/* ============================================================
   NOTIFICACIONES.JS — Aprobaciones y gestión de solicitudes
   ============================================================
   Responsabilidades:
   1. Aprobar / rechazar cuentas de usuarios pendientes (activo = false)
      → Aprobar: crea cuenta en Supabase Auth (pwd = DNI) + activo = true + email
      → Rechazar: elimina el registro + email
   2. Autorizar entrega física de reservas online (Pendiente de Retiro → Retirado)
   3. Limpieza automática de reservas vencidas (> 2 días sin retirar → Vencido)
   ============================================================ */

let solicitudesCache = [];
let usuariosPendientesCache = [];

/* ── Constantes EmailJS (compartidas con prestamos.js) ───── */
// Se leen desde el scope global definido en prestamos.js.
// Si este módulo se carga antes, se definen aquí como fallback.
const _EJS_SERVICE   = typeof EMAILJS_SERVICE             !== 'undefined' ? EMAILJS_SERVICE             : 'service_bytd01h';
const _EJS_KEY       = typeof EMAILJS_KEY                 !== 'undefined' ? EMAILJS_KEY                 : '1Uu73DKwGR4ADExX9';
const _EJS_T_APROB   = typeof EMAILJS_TEMPLATE_APROBACION !== 'undefined' ? EMAILJS_TEMPLATE_APROBACION : 'template_aprobacion';
const _EJS_T_RECHAZO = typeof EMAILJS_TEMPLATE_RECHAZO    !== 'undefined' ? EMAILJS_TEMPLATE_RECHAZO    : 'template_rechazo';
// Template para avisar al alumno que su libro está reservado y listo para retirar
const _EJS_T_RESERVA = 'template_5wj0yhs';

/* ── Carga principal ─────────────────────────────────────── */
async function cargarNotificaciones() {
  await Promise.all([cargarSolicitudesPendientes(), cargarUsuariosPendientes()]);
  actualizarBadgeNotificaciones();
}

async function cargarSolicitudesPendientes() {
  await limpiarReservasVencidas();

  // Bandeja de entrada: solicitudes que requieren acción de la bibliotecaria
  const { data, error } = await supabaseClient
    .from('solicitudes_prestamo')
    .select(`
      id, nombre_solicitante, apellido_solicitante, dni, email,
      estado, fecha_solicitud, fecha_limite_retiro,
      observaciones, tiempo_solicitado_dias, id_libro, id_stock,
      id_lote, cantidad_lote, indice_lote,
      libros(titulo)
    `)
    .in('estado', ['Pendiente de Aprobación', 'Pendiente de Retiro'])
    .order('fecha_solicitud', { ascending: true });

  if (error) { console.error('Error cargando solicitudes:', error.message); return; }
  solicitudesCache = data || [];
  renderSolicitudes();
}

async function cargarUsuariosPendientes() {
  const { data, error } = await supabaseClient
    .from('usuarios')
    .select('id, nombre, apellido, dni, email, rol, telefono, id_curso, cursos(nombre, division)')
    .eq('activo', false)
    .order('apellido');

  if (error) {
    if (error.code === '42703') { usuariosPendientesCache = []; renderUsuariosPendientes(); return; }
    console.error('Error cargando usuarios pendientes:', error.message);
    return;
  }
  usuariosPendientesCache = data || [];
  renderUsuariosPendientes();
}

/* ── Limpieza automática de reservas vencidas ────────────── */
async function limpiarReservasVencidas() {
  // Vencen las que llevan demasiado tiempo sin avanzar en el flujo
  const { error } = await supabaseClient
    .from('solicitudes_prestamo')
    .update({ estado: 'Vencido' })
    .eq('estado', 'Pendiente de Retiro')
    .lt('fecha_limite_retiro', new Date().toISOString());

  if (error) console.error('Error en limpieza de reservas vencidas:', error.message);
}

