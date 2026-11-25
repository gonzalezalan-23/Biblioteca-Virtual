/* ============================================================
   SEGURIDAD-RLS.SQL — Biblioteca Virtual EEST N°5
   ------------------------------------------------------------
   Ejecutar COMPLETO en: Supabase Dashboard → SQL Editor → New query
   Es idempotente: puede re-ejecutarse sin romper nada (usa
   IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS).
   Leer también: Documentación/SEGURIDAD.md
   ============================================================

   QUÉ HACE:
   1. Crea la tabla `solicitudes_extension` si no existe (estaba
      documentada en database.md pero NO existía en la BD: su
      ausencia hacía abortar todo el script en la PARTE 1).
   2. Habilita Row Level Security (RLS) en TODAS las tablas.
   3. Elimina el riesgo crítico de volcar la tabla `usuarios` con
      la anon key: borra TODAS las políticas heredadas (incluidas
      las viejas USING (true) que todavía filtran `usuarios`,
      `prestamos` y `material_estudio` a la anon key).
   4. Reemplaza esas lecturas por funciones RPC seguras
      (login_lookup, dni_registrado, public_stats).
   5. Da al panel admin acceso completo SOLO si el usuario
      autenticado tiene rol = 'admin' y activo = true.
   6. Crea la vista `prestamos_publicos` para que el catálogo
      público calcule disponibilidad sin exponer préstamos.
   7. Aplica los índices pendientes de rendimiento.
   8. Incluye el bloque para dar de alta el PRIMER administrador.

   NOTAS DE TIPOS (verificado contra la BD real):
   - `usuarios.dni` es BIGINT, mientras que `solicitudes_prestamo.dni`
     es TEXT. Todas las comparaciones se hacen casteando a TEXT
     (`u.dni::text = p_dni`), si no Postgres tira
     "operator does not exist: bigint = text".
   ============================================================ */

-- ============================================================
-- PARTE 0 — Funciones auxiliares (SECURITY DEFINER)
-- ============================================================

-- ¿El usuario autenticado es admin activo?
-- SECURITY DEFINER evita la recursión de RLS al consultar `usuarios`.
CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE lower(u.email) = lower(auth.jwt() ->> 'email')
      AND u.rol = 'admin'
      AND u.activo IS TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.es_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.es_admin() TO authenticated;

-- id del usuario autenticado en la tabla `usuarios`
-- (BIGINT: `usuarios.id` es BIGINT en la BD real, evitar cast a INT.
--  Verificado el 11/11/2026: la función NO existe todavía, así que
--  CREATE OR REPLACE la crea directo con este tipo de retorno)
CREATE OR REPLACE FUNCTION public.usuario_actual_id()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id FROM usuarios u
  WHERE lower(u.email) = lower(auth.jwt() ->> 'email')
    AND u.activo IS TRUE
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.usuario_actual_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.usuario_actual_id() TO authenticated;

-- Login por DNI: devuelve email/rol/activo de UN solo DNI.
-- Reemplaza el SELECT anónimo directo sobre `usuarios`
-- (que permitía descargar la tabla completa de menores).
CREATE OR REPLACE FUNCTION public.login_lookup(p_dni TEXT)
RETURNS TABLE(email TEXT, rol TEXT, activo BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.email, u.rol, u.activo
  FROM usuarios u
  WHERE u.dni::text = p_dni
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.login_lookup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_lookup(TEXT) TO anon, authenticated;

-- Registro público: estado de un DNI (no expone más datos).
CREATE OR REPLACE FUNCTION public.dni_registrado(p_dni TEXT)
RETURNS TEXT   -- 'libre' | 'pendiente' | 'activo'
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.dni::text = p_dni) THEN 'libre'
    WHEN EXISTS (SELECT 1 FROM usuarios u WHERE u.dni::text = p_dni AND u.activo IS NOT FALSE) THEN 'activo'
    ELSE 'pendiente'
  END;
$$;

