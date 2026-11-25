# Cambios pendientes en Base de Datos (Supabase)
> Ejecutar en orden. Todos los ALTER son seguros sobre datos existentes (solo agregan columnas nullable o con DEFAULT).

## ✅ Estado verificado contra la BD real (11/11/2026)

| # | Cambio | Estado |
|---|--------|--------|
| 1 | `libros` +`isbn`,`editorial`,`edicion`,`anio_publicacion`,`paginas` | ✅ **ya aplicado** |
| 2 | `stock`: `isbn` → `nro_inventario` | ✅ **ya aplicado** |
| 3 | `cursos.division` nullable | ⚠️ no hay filas con `division = NULL`; si el alta de docentes falla, aplicar el ALTER |
| 4 | `usuarios.email` NOT NULL | ⚠️ no hay filas con email vacío (aplicarlo es inocuo) |
| 5 | índices en `prestamos` | ✅ **los crea `seguridad-rls.sql`** (PARTE 9) |
| 6 | `solicitudes_prestamo.id_stock` | ✅ **ya aplicado** |

Pendientes no listados aquí: `seguridad-rls.sql` crea la tabla
`solicitudes_extension`, las RPC de login/estadísticas, la vista pública y las
políticas base. Después debe ejecutarse `migracion-flujos-criticos.sql` para
campos de solicitudes/lotes, favoritos, segmentación RLS y operaciones atómicas.

---

## 1. Tabla `libros` — agregar columnas de catalogación

```sql
ALTER TABLE libros
  ADD COLUMN IF NOT EXISTS isbn             TEXT,
  ADD COLUMN IF NOT EXISTS editorial        TEXT,
  ADD COLUMN IF NOT EXISTS edicion          TEXT,
  ADD COLUMN IF NOT EXISTS anio_publicacion SMALLINT,
  ADD COLUMN IF NOT EXISTS paginas          SMALLINT;
```

- `isbn`: código bibliográfico del libro (ej: 978-0553802023). Uno por título, compartido por todos sus ejemplares.
- `editorial`, `edicion`, `anio_publicacion`: obligatorios en formulario (validación JS), nullable en DB para no romper registros existentes.
- `paginas`: opcional.

---

## 2. Tabla `stock` — renombrar columna `isbn` → `nro_inventario`

```sql
ALTER TABLE stock RENAME COLUMN isbn TO nro_inventario;
```

Corrección conceptual: el campo `isbn` en `stock` siempre fue el número de inventario
(único por ejemplar físico, asignado por la biblioteca). El ISBN real es un código bibliográfico
que va en la tabla `libros`, no en `stock`.

⚠️ Después de ejecutar esto, el código JS ya estará actualizado para usar `nro_inventario`.

---

## 3. Tabla `cursos` — soporte para "Docente" sin división

```sql
-- No requiere ALTER si 'division' ya es TEXT/VARCHAR sin NOT NULL.
-- Si tiene restricción NOT NULL, ejecutar:
ALTER TABLE cursos ALTER COLUMN division DROP NOT NULL;
```

El valor `division = '—'` se inserta cuando el curso es "Docente".

---

## 4. Tabla `usuarios` — hacer email obligatorio (NOT NULL)

```sql
-- PASO 1: completar registros sin email antes de aplicar la restricción
UPDATE usuarios SET email = 'sin-email@pendiente.com' WHERE email IS NULL OR email = '';

-- PASO 2: aplicar NOT NULL
ALTER TABLE usuarios ALTER COLUMN email SET NOT NULL;
```

⚠️ Ejecutar el UPDATE antes del ALTER o fallará si hay filas con email vacío.

---

## 5. Tabla `prestamos` — índices para rendimiento

```sql
CREATE INDEX IF NOT EXISTS idx_prestamos_estado     ON prestamos(estado);
CREATE INDEX IF NOT EXISTS idx_prestamos_id_usuario ON prestamos(id_usuario);
```

---

## 6. Tabla `solicitudes_prestamo` — vincular ejemplar físico entregado

```sql
ALTER TABLE solicitudes_prestamo
  ADD COLUMN IF NOT EXISTS id_stock INT REFERENCES stock(id);
```

Permite saber qué ejemplar físico exacto se entregó para cada reserva online.
Se completa al confirmar la entrega desde el panel admin (junto con `estado = 'Retirado'`).

---

## Resumen de tablas afectadas

| Tabla      | Cambio                                                            | Motivo                   |
|------------|-------------------------------------------------------------------|--------------------------|
| `libros`   | +`isbn`, +`editorial`, +`edicion`, +`anio_publicacion`, +`paginas` | Catalogación completa   |
| `stock`    | `isbn` → `nro_inventario`                                         | Corrección conceptual    |
| `cursos`   | `division` → nullable                                             | Soporte Docente          |
| `usuarios` | `email` → NOT NULL                                                | Email obligatorio        |
| `prestamos`| índices en `estado` e `id_usuario`                                | Rendimiento              |
