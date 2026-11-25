/*
  Migracion de coherencia y operaciones atomicas.
  Ejecutar DESPUES de seguridad-rls.sql desde Supabase SQL Editor.
  Las funciones usan SECURITY DEFINER pero autorizan cada operacion con
  usuario_actual_id() / es_admin(); la anon key no habilita estas acciones.
*/

-- Campos que el frontend necesita y que faltaban en el esquema documentado.
ALTER TABLE solicitudes_prestamo
  ADD COLUMN IF NOT EXISTS tiempo_solicitado_dias SMALLINT NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS id_stock BIGINT REFERENCES stock(id),
  ADD COLUMN IF NOT EXISTS id_lote UUID,
  ADD COLUMN IF NOT EXISTS cantidad_lote SMALLINT,
  ADD COLUMN IF NOT EXISTS indice_lote SMALLINT;
ALTER TABLE solicitudes_prestamo
  ALTER COLUMN estado SET DEFAULT 'Pendiente de Aprobación';

ALTER TABLE material_estudio
  ADD COLUMN IF NOT EXISTS ciclo TEXT,
  ADD COLUMN IF NOT EXISTS tecnicatura TEXT,
  ADD COLUMN IF NOT EXISTS tipo_recurso TEXT NOT NULL DEFAULT 'otro';

-- Algunas instalaciones antiguas guardaron anio_escolar como TEXT.
-- Convertimos 1..7 y variantes como "4to" o "4° año"; valores inválidos
-- quedan NULL en vez de abortar toda la migración.
DO $$
DECLARE v_tipo TEXT;
BEGIN
  SELECT udt_name INTO v_tipo
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'material_estudio'
    AND column_name = 'anio_escolar';

  IF v_tipo IS NOT NULL AND v_tipo <> 'int2' THEN
    ALTER TABLE material_estudio
      ALTER COLUMN anio_escolar TYPE SMALLINT
      USING CASE
        WHEN trim(anio_escolar::text) ~ '^[1-7]([^0-9].*)?$'
          THEN substring(trim(anio_escolar::text) FROM '^[1-7]')::SMALLINT
        ELSE NULL
      END;
  END IF;
END;
$$;

UPDATE material_estudio
SET ciclo = CASE WHEN anio_escolar BETWEEN 1 AND 3 THEN 'basico'
                 WHEN anio_escolar BETWEEN 4 AND 7 THEN 'tecnico' ELSE ciclo END
WHERE ciclo IS NULL AND anio_escolar IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS solicitudes_lote_indice_uidx
  ON solicitudes_prestamo(id_lote, indice_lote) WHERE id_lote IS NOT NULL;

-- Las solicitudes no deben vencer antes de que la bibliotecaria las apruebe.
CREATE OR REPLACE FUNCTION public.fn_calcular_fecha_limite()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.estado = 'Pendiente de Retiro' THEN
    NEW.fecha_limite_retiro := COALESCE(NEW.fecha_limite_retiro, now() + interval '48 hours');
  ELSE
    NEW.fecha_limite_retiro := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS materiales_favoritos (
  id_usuario BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  id_material BIGINT NOT NULL REFERENCES material_estudio(id) ON DELETE CASCADE,
  PRIMARY KEY (id_usuario, id_material)
);
ALTER TABLE materiales_favoritos ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON materiales_favoritos TO authenticated;
REVOKE ALL ON materiales_favoritos FROM anon;

-- El portal solamente puede ver recursos asociados a su ciclo/año/tecnicatura.
DROP POLICY IF EXISTS "auth_select_material" ON material_estudio;
DROP POLICY IF EXISTS "admin_all_material" ON material_estudio;
CREATE POLICY "auth_select_material"
  ON material_estudio FOR SELECT TO authenticated
  USING (
    public.es_admin() OR EXISTS (
      SELECT 1
      FROM usuarios u JOIN cursos c ON c.id = u.id_curso
      WHERE u.id = public.usuario_actual_id()
        AND u.activo IS TRUE
        AND substring(c.nombre FROM '[0-9]+') IS NOT NULL
        AND material_estudio.anio_escolar = substring(c.nombre FROM '[0-9]+')::SMALLINT
        AND (
          (material_estudio.ciclo = 'basico' AND material_estudio.anio_escolar BETWEEN 1 AND 3)
          OR (material_estudio.ciclo = 'tecnico' AND material_estudio.anio_escolar BETWEEN 4 AND 7
              AND (material_estudio.tecnicatura IS NULL
                   OR material_estudio.tecnicatura = c.division
                   OR position(lower(material_estudio.tecnicatura) in lower(c.nombre)) > 0))
        )
    )
  );