REVOKE ALL ON FUNCTION public.dni_registrado(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dni_registrado(TEXT) TO anon;

-- Estadísticas públicas del sitio (sin exponer tablas).
CREATE OR REPLACE FUNCTION public.public_stats()
RETURNS TABLE(
  ejemplares      BIGINT,
  libros          BIGINT,
  prestamos_total BIGINT,
  devueltos       BIGINT,
  categorias      BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM stock),
    (SELECT count(*) FROM libros),
    (SELECT count(*) FROM prestamos),
    (SELECT count(*) FROM prestamos WHERE estado = 'devuelto'),
    (SELECT count(*) FROM categorias);
$$;

REVOKE ALL ON FUNCTION public.public_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_stats() TO anon, authenticated;

-- La vista pública se crea sobre el ejemplar asignado a cada reserva.
ALTER TABLE solicitudes_prestamo
  ADD COLUMN IF NOT EXISTS id_stock BIGINT REFERENCES stock(id);

-- Vista pública: préstamos NO devueltos con solo id_libro.
-- El sitio público calcula disponibilidad (stock − prestados) con esto,
-- sin ver quién tiene cada libro.
CREATE OR REPLACE VIEW public.prestamos_publicos AS
SELECT min(o.id) AS id, o.id_stock, o.id_libro, 'ocupado'::TEXT AS estado
FROM (
  SELECT p.id::BIGINT AS id, p.id_stock::BIGINT AS id_stock,
         s.id_libro::BIGINT AS id_libro
  FROM prestamos p JOIN stock s ON s.id = p.id_stock
  WHERE p.estado IN ('pendiente', 'activo', 'vencido')
  UNION ALL
  SELECT r.id::BIGINT, r.id_stock::BIGINT, r.id_libro::BIGINT
  FROM solicitudes_prestamo r
  WHERE r.estado = 'Pendiente de Retiro' AND r.id_stock IS NOT NULL
) o
GROUP BY o.id_stock, o.id_libro;

GRANT SELECT ON public.prestamos_publicos TO anon, authenticated;

-- ============================================================
-- PARTE 0.5 — Tabla faltante: solicitudes_extension
-- ------------------------------------------------------------
-- Existe en Documentación/database.md y la usa el panel de alumno
-- (botón "Solicitar extensión" → portal.js enviarExtension()),
-- pero NUNCA se creó en la BD. Sin este bloque, el script moría
-- en el ALTER TABLE de la PARTE 1 y NO se aplicaba NINGUNA
-- política de seguridad (era el motivo por el que el script
-- "funcionaba" pero no cerraba la fuga de `usuarios`).
-- ============================================================
CREATE TABLE IF NOT EXISTS solicitudes_extension (
  id               BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  id_prestamo      BIGINT NOT NULL
                     REFERENCES prestamos(id) ON DELETE CASCADE,
  motivo           TEXT   NOT NULL,
  estado           TEXT   NOT NULL DEFAULT 'Pendiente'
                     CHECK (estado IN ('Pendiente', 'Aprobada', 'Rechazada')),
  fecha_solicitud  TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE solicitudes_extension IS
  'Pedidos de extensión de plazo enviados por alumnos/docentes desde su panel.';

-- Permisos explícitos (no dependemos de las default privileges):
-- RLS es la que realmente decide: no hay política para `anon`,
-- así que el rol anónimo queda igualmente bloqueado.
GRANT SELECT, INSERT, UPDATE, DELETE ON solicitudes_extension
  TO authenticated, service_role;

-- ============================================================
-- PARTE 1 — Habilitar RLS en todas las tablas
-- (sin políticas, todo queda BLOQUEADO salvo las que agregamos abajo)
-- ============================================================

ALTER TABLE cursos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE autores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias         ENABLE ROW LEVEL SECURITY;
ALTER TABLE libros             ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock              ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE prestamos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_prestamo    ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_extension   ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_estudio        ENABLE ROW LEVEL SECURITY;
-- Tabla usada por el panel de alumno (favoritos).
CREATE TABLE IF NOT EXISTS materiales_favoritos (
  id_usuario BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  id_material BIGINT NOT NULL REFERENCES material_estudio(id) ON DELETE CASCADE,
  PRIMARY KEY (id_usuario, id_material)
);
ALTER TABLE materiales_favoritos    ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON materiales_favoritos TO authenticated;
REVOKE ALL ON materiales_favoritos FROM anon;
-- Módulo académico (desactivado en el front):
DO $$ BEGIN
  ALTER TABLE academico ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Quitar la política peligrosa anterior de `usuarios` (si existe):
DROP POLICY IF EXISTS "registro_publico_select_dni" ON usuarios;

-- ------------------------------------------------------------
-- Limpieza TOTAL de políticas heredadas
-- ------------------------------------------------------------
-- Hoy la BD ya tiene RLS activo con políticas viejas que permiten
-- leer `usuarios` (emails y DNIs de todos los menores),
-- `prestamos` (quién tiene cada libro) y `material_estudio` con la
-- anon key. Si no se borran, siguen vigentes aunque este script
-- agregue las suyas (las políticas son aditivas / OR entre ellas).
-- Además garantiza la idempotencia: cualquier re-ejecución del
-- script vuelve a un estado conocido sin error 42710.
-- ------------------------------------------------------------
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN (
             'cursos', 'autores', 'categorias', 'libros', 'stock',
             'usuarios', 'prestamos', 'solicitudes_prestamo',
             'solicitudes_extension', 'material_estudio',
             'materiales_favoritos', 'academico'
           )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I',
                   pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- ============================================================
-- PARTE 2 — Políticas de LECTURA públicas (catálogo)
-- ============================================================

CREATE POLICY "anon_select_cursos"      ON cursos      FOR SELECT TO anon USING (true);
CREATE POLICY "auth_select_cursos"      ON cursos      FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon_select_autores"     ON autores     FOR SELECT TO anon USING (true);
CREATE POLICY "auth_select_autores"     ON autores     FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon_select_categorias"  ON categorias  FOR SELECT TO anon USING (true);
CREATE POLICY "auth_select_categorias"  ON categorias  FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon_select_libros"      ON libros      FOR SELECT TO anon USING (true);
CREATE POLICY "auth_select_libros"      ON libros      FOR SELECT TO authenticated USING (true);
CREATE POLICY "anon_select_stock"       ON stock       FOR SELECT TO anon USING (true);
CREATE POLICY "auth_select_stock"       ON stock       FOR SELECT TO authenticated USING (true);
-- La lectura segmentada de material se habilita en migracion-flujos-criticos.sql.

-- ============================================================
-- PARTE 3 — usuarios
-- ============================================================

-- Registro público: solo puede INSERTAR cuentas inactivas
CREATE POLICY "registro_publico_insert"
  ON usuarios FOR INSERT TO anon
  WITH CHECK (activo = false);

-- Cualquier usuario autenticado lee SU fila (login, panel, admin guard)
CREATE POLICY "usuario_lee_su_fila"
  ON usuarios FOR SELECT TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email') AND activo IS TRUE);

-- Admin: acceso completo a usuarios
DROP POLICY IF EXISTS "admin_all_usuarios" ON usuarios;
CREATE POLICY "admin_all_usuarios"
  ON usuarios FOR ALL TO authenticated
  USING (public.es_admin())
  WITH CHECK (public.es_admin());

-- ============================================================
-- PARTE 4 — prestamos
-- ============================================================

-- El usuario autenticado ve SUS préstamos
CREATE POLICY "usuario_sel_sus_prestamos"
  ON prestamos FOR SELECT TO authenticated
  USING (id_usuario = public.usuario_actual_id());

-- Alta de solicitud desde el modal público: solo el propio usuario
-- y solo como 'pendiente' (la bibliotecaria luego lo gestiona).
-- Las altas de solicitudes pasan por RPC SECURITY DEFINER.

-- Admin: acceso completo
DROP POLICY IF EXISTS "admin_all_prestamos" ON prestamos;
CREATE POLICY "admin_all_prestamos"
  ON prestamos FOR ALL TO authenticated
  USING (public.es_admin())
  WITH CHECK (public.es_admin());

-- ============================================================
-- PARTE 5 — solicitudes_prestamo (reservas online)
-- ============================================================

-- Sin INSERT directo: solicitar_libro valida los datos del usuario y el libro.

-- El alumno/docente ve las solicitudes con su propio DNI
-- OJO: `usuarios.dni` es BIGINT y `solicitudes_prestamo.dni` es TEXT,
-- hay que castear a TEXT o Postgres tira "operator does not exist".
CREATE POLICY "auth_sel_solicitud_propia"
  ON solicitudes_prestamo FOR SELECT TO authenticated
  USING (
    dni = ((SELECT u.dni FROM usuarios u
            WHERE lower(u.email) = lower(auth.jwt() ->> 'email'))::text)
  );

DROP POLICY IF EXISTS "admin_all_solicitudes" ON solicitudes_prestamo;
CREATE POLICY "admin_all_solicitudes"
  ON solicitudes_prestamo FOR ALL TO authenticated
  USING (public.es_admin())
  WITH CHECK (public.es_admin());

-- ============================================================
-- PARTE 6 — solicitudes_extension
-- ============================================================

-- La creación de extensiones pasa por solicitar_extension para validar
-- estado del préstamo y evitar solicitudes pendientes duplicadas.

CREATE POLICY "auth_sel_extension_propia"
  ON solicitudes_extension FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM prestamos p
      WHERE p.id = id_prestamo
        AND p.id_usuario = public.usuario_actual_id()
    )
  );

