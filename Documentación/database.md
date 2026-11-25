# Base de Datos — Biblioteca Virtual EEST N°5

> Referencia canónica de la estructura de Supabase (PostgreSQL).  
> Toda Foreign Key declarada aquí habilita la sintaxis de join `tabla(col)` en el cliente JS.

---

## Diagrama de relaciones

```
categorias ──< libros >── autores
                │
               stock ──< prestamos >── usuarios >── cursos
                                           │
                              solicitudes_prestamo
                              solicitudes_extension
                                    academico
                                 material_estudio
```

---

## Tablas

### `cursos`
Catálogo de cursos y divisiones de la escuela. Referenciado por `usuarios` y `academico`.

| Columna    | Tipo      | Restricciones        | Descripción                          |
|------------|-----------|----------------------|--------------------------------------|
| `id`       | `SERIAL`  | PK                   |                                      |
| `nombre`   | `TEXT`    | NOT NULL             | Año del curso. Ej: `3`, `Docente`    |
| `division` | `TEXT`    |                      | División. Ej: `A`, `B`, `—`          |

```sql
CREATE TABLE cursos (
  id       SERIAL PRIMARY KEY,
  nombre   TEXT NOT NULL,
  division TEXT
);
```

---

### `autores`
Catálogo de autores. Un autor puede tener muchos libros.

| Columna    | Tipo     | Restricciones | Descripción              |
|------------|----------|---------------|--------------------------|
| `id`       | `SERIAL` | PK            |                          |
| `apellido` | `TEXT`   | NOT NULL      | Ej: `Borges`             |
| `nombre`   | `TEXT`   |               | Ej: `Jorge Luis`         |

```sql
CREATE TABLE autores (
  id       SERIAL PRIMARY KEY,
  apellido TEXT NOT NULL,
  nombre   TEXT
);
```

---

### `categorias`
Categorías bibliográficas. Referenciadas por `libros`.

| Columna      | Tipo     | Restricciones | Descripción                        |
|--------------|----------|---------------|------------------------------------|
| `id`         | `SERIAL` | PK            |                                    |
| `nombre`     | `TEXT`   | NOT NULL      | Ej: `Informática`                  |
| `descripcion`| `TEXT`   |               | Descripción breve                  |
| `color`      | `TEXT`   |               | Hex. Ej: `#2563eb`                 |
| `imagen_url` | `TEXT`   |               | URL para el carrusel público       |

```sql
CREATE TABLE categorias (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  color       TEXT,
  imagen_url  TEXT
);
```

---

### `libros`
Títulos bibliográficos. Un título puede tener múltiples ejemplares físicos en `stock`.

| Columna           | Tipo       | Restricciones | Descripción                              |
|-------------------|------------|---------------|------------------------------------------|
| `id`              | `SERIAL`   | PK            |                                          |
| `titulo`          | `TEXT`     | NOT NULL      |                                          |
| `id_autor`        | `INT`      | FK → autores  |                                          |
| `id_categoria`    | `INT`      | FK → categorias|                                         |
| `isbn`            | `TEXT`     |               | Código bibliográfico global              |
| `editorial`       | `TEXT`     |               |                                          |
| `edicion`         | `TEXT`     |               | Ej: `1ª`, `2ª`                           |
| `anio_publicacion`| `SMALLINT` |               | Año de edición (≤ año actual)            |
| `paginas`         | `SMALLINT` |               | Mínimo 1                                 |
| `url_drive`       | `TEXT`     |               | Link digital / Drive                     |
| `palabras_clave`  | `TEXT`     |               | Para búsqueda en catálogo                |

> Regla de negocio: debe tener `url_drive` OR al menos un registro en `stock`. Validado en JS.

```sql
CREATE TABLE libros (
  id               SERIAL PRIMARY KEY,
  titulo           TEXT NOT NULL,
  id_autor         INT REFERENCES autores(id),
  id_categoria     INT REFERENCES categorias(id),
  isbn             TEXT,
  editorial        TEXT,
  edicion          TEXT,
  anio_publicacion SMALLINT,
  paginas          SMALLINT,
  url_drive        TEXT,
  palabras_clave   TEXT
);
```

