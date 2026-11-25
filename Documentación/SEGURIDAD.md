# Seguridad y preparación para publicar

Este documento describe tareas de configuración y límites conocidos. Las claves y credenciales reales no deben escribirse en documentación, capturas ni commits.

## Antes de publicar

1. Revisar `git status` y el diff completo. No agregar `.env`, exportaciones de base, respaldos, contraseñas, tokens ni claves privadas.
2. Rotar cualquier contraseña que se haya publicado anteriormente y revocar claves privadas expuestas.
3. Tener presente que el historial Git de este repositorio incluye versiones antiguas con una credencial y capturas con datos personales. Borrar o reemplazar un archivo en el último commit no elimina sus versiones anteriores. Para un repositorio público hay que limpiar el historial en todas las ramas y etiquetas, o publicar una copia nueva sin ese historial. Una reescritura del historial requiere coordinarla con todos los colaboradores.
4. Las capturas que se conservan en `Documentación/Interfaces/` deben estar anonimizadas. No incorporar capturas nuevas con nombres, DNI, correos, teléfonos u otros datos reales.

## Configuración de Supabase

1. Crear las tablas de acuerdo con `database.md`.
2. Revisar y ejecutar, en el orden indicado en el README, los scripts SQL de cambios pendientes, RLS y migraciones. Hacer un respaldo antes de modificar una base con datos.
3. Crear el usuario inicial desde Supabase Auth y asignarle el rol administrador en `usuarios`.
4. Configurar `Sistema/assets/js/config.js` con la URL del proyecto y la clave pública `anon` correspondiente.
5. Verificar las políticas RLS con cuentas de visitante, alumno, docente y administrador; confirmar que cada rol solo pueda leer o modificar los registros permitidos.

La clave `anon` está diseñada para estar en el cliente. La protección de datos depende de Auth, RLS y permisos correctos. La clave `service_role` y secretos de servidor nunca deben incluirse en el frontend.

## Servicios externos

- **EmailJS:** la integración desde el navegador utiliza una clave pública. Configurar los orígenes permitidos y límites de envío desde EmailJS; no enviar contraseñas ni información sensible en plantillas.
- **Supabase Auth:** mantener controles de abuso y límites de solicitudes adecuados. Los flujos públicos de registro y consulta requieren atención frente a spam y enumeración de usuarios.
- **GitHub Pages:** aloja solo archivos estáticos; las validaciones del navegador no sustituyen las políticas de seguridad del servidor.

## Riesgos que requieren seguimiento

- La contraseña inicial basada en un DNI puede facilitar suplantaciones si no se cambia. Evaluar un flujo de cambio obligatorio en el primer ingreso.
- Las solicitudes públicas de cuenta pueden recibir spam; incorporar CAPTCHA o límites si se observa abuso.
- Los endpoints de consulta necesarios para login pueden permitir probar identificadores. Aplicar limitación de intentos y respuestas que no revelen más información de la necesaria.
- El panel administrativo muestra datos personales a quien tenga acceso autorizado. Usarlo en equipos confiables y cerrar sesión al terminar.

## Comprobación operativa

Antes de cada publicación, probar el acceso de cada rol, permisos RLS, creación y aprobación de cuentas, préstamos, devoluciones, reservas, lotes docentes, extensiones y material de estudio. No usar datos reales en entornos de prueba ni publicar exportaciones de la base.