DROP POLICY IF EXISTS "admin_all_extensiones" ON solicitudes_extension;
CREATE POLICY "admin_all_extensiones"
  ON solicitudes_extension FOR ALL TO authenticated
  USING (public.es_admin())
  WITH CHECK (public.es_admin());

-- ============================================================
-- PARTE 7 — materiales_favoritos (solo filas propias)
-- ============================================================

DO $$ BEGIN
  DROP POLICY IF EXISTS "fav_sel_propios"  ON materiales_favoritos;
  DROP POLICY IF EXISTS "fav_ins_propios"  ON materiales_favoritos;
  DROP POLICY IF EXISTS "fav_del_propios"  ON materiales_favoritos;
  CREATE POLICY "fav_sel_propios" ON materiales_favoritos
    FOR SELECT TO authenticated
    USING (id_usuario = public.usuario_actual_id());
  CREATE POLICY "fav_ins_propios" ON materiales_favoritos
    FOR INSERT TO authenticated
    WITH CHECK (id_usuario = public.usuario_actual_id());
  CREATE POLICY "fav_del_propios" ON materiales_favoritos
    FOR DELETE TO authenticated
    USING (id_usuario = public.usuario_actual_id());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- PARTE 8 — escritura admin en catálogo e inventario
-- ============================================================