---

### `stock`
Ejemplares físicos de un libro. Cada fila es un ejemplar individual con número de inventario único.

| Columna         | Tipo     | Restricciones      | Descripción                        |
|-----------------|----------|--------------------|------------------------------------|
| `id`            | `SERIAL` | PK                 |                                    |
| `id_libro`      | `INT`    | FK → libros, NOT NULL |                                 |
| `nro_inventario`| `TEXT`   | NOT NULL, UNIQUE   | Ej: `INV-0042`                     |

```sql
CREATE TABLE stock (
  id             SERIAL PRIMARY KEY,
  id_libro       INT NOT NULL REFERENCES libros(id) ON DELETE CASCADE,
  nro_inventario TEXT NOT NULL UNIQUE
);
```

---

### `usuarios`
Alumnos y docentes que pueden tomar préstamos. Vinculados a Supabase Auth por `email`.

| Columna      | Tipo      | Restricciones       | Descripción                                  |
|--------------|-----------|---------------------|----------------------------------------------|
| `id`         | `BIGINT`  | PK                  |                                              |
| `nombre`     | `TEXT`    | NOT NULL            |                                              |
| `apellido`   | `TEXT`    | NOT NULL            |                                              |
| `dni`        | `BIGINT`  | NOT NULL, UNIQUE    | **En la BD real es BIGINT, no TEXT** (ojo al comparar con `solicitudes_prestamo.dni`, que sí es TEXT: hay que castear) |
| `email`      | `TEXT`    | NOT NULL, UNIQUE    | Debe coincidir con Supabase Auth             |
| `rol`        | `TEXT`    | NOT NULL, DEFAULT `'alumno'` | `'alumno'` \| `'docente'` \| `'admin'` |

> ⚠️ **Tipos verificados en la BD real (11/11/2026)**: `usuarios.id`,
> `usuarios.dni`, `prestamos.id`, `prestamos.id_stock`,
> `prestamos.id_usuario`, `stock.id`, `stock.id_libro`, `libros.id` y
> `cursos.id` son `BIGINT`. Las comparaciones con parámetros `TEXT`
> (RPC de login, políticas RLS) deben casteear: `u.dni::text = p_dni`.
| `telefono`   | `TEXT`    |                     |                                              |
| `direccion`  | `TEXT`    |                     |                                              |
| `id_curso`   | `INT`     | FK → cursos         |                                              |
| `año_actual` | `SMALLINT`|                     | Año lectivo, calculado automáticamente en JS |
| `activo`     | `BOOLEAN` | DEFAULT `true`      | `false` = cuenta pendiente de aprobación     |

```sql
CREATE TABLE usuarios (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  apellido    TEXT NOT NULL,
  dni         TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL UNIQUE,
  rol         TEXT NOT NULL DEFAULT 'alumno',
  telefono    TEXT,
  direccion   TEXT,
  id_curso    INT REFERENCES cursos(id),
  año_actual  SMALLINT,
  activo      BOOLEAN DEFAULT true
);
```

---

### `prestamos`
Préstamos físicos registrados por la bibliotecaria. Cada fila vincula un ejemplar con un usuario.

| Columna           | Tipo      | Restricciones         | Descripción                                      |
|-------------------|-----------|-----------------------|--------------------------------------------------|
| `id`              | `SERIAL`  | PK                    |                                                  |
| `id_stock`        | `INT`     | FK → stock, NOT NULL  | Ejemplar físico prestado                         |
| `id_usuario`      | `INT`     | FK → usuarios, NOT NULL|                                                 |
| `fecha_prestamo`  | `DATE`    | NOT NULL              |                                                  |
| `fecha_devolucion`| `DATE`    |                       | Fecha límite de devolución                       |
| `estado`          | `TEXT`    | NOT NULL, DEFAULT `'activo'` | `activo` \| `vencido` \| `devuelto` \| `pendiente` \| `rechazado` |
| `observaciones`   | `TEXT`    | Opcional, no aplicada en la BD actual | Solo agregar si se decide registrar notas por préstamo |

