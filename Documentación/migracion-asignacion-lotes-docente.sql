/*
  Asignación masiva y transaccional de ejemplares para solicitudes docentes
  por lote.

  Ejecutar una vez desde Supabase SQL Editor, después de las migraciones
  seguridad-rls.sql y migracion-flujos-criticos.sql.

  La función conserva el seguimiento por número de inventario: selecciona
  ejemplares libres en orden de inventario y los asigna a todas las solicitudes
  pendientes del mismo lote dentro de una sola transacción.

  También registra lotes de clase con vencimiento el mismo día y deja sus
  préstamos vinculados para que los paneles muestren un registro agrupado.
*/

ALTER TABLE prestamos
  ADD COLUMN IF NOT EXISTS id_lote UUID,
  ADD COLUMN IF NOT EXISTS cantidad_lote SMALLINT,
  ADD COLUMN IF NOT EXISTS observaciones TEXT;

CREATE INDEX IF NOT EXISTS prestamos_lote_idx
  ON prestamos(id_lote) WHERE id_lote IS NOT NULL;

CREATE OR REPLACE FUNCTION public.asignar_lote_solicitud(p_id_solicitud BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sol solicitudes_prestamo%ROWTYPE;
  v_pendientes INTEGER;
  v_stock_ids BIGINT[];
  v_fecha_limite TIMESTAMPTZ := now() + interval '48 hours';
  v_actualizados INTEGER;
BEGIN
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo la bibliotecaria puede asignar ejemplares.';
  END IF;

  SELECT * INTO v_sol
  FROM solicitudes_prestamo
  WHERE id = p_id_solicitud;

  IF NOT FOUND OR v_sol.estado <> 'Pendiente de Aprobación' THEN
    RAISE EXCEPTION 'La solicitud ya no está pendiente de aprobación.';
  END IF;
  IF v_sol.id_lote IS NULL OR COALESCE(v_sol.cantidad_lote, 0) < 2 THEN
    RAISE EXCEPTION 'La solicitud no pertenece a un lote.';
  END IF;

  -- Bloquea el lote en orden estable para evitar que dos administradores
  -- asignen simultáneamente las mismas filas.
  PERFORM id
  FROM solicitudes_prestamo
  WHERE id_lote = v_sol.id_lote
    AND estado = 'Pendiente de Aprobación'
  ORDER BY indice_lote NULLS LAST, id
  FOR UPDATE;

  -- Revalidar la fila seleccionada luego de obtener los bloqueos.
  SELECT * INTO v_sol
  FROM solicitudes_prestamo
  WHERE id = p_id_solicitud
  FOR UPDATE;

  IF NOT FOUND OR v_sol.estado <> 'Pendiente de Aprobación' THEN
    RAISE EXCEPTION 'La solicitud ya fue procesada por otro usuario.';
  END IF;

  SELECT count(*) INTO v_pendientes
  FROM solicitudes_prestamo
  WHERE id_lote = v_sol.id_lote
    AND id_libro = v_sol.id_libro
    AND estado = 'Pendiente de Aprobación';

  IF v_pendientes = 0 THEN
    RAISE EXCEPTION 'El lote ya no tiene solicitudes pendientes.';
  END IF;

  -- Reserva los ejemplares libres con bloqueo de fila. Los códigos no se
  -- ingresan manualmente, pero cada préstamo sigue asociado a su inventario.
  SELECT array_agg(libres.id ORDER BY libres.nro_inventario, libres.id)
  INTO v_stock_ids
  FROM (
    SELECT st.id, st.nro_inventario
    FROM stock st
    WHERE st.id_libro = v_sol.id_libro
      AND NOT EXISTS (
        SELECT 1 FROM prestamos p
        WHERE p.id_stock = st.id
          AND p.estado IN ('pendiente', 'activo', 'vencido')
      )
      AND NOT EXISTS (
        SELECT 1 FROM solicitudes_prestamo s
        WHERE s.id_stock = st.id
          AND s.estado = 'Pendiente de Retiro'
      )
    ORDER BY st.nro_inventario, st.id
    LIMIT v_pendientes
    FOR UPDATE OF st SKIP LOCKED
  ) AS libres;

  IF COALESCE(cardinality(v_stock_ids), 0) < v_pendientes THEN
    RAISE EXCEPTION 'No hay suficientes ejemplares libres para completar el lote. Pendientes: %, disponibles: %.',
      v_pendientes, COALESCE(cardinality(v_stock_ids), 0);
  END IF;

  WITH solicitudes AS (
    SELECT id, row_number() OVER (ORDER BY indice_lote NULLS LAST, id) AS orden
    FROM solicitudes_prestamo
    WHERE id_lote = v_sol.id_lote
      AND id_libro = v_sol.id_libro
      AND estado = 'Pendiente de Aprobación'
  )
  UPDATE solicitudes_prestamo destino
  SET estado = 'Pendiente de Retiro',
      id_stock = v_stock_ids[solicitudes.orden],
      fecha_limite_retiro = v_fecha_limite
  FROM solicitudes
  WHERE destino.id = solicitudes.id;

  GET DIAGNOSTICS v_actualizados = ROW_COUNT;
  IF v_actualizados <> v_pendientes THEN
    RAISE EXCEPTION 'No se pudo asignar el lote completo; no se guardaron cambios.';
  END IF;

  RETURN v_actualizados;
END;
$$;

REVOKE ALL ON FUNCTION public.asignar_lote_solicitud(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asignar_lote_solicitud(BIGINT) TO authenticated;

-- Confirma la entrega completa de un lote y registra su devolución para hoy.
-- Internamente guarda una fila por ejemplar para conservar la trazabilidad.
CREATE OR REPLACE FUNCTION public.confirmar_entrega_lote(p_id_solicitud BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sol solicitudes_prestamo%ROWTYPE;
  v_user_id BIGINT;
  v_cantidad INTEGER;
  v_stock_distintos INTEGER;
  v_stock_ids BIGINT[];
  v_fecha DATE := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE;
  v_actualizados INTEGER;
BEGIN
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo la bibliotecaria puede confirmar entregas.';
  END IF;

  SELECT * INTO v_sol
  FROM solicitudes_prestamo
  WHERE id = p_id_solicitud;

  IF NOT FOUND OR v_sol.estado <> 'Pendiente de Retiro' OR v_sol.id_lote IS NULL THEN
    RAISE EXCEPTION 'La solicitud no pertenece a un lote listo para retirar.';
  END IF;

  -- Bloqueo estable de todas las solicitudes del lote para que la confirmación
  -- no compita con otra bibliotecaria que esté procesando la misma entrega.
  PERFORM id
  FROM solicitudes_prestamo
  WHERE id_lote = v_sol.id_lote
    AND estado = 'Pendiente de Retiro'
  ORDER BY indice_lote NULLS LAST, id
  FOR UPDATE;

  SELECT * INTO v_sol
  FROM solicitudes_prestamo
  WHERE id = p_id_solicitud
  FOR UPDATE;

  IF NOT FOUND OR v_sol.estado <> 'Pendiente de Retiro' THEN
    RAISE EXCEPTION 'El lote ya fue procesado por otro usuario.';
  END IF;

  SELECT count(*), count(DISTINCT id_stock), array_agg(id_stock ORDER BY indice_lote NULLS LAST, id)
  INTO v_cantidad, v_stock_distintos, v_stock_ids
  FROM solicitudes_prestamo
  WHERE id_lote = v_sol.id_lote
    AND id_libro = v_sol.id_libro
    AND estado = 'Pendiente de Retiro'
    AND id_stock IS NOT NULL;

  IF v_cantidad < 2 OR v_cantidad <> COALESCE(v_sol.cantidad_lote, v_cantidad)
     OR v_stock_distintos <> v_cantidad
     OR cardinality(v_stock_ids) <> v_cantidad THEN
    RAISE EXCEPTION 'El lote está incompleto. No se confirmó ninguna entrega.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM solicitudes_prestamo
    WHERE id_lote = v_sol.id_lote
      AND estado = 'Pendiente de Retiro'
      AND fecha_limite_retiro IS NOT NULL
      AND fecha_limite_retiro < now()
  ) THEN
    RAISE EXCEPTION 'La reserva del lote venció; actualizá la solicitud antes de entregarlo.';
  END IF;

  SELECT id INTO v_user_id
  FROM usuarios
  WHERE dni::text = v_sol.dni
    AND activo IS TRUE
    AND rol = 'docente'
  LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró una cuenta docente activa asociada a la solicitud.';
  END IF;

  PERFORM id FROM stock
  WHERE id = ANY(v_stock_ids)
  ORDER BY id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM prestamos
    WHERE id_stock = ANY(v_stock_ids)
      AND estado IN ('pendiente', 'activo', 'vencido')
  ) THEN
    RAISE EXCEPTION 'Uno o más ejemplares del lote ya tienen un préstamo activo.';
  END IF;

  INSERT INTO prestamos
    (id_stock, id_usuario, fecha_prestamo, fecha_devolucion, estado,
     id_lote, cantidad_lote, observaciones)
  SELECT s.id_stock, v_user_id, v_fecha, v_fecha, 'activo',
         v_sol.id_lote, v_cantidad::SMALLINT, v_sol.observaciones
  FROM solicitudes_prestamo s
  WHERE s.id_lote = v_sol.id_lote
    AND s.id_libro = v_sol.id_libro
    AND s.estado = 'Pendiente de Retiro'
  ORDER BY s.indice_lote NULLS LAST, s.id;

  UPDATE solicitudes_prestamo
  SET estado = 'Retirado', fecha_retiro = v_fecha, fecha_devolucion = v_fecha
  WHERE id_lote = v_sol.id_lote
    AND id_libro = v_sol.id_libro
    AND estado = 'Pendiente de Retiro';

  GET DIAGNOSTICS v_actualizados = ROW_COUNT;
  IF v_actualizados <> v_cantidad THEN
    RAISE EXCEPTION 'No se pudo confirmar el lote completo; no se guardaron cambios.';
  END IF;

  RETURN v_actualizados;
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_entrega_lote(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_entrega_lote(BIGINT) TO authenticated;

-- Una solicitud de clase de un solo ejemplar también debe volver hoy y dejar
-- guardado el curso/materia indicado por el docente.
CREATE OR REPLACE FUNCTION public.confirmar_entrega_solicitud(p_id_solicitud BIGINT)
RETURNS DATE
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sol solicitudes_prestamo%ROWTYPE;
  v_user_id BIGINT;
  v_rol TEXT;
  v_dias INTEGER;
  v_fecha DATE;
  v_es_lote_clase BOOLEAN;
BEGIN
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo la bibliotecaria puede confirmar entregas.';
  END IF;

  SELECT * INTO v_sol
  FROM solicitudes_prestamo
  WHERE id = p_id_solicitud
  FOR UPDATE;

  IF NOT FOUND OR v_sol.estado <> 'Pendiente de Retiro' OR v_sol.id_stock IS NULL THEN
    RAISE EXCEPTION 'La solicitud no está lista para retiro.';
  END IF;
  IF v_sol.fecha_limite_retiro IS NOT NULL AND v_sol.fecha_limite_retiro < now() THEN
    RAISE EXCEPTION 'La reserva venció; actualizá la solicitud antes de confirmar el retiro.';
  END IF;

  SELECT id, rol INTO v_user_id, v_rol
  FROM usuarios
  WHERE dni::text = v_sol.dni AND activo IS TRUE
  LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró una cuenta activa asociada a la solicitud.';
  END IF;

  PERFORM id FROM stock WHERE id = v_sol.id_stock FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM prestamos
    WHERE id_stock = v_sol.id_stock
      AND estado IN ('pendiente', 'activo', 'vencido')
  ) THEN
    RAISE EXCEPTION 'El ejemplar ya tiene un préstamo activo.';
  END IF;

  v_es_lote_clase := v_rol = 'docente'
    AND COALESCE(v_sol.observaciones, '') LIKE 'Lote para clase:%';
  v_dias := COALESCE(v_sol.tiempo_solicitado_dias, 14);
  IF v_dias < 1 OR v_dias > 30 THEN v_dias := 14; END IF;
  v_fecha := CASE
    WHEN v_es_lote_clase THEN (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE
    ELSE current_date + v_dias
  END;

  INSERT INTO prestamos
    (id_stock, id_usuario, fecha_prestamo, fecha_devolucion, estado,
     id_lote, cantidad_lote, observaciones)
  VALUES (
    v_sol.id_stock, v_user_id,
    CASE WHEN v_es_lote_clase THEN v_fecha ELSE current_date END,
    v_fecha, 'activo',
    v_sol.id_lote,
    CASE WHEN v_es_lote_clase THEN COALESCE(v_sol.cantidad_lote, 1) ELSE NULL END,
    v_sol.observaciones
  );

  UPDATE solicitudes_prestamo
  SET estado = 'Retirado',
      fecha_retiro = CASE WHEN v_es_lote_clase THEN v_fecha ELSE current_date END,
      fecha_devolucion = v_fecha
  WHERE id = p_id_solicitud;

  RETURN v_fecha;
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_entrega_solicitud(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_entrega_solicitud(BIGINT) TO authenticated;

NOTIFY pgrst, 'reload schema';