/* ── Badge contador en el nav ────────────────────────────── */
function actualizarBadgeNotificaciones() {
  const badgeReservas = document.getElementById('notif-badge-reservas');
  const badgeCuentas  = document.getElementById('notif-badge-cuentas');

  if (badgeReservas) {
    const claves = new Set(solicitudesCache.map(s => s.id_lote ? `lote:${s.id_lote}` : `sol:${s.id}`));
    badgeReservas.textContent = claves.size;
    badgeReservas.style.display = claves.size > 0 ? 'inline-block' : 'none';
  }
  if (badgeCuentas) {
    badgeCuentas.textContent = usuariosPendientesCache.length;
    badgeCuentas.style.display = usuariosPendientesCache.length > 0 ? 'inline-block' : 'none';
  }
}

/* ── Render: bandeja de solicitudes ─────────────────────── */
// Punto de entrada público: aplica filtros sobre el cache y pinta.
function renderSolicitudes() {
  filtrarSolicitudes();
}

/* ── Filtrado en cliente: búsqueda + select de estado ────── */
function filtrarSolicitudes() {
  const q      = (document.getElementById('notif-search')?.value ?? '').toLowerCase().trim();
  const estado = (document.getElementById('notif-filter')?.value ?? '');

  const lista = solicitudesCache.filter(s => {
    const haystack = [
      s.nombre_solicitante   ?? '',
      s.apellido_solicitante ?? '',
      s.dni                  ?? '',
      s.libros?.titulo       ?? '',
      s.observaciones        ?? '',
    ].join(' ').toLowerCase();

    const matchQ      = !q      || haystack.includes(q);
    const matchEstado = !estado || s.estado === estado;
    return matchQ && matchEstado;
  });

  _pintarSolicitudes(agruparSolicitudesPorLote(lista));
}

function agruparSolicitudesPorLote(lista) {
  const grupos = new Map();
  lista.forEach(s => {
    const clave = s.id_lote ? `${s.id_lote}:${s.estado}` : `solicitud:${s.id}`;
    const grupo = grupos.get(clave);
    if (grupo) grupo.cantidadVisible++;
    else grupos.set(clave, { ...s, cantidadVisible: 1 });
  });
  return [...grupos.values()];
}

function extraerMateriaLote(observaciones) {
  const match = String(observaciones ?? '').match(/^Lote para clase:\s*(.*?)\s+—\s+\d+\s+ejemplares/i);
  return match?.[1]?.trim() ?? '';
}

function limpiarPrefijoLote(observaciones) {
  return String(observaciones ?? '')
    .replace(/^Lote para clase:.*?\d+\s+ejemplares\s*\|?\s*/i, '')
    .trim();
}