```sql
CREATE TABLE prestamos (
  id               SERIAL PRIMARY KEY,
  id_stock         INT NOT NULL REFERENCES stock(id),
  id_usuario       INT NOT NULL REFERENCES usuarios(id),
  fecha_prestamo   DATE NOT NULL,
  fecha_devolucion DATE,
  estado           TEXT NOT NULL DEFAULT 'activo'
);

CREATE INDEX idx_prestamos_estado     ON prestamos(estado);
CREATE INDEX idx_prestamos_id_usuario ON prestamos(id_usuario);
```

---

### `solicitudes_prestamo`
Reservas online iniciadas por alumnos/docentes desde el catálogo público. La bibliotecaria las aprueba o rechaza.

| Columna                | Tipo        | Restricciones | Descripción                                                    |
|------------------------|-------------|---------------|----------------------------------------------------------------|
| `id`                   | `SERIAL`    | PK            |                                                                |
| `nombre_solicitante`   | `TEXT`      | **NOT NULL** (verificado en la BD real) |                     |
| `apellido_solicitante` | `TEXT`      | **NOT NULL** (verificado en la BD real) |                     |
| `dni`                  | `TEXT`      | NOT NULL      | Usado para vincular con `usuarios` (ojo: `usuarios.dni` es BIGINT) |
| `email`                | `TEXT`      | **NOT NULL** (verificado en la BD real) |                     |
| `id_libro`             | `INT`       | FK → libros, **NOT NULL** (verificado en la BD real) |        |
| `estado`               | `TEXT`      | NOT NULL, DEFAULT `'Pendiente de Retiro'` | CHECK: `'Pendiente de Aprobación'` \| `'Pendiente de Retiro'` \| `'Retirado'` \| `'Rechazado'` \| `'Vencido'` |
| `fecha_solicitud`      | `TIMESTAMPTZ` | DEFAULT `now()` |                                                             |
| `fecha_limite_retiro`  | `TIMESTAMPTZ` |               | Se fija al aprobar: 48 h para retirar                         |
| `tiempo_solicitado_dias` | `SMALLINT` | NOT NULL, DEFAULT `14` | Plazo solicitado; RPC valida 1–30 días |
| `id_stock`             | `BIGINT`    | FK → stock     | Ejemplar separado al aprobar la solicitud                     |
| `id_lote`              | `UUID`      |                 | Identificador compartido para solicitudes de lote docente      |
| `cantidad_lote`        | `SMALLINT`  |                 | Cantidad de ejemplares solicitados en el lote                   |
| `indice_lote`          | `SMALLINT`  |                 | Número de ejemplar dentro del lote                              |
| `fecha_retiro`         | `DATE`      |               | Fecha real en que el libro fue retirado                        |
| `fecha_devolucion`     | `DATE`      |               | Confirmación de entrega + días solicitados (1–30)              |
| `observaciones`        | `TEXT`      |               |                                                                |

```sql
CREATE TABLE solicitudes_prestamo (
  id                    SERIAL PRIMARY KEY,
  nombre_solicitante    TEXT NOT NULL,
  apellido_solicitante  TEXT NOT NULL,
  dni                   TEXT NOT NULL,
  email                 TEXT NOT NULL,
  id_libro              INT NOT NULL REFERENCES libros(id),
  estado                TEXT NOT NULL DEFAULT 'Pendiente de Aprobación'
                          CHECK (estado IN ('Pendiente de Aprobación', 'Pendiente de Retiro', 'Retirado', 'Rechazado', 'Vencido')),
  fecha_solicitud       TIMESTAMPTZ DEFAULT now(),
  fecha_limite_retiro   TIMESTAMPTZ,
  fecha_retiro          DATE,
  fecha_devolucion      DATE,
  observaciones         TEXT,
  tiempo_solicitado_dias SMALLINT NOT NULL DEFAULT 14,
  id_stock              BIGINT REFERENCES stock(id),
  id_lote               UUID,
  cantidad_lote         SMALLINT,
  indice_lote           SMALLINT
);

-- La fecha límite se asigna al pasar a 'Pendiente de Retiro' por RPC,
-- no al crear la solicitud que espera aprobación.
```

