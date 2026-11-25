/* ============================================================
   EXTENSIONES.JS — Solicitudes de prórroga de plazo
   ------------------------------------------------------------
   1. Lista las solicitudes de extensión (tabla
      `solicitudes_extension`) junto con el préstamo, el libro y
      el solicitante, para la bibliotecaria.
   2. Aprobar: mueve la fecha de devolución del préstamo y marca
      la solicitud como 'Aprobada'.
   3. Rechazar: marca la solicitud como 'Rechazada'.
   ------------------------------------------------------------
   Seguridad: sólo el rol admin ve y modifica estas filas
   (política `admin_all_extensiones` de seguridad-rls.sql) y el
   préstamo se modifica con `admin_all_prestamos`.
   ============================================================ */

let extensionesCache = [];
let _extCtx = null;   // { ext } — contexto del modal de aprobación

/* ── Helpers locales ────────────────────────────────────── */
const _fmtFecha = d => d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const _aFechaISO = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const _NOMBRE_ESTADO_PRESTAMO = {
  pendiente: 'Pendiente de entrega',
  activo:    'Activo',
  vencido:   'Vencido',
  devuelto:  'Devuelto',
  rechazado: 'Rechazado',
};

/* ── Carga principal ────────────────────────────────────── */
async function cargarExtensiones() {
  const loading = document.getElementById('ext-loading');
  const aviso   = document.getElementById('ext-aviso');
  const lista   = document.getElementById('ext-lista');
  const empty   = document.getElementById('ext-empty');

  if (loading) loading.classList.remove('hidden');
  if (aviso)   aviso.classList.add('hidden');
  if (empty)   empty.classList.add('hidden');
  if (lista)   lista.innerHTML = '';

  const { data, error } = await supabaseClient
    .from('solicitudes_extension')
    .select(
      'id, id_prestamo, motivo, estado, fecha_solicitud, ' +
      'prestamos(id, estado, fecha_devolucion, fecha_prestamo, ' +
      'usuarios(nombre, apellido, dni, email), stock(nro_inventario, libros(titulo)))'
    )
    .order('fecha_solicitud', { ascending: false });

  if (loading) loading.classList.add('hidden');

  if (error) {
    console.error('[EXTENSIONES] Error cargando:', error.message, error);
    extensionesCache = [];
    actualizarBadgeExtensiones();

    // ¿Falta ejecutar el SQL? (la tabla todavía no existe)
    const faltaTabla = /solicitudes_extension|PGRST205|42P01/i.test(`${error.message} ${error.code ?? ''}`);
    if (aviso) aviso.classList.toggle('hidden', !faltaTabla);

    if (!faltaTabla && lista) {
      const p = document.createElement('p');
      p.style.cssText = 'text-align:center;color:#dc2626;padding:1.5rem;';
      p.textContent = `No se pudieron cargar las solicitudes: ${error.message}`;
      lista.appendChild(p);
    }
    return;
  }

  extensionesCache = data || [];
  actualizarBadgeExtensiones();
  filtrarExtensiones();
}

/* ── Badge contador en el nav ───────────────────────────── */
function actualizarBadgeExtensiones() {
  const badge = document.getElementById('notif-badge-extensiones');
  if (!badge) return;
  const pendientes = extensionesCache.filter(e => e.estado === 'Pendiente').length;
  badge.textContent = pendientes;
  badge.style.display = pendientes > 0 ? 'inline-block' : 'none';
}

/* ── Filtrado en cliente: búsqueda + select de estado ───── */
function filtrarExtensiones() {
  // Normaliza sin acentos: "sofia" debe encontrar a "Sofía", "gomez" a "Gómez"
  const _sinTilde = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const q      = _sinTilde((document.getElementById('ext-search')?.value ?? '').trim());
  const estado = document.getElementById('ext-filter')?.value ?? '';

  const lista = extensionesCache.filter(e => {
    const p = e.prestamos;
    const haystack = _sinTilde([
      p?.usuarios?.nombre   ?? '',
      p?.usuarios?.apellido ?? '',
      p?.usuarios?.dni      ?? '',
      p?.stock?.libros?.titulo ?? '',
      p?.stock?.nro_inventario ?? '',
      e.motivo ?? '',
    ].join(' '));

    return (!q || haystack.includes(q)) && (!estado || e.estado === estado);
  });

  pintarExtensiones(lista);
}

