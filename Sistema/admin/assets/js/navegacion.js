/* ============================================================
   NAVIGATION
   ============================================================ */
const sectionTitles = {
  reservas:    'Reservas Online',
  cuentas:     'Aprobación de Cuentas',
  extensiones: 'Solicitudes de Extensión',
  prestamos:   'Gestión de Préstamos',
  alta:        'Alta de Préstamo',
  usuarios:    'Gestión de Usuarios',
  'alta-libro':'Agregar Libro',
  inventario:  'Inventario de Libros',
  categorias:  'Categorías',
  academico:   'Recursar / Intensificar',
  material:    'Material de Estudio',
  estadisticas:'Estadísticas de Lectura',
};

// ── Overlay para cerrar sidebar al tocar afuera ──
const _sidebarOverlay = document.createElement('div');
_sidebarOverlay.id = 'sidebar-overlay';
_sidebarOverlay.addEventListener('click', closeSidebar);
document.body.appendChild(_sidebarOverlay);

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  _sidebarOverlay.classList.remove('active');
}

function toggleSidebar() {
  const isOpen = document.getElementById('sidebar').classList.toggle('open');
  _sidebarOverlay.classList.toggle('active', isOpen);
}

function showSection(name, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('sec-' + name).classList.add('active');
  el.classList.add('active');
  document.getElementById('topbar-title').textContent = sectionTitles[name] ?? name;
  if (name === 'alta')     populateLibroSelect();
  if (name === 'reservas') cargarSolicitudesPendientes();
  if (name === 'cuentas')  cargarUsuariosPendientes();
  if (name === 'extensiones') cargarExtensiones();
  if (name === 'material') cargarCursosMaterial();
  closeSidebar();
}