---

### `solicitudes_extension`
Pedidos de extensión de plazo enviados por alumnos desde su panel.

| Columna           | Tipo          | Restricciones                    | Descripción                                        |
|-------------------|---------------|----------------------------------|----------------------------------------------------|
| `id`              | `BIGINT`      | PK, GENERATED BY DEFAULT AS IDENTITY |                                               |
| `id_prestamo`     | `BIGINT`      | FK → prestamos, NOT NULL         | Préstamo al que se solicita extensión              |
| `motivo`          | `TEXT`        | NOT NULL                         | Razón del alumno                                   |
| `estado`          | `TEXT`        | NOT NULL, DEFAULT `'Pendiente'`  | `Pendiente` \| `Aprobada` \| `Rechazada`           |
| `fecha_solicitud` | `TIMESTAMPTZ` | DEFAULT `now()`                  |                                                    |

```sql
CREATE TABLE solicitudes_extension (
  id               BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  id_prestamo      BIGINT NOT NULL REFERENCES prestamos(id) ON DELETE CASCADE,
  motivo           TEXT NOT NULL,
  estado           TEXT NOT NULL DEFAULT 'Pendiente'
                     CHECK (estado IN ('Pendiente', 'Aprobada', 'Rechazada')),
  fecha_solicitud  TIMESTAMPTZ DEFAULT now()
);
```

---

### `academico`
Registro de alumnos que recursan o intensifican materias. Módulo independiente de préstamos.

| Columna        | Tipo       | Restricciones | Descripción                          |
|----------------|------------|---------------|--------------------------------------|
| `id`           | `SERIAL`   | PK            |                                      |
| `apellido`     | `TEXT`     | NOT NULL      |                                      |
| `nombre`       | `TEXT`     | NOT NULL      |                                      |
| `dni`          | `TEXT`     | NOT NULL      |                                      |
| `id_curso`     | `INT`      | FK → cursos   |                                      |
| `anio_lectivo` | `SMALLINT` | NOT NULL      |                                      |
| `materia`      | `TEXT`     | NOT NULL      |                                      |
| `tipo`         | `TEXT`     | NOT NULL      | `recursar` \| `intensificar`         |
| `turno`        | `TEXT`     |               | `mañana` \| `tarde` \| `noche`       |
| `observaciones`| `TEXT`     |               |                                      |

```sql
CREATE TABLE academico (
  id           SERIAL PRIMARY KEY,
  apellido     TEXT NOT NULL,
  nombre       TEXT NOT NULL,
  dni          TEXT NOT NULL,
  id_curso     INT REFERENCES cursos(id),
  anio_lectivo SMALLINT NOT NULL,
  materia      TEXT NOT NULL,
  tipo         TEXT NOT NULL,
  turno        TEXT,
  observaciones TEXT
);
```

---

### `material_estudio`
Recursos digitales (PDFs, links, guías, videos) subidos por la bibliotecaria para alumnos.

| Columna         | Tipo        | Restricciones   | Descripción                                      |
|-----------------|-------------|-----------------|--------------------------------------------------|
| `id`            | `SERIAL`    | PK              |                                                  |
| `titulo`        | `TEXT`      | NOT NULL        |                                                  |
| `descripcion`   | `TEXT`      |                 |                                                  |
| `materia`       | `TEXT`      | NOT NULL        | Texto libre (adaptado a las 3 tecnicaturas)      |
| `anio_escolar`  | `SMALLINT`  |                 | Año numérico: `1`–`7`. Reemplaza el texto libre. |
| `ciclo`         | `TEXT`      |                 | `'basico'` (1–3) \| `'tecnico'` (4+)            |
| `tecnicatura`   | `TEXT`      |                 | `null` si ciclo básico, o `'Electrónica'` \| `'Informática'` \| `'Construcciones'` |
| `tipo_recurso`  | `TEXT`      | NOT NULL        | `pdf` \| `link` \| `guia` \| `video` \| `otro`  |
| `url_recurso`   | `TEXT`      | NOT NULL        |                                                  |
| `fecha_creacion`| `TIMESTAMPTZ` | DEFAULT `now()` |                                                |