/* ── Pintado real de tarjetas (recibe el array ya filtrado) ─ */
function _pintarSolicitudes(lista) {
  const cont  = document.getElementById('notif-solicitudes-lista');
  const empty = document.getElementById('notif-solicitudes-empty');
  if (!cont) return;
  cont.innerHTML = '';

  if (!lista.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  const CFG = {
    'Pendiente de Aprobación': {
      cardCls:   'border-amber-200 bg-amber-50',
      badgeCls:  'bg-amber-100 text-amber-800',
      badgeText: '⏳ Pendiente de aprobación',
      metaExtra: 'Esperando verificación del libro en estantería',
    },
    'Pendiente de Retiro': {
      cardCls:   'border-green-200 bg-green-50',
      badgeCls:  'bg-green-100 text-green-800',
      badgeText: '📦 Libro separado — esperando retiro',
      metaExtra: 'El libro está en el mostrador',
    },
  };

  lista.forEach(s => {
    const cfg    = CFG[s.estado] ?? CFG['Pendiente de Aprobación'];
    const nombre = `${s.apellido_solicitante ?? ''}, ${s.nombre_solicitante ?? ''}`.trim().replace(/^,\s*/, '');
    const titulo = s.libros?.titulo ?? '—';
    const limite = s.estado === 'Pendiente de Retiro' && s.fecha_limite_retiro
      ? new Date(s.fecha_limite_retiro) : null;
    const urgente = limite ? limite < new Date() : false;

    // La solicitud guarda una copia mínima del solicitante; no hay FK a usuarios.
    const materiaLote = extraerMateriaLote(s.observaciones);
    const etiquetaEscolar = materiaLote ? `👩‍🏫 Profesor/a de ${materiaLote}` : '';

    // Fecha límite institucional — formato estricto DD/MM/YYYY - HH:MM hs
    const fechaLimiteTexto = limite
      ? `📅 Límite de retiro: ${limite.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })} - ${limite.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })} hs`
      : '';

    // ── Tarjeta contenedor ──────────────────────────────────
    const card = document.createElement('div');
    card.className = [
      'flex flex-col md:flex-row md:items-center md:justify-between',
      'gap-3 p-4 rounded-xl border',
      urgente ? 'border-red-300 bg-red-50' : cfg.cardCls,
    ].join(' ');

    // ── Fila superior: avatar + datos ──────────────────────
    const topRow = document.createElement('div');
    topRow.className = 'flex items-start gap-3 flex-1 min-w-0';

    // Avatar
    const initials = nombre.split(/[\s,]+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const avatar = document.createElement('div');
    avatar.className = 'flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold';
    avatar.textContent = initials;

    // Bloque de texto
    const infoBlock = document.createElement('div');
    infoBlock.className = 'flex-1 min-w-0 space-y-1';

    // Línea 1: nombre · DNI
    const nameRow = document.createElement('div');
    nameRow.className = 'font-semibold text-slate-800 text-sm break-words leading-snug';
    const partes = [nombre];
    if (s.dni) partes.push('DNI ' + s.dni);
    nameRow.textContent = partes.join(' · ');

    // Línea 1b: rol + curso — separada visualmente en azul
    const escolarRow = document.createElement('div');
    escolarRow.className = 'text-xs font-medium text-blue-600';
    escolarRow.textContent = etiquetaEscolar;
    escolarRow.hidden = !etiquetaEscolar;

    // Badge de estado
    const badge = document.createElement('span');
    badge.className = `inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badgeCls}`;
    badge.textContent = cfg.badgeText;

    // Línea 2: libro + meta
    const metaRow = document.createElement('div');
    metaRow.className = 'text-xs text-slate-500 break-words leading-relaxed';
    const metaPartes = [`📗 ${titulo}`];
    if (s.id_lote) metaPartes.push(`Lote: ${s.cantidadVisible} de ${s.cantidad_lote} ejemplares`);
    else if (s.cantidad_lote) metaPartes.push(`Ejemplar ${s.indice_lote}/${s.cantidad_lote} del lote`);
    if (s.tiempo_solicitado_dias) metaPartes.push(`${s.tiempo_solicitado_dias} días solicitados`);
    const detalle = s.id_lote ? limpiarPrefijoLote(s.observaciones) : s.observaciones;
    if (detalle) metaPartes.push(detalle);
    metaPartes.push(cfg.metaExtra);
    if (fechaLimiteTexto)         metaPartes.push(fechaLimiteTexto);
    metaRow.textContent = metaPartes.filter(Boolean).join(' · ');

    infoBlock.append(nameRow, escolarRow, badge, metaRow);
    topRow.append(avatar, infoBlock);

    // ── Bloque de botones adaptativo ───────────────────────
    const btnGroup = document.createElement('div');
    btnGroup.className = 'flex flex-col gap-2 mt-4 w-full md:mt-0 md:w-auto md:flex-row md:items-center md:flex-shrink-0';

    if (s.estado === 'Pendiente de Aprobación') {
      const btnAceptar = document.createElement('button');
      btnAceptar.className = 'btn btn-primary w-full md:w-auto';
      btnAceptar.textContent = '✔ Aceptar préstamo';
      btnAceptar.title = 'El libro existe en estantería. Separarlo y avisar al alumno.';
      btnAceptar.addEventListener('click', () => aceptarSolicitud(s, nombre, titulo));
      btnGroup.appendChild(btnAceptar);
    } else {
      const btnEntregar = document.createElement('button');
      btnEntregar.className = 'btn btn-success w-full md:w-auto';
      btnEntregar.textContent = '📖 Confirmar entrega';
      btnEntregar.title = 'El alumno retiró el libro físicamente con DNI en mano.';
      btnEntregar.addEventListener('click', () => confirmarEntrega(
        s.id, nombre, titulo, s.tiempo_solicitado_dias, s.id_lote, s.cantidadVisible,
        Boolean(extraerMateriaLote(s.observaciones)),
      ));
      btnGroup.appendChild(btnEntregar);
    }

    const btnRechazar = document.createElement('button');
    btnRechazar.className = 'btn btn-danger w-full md:w-auto';
    btnRechazar.textContent = '✕ Rechazar';
    btnRechazar.addEventListener('click', () => rechazarReserva(s.id, nombre, s.id_lote));
    btnGroup.appendChild(btnRechazar);

    card.append(topRow, btnGroup);
    cont.appendChild(card);
  });
}

/* ── Render: cuentas pendientes de aprobación ────────────── */
function renderUsuariosPendientes() {
  const cont    = document.getElementById('notif-usuarios-lista');
  const empty   = document.getElementById('notif-usuarios-empty');
  const seccion = document.getElementById('notif-sec-usuarios');
  if (!cont) return;
  cont.innerHTML = '';

  if (seccion) seccion.classList.toggle('hidden', !usuariosPendientesCache.length);
  if (!usuariosPendientesCache.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  const rolLabel = { alumno: '🎒 Alumno', docente: '👩🏫 Docente', admin: '🔑 Admin' };

  usuariosPendientesCache.forEach(u => {
    const nombre = `${capitalizarNombre(u.apellido)}, ${capitalizarNombre(u.nombre)}`;
    const curso  = u.cursos
      ? (u.cursos.division && u.cursos.division !== '—'
          ? `${u.cursos.nombre}° ${u.cursos.division}`
          : u.cursos.nombre)
      : '—';

    const div = document.createElement('div');
    div.className = 'loan-card';

    const initials = [u.apellido, u.nombre].filter(Boolean).map(w => w[0]).join('').toUpperCase();
    const avatarDiv = document.createElement('div'); avatarDiv.className = 'loan-avatar'; avatarDiv.textContent = initials;

    const infoDiv = document.createElement('div'); infoDiv.className = 'loan-info';
    const nameDiv = document.createElement('div'); nameDiv.className = 'loan-name';
    nameDiv.textContent = nombre;
    const metaDiv = document.createElement('div'); metaDiv.className = 'loan-meta';
    metaDiv.textContent = [
      `DNI ${u.dni ?? '—'}`,
      rolLabel[u.rol] ?? u.rol,
      curso !== '—' ? curso : null,
      u.email,
    ].filter(Boolean).join(' · ');
    infoDiv.append(nameDiv, metaDiv);

    const actionsDiv = document.createElement('div'); actionsDiv.className = 'loan-actions';

    const btnAprobar = document.createElement('button');
    btnAprobar.className = 'btn btn-success';
    btnAprobar.textContent = '✔ Aprobar';
    btnAprobar.addEventListener('click', () => aprobarCuenta(u, btnAprobar));

    const btnRechazar = document.createElement('button');
    btnRechazar.className = 'btn btn-danger';
    btnRechazar.textContent = '✕ Rechazar';
    btnRechazar.addEventListener('click', () => rechazarCuenta(u, btnRechazar));

    actionsDiv.append(btnAprobar, btnRechazar);
    div.append(avatarDiv, infoDiv, actionsDiv);
    cont.appendChild(div);
  });
}

/* ══════════════════════════════════════════════════════════
   FASE 1 — Modal «Aceptar solicitud» con buscador de stock
   ══════════════════════════════════════════════════════════ */
let _aceptarCtx = null;   // { s, nombre, titulo }

function aceptarSolicitud(s, nombre, titulo) {
  _aceptarCtx = { s, nombre, titulo };

  // Resetear UI del modal
  document.getElementById('mas-titulo').textContent   = titulo;
  document.getElementById('mas-alumno').textContent   = nombre;
  document.getElementById('mas-inv-input').value      = '';
  document.getElementById('mas-dropdown').innerHTML   = '';
  document.getElementById('mas-dropdown').classList.add('hidden');
  document.getElementById('mas-selected-id').value   = '';
  document.getElementById('mas-selected-label').textContent = '';
  document.getElementById('mas-error').classList.add('hidden');
  document.getElementById('mas-btn-confirmar').disabled = true;
  const esLote = Number(s.cantidad_lote) > 1 && Boolean(s.id_lote);
  document.getElementById('mas-lote-ayuda').classList.toggle('hidden', !esLote);
  document.getElementById('mas-btn-lote').classList.toggle('hidden', !esLote);
  document.getElementById('mas-btn-lote').textContent = esLote
    ? `📦 Asignar ejemplares restantes automáticamente (${s.cantidadVisible ?? s.cantidad_lote})`
    : '📦 Asignar lote automáticamente';
  document.getElementById('mas-btn-lote').disabled = false;
  document.getElementById('mas-inv-label').textContent = esLote
    ? 'Nº de inventario (opcional si asignás el lote automáticamente)'
    : 'Nº de Inventario del ejemplar *';
  document.getElementById('modal-aceptar-solicitud').classList.remove('hidden');
  setTimeout(() => document.getElementById(esLote ? 'mas-btn-lote' : 'mas-inv-input').focus(), 80);
}

async function _ejecutarAceptarLote() {
  if (!_aceptarCtx) return;
  const { s, nombre, titulo } = _aceptarCtx;
  if (!s.id_lote || Number(s.cantidad_lote) < 2) return;

  const btn = document.getElementById('mas-btn-lote');
  const errEl = document.getElementById('mas-error');
  btn.disabled = true;
  btn.textContent = '⏳ Asignando ejemplares…';
  errEl.classList.add('hidden');

  const { data: cantidadAsignada, error } = await supabaseClient.rpc('asignar_lote_solicitud', {
    p_id_solicitud: s.id,
  });
  if (error) {
    errEl.textContent = error.message || 'No se pudo asignar el lote. Verificá el stock disponible.';
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = `📦 Reintentar asignación del lote (${s.cantidadVisible ?? s.cantidad_lote})`;
    return;
  }

  document.getElementById('modal-aceptar-solicitud').classList.add('hidden');
  _aceptarCtx = null;
  mostrarNotificacion(`📦 Se asignaron ${cantidadAsignada} ejemplares del lote de ${titulo} para ${nombre}.`, 'success');

  if (s.email && typeof emailjs !== 'undefined') {
    const limit_date = new Date(Date.now() + 48 * 60 * 60 * 1000).toLocaleDateString('es-AR', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    try {
      await emailjs.send(_EJS_SERVICE, _EJS_T_RESERVA, {
        to_email: String(s.email).trim(),
        to_name: `${s.nombre_solicitante ?? ''} ${s.apellido_solicitante ?? ''}`.trim(),
        book_title: `${titulo} (${cantidadAsignada} ejemplares)`,
        limit_date,
      });
    } catch (e) { console.warn('[EMAIL] reserva_lote falló:', e); }
  }
  await cargarNotificaciones();
}

function _cerrarModalAceptar(e) {
  const modal = document.getElementById('modal-aceptar-solicitud');
  if (e && e.target !== modal) return;
  modal.classList.add('hidden');
  _aceptarCtx = null;
}

// Debounce liviano para no saturar Supabase mientras se escribe
let _masDebounce = null;
function onMasInvInput() {
  clearTimeout(_masDebounce);
  const q = document.getElementById('mas-inv-input').value.trim().toUpperCase();

  // Limpiar selección previa al escribir de nuevo
  document.getElementById('mas-selected-id').value = '';
  document.getElementById('mas-selected-label').textContent = '';
  document.getElementById('mas-btn-confirmar').disabled = true;

  if (q.length < 1) {
    document.getElementById('mas-dropdown').classList.add('hidden');
    return;
  }
  _masDebounce = setTimeout(() => _buscarStock(q), 280);
}

async function _buscarStock(q) {
  const { s } = _aceptarCtx;
  const dropdown = document.getElementById('mas-dropdown');
  dropdown.innerHTML = '<div class="px-3 py-2 text-xs text-slate-400">Buscando…</div>';
  dropdown.classList.remove('hidden');

  // Consulta A: todos los ejemplares físicos de este libro
  // Consulta B: id_stock ya ocupados (Pendiente de Retiro o Retirado activo)
  const [resStock, resSolicitudes, resPrestamos] = await Promise.all([
    supabaseClient
      .from('stock')
      .select('id, nro_inventario')
      .eq('id_libro', s.id_libro)
      .order('nro_inventario'),

    supabaseClient
      .from('solicitudes_prestamo')
      .select('id_stock')
      .eq('id_libro', s.id_libro)
      .in('estado', ['Pendiente de Retiro', 'Retirado'])
      .not('id_stock', 'is', null),

    supabaseClient
      .from('prestamos')
      .select('id_stock')
      .in('estado', ['pendiente', 'activo', 'vencido'])
      .not('id_stock', 'is', null),
  ]);

  if (resStock.error) {
    dropdown.innerHTML = '<div class="px-3 py-2 text-xs text-red-400">Error al consultar stock.</div>';
    return;
  }

  // Construir Set de ids ocupados (unión de ambas fuentes)
  const ocupados = new Set([
    ...(resSolicitudes.data ?? []).map(r => r.id_stock),
    ...(resPrestamos.data   ?? []).map(r => r.id_stock),
  ]);

  // Filtrado en cliente: libres + coincidencia con lo que escribe la bibliotecaria
  const libres = (resStock.data ?? [])
    .filter(r => !ocupados.has(r.id) && r.nro_inventario.toUpperCase().includes(q))
    .slice(0, 8);

  dropdown.innerHTML = '';

  if (!libres.length) {
    dropdown.innerHTML = '<div class="px-3 py-2 text-xs text-slate-400">Sin ejemplares disponibles para ese criterio.</div>';
    return;
  }

  libres.forEach(row => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'w-full text-left px-3 py-2 text-sm hover:bg-blue-50 hover:text-blue-700 transition-colors';
    item.textContent = row.nro_inventario;
    item.addEventListener('click', () => _seleccionarEjemplar(row.id, row.nro_inventario));
    dropdown.appendChild(item);
  });
}

function _seleccionarEjemplar(stockId, nroInv) {
  document.getElementById('mas-inv-input').value            = nroInv;
  document.getElementById('mas-selected-id').value          = stockId;
  document.getElementById('mas-selected-label').textContent = `✔ Ejemplar seleccionado: ${nroInv}`;
  document.getElementById('mas-dropdown').classList.add('hidden');
  document.getElementById('mas-btn-confirmar').disabled      = false;
  document.getElementById('mas-error').classList.add('hidden');
}

async function _ejecutarAceptarSolicitud() {
  if (!_aceptarCtx) return;
  const { s, nombre, titulo } = _aceptarCtx;
  const stockId = parseInt(document.getElementById('mas-selected-id').value);
  const nroInv  = document.getElementById('mas-inv-input').value.trim().toUpperCase();
  const errEl   = document.getElementById('mas-error');
  const btn     = document.getElementById('mas-btn-confirmar');

  if (!stockId) {
    errEl.textContent = 'Seleccioná un ejemplar del desplegable.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';
  errEl.classList.add('hidden');

  // Guardar id_stock + cambiar estado → el ejemplar queda "ocupado" implícitamente
  // (la próxima búsqueda lo excluirá porque aparece en solicitudes con estado activo)
  const { data: fechaLimiteISO, error: errSol } = await supabaseClient.rpc('asignar_ejemplar_solicitud', {
    p_id_solicitud: s.id,
    p_id_stock: stockId,
  });

  if (errSol) {
    errEl.textContent = errSol.message || 'No se pudo asignar el ejemplar. Puede que ya no esté disponible.';
    errEl.classList.remove('hidden');
    btn.disabled = false; btn.textContent = '✔ Confirmar';
    return;
  }

  const fechaLimite = fechaLimiteISO ? new Date(fechaLimiteISO) : new Date(Date.now() + 48 * 60 * 60 * 1000);

  // 3. Email al alumno — best-effort
  if (s.email && typeof emailjs !== 'undefined') {
    const limit_date = fechaLimite.toLocaleDateString('es-AR', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    try {
      await emailjs.send(_EJS_SERVICE, _EJS_T_RESERVA, {
        to_email:   String(s.email).trim(),
        to_name:    `${s.nombre_solicitante ?? ''} ${s.apellido_solicitante ?? ''}`.trim(),
        book_title: String(titulo),
        limit_date,
      });
    } catch (e) { console.warn('[EMAIL] reserva_lista falló:', e); }
  }

  document.getElementById('modal-aceptar-solicitud').classList.add('hidden');
  _aceptarCtx = null;
  mostrarNotificacion(`📦 Ejemplar ${nroInv} reservado para ${nombre}. Alumno notificado.`, 'success');
  await cargarNotificaciones();
}

/* ══════════════════════════════════════════════════════════
   FASE 2 — Confirmar entrega (el id_stock ya está guardado)
   ══════════════════════════════════════════════════════════ */
let _entregaPendiente = null;

function confirmarEntrega(id, nombre, titulo, tiempoDias, idLote = null, cantidad = 1, esClase = false) {
  _entregaPendiente = { id, nombre, titulo, tiempoDias, idLote, cantidad, esClase };
  document.getElementById('mce-alumno').textContent = `${nombre} · ${titulo}${idLote ? ` · ${cantidad} ejemplares` : ''}`;
  document.getElementById('mce-explicacion').textContent = idLote || esClase
    ? 'Al confirmar se registrará el lote completo y su devolución para hoy.'
    : 'El alumno se presentó con su DNI. Al confirmar se registrará el préstamo activo y comenzará el plazo de devolución.';
  document.getElementById('mce-error').classList.add('hidden');
  document.getElementById('mce-btn-confirmar').disabled = false;
  document.getElementById('modal-confirmar-entrega').classList.remove('hidden');
}

function _cerrarModalEntrega(e) {
  const modal = document.getElementById('modal-confirmar-entrega');
  if (e && e.target !== modal) return;
  modal.classList.add('hidden');
  _entregaPendiente = null;
}

async function _ejecutarConfirmarEntrega() {
  if (!_entregaPendiente) return;
  const { id, nombre, titulo, tiempoDias, idLote, cantidad, esClase } = _entregaPendiente;
  const errEl = document.getElementById('mce-error');
  const btn   = document.getElementById('mce-btn-confirmar');
  btn.disabled = true;
  btn.textContent = '⏳ Registrando...';

  const { data: resultado, error } = await supabaseClient.rpc(
    idLote ? 'confirmar_entrega_lote' : 'confirmar_entrega_solicitud',
    { p_id_solicitud: id },
  );
  if (error) {
    errEl.textContent = error.message || 'No se pudo confirmar la entrega. Verificá el estado de la solicitud.';
    errEl.classList.remove('hidden');
    btn.disabled = false; btn.textContent = '✔ Confirmar entrega';
    return;
  }

  document.getElementById('modal-confirmar-entrega').classList.add('hidden');
  _entregaPendiente = null;
  const detalleEntrega = idLote || esClase
    ? `${idLote ? `${cantidad} ejemplares de ` : ''}${titulo} · devolución hoy (${new Date().toLocaleDateString('es-AR')})`
    : `Devolución: ${new Date(resultado + 'T00:00:00').toLocaleDateString('es-AR')}`;
  mostrarNotificacion(`✅ Entrega confirmada · ${nombre} · ${detalleEntrega}.`, 'success');
  await cargarNotificaciones();
}

/* ── Acción: rechazar reserva online ─────────────────────── */
async function rechazarReserva(id, nombre, idLote = null) {
  if (!confirm(`¿Rechazar la reserva de ${nombre}?`)) return;

  let query = supabaseClient.from('solicitudes_prestamo').update({ estado: 'Rechazado' });
  query = idLote
    ? query.eq('id_lote', idLote).in('estado', ['Pendiente de Aprobación', 'Pendiente de Retiro'])
    : query.eq('id', id);
  const { error } = await query;

  if (error) { mostrarNotificacion('Error al rechazar reserva: ' + error.message, 'error'); return; }

  mostrarNotificacion(`Reserva de ${nombre} rechazada.`, 'success');
  await cargarNotificaciones();
}

/* ── Acción: APROBAR cuenta nueva ────────────────────────── */
async function aprobarCuenta(u, btn) {
  const nombre = `${capitalizarNombre(u.apellido)}, ${capitalizarNombre(u.nombre)}`;

  if (!u.email) {
    mostrarNotificacion(`${nombre} no tiene email. Editá el usuario antes de aprobar.`, 'warning');
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳';

  try {
    // 1. Crear cuenta en Supabase Auth con email + DNI como contraseña inicial
    //    Requiere que el proyecto tenga habilitado "Enable email confirmations: OFF"
    //    en Authentication → Settings, o usar la Admin API desde un Edge Function.
    //    Desde el cliente anon solo podemos usar signUp (crea la sesión del nuevo usuario).
    //    Para no interferir con la sesión de la bibliotecaria, usamos un cliente temporal.
    const sbTemp = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);

    const emailFinal = String(u.email).trim().toLowerCase();
    const pwdFinal   = String(u.dni);

    const { error: errAuth } = await sbTemp.auth.signUp({
      email:    emailFinal,
      password: pwdFinal,
    });

    // Ignorar "User already registered" — significa que la cuenta Auth ya existe
    if (errAuth) {
      if (!errAuth.message.includes('already registered')) {
        throw new Error('Auth: ' + errAuth.message);
      }
    }

    // 2. Activar el usuario en la tabla usuarios
    const { error: errUpdate } = await supabaseClient
      .from('usuarios')
      .update({ activo: true })
      .eq('id', u.id);

    if (errUpdate) throw new Error('DB: ' + errUpdate.message);

    // 3. Notificar por email — best-effort: no bloquea el flujo si falla
    try {
      await _enviarEmailCuenta(u.email, `${u.nombre} ${u.apellido}`, 'aprobacion');
    } catch (errEmail) {
      console.warn('[APROBAR] EmailJS falló (no crítico):', errEmail);
      mostrarNotificacion('Cuenta aprobada, pero hubo un problema al enviar el email de notificación.', 'warning');
    }

    mostrarNotificacion(`✅ Cuenta de ${nombre} aprobada. Contraseña inicial: DNI.`, 'success');

    // 4. Actualizar cache y UI
    usuariosPendientesCache = usuariosPendientesCache.filter(x => x.id !== u.id);
    renderUsuariosPendientes();
    actualizarBadgeNotificaciones();
    await cargarUsuarios();
    renderUsuarios();

  } catch (err) {
    console.error('Error al aprobar cuenta:', err);
    mostrarNotificacion('Error al aprobar: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = '✔ Aprobar';
  }
}

/* ── Acción: RECHAZAR cuenta nueva ──────────────────────── */
async function rechazarCuenta(u, btn) {
  const nombre = `${capitalizarNombre(u.apellido)}, ${capitalizarNombre(u.nombre)}`;
  if (!confirm(`¿Rechazar y eliminar la solicitud de ${nombre}? Esta acción no se puede deshacer.`)) return;

  btn.disabled = true;
  btn.textContent = '⏳';

  try {
    // 1. Notificar antes de eliminar (para tener el email disponible)
    if (u.email) await _enviarEmailCuenta(u.email, `${u.nombre} ${u.apellido}`, 'rechazo');

    // 2. Eliminar el registro de usuarios
    const { error } = await supabaseClient.from('usuarios').delete().eq('id', u.id);
    if (error) throw error;

    mostrarNotificacion(`Solicitud de ${nombre} rechazada y eliminada.`, 'success');

    usuariosPendientesCache = usuariosPendientesCache.filter(x => x.id !== u.id);
    renderUsuariosPendientes();
    actualizarBadgeNotificaciones();

  } catch (err) {
    console.error('Error al rechazar cuenta:', err);
    mostrarNotificacion('Error al rechazar: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = '✕ Rechazar';
  }
}

/* ── Email: aprobación / rechazo de cuenta ───────────────── */
async function _enviarEmailCuenta(email, nombreCompleto, tipo) {
  if (!email) return;
  try {
    if (typeof emailjs === 'undefined') return;
    await emailjs.send(_EJS_SERVICE, tipo === 'aprobacion' ? _EJS_T_APROB : _EJS_T_RECHAZO, {
      to_email: email,
      to_name:  nombreCompleto,
      // Variables extra que el template puede usar:
      estado:   tipo === 'aprobacion' ? 'Aprobada' : 'Rechazada',
      mensaje:  tipo === 'aprobacion'
        ? 'Tu cuenta fue aprobada. Podés ingresar con tu DNI como contraseña inicial.'
        : 'Tu solicitud de acceso fue rechazada. Consultá a la bibliotecaria para más información.',
    });
  } catch (err) {
    // El email es best-effort: no bloquea el flujo principal
    console.warn('EmailJS (cuenta):', err);
  }
}