/* ── Pintado de tarjetas ────────────────────────────────── */
function pintarExtensiones(lista) {
  const cont  = document.getElementById('ext-lista');
  const empty = document.getElementById('ext-empty');
  if (!cont) return;
  cont.innerHTML = '';

  if (!lista.length) {
    // ¿No hay datos en absoluto o la búsqueda/filtro no dejó nada?
    const hayFiltro = (document.getElementById('ext-search')?.value ?? '').trim()
                   || document.getElementById('ext-filter')?.value;
    empty.textContent = extensionesCache.length && hayFiltro
      ? '🔍 No hay solicitudes que coincidan con la búsqueda.'
      : '✅ No hay solicitudes de extensión.';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const CFG = {
    Pendiente: {
      cardCls:   'border-violet-200 bg-violet-50',
      badgeCls:  'bg-violet-100 text-violet-800',
      badgeText: '⏳ Pendiente de respuesta',
    },
    Aprobada: {
      cardCls:   'border-green-200 bg-green-50',
      badgeCls:  'bg-green-100 text-green-800',
      badgeText: '✅ Extensión aprobada',
    },
    Rechazada: {
      cardCls:   'border-red-200 bg-red-50',
      badgeCls:  'bg-red-100 text-red-800',
      badgeText: '✕ Rechazada',
    },
  };

  lista.forEach(e => {
    const cfg    = CFG[e.estado] ?? CFG.Pendiente;
    const p      = e.prestamos;
    const u      = p?.usuarios ?? {};
    const titulo = p?.stock?.libros?.titulo ?? '—';
    const inv    = p?.stock?.nro_inventario;
    const nombre = [u.apellido, u.nombre].filter(Boolean).join(', ') || '—';

    const devolucion = p?.fecha_devolucion ? new Date(p.fecha_devolucion + 'T00:00:00') : null;
    const pedido     = e.fecha_solicitud ? new Date(e.fecha_solicitud) : null;

    // ── Tarjeta contenedor (mismo estilo que Reservas Online) ──
    const card = document.createElement('div');
    card.className = [
      'flex flex-col md:flex-row md:items-center md:justify-between',
      'gap-3 p-4 rounded-xl border', cfg.cardCls,
    ].join(' ');

    // ── Fila superior: avatar + datos ──────────────────────
    const topRow = document.createElement('div');
    topRow.className = 'flex items-start gap-3 flex-1 min-w-0';

    const iniciales = [u.apellido, u.nombre].filter(Boolean)
      .map(w => w[0]).slice(0, 2).join('').toUpperCase() || '??';
    const avatar = document.createElement('div');
    avatar.className = 'flex-shrink-0 w-10 h-10 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-sm font-bold';
    avatar.textContent = iniciales;

    const infoBlock = document.createElement('div');
    infoBlock.className = 'flex-1 min-w-0 space-y-1';

    // Línea 1: nombre · DNI
    const nameRow = document.createElement('div');
    nameRow.className = 'font-semibold text-slate-800 text-sm break-words leading-snug';
    nameRow.textContent = u.dni ? `${nombre} · DNI ${u.dni}` : nombre;

    // Badge de estado de la solicitud
    const badge = document.createElement('span');
    badge.className = `inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badgeCls}`;
    badge.textContent = cfg.badgeText;

    // Línea 2: libro, estado del préstamo y fechas
    const metaRow = document.createElement('div');
    metaRow.className = 'text-xs text-slate-500 break-words leading-relaxed';
    const partes = [`📗 ${titulo}`];
    if (inv) partes.push(`Inv. ${inv}`);
    if (p?.estado) partes.push(`Préstamo: ${_NOMBRE_ESTADO_PRESTAMO[p.estado] ?? p.estado}`);
    if (devolucion) partes.push(`📅 Vence: ${_fmtFecha(devolucion)}`);
    else partes.push('📅 Sin fecha de devolución');
    if (pedido) partes.push(`🕐 Pedido: ${_fmtFecha(pedido)}`);
    metaRow.textContent = partes.join(' · ');

    // Línea 3: motivo del solicitante (comillas)
    const motivoRow = document.createElement('div');
    motivoRow.className = 'text-xs text-slate-600 italic break-words leading-relaxed';
    motivoRow.textContent = e.motivo ? `💬 "${e.motivo}"` : '';

    infoBlock.append(nameRow, badge, metaRow);
    if (e.motivo) infoBlock.appendChild(motivoRow);
    topRow.append(avatar, infoBlock);

    // ── Botones ────────────────────────────────────────────
    const btnGroup = document.createElement('div');
    btnGroup.className = 'flex flex-col gap-2 mt-4 w-full md:mt-0 md:w-auto md:flex-row md:items-center md:flex-shrink-0';

    if (e.estado === 'Pendiente') {
      const btnAprobar = document.createElement('button');
      btnAprobar.className = 'btn btn-success w-full md:w-auto';
      btnAprobar.textContent = '⏱ Aprobar';
      btnAprobar.title = 'Mover la fecha de devolución y avisarle al solicitante desde su panel.';
      btnAprobar.addEventListener('click', () => abrirModalAprobarExtension(e));

      const btnRechazar = document.createElement('button');
      btnRechazar.className = 'btn btn-danger w-full md:w-auto';
      btnRechazar.textContent = '✕ Rechazar';
      btnRechazar.title = 'La solicitud queda rechazada y el plazo no se modifica.';
      btnRechazar.addEventListener('click', () => rechazarExtension(e));

      btnGroup.append(btnAprobar, btnRechazar);
    } else {
      // Resolución ya tomada: mostramos quién y cuándo (sin acciones)
      const resuelta = document.createElement('p');
      resuelta.className = 'text-xs text-slate-400 m-0';
      resuelta.textContent = e.estado === 'Aprobada' ? 'Plazo extendido ✔' : 'Sin cambios en el plazo';
      btnGroup.appendChild(resuelta);
    }

    card.append(topRow, btnGroup);
    cont.appendChild(card);
  });
}

/* ══════════════════════════════════════════════════════════
   Modal — Aprobar extensión
   ══════════════════════════════════════════════════════════ */
function abrirModalAprobarExtension(ext) {
  const p = ext.prestamos;
  const u = p?.usuarios ?? {};
  const titulo   = p?.stock?.libros?.titulo ?? '—';
  const inv      = p?.stock?.nro_inventario;
  const nombre   = [u.apellido, u.nombre].filter(Boolean).join(', ') || '—';
  const devolucion = p?.fecha_devolucion ? new Date(p.fecha_devolucion + 'T00:00:00') : null;

  _extCtx = { ext };

  document.getElementById('mea-solicitante').textContent = u.dni ? `${nombre} · DNI ${u.dni}` : nombre;
  document.getElementById('mea-libro').textContent = inv ? `📗 ${titulo} · Inv. ${inv}` : `📗 ${titulo}`;
  document.getElementById('mea-fechas').textContent = devolucion
    ? `📅 Devolución actual: ${_fmtFecha(devolucion)}`
    : '📅 Sin fecha de devolución: el préstamo todavía no fue entregado.';
  document.getElementById('mea-motivo').textContent = ext.motivo ? `💬 "${ext.motivo}"` : 'Sin motivo informado.';

  // Modo 1: hay fecha → pedir días.  Modo 2: no hay fecha → pedir fecha.
  const wrapDias   = document.getElementById('mea-dias-wrap');
  const wrapFecha  = document.getElementById('mea-fecha-wrap');
  const inputDias  = document.getElementById('mea-dias');
  const inputFecha = document.getElementById('mea-fecha');
  const aviso      = document.getElementById('mea-aviso-estado');
  const btn        = document.getElementById('mea-btn-confirmar');

  wrapDias.classList.toggle('hidden', !devolucion);
  wrapFecha.classList.toggle('hidden', !!devolucion);

  if (devolucion) {
    inputDias.value = 7;
    inputDias.max = 60;
  } else {
    const hoy = new Date();
    inputFecha.min = _aFechaISO(hoy);
    inputFecha.value = '';
  }

  // Restaurar el botón (tras una aprobación quedó en "⏳ Guardando…" / disabled)
  btn.textContent = '✔ Aprobar extensión';
  btn.disabled = false;

  // Estado del préstamo: avisos que evitan decisiones erróneas
  let avisoTexto = '';
  if (p?.estado === 'devuelto') {
    avisoTexto = '⚠️ Este préstamo ya fue devuelto: no tiene sentido extenderlo. Rechazá la solicitud.';
    btn.disabled = true;
  } else if (p?.estado === 'pendiente') {
    avisoTexto = 'ℹ️ Este préstamo todavía no fue entregado: al aprobar se fija directamente la fecha de devolución.';
    btn.disabled = false;
  } else if (p?.estado === 'vencido') {
    avisoTexto = '⚠️ El préstamo está vencido: la extensión lo deja al día con la nueva fecha.';
    btn.disabled = false;
  } else {
    btn.disabled = false;
  }
  aviso.textContent = avisoTexto;
  aviso.classList.toggle('hidden', !avisoTexto);

  document.getElementById('mea-preview').classList.add('hidden');
  document.getElementById('mea-error').classList.add('hidden');
  document.getElementById('modal-aprobar-extension').classList.remove('hidden');

  // Preview inmediato del resultado
  actualizarPreviewExtension();
  if (devolucion) setTimeout(() => inputDias.focus(), 80);
}

function _cerrarModalAprobarExtension(e) {
  const modal = document.getElementById('modal-aprobar-extension');
  if (e && e.target !== modal) return;
  modal.classList.add('hidden');
  _extCtx = null;
}

/* ── Preview en vivo de la nueva fecha ──────────────────── */
function actualizarPreviewExtension() {
  if (!_extCtx) return;
  const p = _extCtx.ext.prestamos;
  const el = document.getElementById('mea-preview');
  const devolucion = p?.fecha_devolucion ? new Date(p.fecha_devolucion + 'T00:00:00') : null;

  if (devolucion) {
    const dias = parseInt(document.getElementById('mea-dias').value, 10);
    if (!dias || dias < 1) { el.classList.add('hidden'); return; }
    const nueva = new Date(devolucion);
    nueva.setDate(nueva.getDate() + dias);
    el.textContent = `Nueva fecha de devolución: ${_fmtFecha(nueva)}  (+${dias} día${dias === 1 ? '' : 's'})`;
  } else {
    const valor = document.getElementById('mea-fecha').value;
    if (!valor) { el.classList.add('hidden'); return; }
    const nueva = new Date(valor + 'T00:00:00');
    el.textContent = `Nueva fecha de devolución: ${_fmtFecha(nueva)}`;
  }
  el.classList.remove('hidden');
}

/* ── Ejecutar aprobación ────────────────────────────────── */
async function _ejecutarAprobarExtension() {
  if (!_extCtx) return;
  const { ext } = _extCtx;
  const p = ext.prestamos;
  const errEl = document.getElementById('mea-error');
  const btn   = document.getElementById('mea-btn-confirmar');

  const u = p?.usuarios ?? {};
  const nombre = [u.apellido, u.nombre].filter(Boolean).join(', ') || '—';

  // 1. Calcular la nueva fecha (YYYY-MM-DD, en horario local)
  let nuevaFecha = null;
  if (p?.fecha_devolucion) {
    const dias = parseInt(document.getElementById('mea-dias').value, 10);
    if (!dias || dias < 1 || dias > 60) {
      errEl.textContent = 'Ingresá una cantidad de días entre 1 y 60.';
      errEl.classList.remove('hidden');
      return;
    }
    const base = new Date(p.fecha_devolucion + 'T00:00:00');
    base.setDate(base.getDate() + dias);
    nuevaFecha = _aFechaISO(base);
  } else {
    const valor = document.getElementById('mea-fecha').value;
    if (!valor) {
      errEl.textContent = 'Elegí la nueva fecha de devolución.';
      errEl.classList.remove('hidden');
      return;
    }
    nuevaFecha = valor;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Guardando…';
  errEl.classList.add('hidden');

  const { error } = await supabaseClient.rpc('resolver_extension', {
    p_id_extension: ext.id,
    p_aprobar: true,
    p_nueva_fecha: nuevaFecha,
  });
  if (error) {
    errEl.textContent = error.message || 'No se pudo resolver la extensión.';
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = '✔ Aprobar extensión';
    return;
  }
  mostrarNotificacion(`✅ Extensión aprobada: ${nombre} vence el ${_fmtFecha(new Date(nuevaFecha + 'T00:00:00'))}.`, 'success');

  document.getElementById('modal-aprobar-extension').classList.add('hidden');
  _extCtx = null;
  await cargarExtensiones();
}

/* ── Acción: rechazar extensión ─────────────────────────── */
async function rechazarExtension(ext) {
  const p = ext.prestamos;
  const u = p?.usuarios ?? {};
  const nombre = [u.apellido, u.nombre].filter(Boolean).join(', ') || '—';

  if (!confirm(`¿Rechazar la solicitud de extensión de ${nombre}?`)) return;

  const { error } = await supabaseClient.rpc('resolver_extension', {
    p_id_extension: ext.id,
    p_aprobar: false,
    p_nueva_fecha: null,
  });

  if (error) {
    console.error('[EXTENSIONES] Error al rechazar:', error.message);
    mostrarNotificacion('Error al rechazar la solicitud: ' + error.message, 'error');
    return;
  }

  mostrarNotificacion(`✕ Extensión rechazada (${nombre}). El plazo no se modificó.`, 'success');
  await cargarExtensiones();
}