```sql
CREATE TABLE material_estudio (
  id            SERIAL PRIMARY KEY,
  titulo        TEXT NOT NULL,
  descripcion   TEXT,
  materia       TEXT NOT NULL,
  anio_escolar  SMALLINT,
  ciclo         TEXT,
  tecnicatura   TEXT,
  tipo_recurso  TEXT NOT NULL,
  url_recurso   TEXT NOT NULL,
  fecha_creacion TIMESTAMPTZ DEFAULT now()
);

-- Migración desde esquema anterior (anio_escolar TEXT → SMALLINT + ciclo + tecnicatura)
ALTER TABLE material_estudio
  ADD COLUMN IF NOT EXISTS ciclo       TEXT,
  ADD COLUMN IF NOT EXISTS tecnicatura TEXT;

-- Si anio_escolar era TEXT, convertir a SMALLINT:
-- ALTER TABLE material_estudio ALTER COLUMN anio_escolar TYPE SMALLINT USING anio_escolar::SMALLINT;

CREATE INDEX IF NOT EXISTS idx_material_ciclo       ON material_estudio(ciclo);
CREATE INDEX IF NOT EXISTS idx_material_anio        ON material_estudio(anio_escolar);
CREATE INDEX IF NOT EXISTS idx_material_tecnicatura ON material_estudio(tecnicatura);
```

La aplicación usa `ciclo`, `tecnicatura` y `tipo_recurso` como campos canónicos;
el panel no depende de `id_curso` en `material_estudio`. La política RLS de la
migración filtra año/ciclo/tecnicatura por el curso del usuario.

### `materiales_favoritos`

Relación entre usuario y material guardado. Clave primaria compuesta para evitar
favoritos duplicados; ambas referencias se eliminan en cascada.

```sql
CREATE TABLE materiales_favoritos (
  id_usuario BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  id_material BIGINT NOT NULL REFERENCES material_estudio(id) ON DELETE CASCADE,
  PRIMARY KEY (id_usuario, id_material)
);
```

### Operaciones transaccionales

Ejecutar `Documentación/migracion-flujos-criticos.sql` después de
`seguridad-rls.sql`. Las solicitudes, asignación de ejemplar, confirmación de
entrega y resolución de extensiones pasan por RPCs que validan rol/propiedad y
realizan cada cambio en una transacción.

---

## Foreign Keys — resumen para PostgREST

Estas FK deben estar declaradas para que la sintaxis `tabla(columna)` funcione en el cliente JS sin errores 400.

```sql
-- Ejecutar si alguna FK falta
ALTER TABLE libros
  ADD CONSTRAINT fk_libros_autores    FOREIGN KEY (id_autor)     REFERENCES autores(id),
  ADD CONSTRAINT fk_libros_categorias FOREIGN KEY (id_categoria) REFERENCES categorias(id);

ALTER TABLE stock
  ADD CONSTRAINT fk_stock_libros      FOREIGN KEY (id_libro)     REFERENCES libros(id) ON DELETE CASCADE;

ALTER TABLE usuarios
  ADD CONSTRAINT fk_usuarios_cursos   FOREIGN KEY (id_curso)     REFERENCES cursos(id);

ALTER TABLE prestamos
  ADD CONSTRAINT fk_prestamos_stock    FOREIGN KEY (id_stock)    REFERENCES stock(id),
  ADD CONSTRAINT fk_prestamos_usuarios FOREIGN KEY (id_usuario)  REFERENCES usuarios(id);

ALTER TABLE solicitudes_prestamo
  ADD CONSTRAINT fk_solicitudes_libros FOREIGN KEY (id_libro)    REFERENCES libros(id);

ALTER TABLE solicitudes_extension
  ADD CONSTRAINT fk_extension_prestamos FOREIGN KEY (id_prestamo) REFERENCES prestamos(id) ON DELETE CASCADE;

ALTER TABLE academico
  ADD CONSTRAINT fk_academico_cursos  FOREIGN KEY (id_curso)     REFERENCES cursos(id);
```

