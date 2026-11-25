# Análisis de Requerimientos — Biblioteca Virtual EEST N°5

> Escuela Técnica N°5 "Ing. E. S. Ranelagh" — Ranelagh, Berazategui.
> Sistema web de gestión de biblioteca escolar: catálogo público, préstamos, reservas online, material de estudio y panel administrativo.

---

## 1. Introducción

### 1.1 Contexto

La biblioteca de la EEST N°5 administra un fondo bibliográfico para alumnos y docentes de la tecnicatura. Actualmente, la gestión de préstamos, reservas y seguimiento de devoluciones se realiza de forma manual, lo que genera demoras, dificultad para consultar la disponibilidad desde fuera de la escuela y falta de visibilidad del estado de cada préstamo.

### 1.2 Objetivo

Desarrollar una aplicación web que permita:

- **Consultar el catálogo** de libros de forma pública y en tiempo real.
- **Gestionar préstamos y reservas** con seguimiento de estados y plazos.
- **Publicar material de estudio** digital organizado por año y tecnicatura.
- **Administrar inventario, usuarios y estadísticas** desde un panel de la bibliotecaria.

### 1.3 Alcance

El sistema cubre las operaciones cotidianas de la biblioteca escolar. Quedan fuera de alcance: compras/altas de bibliografía, gestión de multas económicas y préstamos entre escuelas.

---

## 2. Actores del sistema

| Actor | Descripción | Acceso |
|---|---|---|
| **Visitante** | Cualquier usuario sin cuenta (incluso fuera de la escuela). | Catálogo, búsqueda, estadísticas públicas. |
| **Alumno** | Estudiante de la escuela con cuenta aprobada. | Reservar libros, ver préstamos, pedir extensiones, material de estudio con favoritos. |
| **Docente** | Personal docente con cuenta aprobada. | Historial de préstamos, solicitar libros (individual o lote para clase). |
| **Bibliotecaria (Admin)** | Responsable de la biblioteca. | Panel completo: aprobaciones, reservas, préstamos, inventario, categorías, material, estadísticas, notificaciones. |
| **Sistema** | Entidades automáticas. | Cálculo de fechas por trigger, estados de vencimiento. |

---

## 3. Requerimientos funcionales

### 3.1 Catálogo público (Visitante)

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-01 | Visualizar el catálogo completo de libros con título, autor, categoría y disponibilidad. | Alta |
| RF-02 | Buscar libros por título, autor o palabras clave en tiempo real. | Alta |
| RF-03 | Filtrar por categoría y por disponibilidad (con/sin stock). | Alta |
| RF-04 | Navegar las categorías mediante un carrusel visual. | Media |
| RF-05 | Ver estadísticas generales de la biblioteca (ejemplares, títulos, devoluciones a tiempo, categorías). | Media |
| RF-06 | Acceder a versiones digitales (PDF/Drive) cuando el libro la tenga asociada. | Media |

### 3.2 Acceso y cuentas

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-07 | Registro público de alumnos y docentes con validación de DNI y email únicos. | Alta |
| RF-08 | Las cuentas nuevas quedan **pendientes de aprobación** (`activo = false`) hasta validación de la bibliotecaria. | Alta |
| RF-09 | Login por DNI + contraseña vía Supabase Auth. Contraseña inicial = DNI. | Alta |
| RF-10 | El usuario puede cambiar su contraseña desde su panel (mínimo 6 caracteres). | Media |
| RF-11 | Notificación por email al aprobar una cuenta. | Media |

### 3.3 Reservas online y préstamos

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-12 | El alumno/docente solicita un libro desde el catálogo indicando cantidad de días (1–30). | Alta |
| RF-13 | La solicitud nace en estado **Pendiente de Retiro** tras aprobación de la bibliotecaria. | Alta |
| RF-14 | El sistema calcula la **fecha límite de retiro** automáticamente (48 h desde la aprobación) mediante trigger. | Alta |
| RF-15 | La bibliotecaria registra el retiro y calcula la **fecha de devolución** (fecha de retiro + 14 días). | Alta |
| RF-16 | Estados del préstamo: `Pendiente de Retiro`, `Activo`, `Vencido`, `Devuelto`, `Rechazado`. | Alta |
| RF-17 | El usuario puede solicitar la **extensión** de un préstamo con motivo; la bibliotecaria aprueba o rechaza. | Media |
| RF-18 | Registro manual de préstamos presenciales desde el panel admin. | Alta |

### 3.4 Panel administrativo (Bibliotecaria)

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-19 | Aprobar o rechazar cuentas nuevas. | Alta |
| RF-20 | Gestionar reservas online: aprobar, marcar retiradas, rechazar, detectar vencidas. | Alta |
| RF-21 | Gestionar préstamos: alta, edición, devolución, seguimiento de vencidos. | Alta |
| RF-22 | Gestionar usuarios: alta, edición, desactivación. | Alta |
| RF-23 | **Gestión de inventario** con autocompletado por ISBN (Open Library API), edición de libros y ejemplares individuales con número de inventario único. | Alta |
| RF-24 | Gestionar categorías (nombre, descripción, color, imagen para el carrusel). | Media |
| RF-25 | Subir y administrar material de estudio (PDF, links, guías, videos) con año, ciclo y tecnicatura. | Alta |
| RF-26 | Visualizar estadísticas: libros prestados, devoluciones a tiempo, usuarios activos, categorías populares. | Media |
| RF-27 | Enviar recordatorios y notificaciones por email (EmailJS). | Media |
| RF-28 | Registrar alumnos que recursan o intensifican materias (módulo académico independiente). | Baja |