CREATE POLICY "admin_all_material"
  ON material_estudio FOR ALL TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());

-- Crea solicitudes con identidad tomada de la sesion; serializa duplicados
-- concurrentes del mismo usuario y libro.
DROP FUNCTION IF EXISTS public.solicitar_libro(BIGINT, INTEGER);
CREATE OR REPLACE FUNCTION public.solicitar_libro(
  p_id_libro BIGINT, p_dias INTEGER, p_cantidad INTEGER DEFAULT 1, p_observaciones TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user usuarios%ROWTYPE; v_disponibles BIGINT; v_lote UUID;
BEGIN
  SELECT * INTO v_user FROM usuarios
  WHERE id = public.usuario_actual_id()
    AND activo IS TRUE AND rol IN ('alumno', 'docente');
  IF NOT FOUND THEN RAISE EXCEPTION 'La cuenta no esta activa o no puede solicitar prestamos.'; END IF;
  IF p_dias IS NULL OR p_dias < 1 OR p_dias > 30 THEN
    RAISE EXCEPTION 'El plazo debe ser de entre 1 y 30 dias.';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad < 1 OR p_cantidad > 40 THEN
    RAISE EXCEPTION 'La cantidad debe estar entre 1 y 40 ejemplares.';
  END IF;
  IF p_cantidad > 1 AND v_user.rol <> 'docente' THEN
    RAISE EXCEPTION 'Solo docentes pueden solicitar lotes para una clase.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM libros WHERE id = p_id_libro) THEN
    RAISE EXCEPTION 'El libro solicitado no existe.';
  END IF;

  PERFORM pg_advisory_xact_lock(27101, hashtext(v_user.id::text || ':' || p_id_libro::text));
  IF EXISTS (
    SELECT 1 FROM solicitudes_prestamo
    WHERE dni = v_user.dni::text AND id_libro = p_id_libro
      AND estado IN ('Pendiente de Aprobación', 'Pendiente de Retiro')
  ) OR EXISTS (
    SELECT 1 FROM prestamos p JOIN stock s ON s.id = p.id_stock
    WHERE p.id_usuario = v_user.id AND s.id_libro = p_id_libro AND p.estado IN ('pendiente', 'activo', 'vencido')
  ) THEN
    RAISE EXCEPTION 'Ya tenes una solicitud abierta para este libro.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM stock s
    WHERE s.id_libro = p_id_libro
      AND NOT EXISTS (SELECT 1 FROM prestamos p WHERE p.id_stock = s.id AND p.estado IN ('pendiente', 'activo', 'vencido'))
      AND NOT EXISTS (SELECT 1 FROM solicitudes_prestamo r WHERE r.id_stock = s.id AND r.estado = 'Pendiente de Retiro')
  ) THEN
    RAISE EXCEPTION 'No hay ejemplares disponibles en este momento.';
  END IF;

  SELECT count(*) INTO v_disponibles FROM stock s
  WHERE s.id_libro = p_id_libro
    AND NOT EXISTS (SELECT 1 FROM prestamos p WHERE p.id_stock = s.id AND p.estado IN ('pendiente', 'activo', 'vencido'))
    AND NOT EXISTS (SELECT 1 FROM solicitudes_prestamo r WHERE r.id_stock = s.id AND r.estado = 'Pendiente de Retiro');
  IF v_disponibles < p_cantidad THEN
    RAISE EXCEPTION 'Hay % ejemplar(es) disponible(s); reduci la cantidad solicitada.', v_disponibles;
  END IF;

  IF p_cantidad > 1 THEN v_lote := gen_random_uuid(); END IF;

  INSERT INTO solicitudes_prestamo
    (nombre_solicitante, apellido_solicitante, dni, email, id_libro, estado,
     tiempo_solicitado_dias, observaciones, id_lote, cantidad_lote, indice_lote)
  SELECT v_user.nombre, v_user.apellido, v_user.dni::text, v_user.email, p_id_libro,
         'Pendiente de Aprobación', p_dias, NULLIF(trim(p_observaciones), ''),
         v_lote, CASE WHEN p_cantidad > 1 THEN p_cantidad::SMALLINT ELSE NULL END,
         CASE WHEN p_cantidad > 1 THEN n::SMALLINT ELSE NULL END
  FROM generate_series(1, p_cantidad) AS n;
  RETURN TRUE;