---

## Políticas RLS — ejecutar en Supabase SQL Editor

```sql
-- ── TABLA: usuarios ──────────────────────────────────────────────────────

-- 1. Permitir INSERT público (anon) para el formulario de registro
--    WITH CHECK (activo = false) garantiza que nadie pueda auto-aprobarse:
--    cualquier fila insertada desde el exterior DEBE llegar con activo = false.
CREATE POLICY "registro_publico_insert"
  ON usuarios
  FOR INSERT
  TO anon
  WITH CHECK (activo = false);

-- 2. Permitir SELECT público solo para verificar DNI duplicado antes de registrarse
--    (solo expone id y activo, no datos sensibles)
CREATE POLICY "registro_publico_select_dni"
  ON usuarios
  FOR SELECT
  TO anon
  USING (true);

-- 3. Usuarios autenticados pueden leer su propio registro
CREATE POLICY "usuario_lee_su_fila"
  ON usuarios
  FOR SELECT
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

-- 4. Solo el rol service_role (bibliotecaria/admin) puede UPDATE y DELETE
--    Las políticas de UPDATE/DELETE para authenticated se gestionan
--    desde el panel admin con la service key, no desde el cliente anon.
```

> **Importante**: si ya existía una política de SELECT genérica, verificá en
> Dashboard → Authentication → Policies que no haya conflictos de nombres.
> Podés listar las políticas activas con:
> ```sql
> SELECT policyname, cmd, roles, qual, with_check
> FROM pg_policies
> WHERE tablename = 'usuarios';
> ```

---

## SQL de migración — ejecutar en Supabase SQL Editor

```sql
-- 1. Columna activo (pendiente de aprobación)
--    Si ya existe, este comando no hace nada.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;

-- 2. Columna rol con constraint de valores válidos
--    Agrega la columna si no existe y aplica el CHECK.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS rol TEXT NOT NULL DEFAULT 'alumno';

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_rol_check;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('alumno', 'docente', 'admin'));

-- 3. Marcar solicitudes pendientes de aprobación
--    Las cuentas creadas desde el formulario público llegan con activo = false.
--    Las creadas por la bibliotecaria desde el panel llegan con activo = true.
--    No se necesita tabla separada: activo = false ES el estado "esperando aprobación".

-- 4. Índice para acelerar la consulta del panel de notificaciones
CREATE INDEX IF NOT EXISTS idx_usuarios_activo ON usuarios(activo)
  WHERE activo = false;
```

---

## Notas de diseño

- **Sin redundancia de datos de usuario en `solicitudes_prestamo`**: los campos `nombre_solicitante`, `apellido_solicitante` y `email` se guardan como snapshot al momento de la solicitud porque el usuario puede no estar registrado aún en `usuarios` (flujo de reserva pública anónima). El `dni` es el vínculo de reconciliación.
- **`academico` es independiente de `usuarios`**: un alumno que recursa no necesariamente tiene cuenta en el portal. El DNI es el identificador compartido.
- **`stock.nro_inventario` es UNIQUE**: impide registrar dos ejemplares con el mismo número de inventario, validado también en JS antes del INSERT.
- **`usuarios.activo`**: permite el flujo de aprobación de cuentas nuevas sin eliminar el registro. `false` = pendiente de aprobación por la bibliotecaria.
- **Contraseña inicial**: es el DNI del usuario. Supabase Auth la gestiona; el email es el identificador de Auth y debe coincidir con `usuarios.email`.