DROP POLICY IF EXISTS "admin_all_libros" ON libros;
CREATE POLICY "admin_all_libros" ON libros FOR ALL TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());

DROP POLICY IF EXISTS "admin_all_stock" ON stock;
CREATE POLICY "admin_all_stock" ON stock FOR ALL TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());

DROP POLICY IF EXISTS "admin_all_autores" ON autores;
CREATE POLICY "admin_all_autores" ON autores FOR ALL TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());

DROP POLICY IF EXISTS "admin_all_categorias" ON categorias;
CREATE POLICY "admin_all_categorias" ON categorias FOR ALL TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());

DROP POLICY IF EXISTS "admin_all_cursos" ON cursos;
CREATE POLICY "admin_all_cursos" ON cursos FOR ALL TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());

DROP POLICY IF EXISTS "admin_all_material" ON material_estudio;
CREATE POLICY "admin_all_material" ON material_estudio FOR ALL TO authenticated
  USING (public.es_admin()) WITH CHECK (public.es_admin());

DO $$ BEGIN
  DROP POLICY IF EXISTS "admin_all_academico" ON academico;
  CREATE POLICY "admin_all_academico" ON academico FOR ALL TO authenticated
    USING (public.es_admin()) WITH CHECK (public.es_admin());
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================
-- PARTE 9 — índices de rendimiento (pendientes)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_prestamos_estado      ON prestamos(estado);
CREATE INDEX IF NOT EXISTS idx_prestamos_id_usuario  ON prestamos(id_usuario);
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado    ON solicitudes_prestamo(estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_dni       ON solicitudes_prestamo(dni);

-- ============================================================
-- PARTE 9.5 — Diagnóstico (sólo imprime avisos, no cambia nada)
-- ============================================================
-- Muestra los CHECK de `estado` en las dos tablas de movimiento.
-- Si el aviso de `prestamos` muestra un CHECK que NO incluye
-- 'pendiente', el modal público de reserva va a fallar con 23514;
-- en ese caso sacalo con:
--   ALTER TABLE prestamos DROP CONSTRAINT <nombre_del_check>;
-- (verificado el 11/11/2026: el CHECK de `solicitudes_prestamo`
--  acepta los 5 valores que usa el código: 'Pendiente de Aprobación',
--  'Pendiente de Retiro', 'Retirado', 'Rechazado' y 'Vencido')
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conrelid::regclass::text AS tabla,
           conname,
           pg_get_constraintdef(oid) AS definicion
      FROM pg_constraint
     WHERE contype = 'c'
       AND conrelid IN ('prestamos'::regclass, 'solicitudes_prestamo'::regclass)
  LOOP
    RAISE NOTICE '[CHECK] %.% → %', c.tabla, c.conname, c.definicion;
  END LOOP;
END $$;

-- ============================================================
-- PARTE 10 — ALTA DEL PRIMER ADMINISTRADOR  (EDITAR ANTES DE EJECUTAR)
-- ------------------------------------------------------------
-- Hoy NO existe ningún usuario con rol = 'admin' en `usuarios`
-- (verificado: los 21 usuarios son 'alumno' o 'docente').
-- Sin esta fila, es_admin() devuelve false para todos y el
-- guardián del panel admin (admin/assets/js/db.js) cierra la puerta.
--
-- REQUISITO: el email debe existir también en Supabase Auth
-- (Dashboard → Authentication → Users). Si todavía no está,
-- crealo ahí primero con "Add user" y "Auto Confirm" activado,
-- o aprobá la cuenta desde el panel admin.
--
-- ▼▼▼ REEMPLAZÁ el email de abajo por el del administrador ▼▼▼
UPDATE usuarios
   SET rol    = 'admin',
       activo = true
 WHERE lower(email) = lower('cambiar-por-tu-email@ejemplo.com');
-- ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
-- Si el email no coincide con ninguna fila no pasa nada
-- (0 filas afectadas): el script no se rompe.
--
-- Verificación (debe devolver 1 fila con rol = 'admin'):
--   SELECT id, email, rol, activo FROM usuarios WHERE rol = 'admin';

-- ============================================================
-- FIN — Verificación rápida
-- ============================================================
-- Listar políticas por tabla:
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--   WHERE schemaname = 'public' ORDER BY tablename;
--
-- Probar el lookup de login con la anon key (debe devolver 1 fila o 0):
--   SELECT * FROM public.login_lookup('12345678');
--
-- Comprobar que la anon key ya NO volca datos (debe devolver [] y []):
--   curl -s -H "apikey: ANON_KEY" \
--     "https://PROYECTO.supabase.co/rest/v1/usuarios?select=id,email,dni&limit=5"
--   curl -s -H "apikey: ANON_KEY" \
--     "https://PROYECTO.supabase.co/rest/v1/prestamos?select=id&limit=5"
--
-- Comprobar las RPC del login (debe devolver un JSON con email/rol):
--   curl -s -X POST -H "apikey: ANON_KEY" -H "Content-Type: application/json" \
--     -d '{"p_dni":"12345678"}' \
--     "https://PROYECTO.supabase.co/rest/v1/rpc/login_lookup"