END;
$$;

-- Reserva un ejemplar mediante bloqueo de fila; la segunda bibliotecaria que
-- intente tomar el mismo ejemplar vuelve a comprobarlo despues del bloqueo.
CREATE OR REPLACE FUNCTION public.asignar_ejemplar_solicitud(p_id_solicitud BIGINT, p_id_stock BIGINT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sol solicitudes_prestamo%ROWTYPE; v_libro BIGINT;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'Solo la bibliotecaria puede asignar ejemplares.'; END IF;
  SELECT * INTO v_sol FROM solicitudes_prestamo WHERE id = p_id_solicitud FOR UPDATE;
  IF NOT FOUND OR v_sol.estado <> 'Pendiente de Aprobación' THEN
    RAISE EXCEPTION 'La solicitud ya no esta pendiente de aprobacion.';
  END IF;
  SELECT id_libro INTO v_libro FROM stock WHERE id = p_id_stock FOR UPDATE;
  IF NOT FOUND OR v_libro <> v_sol.id_libro THEN RAISE EXCEPTION 'El ejemplar no corresponde a este libro.'; END IF;
  IF EXISTS (SELECT 1 FROM prestamos WHERE id_stock = p_id_stock AND estado IN ('pendiente', 'activo', 'vencido'))
     OR EXISTS (SELECT 1 FROM solicitudes_prestamo WHERE id_stock = p_id_stock AND estado = 'Pendiente de Retiro') THEN
    RAISE EXCEPTION 'El ejemplar ya fue asignado o prestado.';
  END IF;
  UPDATE solicitudes_prestamo
  SET estado = 'Pendiente de Retiro', id_stock = p_id_stock,
      fecha_limite_retiro = now() + interval '48 hours'
  WHERE id = p_id_solicitud;
  RETURN now() + interval '48 hours';
END;
$$;

-- Registra prestamo y cierra la reserva en una sola transaccion.
CREATE OR REPLACE FUNCTION public.confirmar_entrega_solicitud(p_id_solicitud BIGINT)
RETURNS DATE
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sol solicitudes_prestamo%ROWTYPE; v_user_id BIGINT; v_fecha DATE; v_dias INTEGER;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'Solo la bibliotecaria puede confirmar entregas.'; END IF;
  SELECT * INTO v_sol FROM solicitudes_prestamo WHERE id = p_id_solicitud FOR UPDATE;
  IF NOT FOUND OR v_sol.estado <> 'Pendiente de Retiro' OR v_sol.id_stock IS NULL THEN
    RAISE EXCEPTION 'La solicitud no esta lista para retiro.';
  END IF;
  IF v_sol.fecha_limite_retiro IS NOT NULL AND v_sol.fecha_limite_retiro < now() THEN
    RAISE EXCEPTION 'La reserva vencio; actualiza la solicitud antes de confirmar el retiro.';
  END IF;
  SELECT id INTO v_user_id FROM usuarios WHERE dni::text = v_sol.dni AND activo IS TRUE LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No se encontro una cuenta asociada al DNI de la solicitud.'; END IF;
  IF EXISTS (SELECT 1 FROM prestamos WHERE id_stock = v_sol.id_stock AND estado IN ('pendiente', 'activo', 'vencido')) THEN
    RAISE EXCEPTION 'El ejemplar ya tiene un prestamo activo.';
  END IF;
  v_dias := COALESCE(v_sol.tiempo_solicitado_dias, 14);
  IF v_dias < 1 OR v_dias > 30 THEN v_dias := 14; END IF;
  v_fecha := current_date + v_dias;
  INSERT INTO prestamos (id_stock, id_usuario, fecha_prestamo, fecha_devolucion, estado)
  VALUES (v_sol.id_stock, v_user_id, current_date, v_fecha, 'activo');
  UPDATE solicitudes_prestamo
  SET estado = 'Retirado', fecha_retiro = current_date, fecha_devolucion = v_fecha
  WHERE id = p_id_solicitud;
  RETURN v_fecha;
END;
$$;

CREATE OR REPLACE FUNCTION public.solicitar_extension(p_id_prestamo BIGINT, p_motivo TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user BIGINT := public.usuario_actual_id();
BEGIN
  IF v_user IS NULL OR length(trim(COALESCE(p_motivo, ''))) = 0 OR length(trim(p_motivo)) > 1000 THEN
    RAISE EXCEPTION 'Ingresá un motivo para solicitar la extension.';
  END IF;
  PERFORM pg_advisory_xact_lock(27102, hashtext(p_id_prestamo::text));
  IF NOT EXISTS (SELECT 1 FROM prestamos WHERE id = p_id_prestamo AND id_usuario = v_user AND estado IN ('activo', 'vencido')) THEN
    RAISE EXCEPTION 'Solo se puede pedir una extension para un prestamo activo o vencido propio.';
  END IF;
  IF EXISTS (SELECT 1 FROM solicitudes_extension WHERE id_prestamo = p_id_prestamo AND estado = 'Pendiente') THEN
    RAISE EXCEPTION 'Ya existe una extension pendiente para este prestamo.';
  END IF;
  INSERT INTO solicitudes_extension (id_prestamo, motivo, estado)
  VALUES (p_id_prestamo, trim(p_motivo), 'Pendiente');
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolver_extension(
  p_id_extension BIGINT, p_aprobar BOOLEAN, p_nueva_fecha DATE DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ext solicitudes_extension%ROWTYPE; v_prestamo prestamos%ROWTYPE;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'Solo la bibliotecaria puede resolver extensiones.'; END IF;
  SELECT * INTO v_ext FROM solicitudes_extension WHERE id = p_id_extension FOR UPDATE;
  IF NOT FOUND OR v_ext.estado <> 'Pendiente' THEN RAISE EXCEPTION 'La extension ya fue resuelta.'; END IF;
  IF p_aprobar THEN
    IF p_nueva_fecha IS NULL OR p_nueva_fecha <= current_date THEN RAISE EXCEPTION 'La nueva fecha debe ser posterior a hoy.'; END IF;
    SELECT * INTO v_prestamo FROM prestamos WHERE id = v_ext.id_prestamo FOR UPDATE;
    IF NOT FOUND OR v_prestamo.estado NOT IN ('activo', 'vencido') THEN
      RAISE EXCEPTION 'El prestamo ya no admite extensiones.';
    END IF;
    UPDATE prestamos SET fecha_devolucion = p_nueva_fecha WHERE id = v_ext.id_prestamo;
    UPDATE solicitudes_extension SET estado = 'Aprobada' WHERE id = p_id_extension;
  ELSE
    UPDATE solicitudes_extension SET estado = 'Rechazada' WHERE id = p_id_extension;
  END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_prestamos_admin(p_id_usuario BIGINT, p_items JSONB)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_item RECORD; v_count INTEGER := 0; v_hoy DATE := current_date;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'Solo la bibliotecaria puede registrar prestamos.'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'El lote debe incluir entre 1 y 40 ejemplares.';
  END IF;
  IF jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 40 THEN
    RAISE EXCEPTION 'El lote debe incluir entre 1 y 40 ejemplares.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_id_usuario AND activo IS TRUE) THEN
    RAISE EXCEPTION 'El usuario no existe o esta inactivo.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) AS x(id_stock BIGINT, fecha_devolucion DATE)
    GROUP BY id_stock HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'El lote contiene un ejemplar repetido.'; END IF;

  -- Bloqueo consistente por ID para que operaciones concurrentes no asignen el mismo ejemplar.
  FOR v_item IN SELECT id_stock, fecha_devolucion
    FROM jsonb_to_recordset(p_items) AS x(id_stock BIGINT, fecha_devolucion DATE)
    ORDER BY id_stock
  LOOP
    PERFORM 1 FROM stock WHERE id = v_item.id_stock FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No se encontro el ejemplar %.', v_item.id_stock; END IF;
    IF v_item.fecha_devolucion IS NULL OR v_item.fecha_devolucion <= v_hoy THEN
      RAISE EXCEPTION 'Cada fecha de devolucion debe ser posterior a hoy.';
    END IF;
    IF EXISTS (SELECT 1 FROM prestamos WHERE id_stock = v_item.id_stock AND estado IN ('pendiente', 'activo', 'vencido'))
       OR EXISTS (SELECT 1 FROM solicitudes_prestamo WHERE id_stock = v_item.id_stock AND estado = 'Pendiente de Retiro') THEN
      RAISE EXCEPTION 'El ejemplar % ya esta asignado o prestado.', v_item.id_stock;
    END IF;
  END LOOP;

  INSERT INTO prestamos (id_stock, id_usuario, fecha_prestamo, fecha_devolucion, estado)
  SELECT x.id_stock, p_id_usuario, v_hoy, x.fecha_devolucion, 'activo'
  FROM jsonb_to_recordset(p_items) AS x(id_stock BIGINT, fecha_devolucion DATE);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.aprobar_prestamo_pendiente(p_id_prestamo BIGINT)
RETURNS DATE
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_p prestamos%ROWTYPE; v_hoy DATE := current_date;
BEGIN
  IF NOT public.es_admin() THEN RAISE EXCEPTION 'Solo la bibliotecaria puede aprobar prestamos.'; END IF;
  SELECT * INTO v_p FROM prestamos WHERE id = p_id_prestamo FOR UPDATE;
  IF NOT FOUND OR v_p.estado <> 'pendiente' THEN RAISE EXCEPTION 'El prestamo ya no esta pendiente.'; END IF;
  PERFORM 1 FROM stock WHERE id = v_p.id_stock FOR UPDATE;
  IF EXISTS (SELECT 1 FROM prestamos WHERE id_stock = v_p.id_stock AND estado IN ('pendiente', 'activo', 'vencido') AND id <> p_id_prestamo)
     OR EXISTS (SELECT 1 FROM solicitudes_prestamo WHERE id_stock = v_p.id_stock AND estado = 'Pendiente de Retiro') THEN
    RAISE EXCEPTION 'El ejemplar ya esta asignado o prestado.';
  END IF;
  UPDATE prestamos SET estado = 'activo', fecha_prestamo = v_hoy, fecha_devolucion = v_hoy + 14
  WHERE id = p_id_prestamo;
  RETURN v_hoy + 14;
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_libro(BIGINT, INTEGER, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asignar_ejemplar_solicitud(BIGINT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirmar_entrega_solicitud(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solicitar_extension(BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolver_extension(BIGINT, BOOLEAN, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_prestamos_admin(BIGINT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aprobar_prestamo_pendiente(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.solicitar_libro(BIGINT, INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asignar_ejemplar_solicitud(BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_entrega_solicitud(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.solicitar_extension(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolver_extension(BIGINT, BOOLEAN, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_prestamos_admin(BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aprobar_prestamo_pendiente(BIGINT) TO authenticated;

-- Verificacion previa de duplicados antes de sumar restricciones adicionales:
-- SELECT id_stock, count(*) FROM prestamos WHERE estado IN ('activo','vencido')
-- GROUP BY id_stock HAVING count(*) > 1;