### 3.5 Material de estudio (Alumno)

| ID | Requerimiento | Prioridad |
|---|---|---|
| RF-29 | Visualizar solo el material correspondiente a su año/ciclo. | Alta |
| RF-30 | Buscar por título/materia, filtrar por tipo de recurso y por año (1°–7°). | Media |
| RF-31 | Marcar/desmarcar favoritos persistentes por usuario. | Media |

---

## 4. Requerimientos no funcionales

| ID | Requerimiento | Criterio |
|---|---|---|
| RNF-01 | **Disponibilidad** | Sitio accesible 24/7 desde navegador (despliegue en GitHub Pages). |
| RNF-02 | **Rendimiento** | Carga del catálogo < 3 s en conexión 4G. |
| RNF-03 | **Responsividad** | Adaptado a celular, tablet y computadora. |
| RNF-04 | **Seguridad** | Row Level Security (RLS) en Supabase; la `service_role key` nunca se expone al frontend; registro público solo puede insertar `activo = false`. |
| RNF-05 | **Autenticación** | Supabase Auth con confirmación de email deshabilitada (creación de cuentas administrada por panel). |
| RNF-06 | **Usabilidad** | Interfaz en español rioplatense, sin necesidad de entrenamiento; manuales de usuario por rol. |
| RNF-07 | **Sin dependencias de build** | HTML + CSS + JS vanilla (Tailwind CDN, Google Fonts); se sirve tal cual. |
| RNF-08 | **Integridad de datos** | Claves foráneas declaradas para joins PostgREST; `nro_inventario` y `dni` únicos; fechas calculadas por trigger. |

---

## 5. Reglas de negocio

1. Un libro debe tener `url_drive` **o** al menos un ejemplar en `stock` (validado en JS).
2. La contraseña inicial es el DNI; se recomienda cambiarla en el primer ingreso.
3. Las cuentas creadas desde el formulario público llegan con `activo = false` (auto-aprobación bloqueada por RLS).
4. Las reservas pendientes de retiro vencen a las 48 horas si no se retiran.
5. El préstamo máximo es de 30 días según lo elegido al solicitar; devolución estándar a 14 días del retiro.
6. No se puede prestar un ejemplar que ya está prestado o reservado.
7. El material de estudio solo es visible para alumnos del año/ciculo correspondiente.
8. `academico` es independiente de `usuarios`: el DNI es el identificador compartido.

---

## 6. Modelado de casos de uso (resumen)

### CU-01: Reservar un libro (Alumno)
- **Precondición:** alumno con cuenta aprobada y sesión iniciada.
- **Flujo:** busca el libro → solicita préstamo → elige días (1–30) → confirma → bibliotecaria aprueba → estado "Pendiente de Retiro" con fecha límite → retira en biblioteca con DNI.
- **Postcondición:** préstamo activo registrado.

### CU-02: Aprobar cuenta (Bibliotecaria)
- **Precondición:** existe solicitud con `activo = false`.
- **Flujo:** revisa datos → aprueba (o rechaza) → sistema notifica por email → el usuario ya puede iniciar sesión.

### CU-03: Registrar préstamo presencial (Bibliotecaria)
- **Flujo:** busca usuario → busca libro/ejemplar → registra préstamo → sistema calcula fecha de devolución.

### CU-04: Solicitar extensión (Alumno)
- **Precondición:** préstamo activo o pendiente de retiro.
- **Flujo:** toca "Extender" → ingresa motivo → bibliotecaria aprueba/rechaza → el usuario ve el estado en su panel.

### CU-05: Solicitar lote para clase (Docente)
- **Flujo:** elige "Lote para clase" → busca libro → indica cantidad (≤40) y materia → envía → bibliotecaria prepara ejemplares.

---

## 7. Modelado de datos (resumen)

Ver `Documentación/database.md` (esquema canónico) y `Documentación/Diagramas/diagrama-er.html` (diagrama ER).

Tablas principales: `cursos`, `autores`, `categorias`, `libros`, `stock`, `usuarios`, `prestamos`, `solicitudes_prestamo`, `solicitudes_extension`, `academico`, `material_estudio`, `materiales_favoritos`.

---

## 8. Tecnologías

| Capa | Tecnología |
|---|---|
| Frontend | HTML + CSS + JavaScript vanilla (Tailwind CDN, Google Fonts) |
| Backend / BD | Supabase (PostgreSQL + PostgREST + Supabase Auth + RLS) |
| Emails | EmailJS |
| Autocompletado ISBN | Open Library API |
| Despliegue | GitHub Pages |

---

## 9. Criterios de aceptación globales

- Todo préstamo/registro nuevo debe reflejarse en la BD y consultarse en menos de 3 s.
- Ningún usuario no autenticado puede modificar datos (verificado con políticas RLS activas).
- Los estados y fechas calculados (límite de retiro, devolución) coinciden con las reglas de negocio.
- El sitio es usable en celular sin scroll horizontal ni solapamientos.

---

*Documento de análisis de requerimientos — versión 1.0 (2025).*
