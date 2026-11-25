/* ============================================================
   INIT — Arranque del panel admin
   ------------------------------------------------------------
   Los datos solo se cargan cuando el guardián de db.js
   validó sesión + rol admin y emite 'admin:autorizado'.
   Así evitamos descargar la base con una sesión inválida.
   ============================================================ */
document.addEventListener('admin:autorizado', () => { initApp(); }, { once: true });

async function initApp() {
  setDate();
  try {
    await cargarDatos();
    buildChart();
  } catch (error) {
    console.error('Error inicializando la app:', error);
  }
}

async function cargarDatos() {
  await cargarCategorias();
  await cargarInventario();
  await cargarCursos();
  await cargarUsuarios();
  await cargarPrestamos();
  renderInventario();
  renderUsuarios();
  renderLoans();
  if (typeof renderStats === 'function') renderStats();
  agregarFilaPrestamo();
  populateLibroSelect();
  await cargarAcademico();
  poblarCursoAcademico();
  renderAcademico();
  await cargarYRenderCategorias();
  await cargarMaterial();
  renderMaterial();
  await cargarNotificaciones();
  await cargarExtensiones();
}

function setDate() {
  const d = new Date();
  document.getElementById('topbar-date').textContent = d.toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}
