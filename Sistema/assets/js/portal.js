/* ============================================================
   PORTAL.JS — Login por DNI + Paneles Alumno / Docente
   ============================================================ */

// La instancia única viene de config.js + db.js (cargados antes que este archivo).
// Así evitamos el warning "Multiple GoTrueClient instances" y el conflicto de
// tokens en localStorage que rompía el login tras cambiar la contraseña.
const sb = window.supabaseClient;

/* ── Helpers de seguridad ────────────────────── */
// Escapa HTML para inyectar texto de la BD en el DOM sin XSS.
function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Solo permite URLs http/https (bloquea javascript:, data:, etc.)
function urlSegura(url) {
  if (!url) return '#';
  try {
    const u = new URL(String(url), window.location.origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '#';
  } catch {
    return '#';
  }
}

/* ── Estado global ─────────────────────────── */
let rolActual = 'alumno';          // 'alumno' | 'docente'
let usuarioActual = null;          // fila de tabla usuarios
let anioAlumno      = 0;           // sin curso identificable no se habilita material segmentado
let tecnicaturaAlumno = null;      // nombre de la tecnicatura (ej: 'Informática') o null
let tipoSolicitudDocente = 'personal';
let librosCache = [];
let materialCache = [];
let prestamosCache = [];
// id_prestamo → estado de su última solicitud de extensión ('Pendiente' |
// 'Aprobada' | 'Rechazada'). Se usa para no dejar pedir dos veces la misma
// prórroga mientras la bibliotecaria no respondió.
let extensionesCache = new Map();
let mostrarMaterialAnterior = false;

/* ════════════════════════════════════════════
   LOGIN
   ════════════════════════════════════════════ */
function setRol(rol) {
  rolActual = rol;
  const isAlumno = rol === 'alumno';
  document.getElementById('btn-rol-alumno').className =
    'flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ' +
    (isAlumno ? 'bg-blue-600 text-white shadow' : 'text-white/50 hover:text-white/80');
  document.getElementById('btn-rol-docente').className =
    'flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ' +
    (!isAlumno ? 'bg-blue-600 text-white shadow' : 'text-white/50 hover:text-white/80');
  // Limpiar error y campos al cambiar de pestaña
  const errEl = document.getElementById('login-error');
  if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }
  ['login-dni', 'login-pwd'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.classList.remove('border-red-500', 'ring-red-500'); }
  });
}

function togglePwd() {
  const el = document.getElementById('login-pwd');
  el.type = el.type === 'password' ? 'text' : 'password';
}

async function doPortalLogin() {
  const dniRaw = String(document.getElementById('login-dni').value).trim();
  const pwd    = document.getElementById('login-pwd').value;
  const btn    = document.querySelector('#panel-login button[onclick="doPortalLogin()"]');

  document.getElementById('login-error').classList.add('hidden');

  if (!dniRaw || !pwd) return showLoginError('Completá DNI y contraseña.');

  if (btn) { btn.disabled = true; btn.textContent = 'Ingresando…'; }

  const resetBtn = () => {
    if (btn) { btn.disabled = false; btn.textContent = 'Ingresar →'; }
  };

  // Limpiar tokens huérfanos de Supabase antes de autenticar
  Object.keys(localStorage)
    .filter(k => k.startsWith('sb-') && k.includes('-auth-token'))
    .forEach(k => localStorage.removeItem(k));

  // 1. Preservar el DNI tal como fue ingresado (sin parseInt para no perder ceros)
  const dniStr = dniRaw.replace(/\D/g, '');

  // 2. Buscar email + estado por DNI vía RPC segura (evita volcar la tabla usuarios)
  let usuario = null;
  let errConsulta = null;
  for (const val of [dniStr, dniRaw.trim()]) {
    const { data, error } = await sb.rpc('login_lookup', { p_dni: val });
    if (error) { errConsulta = error; continue; }
    const fila = Array.isArray(data) ? data[0] : data;
    if (fila?.email) { usuario = fila; break; }
  }

  if (!usuario && errConsulta) {
    console.error('[LOGIN] Error consultando usuarios:', errConsulta.message, errConsulta);
    resetBtn();
    return showLoginError('Error de conexión. Recargá la página e intentá nuevamente.');
  }

  // Mensaje único y genérico: evita enumerar DNIs registrados
  // (anti-enumeración de cuentas).
  const MSG_LOGIN = 'No se pudo iniciar sesión con esos datos. Verificá DNI y contraseña, o consultá a la bibliotecaria si tu cuenta está pendiente de aprobación.';

  if (!usuario) {
    resetBtn();
    return showLoginError(MSG_LOGIN);
  }

  // 3. Bloquear cuentas pendientes de aprobación (mismo mensaje genérico)
  if (usuario.activo === false) {
    resetBtn();
    return showLoginError(MSG_LOGIN);
  }

  // 4. Autenticar contra Supabase Auth
  const { error: errAuth } = await sb.auth.signInWithPassword({
    email:    usuario.email.trim().toLowerCase(),
    password: pwd,
  });

  if (errAuth) {
    resetBtn();
    return showLoginError(MSG_LOGIN);
  }

  // 5. Verificar que el rol seleccionado coincida con el rol real
  // (los admins pueden entrar desde cualquier pestaña)
  if (usuario.rol !== 'admin' && usuario.rol !== rolActual) {
    await sb.auth.signOut();
    resetBtn();
    return showLoginError(
      usuario.rol === 'alumno'
        ? 'Este DNI corresponde a un alumno. Seleccioná la pestaña "Alumno" para ingresar.'
        : 'Este DNI corresponde a un docente. Seleccioná la pestaña "Docente" para ingresar.'
    );
  }

  // 6. Redirigir según rol
  const destino = { alumno: 'panel-alumno.html', docente: 'panel-docente.html', admin: 'admin/index.html' };
  window.location.href = destino[usuario.rol] ?? 'panel-alumno.html';
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function doPortalLogout() {
  await sb.auth.signOut();
  window.location.href = 'portal-login.html';
}

// Enter key en login
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-dni')) doPortalLogin();
});

/* ════════════════════════════════════════════
   UTILIDADES COMPARTIDAS
   ════════════════════════════════════════════ */
// Estados que se agrupan bajo el filtro 'activo' en la vista del alumno
const ESTADOS_ACTIVO = new Set(['activo', 'Retirado']);

function estadoBadge(estado) {
  const map = {
    'activo':                   'bg-green-100 text-green-700',
    'Retirado':                  'bg-green-100 text-green-700',
    'Pendiente de Retiro':       'bg-blue-100 text-blue-700',
    'Pendiente de Aprobación':   'bg-amber-100 text-amber-700',
    'pendiente':                 'bg-amber-100 text-amber-700',
    'vencido':                   'bg-red-100 text-red-700',
    'Vencido':                   'bg-red-100 text-red-700',
    'devuelto':                  'bg-slate-100 text-slate-500',
    'Rechazado':                 'bg-red-100 text-red-700',
  };
  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[estado] ?? 'bg-slate-100 text-slate-500'}">${escapeHtml(estado)}</span>`;
}

function msgBox(elId, tipo, texto) {
  const el = document.getElementById(elId);
  if (!el) return;
  const clases = {
    success: 'bg-green-50 border border-green-200 text-green-700',
    error:   'bg-red-50 border border-red-200 text-red-700',
    info:    'bg-blue-50 border border-blue-200 text-blue-700',
  };
  el.className = `text-sm rounded-xl px-4 py-2.5 ${clases[tipo] ?? clases.info}`;
  el.textContent = texto;
  el.classList.remove('hidden');
}

async function cambiarPasswordGenerico(pwdNuevaId, pwdConfirmarId, msgId) {
  const nueva = document.getElementById(pwdNuevaId).value;
  const confirmar = document.getElementById(pwdConfirmarId).value;

  if (nueva.length < 6) return msgBox(msgId, 'error', 'La contraseña debe tener al menos 6 caracteres.');
  if (nueva !== confirmar) return msgBox(msgId, 'error', 'Las contraseñas no coinciden.');

  const { error } = await sb.auth.updateUser({ password: nueva });
  if (error) return msgBox(msgId, 'error', traducirErrorAuth(error.message));

  msgBox(msgId, 'success', '✓ Contraseña actualizada correctamente.');
  document.getElementById(pwdNuevaId).value = '';
  document.getElementById(pwdConfirmarId).value = '';
}

function traducirErrorAuth(msg) {
  if (msg.includes('New password should be different from the old password'))
    return 'La nueva contraseña debe ser diferente a la actual. Elegí una clave nueva por seguridad.';
  if (msg.includes('Password should be at least 6 characters'))
    return 'La contraseña debe tener al menos 6 caracteres.';
  if (msg.includes('Auth session missing'))
    return 'Tu sesión expiró. Volvé a iniciar sesión e intentá nuevamente.';
  if (msg.includes('User not found'))
    return 'No se encontró el usuario. Comunicate con la bibliotecaria.';
  return 'Ocurrió un error al actualizar la contraseña. Intentá nuevamente.';
}

/* ════════════════════════════════════════════
   PANEL ALUMNO
   ════════════════════════════════════════════ */
async function initPanelAlumno() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'portal-login.html'; return; }

  // Cargar datos del usuario (sin join para evitar 400 si la FK no está declarada en PostgREST)
  const { data: user, error: errUser } = await sb
    .from('usuarios')
    .select('id, nombre, apellido, dni, email, id_curso, rol, activo')
    // Auth normaliza el email a minúsculas; la fila histórica de usuarios
    // puede conservar mayúsculas. Debe coincidir con la política RLS, que
    // compara lower(email), para evitar el rebote al login tras autenticar.
    .ilike('email', session.user.email)
    .maybeSingle();

  // Control de rol: este panel es solo para alumnos
  if (errUser) console.error('[PANEL ALUMNO] No se pudo cargar el perfil:', errUser);
  if (!user || errUser || user.rol !== 'alumno' || user.activo !== true) { window.location.href = 'portal-login.html'; return; }
  usuarioActual = user;

  // Resolver el curso en una consulta separada
  let cursoLabel = '—';
  if (user.id_curso) {
    const { data: curso } = await sb
      .from('cursos')
      .select('nombre, division')
      .eq('id', user.id_curso)
      .maybeSingle();
    if (curso) {
      // Extraer número de año — acepta '7', '7mo', '7°', '7 Programación', etc.
      const matchAnio = String(curso.nombre).match(/(\d+)/);
      if (matchAnio) anioAlumno = parseInt(matchAnio[1]);

      const div = curso.division?.trim();
      // División alfabética: una sola letra (A, B, C…) o vacía/guión → no es tecnicatura
      const esDivisionAlfabetica = !div || div === '—' || /^[A-Za-z]$/.test(div);

      if (anioAlumno >= 4) {
        if (!esDivisionAlfabetica) {
          // La división contiene el nombre de la tecnicatura (ej: 'Programación', 'Informática')
          tecnicaturaAlumno = div;
        } else {
          // Fallback: extraer tecnicatura del nombre del curso (ej: '7mo Programación')
          const partes = String(curso.nombre).split(/\s+/);
          const sinAnio = partes.filter(p => !/^\d/.test(p) && !/^(mo|ro|to|vo|do|°)$/i.test(p));
          if (sinAnio.length) tecnicaturaAlumno = sinAnio.join(' ');
        }
      }

      console.log('[MATERIAL] Curso:', curso.nombre, '| División:', div,
        '| Año:', anioAlumno, '| Tecnicatura:', tecnicaturaAlumno);

      cursoLabel = div && div !== '—'
        ? `${curso.nombre} ${div}`
        : curso.nombre;
    }
  }

  const nombreCompleto = `${user.nombre} ${user.apellido}`;
  document.getElementById('alumno-nombre').textContent = nombreCompleto;
  document.getElementById('info-nombre').textContent = nombreCompleto;
  document.getElementById('info-dni').textContent = user.dni;
  document.getElementById('info-email').textContent = user.email ?? '—';
  document.getElementById('info-curso').textContent = cursoLabel;

  await Promise.all([cargarPrestamosAlumno(), cargarMaterialEstudio()]);
  _inicializarBotonesAnio();   // ocultar años futuros según anioAlumno
}

async function cargarPrestamosAlumno() {
  // Préstamos activos (tabla prestamos)
  const { data: prest } = await sb
    .from('prestamos')
    .select('id, estado, fecha_prestamo, fecha_devolucion, stock(id_libro, libros(titulo))')
    .eq('id_usuario', usuarioActual.id)
    .order('fecha_prestamo', { ascending: false });

  // Solicitudes online (tabla solicitudes_prestamo)
  const { data: sols } = await sb
    .from('solicitudes_prestamo')
    .select('id, estado, fecha_solicitud, fecha_limite_retiro, id_libro, observaciones, cantidad_lote, indice_lote, libros(titulo)')
    .eq('dni', usuarioActual.dni)
    .order('fecha_solicitud', { ascending: false });

  // Unificar en un array común
  prestamosCache = [
    ...(prest || []).map(p => ({
      id: p.id,
      titulo: p.stock?.libros?.titulo ?? '—',
      estado: p.estado,
      fecha: p.fecha_prestamo,
      vence: p.fecha_devolucion,
      origen: 'prestamo',
    })),
    ...(sols || []).map(s => ({
      id: s.id,
      titulo: s.cantidad_lote
        ? `${s.libros?.titulo ?? '—'} (lote ${s.indice_lote}/${s.cantidad_lote})`
        : (s.libros?.titulo ?? '—'),
      estado: s.estado,
      fecha: s.fecha_solicitud,
      vence: s.fecha_limite_retiro,
      origen: 'solicitud',
    })),
  ];

  // ── Extensiones ya pedidas (para no duplicar el pedido) ──
  await cargarMisExtensiones((prest || []).map(p => p.id));

  // KPIs
  const activos    = prestamosCache.filter(p => p.estado === 'activo' || p.estado === 'Retirado').length;
  const pendientes = prestamosCache.filter(p => ['Pendiente de Aprobación', 'Pendiente de Retiro', 'pendiente'].includes(p.estado)).length;
  const hoy = new Date();
  const en7dias = new Date(hoy); en7dias.setDate(hoy.getDate() + 7);
  const porVencer = prestamosCache.filter(p => {
    if (!p.vence || p.estado === 'devuelto') return false;
    const v = new Date(p.vence);
    return v >= hoy && v <= en7dias;
  }).length;

  document.getElementById('kpi-activos').textContent = activos;
  document.getElementById('kpi-pendientes').textContent = pendientes;
  document.getElementById('kpi-vencer').textContent = porVencer;
  document.getElementById('kpi-total').textContent = prestamosCache.length;

  renderPrestamosAlumno();
  renderSolicitudesPendientes();
}

function renderSolicitudesPendientes() {
  const ESTADOS_SOL = ['Pendiente de Aprobación', 'Pendiente de Retiro'];
  const activas = prestamosCache.filter(
    p => p.origen === 'solicitud' && ESTADOS_SOL.includes(p.estado)
  );
  const badge      = document.getElementById('badge-sols-pendientes');
  const cardsWrap  = document.getElementById('lista-solicitudes-pendientes');
  const tbodyDesk  = document.getElementById('tbody-solicitudes-pendientes');
  const empty      = document.getElementById('empty-solicitudes-pendientes');
  if (!badge || !cardsWrap || !empty) return;

  badge.textContent = activas.length;
  cardsWrap.innerHTML  = '';
  if (tbodyDesk) tbodyDesk.innerHTML = '';

  if (!activas.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  const CFG = {
    'Pendiente de Aprobación': {
      bg: 'hover:bg-amber-50/50', iconoBg: 'bg-amber-100', icono: '⏳',
      badgeCls: 'bg-amber-100 text-amber-700', badgeText: 'Pendiente de aprobación',
      subtexto: (f, _l) => `Solicitado el ${f} · La bibliotecaria está buscando el libro`,
    },
    'Pendiente de Retiro': {
      bg: 'hover:bg-blue-50/50', iconoBg: 'bg-blue-100', icono: '📦',
      badgeCls: 'bg-blue-100 text-blue-700', badgeText: '¡Listo para retirar!',
      subtexto: (_f, l) => `Tu libro está separado. Retirá antes del: <span class="font-semibold text-blue-700">${l}</span>`,
    },
  };

  activas.forEach(s => {
    const cfg       = CFG[s.estado] ?? CFG['Pendiente de Aprobación'];
    const fechaStr  = s.fecha ? new Date(s.fecha).toLocaleDateString('es-AR') : '—';
    const limiteStr = s.vence ? new Date(s.vence).toLocaleDateString('es-AR') : '—';
    const cantidadLabel = s.idLote && s.origen === 'solicitud' && s.cantidadVisible < s.cantidad
      ? `${s.cantidadVisible} de ${s.cantidad} ejemplares`
      : `${s.cantidad} ejemplar${s.cantidad === 1 ? '' : 'es'}`;
    const tituloVisible = s.idLote || s.cursoClase
      ? `${s.titulo} · ${cantidadLabel}`
      : s.titulo;
    const contextoClase = s.cursoClase ? ` · Para ${s.cursoClase}` : '';

    // ─ Fila tabla desktop (md+)
    if (tbodyDesk) {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition-colors';
      tr.innerHTML = `
        <td class="px-5 py-3 font-medium text-slate-800 max-w-[200px] truncate">${escapeHtml(tituloVisible)}</td>
        <td class="px-4 py-3"><span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.badgeCls}">${cfg.badgeText}</span></td>
        <td class="px-4 py-3 text-slate-500 text-xs">${fechaStr}</td>
        <td class="px-4 py-3 text-slate-500 text-xs">${limiteStr}</td>`;
      tbodyDesk.appendChild(tr);
    }

    // ─ Card mobile
    const div = document.createElement('div');
    div.className = `p-4 flex flex-col gap-3 ${cfg.bg} transition-colors`;
    div.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <p class="font-semibold text-slate-800 text-sm leading-snug flex-1">${escapeHtml(tituloVisible)}</p>
        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.badgeCls} flex-shrink-0">${cfg.badgeText}</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-7 h-7 rounded-lg ${cfg.iconoBg} flex items-center justify-center text-sm flex-shrink-0">${cfg.icono}</div>
        <p class="text-xs text-slate-400">${cfg.subtexto(fechaStr, limiteStr)}${escapeHtml(contextoClase)}</p>
      </div>`;
    cardsWrap.appendChild(div);
  });
}

function renderPrestamosAlumno() {
  const filtro = document.getElementById('filtro-estado')?.value ?? '';
  const lista = filtro
    ? prestamosCache.filter(p => filtro === 'activo' ? ESTADOS_ACTIVO.has(p.estado) : p.estado === filtro)
    : prestamosCache;

  const tbody      = document.getElementById('tbody-prestamos-alumno');
  const cardsWrap  = document.getElementById('cards-prestamos-alumno');
  const empty      = document.getElementById('empty-prestamos');
  tbody.innerHTML     = '';
  cardsWrap.innerHTML = '';

  if (!lista.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  lista.forEach(p => {
    const venceStr = p.vence ? new Date(p.vence).toLocaleDateString('es-AR') : '—';
    // Sólo los préstamos FÍSICOS (origen 'prestamo') se pueden extender:
    // `solicitudes_extension.id_prestamo` es FK a `prestamos`, así que sobre
    // una solicitud online no hay nada que prorrogar.
    // Estados de `prestamos` son minúsculas: activo | vencido | devuelto | ...
    // (vencido también se puede pedir: es justamente cuando más hace falta)
    const esPrestamoFisico = p.origen === 'prestamo';
    const extPendiente     = extensionesCache.get(p.id) === 'Pendiente';
    const puedeExtender = esPrestamoFisico
      && ['activo', 'vencido'].includes(p.estado)
      && !extPendiente;

    // El título NO se pasa por onclick (evita romper el atributo con comillas / XSS):
    // solo viaja el id y el título se resuelve desde prestamosCache.
    let accionBtn;
    if (extPendiente) {
      // Ya hay una solicitud en curso: no se pide dos veces
      accionBtn = `<span class="inline-flex items-center px-3 py-1.5 rounded-lg bg-violet-50 text-violet-600 text-xs font-medium"
        title="La bibliotecaria está revisando tu solicitud de prórroga">⏳ Extensión pedida</span>`;
    } else if (puedeExtender) {
      accionBtn = `<button data-ext-id="${escapeHtml(p.id)}"
           class="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium transition-colors js-btn-extender">
           📅 Extender
         </button>`;
    } else {
      accionBtn = `<span class="text-slate-300 text-xs">—</span>`;
    }

    // ─ Fila tabla (md+)
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition-colors';
    tr.innerHTML = `
      <td class="px-5 py-3 font-medium text-slate-800 max-w-[200px] truncate">${escapeHtml(p.titulo)}</td>
      <td class="px-4 py-3">${estadoBadge(p.estado)}</td>
      <td class="px-4 py-3 text-slate-500 text-xs">${venceStr}</td>
      <td class="px-4 py-3 text-center">${accionBtn}</td>`;
    tbody.appendChild(tr);

    // ─ Card mobile
    const card = document.createElement('div');
    card.className = 'p-4 flex flex-col gap-3';
    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <p class="font-semibold text-slate-800 text-sm leading-snug flex-1">${escapeHtml(p.titulo)}</p>
        ${estadoBadge(p.estado)}
      </div>
      <p class="text-xs text-slate-400">📅 Vence: <span class="font-medium text-slate-600">${venceStr}</span></p>
      ${extPendiente ? `<p class="w-full py-2.5 rounded-xl text-sm font-semibold bg-violet-50 text-violet-600 border border-violet-200 text-center m-0"
          title="La bibliotecaria está revisando tu solicitud de prórroga">⏳ Extensión pedida</p>`
        : puedeExtender ? `<button data-ext-id="${escapeHtml(p.id)}"
        class="w-full py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 transition-colors js-btn-extender">
        📅 Solicitar extensión
      </button>` : ''}`;
    cardsWrap.appendChild(card);
  });

  // Delegación de eventos: un solo listener para todos los botones de extensión
  document.querySelectorAll('.js-btn-extender').forEach(btn => {
    btn.addEventListener('click', () => abrirModalExtension(btn.dataset.extId));
  });
}

/* ── Material de estudio ────────────────────── */
let favoritosCache   = new Set();
let filtroAnioActivo = '';
let soloFavoritos    = false;

async function cargarMaterialEstudio() {
  // Algunos navegadores confunden este campo de búsqueda con un campo de email
  // y autocompletan la cuenta del administrador, filtrando todos los recursos.
  const inputBusqueda = document.getElementById('mat-buscar');
  if (inputBusqueda && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inputBusqueda.value.trim())) {
    inputBusqueda.value = '';
  }

  const [{ data: material, error: errMat }, { data: favs, error: errFav }] = await Promise.all([
    sb.from('material_estudio')
      .select('id, titulo, descripcion, materia, anio_escolar, ciclo, tecnicatura, tipo_recurso, url_recurso')
      .order('anio_escolar', { ascending: true }),
    sb.from('materiales_favoritos')
      .select('id_material')
      .eq('id_usuario', usuarioActual.id),
  ]);

  if (errMat) {
    console.error('[MATERIAL] Error al cargar:', errMat.message);
    const grid = document.getElementById('grid-material-alumno');
    const empty = document.getElementById('empty-material');
    if (grid) grid.innerHTML = '';
    if (empty) { empty.textContent = 'No se pudo cargar el material. Consultá con el administrador.'; empty.classList.remove('hidden'); }
    return;
  }
  if (errFav) console.error('[FAVORITOS] No se pudieron cargar:', errFav.message);

  materialCache = (material || []).filter(m => {
    if (Number(m.anio_escolar) !== anioAlumno) return false;
    if (anioAlumno <= 3) return m.ciclo === 'basico';
    if (m.ciclo !== 'tecnico') return false;
    if (!m.tecnicatura) return true;  // material genérico del ciclo técnico
    const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return norm(m.tecnicatura) === norm(tecnicaturaAlumno);
  });

  console.log('[MATERIAL] Total cargado:', material?.length, '| Filtrado:', materialCache.length,
    '| Año:', anioAlumno, '| Tecnicatura:', tecnicaturaAlumno);

  favoritosCache = new Set((favs || []).map(f => f.id_material));
  renderMaterialAlumno();
}

/* ── Oculta los botones de años futuros según el año del alumno ── */
function _inicializarBotonesAnio() {
  for (let n = 1; n <= 7; n++) {
    const btn = document.getElementById(`mat-anio-btn-${n}`);
    if (!btn) continue;
    if (n > anioAlumno) {
      btn.classList.add('hidden');   // ocultar años que aún no cursa
    } else {
      btn.classList.remove('hidden');
    }
  }
}

function setFiltroAnio(anio) {
  filtroAnioActivo = anio;
  const activo   = 'px-3 py-1 rounded-lg text-xs font-semibold transition-all bg-green-600 text-white';
  const inactivo = 'px-3 py-1 rounded-lg text-xs font-semibold transition-all bg-slate-100 text-slate-600 hover:bg-green-50 hover:text-green-700';
  ['todos','1','2','3','4','5','6','7'].forEach(v => {
    const btn = document.getElementById(`mat-anio-btn-${v}`);
    if (!btn) return;
    btn.className = (anio === '' ? v === 'todos' : v === anio) ? activo : inactivo;
  });
  renderMaterialAlumno();
}

function toggleSoloFavoritos() {
  soloFavoritos = !soloFavoritos;
  const btn   = document.getElementById('btn-solo-favoritos');
  const label = document.getElementById('fav-btn-label');
  const icon  = document.getElementById('fav-star-icon');
  if (soloFavoritos) {
    btn.className     = 'flex items-center gap-2 self-start px-4 py-2 rounded-xl text-sm font-semibold border border-amber-400 bg-amber-400 text-white transition-all duration-200';
    label.textContent = 'Mostrando solo favoritos';
    icon.textContent  = '★';
  } else {
    btn.className     = 'flex items-center gap-2 self-start px-4 py-2 rounded-xl text-sm font-semibold border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-all duration-200';
    label.textContent = 'Mostrar solo mis favoritos';
    icon.textContent  = '⭐';
  }
  renderMaterialAlumno();
}

async function toggleFavorito(idMaterial, btnEl) {
  const esFav = favoritosCache.has(idMaterial);
  if (btnEl) btnEl.disabled = true;
  let error = null;
  if (esFav) {
    ({ error } = await sb.from('materiales_favoritos')
      .delete()
      .eq('id_usuario', usuarioActual.id)
      .eq('id_material', idMaterial));
  } else {
    ({ error } = await sb.from('materiales_favoritos')
      .insert([{ id_usuario: usuarioActual.id, id_material: idMaterial }]));
  }
  if (btnEl) btnEl.disabled = false;
  if (error) {
    console.error('[FAVORITOS] No se pudo actualizar:', error.message);
    _mostrarToastAlumno('No se pudo actualizar el favorito. Intentá nuevamente.');
    return;
  }
  if (esFav) {
    favoritosCache.delete(idMaterial);
    btnEl.textContent = '☆';
    btnEl.title       = 'Agregar a favoritos';
    btnEl.classList.replace('text-amber-400', 'text-slate-300');
  } else {
    favoritosCache.add(idMaterial);
    btnEl.textContent = '★';
    btnEl.title       = 'Quitar de favoritos';
    btnEl.classList.replace('text-slate-300', 'text-amber-400');
  }
  if (soloFavoritos) renderMaterialAlumno();
}

function renderMaterialAlumno() {
  const inputBusqueda = document.getElementById('mat-buscar');
  if (inputBusqueda && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inputBusqueda.value.trim())) {
    inputBusqueda.value = '';
  }
  const q    = (inputBusqueda?.value ?? '').toLowerCase().trim();
  const tipoFiltro = document.getElementById('mat-tipo-filtro')?.value ?? '';

  const normalizar = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const lista = materialCache.filter(m => {
    if (soloFavoritos && !favoritosCache.has(m.id)) return false;
    // Filtro por botón de año: nunca mostrar años superiores al del alumno
    const anio = m.anio_escolar ?? 0;
    if (anio !== anioAlumno) return false;
    if (filtroAnioActivo && String(anio) !== filtroAnioActivo) return false;
    if (tipoFiltro && m.tipo_recurso !== tipoFiltro) return false;
    if (q && !normalizar(`${m.titulo} ${m.materia} ${m.descripcion ?? ''}`).includes(normalizar(q))) return false;
    return true;
  });

  const grid  = document.getElementById('grid-material-alumno');
  const empty = document.getElementById('empty-material');
  grid.innerHTML = '';

  if (!lista.length) {
    empty.textContent = materialCache.length
      ? 'No hay material que coincida con esos filtros.'
      : 'No hay material habilitado para el año, ciclo o tecnicatura de tu curso. Si esperabas ver recursos, pedí que revisen la asignación del material y tu curso.';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  lista.forEach(m => {
    const icon  = '📁';
    const esFav = favoritosCache.has(m.id);
    const meta  = m.anio_escolar ? `${m.anio_escolar}° Año` : '';

    const div = document.createElement('div');
    div.className = `bg-white border ${esFav ? 'border-amber-300' : 'border-slate-200'} rounded-2xl p-4 flex flex-col gap-3 hover:shadow-md transition-all duration-200`;

    const btnFav = document.createElement('button');
    btnFav.className   = `text-xl leading-none transition-colors ${esFav ? 'text-amber-400' : 'text-slate-300 hover:text-amber-300'}`;
    btnFav.textContent = esFav ? '★' : '☆';
    btnFav.title       = esFav ? 'Quitar de favoritos' : 'Agregar a favoritos';
    btnFav.addEventListener('click', () => toggleFavorito(m.id, btnFav));

    div.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center text-xl flex-shrink-0">${icon}</div>
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-slate-800 text-sm leading-snug">${escapeHtml(m.titulo)}</p>
          <p class="text-xs text-slate-400 mt-0.5">${escapeHtml(m.materia)}${meta ? ' · ' + escapeHtml(meta) : ''}</p>
        </div>
        <span class="fav-slot"></span>
      </div>
      ${m.descripcion ? `<p class="text-xs text-slate-500 leading-relaxed">${escapeHtml(m.descripcion)}</p>` : ''}
      <a href="${escapeHtml(urlSegura(m.url_recurso))}" target="_blank" rel="noopener"
        class="mt-auto text-center text-xs font-semibold py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white transition-colors">
        ${icon} Abrir recurso
      </a>`;
    div.querySelector('.fav-slot').replaceWith(btnFav);
    grid.appendChild(div);
  });
}

/* ── Tabs alumno ─────────────────────────────── */
function showTab(tab) {
  const LABELS = { prestamos: '📋 Préstamos', catalogo: '🔍 Catálogo', material: '📚 Material', cuenta: '🔒 Cuenta' };
  ['prestamos', 'catalogo', 'material', 'cuenta'].forEach(t => {
    document.getElementById('panel-' + t).classList.toggle('hidden', t !== tab);
    const btn = document.getElementById('tab-' + t);
    if (btn) btn.classList.toggle('active-tab', t === tab);
    if (btn) btn.classList.toggle('tab-btn', true);
  });
  // Limpiar mensajes de error/éxito del formulario de contraseña al salir de esa vista
  const pwdMsg = document.getElementById('pwd-msg');
  if (pwdMsg) { pwdMsg.classList.add('hidden'); pwdMsg.textContent = ''; pwdMsg.removeAttribute('style'); }
  const pwdNueva = document.getElementById('pwd-nueva');
  const pwdConf  = document.getElementById('pwd-confirmar');
  if (pwdNueva) pwdNueva.value = '';
  if (pwdConf)  pwdConf.value  = '';
  // Sincronizar label del dropdown mobile
  const label = document.getElementById('mobile-nav-label');
  if (label) label.textContent = LABELS[tab] ?? tab;
  if (tab === 'catalogo' && !catalogoCache.length) cargarCatalogo();
}

function toggleMobileNav() {
  document.getElementById('mobile-nav-menu').classList.toggle('hidden');
}
function closeMobileNav() {
  document.getElementById('mobile-nav-menu').classList.add('hidden');
}
// Cerrar al hacer clic fuera
document.addEventListener('click', e => {
  const wrap = document.getElementById('mobile-nav-wrap');
  if (wrap && !wrap.contains(e.target)) closeMobileNav();
});

/* ── Catálogo de libros ─────────────────────── */
let catalogoCache = [];
let libroSolicitandoId = null;

async function cargarCatalogo() {
  document.getElementById('cat-skeleton').classList.remove('hidden');
  document.getElementById('grid-catalogo').innerHTML = '';

  // 1. Libros con joins a autores y categorias
  const { data: libros, error: errLibros } = await sb
    .from('libros')
    .select('id, titulo, url_drive, categorias(nombre), autores(nombre), stock(id)')
    .order('titulo');

  if (errLibros) {
    console.error('[CATALOGO] Error cargando libros:', errLibros.message);
    document.getElementById('cat-skeleton').classList.add('hidden');
    document.getElementById('empty-catalogo').classList.remove('hidden');
    return;
  }

  // 2. Préstamos activos vía vista pública (no expone quién tiene cada libro)
  const { data: prestados, error: errPrest } = await sb
    .from('prestamos_publicos')
    .select('id_libro');

  if (errPrest) console.error('[CATALOGO] Error cargando préstamos:', errPrest.message);

  const prestadosPorLibro = (prestados || []).reduce((acc, p) => {
    if (p.id_libro) acc[p.id_libro] = (acc[p.id_libro] || 0) + 1;
    return acc;
  }, {});

  catalogoCache = (libros || []).map(l => ({
    id:         l.id,
    titulo:     l.titulo,
    autor:      l.autores?.nombre ?? '—',
    categoria:  l.categorias?.nombre ?? '',
    urlDrive:   l.url_drive ?? '',
    disponible: Math.max(0, (l.stock?.length || 0) - (prestadosPorLibro[l.id] || 0)),
  }));

  document.getElementById('cat-skeleton').classList.add('hidden');
  renderCatalogo();
}

function renderCatalogo() {
  const q    = (document.getElementById('cat-buscar')?.value ?? '').toLowerCase().trim();
  const solo = document.getElementById('cat-filtro-disponible')?.value ?? 'disponible';

  const lista = catalogoCache.filter(l => {
    if (solo === 'disponible' && l.disponible <= 0) return false;
    return `${l.titulo} ${l.autor} ${l.categoria}`.toLowerCase().includes(q);
  });

  const grid  = document.getElementById('grid-catalogo');
  const empty = document.getElementById('empty-catalogo');
  const cont  = document.getElementById('cat-contador');
  grid.innerHTML = '';
  cont.textContent = `${lista.length} libro${lista.length !== 1 ? 's' : ''} encontrado${lista.length !== 1 ? 's' : ''}`;

  if (!lista.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  const CAT_GRADIENT = {
    'Informática': 'from-blue-500 to-cyan-600',
    'Literatura':  'from-purple-500 to-pink-600',
    'Historia':    'from-amber-500 to-orange-600',
    'Ciencias':    'from-green-500 to-teal-600',
    'Matemática':  'from-indigo-500 to-blue-700',
    'Tecnología':  'from-sky-500 to-indigo-600',
    'Arte':        'from-rose-400 to-pink-600',
    'Geografía':   'from-emerald-500 to-green-700',
  };
  const CAT_BORDER = {
    'Informática': 'border-blue-200 hover:border-blue-400',
    'Literatura':  'border-purple-200 hover:border-purple-400',
    'Historia':    'border-amber-200 hover:border-amber-400',
    'Ciencias':    'border-green-200 hover:border-green-400',
    'Matemática':  'border-indigo-200 hover:border-indigo-400',
    'Tecnología':  'border-sky-200 hover:border-sky-400',
    'Arte':        'border-rose-200 hover:border-rose-400',
    'Geografía':   'border-emerald-200 hover:border-emerald-400',
  };

  lista.forEach(l => {
    const hayStock = l.disponible > 0;
    const hayDrive = !!l.urlDrive;
    const gradient = CAT_GRADIENT[l.categoria] ?? 'from-slate-500 to-slate-700';
    const border   = CAT_BORDER[l.categoria]   ?? 'border-slate-200 hover:border-slate-400';
    const iniciales = l.titulo.split(' ').filter(w => w.length > 2).slice(0, 2).map(w => w[0].toUpperCase()).join('') || l.titulo[0].toUpperCase();

    const catBadge = l.categoria
      ? `<span class="text-xs px-2.5 py-0.5 rounded-full font-medium bg-white/80 text-slate-600 border border-slate-200">${escapeHtml(l.categoria)}</span>`
      : '';
    const stockBadge = hayStock
      ? `<span class="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-2.5 py-0.5 rounded-full">✅ ${l.disponible} disp.</span>`
      : `<span class="text-xs font-semibold text-red-500 bg-red-50 border border-red-200 px-2.5 py-0.5 rounded-full">❌ Sin stock</span>`;
    const driveBadge = hayDrive
      ? `<span class="text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">📄 PDF</span>`
      : '';

    const div = document.createElement('div');
    div.className = `bg-white border ${border} rounded-2xl overflow-hidden flex flex-col shadow-sm hover:shadow-lg transition-all duration-200`;
    div.innerHTML = `
      <div class="bg-gradient-to-br ${gradient} h-28 flex items-center justify-center relative flex-shrink-0">
        <span class="text-white font-bold text-4xl opacity-90 select-none tracking-tight drop-shadow">${iniciales}</span>
        <div class="absolute inset-0 bg-black/10"></div>
      </div>
      <div class="p-4 flex flex-col gap-3 flex-1">
        <div>
          <p class="font-bold text-slate-800 text-base leading-snug line-clamp-2">${escapeHtml(l.titulo)}</p>
          <p class="text-xs text-slate-400 mt-1 truncate">${escapeHtml(l.autor)}</p>
        </div>
        <div class="flex items-center gap-1.5 flex-wrap">
          ${catBadge}${stockBadge}${driveBadge}
        </div>
        <div class="flex flex-col gap-2 mt-auto pt-1">
          ${hayDrive ? `<a href="${escapeHtml(urlSegura(l.urlDrive))}" target="_blank" rel="noopener"
            class="w-full text-center py-2 rounded-xl text-xs font-semibold bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 transition-colors">
            📄 Ver PDF
          </a>` : ''}
          <button
            data-libro-id="${escapeHtml(l.id)}"
            ${hayStock ? '' : 'disabled'}
            class="w-full py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 active:scale-95 js-btn-solicitar
                   ${hayStock ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}">
            ${hayStock ? '📚 Solicitar préstamo' : 'Sin disponibilidad'}
          </button>
        </div>
      </div>`;
    grid.appendChild(div);
  });

  // Delegación de eventos: el título se resuelve desde catalogoCache (sin pasar por onclick)
  grid.querySelectorAll('.js-btn-solicitar').forEach(btn => {
    btn.addEventListener('click', () => abrirModalSolicitar(btn.dataset.libroId));
  });
}

function abrirModalSolicitar(idLibro) {
  const libro = catalogoCache.find(l => String(l.id) === String(idLibro));
  if (!libro) return;
  libroSolicitandoId = libro.id;
  document.getElementById('modal-sol-titulo').textContent = libro.titulo;
  document.getElementById('modal-sol-msg').classList.add('hidden');
  const btn = document.getElementById('modal-sol-btn-confirmar');
  btn.disabled = false;
  btn.textContent = 'Confirmar solicitud';
  document.getElementById('modal-solicitar').classList.remove('hidden');
}

function cerrarModalSolicitar() {
  document.getElementById('modal-solicitar').classList.add('hidden');
  libroSolicitandoId = null;
}

async function confirmarSolicitudLibro() {
  if (!libroSolicitandoId || !usuarioActual) return;

  const diasInput = parseInt(document.getElementById('modal-sol-dias').value) || 7;
  const dias = Math.min(Math.max(diasInput, 1), 30);

  const btn = document.getElementById('modal-sol-btn-confirmar');
  btn.disabled = true;
  btn.textContent = 'Enviando…';

  const { error } = await sb.rpc('solicitar_libro', {
    p_id_libro: Number(libroSolicitandoId),
    p_dias: dias,
    p_cantidad: 1,
    p_observaciones: null,
  });

  const msgEl = document.getElementById('modal-sol-msg');
  if (error) {
    msgEl.className = 'text-sm rounded-xl px-4 py-2.5 mb-3 bg-red-50 border border-red-200 text-red-600';
    msgEl.textContent = 'Error al enviar la solicitud. Intentá nuevamente.';
    msgEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Confirmar solicitud';
    return;
  }

  msgEl.className = 'text-sm rounded-xl px-4 py-2.5 mb-3 bg-green-50 border border-green-200 text-green-700';
  msgEl.textContent = `✅ Solicitud enviada. La bibliotecaria verificará el libro y te avisará cuando esté listo.`;
  msgEl.classList.remove('hidden');
  btn.textContent = 'Solicitud enviada ✓';
  // Refrescar la UI en caliente sin F5
  await cargarPrestamosAlumno();
  setTimeout(cerrarModalSolicitar, 1800);
}

/* ── Extensión de préstamo ───────────────────── */
// Carga las extensiones de UN usuario para sus préstamos y las deja en
// `extensionesCache` (Map: id_prestamo → estado). La usan el panel del alumno
// y el del docente.
// RLS: cada usuario sólo ve las extensiones de SUS propios préstamos
// (`auth_sel_extension_propia`). Si la tabla todavía no existe (falta correr
// seguridad-rls.sql) se loguea y seguimos sin bloquear el panel.
async function cargarMisExtensiones(idsPrestamos) {
  extensionesCache = new Map();
  if (!idsPrestamos || !idsPrestamos.length) return;

  const { data: exts, error } = await sb
    .from('solicitudes_extension')
    .select('id_prestamo, estado')
    .in('id_prestamo', idsPrestamos);

  if (error) {
    console.error('[EXTENSIONES] Error cargando solicitudes propias:', error.message);
    return;
  }
  // Si hay varias para el mismo préstamo, manda la 'Pendiente'
  (exts || []).forEach(e => {
    const prev = extensionesCache.get(e.id_prestamo);
    if (!prev || (prev !== 'Pendiente' && e.estado === 'Pendiente')) {
      extensionesCache.set(e.id_prestamo, e.estado);
    }
  });
}

function abrirModalExtension(id) {
  // Se busca sólo entre los préstamos FÍSICOS (los que tienen id en `prestamos`):
  // en el panel del alumno `prestamosCache` también trae solicitudes online, cuyo
  // id puede coincidir con el de un préstamo distinto.
  const prestamo = prestamosCache.find(p => String(p.id) === String(id) && p.origen === 'prestamo');
  if (!prestamo) return;
  document.getElementById('ext-prestamo-id').value = id;
  document.getElementById('ext-libro-titulo').textContent = prestamo.titulo;
  document.getElementById('ext-motivo').value = '';
  document.getElementById('ext-msg').classList.add('hidden');
  document.getElementById('modal-extension').classList.remove('hidden');
}

function cerrarModalExtension(e) {
  if (e?.target === document.getElementById('modal-extension')) {
    document.getElementById('modal-extension').classList.add('hidden');
  }
}

function _mostrarToastAlumno(texto) {
  let t = document.getElementById('_toast-alumno');
  if (!t) {
    t = document.createElement('div');
    t.id = '_toast-alumno';
    t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-2xl text-sm font-semibold text-white bg-green-600 shadow-xl transition-all duration-300';
    document.body.appendChild(t);
  }
  t.textContent = texto;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 3000);
}

async function enviarExtension() {
  const id     = String(document.getElementById('ext-prestamo-id').value).trim();
  const motivo = document.getElementById('ext-motivo').value.trim();

  if (!id || isNaN(parseInt(id, 10))) {
    msgBox('ext-msg', 'error', 'No se pudo identificar el préstamo. Cerrá y volvé a abrir la ventana.');
    return;
  }
  // `solicitudes_extension.motivo` es NOT NULL: no se puede enviar vacío
  if (!motivo) {
    msgBox('ext-msg', 'error', 'Contanos el motivo de la extensión.');
    return;
  }

  const btn = document.getElementById('ext-btn-enviar');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }

  const { error } = await sb.rpc('solicitar_extension', {
    p_id_prestamo: parseInt(id, 10),
    p_motivo: motivo,
  });

  if (btn) { btn.disabled = false; btn.textContent = 'Enviar solicitud'; }

  if (error) {
    msgBox('ext-msg', 'error', 'Error al enviar: ' + error.message);
    return;
  }

  document.getElementById('modal-extension').classList.add('hidden');
  _mostrarToastAlumno('Solicitud enviada a la bibliotecaria');
  // Refrescar para que el botón pase a "⏳ Extensión pedida"
  await refrescarPrestamosPropios();
}

// Recarga la lista de préstamos del panel que esté abierto (alumno o docente),
// para que el botón de extensión pase a "⏳ Extensión pedida" sin recargar la página.
async function refrescarPrestamosPropios() {
  if (document.getElementById('tbody-prestamos-alumno')) {
    await cargarPrestamosAlumno();
  } else if (document.getElementById('tbody-prestamos-docente')) {
    await cargarPrestamosDocente();
  }
}

/* ── Cambiar contraseña alumno ──────────────── */
function cambiarPassword() {
  cambiarPasswordGenerico('pwd-nueva', 'pwd-confirmar', 'pwd-msg');
}

/* ════════════════════════════════════════════
   PANEL DOCENTE
   ════════════════════════════════════════════ */
async function initPanelDocente() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'portal-login.html'; return; }

  const { data: user, error: errUser } = await sb
    .from('usuarios')
    .select('id, nombre, apellido, dni, email, rol, activo')
    .ilike('email', session.user.email)
    .maybeSingle();

  if (errUser) console.error('[PANEL DOCENTE] No se pudo cargar el perfil:', errUser);
  if (!user || user.rol !== 'docente' || user.activo !== true) { window.location.href = 'portal-login.html'; return; }
  usuarioActual = user;

  const nombre = `${user.nombre} ${user.apellido}`;
  document.getElementById('docente-nombre').textContent = nombre;
  document.getElementById('dinfo-nombre').textContent = nombre;
  document.getElementById('dinfo-dni').textContent = user.dni;
  document.getElementById('dinfo-email').textContent = user.email ?? '—';

  limpiarAutocompletadoReservaDocente();

  await Promise.all([cargarPrestamosDocente(), cargarLibrosParaSolicitud()]);
}

async function cargarPrestamosDocente() {
  // Join stock→libros puede no estar expuesto en PostgREST; se resuelve en dos pasos
  // Los lotes conservan su id y el contexto de clase en cada ejemplar.
  const { data: prest, error: errPrest } = await sb
    .from('prestamos')
    .select('id, estado, fecha_prestamo, fecha_devolucion, id_stock, id_lote, cantidad_lote, observaciones')
    .eq('id_usuario', usuarioActual.id)
    .order('fecha_prestamo', { ascending: false });

  if (errPrest) console.error('[DOCENTE] Error cargando préstamos:', errPrest.message);

  const { data: sols, error: errSols } = await sb
    .from('solicitudes_prestamo')
    .select('id, id_lote, estado, fecha_solicitud, fecha_limite_retiro, id_libro, observaciones, cantidad_lote, indice_lote, libros(titulo)')
    .eq('dni', usuarioActual.dni)
    .order('fecha_solicitud', { ascending: false });

  if (errSols) console.error('[DOCENTE] Error cargando solicitudes:', errSols.message);

  // Resolver títulos de préstamos físicos via stock_id → stock → libros
  const stockIds = (prest || []).map(p => p.id_stock).filter(Boolean);
  let titulosPorStock = {};
  if (stockIds.length) {
    const { data: stocks } = await sb
      .from('stock')
      .select('id, libros(titulo)')
      .in('id', stockIds);
    (stocks || []).forEach(s => { titulosPorStock[s.id] = s.libros?.titulo ?? '—'; });
  }

  const todos = [
    ...(prest || []).map(p => ({
      id: p.id,
      idLote: p.id_lote,
      cantidad: Number(p.cantidad_lote) || 1,
      origen: 'prestamo',
      titulo: titulosPorStock[p.id_stock] ?? '—',
      tipo: p.id_lote || String(p.observaciones ?? '').startsWith('Lote para clase:') ? 'Lote para clase' : 'Préstamo',
      estado: p.estado,
      fecha: p.fecha_prestamo,
      vence: p.fecha_devolucion,
      obs: p.observaciones,
      cursoClase: extraerMateriaSolicitudLote(p.observaciones),
    })),
    ...(sols || []).filter(s => s.estado !== 'Retirado').map(s => ({
      id: s.id,
      idLote: s.id_lote,
      origen: 'solicitud',
      cantidad: Number(s.cantidad_lote) || 1,
      titulo: s.libros?.titulo ?? '—',
      tipo: s.id_lote || String(s.observaciones ?? '').startsWith('Lote para clase:') ? 'Solicitud por lote' : 'Solicitud online',
      estado: s.estado,
      fecha: s.fecha_solicitud,
      vence: s.fecha_limite_retiro,
      obs: s.observaciones,
      cursoClase: extraerMateriaSolicitudLote(s.observaciones),
    })),
  ];

  const registrosAgrupados = agruparRegistrosDocente(todos);

  // Para que el modal de extensión (compartido con el panel del alumno) pueda
  // resolver el préstamo por id, y para saber cuáles ya tienen pedido en curso.
  prestamosCache = registrosAgrupados;
  await cargarMisExtensiones((prest || []).map(p => p.id));

  document.getElementById('dkpi-activos').textContent    = registrosAgrupados.filter(p => p.estado === 'activo' || p.estado === 'Retirado').length;
  document.getElementById('dkpi-pendientes').textContent  = registrosAgrupados.filter(p => ['Pendiente de Aprobación', 'Pendiente de Retiro', 'pendiente'].includes(p.estado)).length;
  document.getElementById('dkpi-total').textContent     = registrosAgrupados.length;

  const tbody = document.getElementById('tbody-prestamos-docente');
  const empty = document.getElementById('empty-prestamos-docente');
  tbody.innerHTML = '';

  if (!registrosAgrupados.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  registrosAgrupados.forEach(p => {
    // Misma lógica que el panel del alumno: sólo los préstamos físicos con
    // plazo en curso o vencido se pueden prorrogar, y no si ya hay un pedido.
    const esPrestamoFisico = p.origen === 'prestamo';
    const extPendiente     = extensionesCache.get(p.id) === 'Pendiente';
    const puedeExtender = esPrestamoFisico && !p.idLote
      && ['activo', 'vencido'].includes(p.estado)
      && !extPendiente;

    let accionBtn;
    if (extPendiente && !p.idLote) {
      accionBtn = `<span class="inline-flex items-center px-3 py-1.5 rounded-lg bg-violet-50 text-violet-600 text-xs font-medium"
        title="La bibliotecaria está revisando tu solicitud de prórroga">⏳ Extensión pedida</span>`;
    } else if (puedeExtender) {
      accionBtn = `<button data-ext-id="${escapeHtml(p.id)}"
        class="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium transition-colors js-btn-extender">
        📅 Extender
      </button>`;
    } else {
      accionBtn = `<span class="text-slate-300 text-xs">—</span>`;
    }

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition-colors';
    tr.innerHTML = `
      <td class="px-5 py-3 font-medium text-slate-800 max-w-[180px] truncate">${escapeHtml(p.titulo)}${p.idLote || p.cursoClase ? ` · ${p.cantidad} ejemplar${p.cantidad === 1 ? '' : 'es'}` : ''}</td>
      <td class="px-4 py-3 text-xs text-slate-500">${escapeHtml(p.tipo)}</td>
      <td class="px-4 py-3">${estadoBadge(p.estado)}</td>
      <td class="px-4 py-3 text-slate-500 text-xs hidden sm:table-cell">${p.fecha ? new Date(p.fecha).toLocaleDateString('es-AR') : '—'}</td>
      <td class="px-4 py-3 text-slate-400 text-xs hidden md:table-cell max-w-[160px] truncate">${p.cursoClase ? `Clase: ${escapeHtml(p.cursoClase)}` : (escapeHtml(p.obs) || '—')}</td>
      <td class="px-4 py-3 text-center">${accionBtn}</td>`;
    tbody.appendChild(tr);
  });

  // Delegación de eventos (mismo patrón que el panel del alumno)
  document.querySelectorAll('#tbody-prestamos-docente .js-btn-extender').forEach(btn => {
    btn.addEventListener('click', () => abrirModalExtension(btn.dataset.extId));
  });
}

/* ── Solicitud de libros (docente) ───────────── */
async function cargarLibrosParaSolicitud() {
  // Traer libros con su stock total y préstamos activos para calcular disponibilidad
  const [{ data: libros }, { data: prestados }] = await Promise.all([
    sb.from('libros').select('id, titulo, stock(id)').order('titulo'),
    sb.from('prestamos_publicos').select('id_libro'),
  ]);

  const prestadosPorLibro = (prestados || []).reduce((acc, p) => {
    if (p.id_libro) acc[p.id_libro] = (acc[p.id_libro] || 0) + 1;
    return acc;
  }, {});

  // Solo libros con al menos 1 ejemplar físico disponible
  librosCache = (libros || [])
    .map(l => ({
      id:         l.id,
      titulo:     l.titulo,
      disponible: Math.max(0, (l.stock?.length || 0) - (prestadosPorLibro[l.id] || 0)),
    }))
    .filter(l => l.disponible > 0);
}

function setTipoSolicitud(tipo) {
  tipoSolicitudDocente = tipo;
  const esCl = tipo === 'clase';
  document.getElementById('btn-tipo-personal').className =
    'flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ' +
    (!esCl ? 'bg-white text-indigo-600 shadow border border-slate-200' : 'text-slate-400 hover:text-slate-600');
  document.getElementById('btn-tipo-clase').className =
    'flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ' +
    (esCl ? 'bg-white text-indigo-600 shadow border border-slate-200' : 'text-slate-400 hover:text-slate-600');
  document.getElementById('campo-cantidad').classList.toggle('hidden', !esCl);
  document.getElementById('campo-materia').classList.toggle('hidden', !esCl);
}

function buscarLibroSolicitud(q) {
  limpiarAutocompletadoReservaDocente();
  q = document.getElementById('sol-libro-buscar').value;
  const cont = document.getElementById('sol-libro-resultados');
  // Al cambiar la búsqueda, limpiar selección previa y resetear cantidad
  document.getElementById('sol-libro-id').value = '';
  document.getElementById('sol-libro-seleccionado').classList.add('hidden');
  const inputCantidad = document.getElementById('sol-cantidad');
  inputCantidad.value = 1;
  inputCantidad.removeAttribute('max');
  if (!q.trim()) { cont.classList.add('hidden'); return; }
  const res = librosCache.filter(l => l.titulo.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  cont.innerHTML = '';
  if (!res.length) { cont.classList.add('hidden'); return; }
  res.forEach(l => {
    const div = document.createElement('div');
    div.className = 'px-4 py-2.5 text-sm text-slate-700 hover:bg-indigo-50 cursor-pointer transition-colors';
    div.textContent = `${l.titulo} (${l.disponible} disp.)`;
    div.addEventListener('click', () => {
      document.getElementById('sol-libro-id').value = l.id;
      document.getElementById('sol-libro-buscar').value = '';
      // Resetear y limitar cantidad al stock disponible del libro seleccionado
      const inputCantidad = document.getElementById('sol-cantidad');
      inputCantidad.max   = l.disponible;
      inputCantidad.value = 1;
      const p = document.getElementById('sol-libro-seleccionado');
      p.textContent = `✓ Seleccionado: ${l.titulo} — ${l.disponible} ejemplar${l.disponible !== 1 ? 'es' : ''} disponible${l.disponible !== 1 ? 's' : ''}`;
      p.classList.remove('hidden');
      cont.classList.add('hidden');
    });
    cont.appendChild(div);
  });
  cont.classList.remove('hidden');
}

function limpiarAutocompletadoReservaDocente() {
  ['sol-libro-buscar', 'sol-materia', 'sol-obs'].forEach(id => {
    const input = document.getElementById(id);
    if (input && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) input.value = '';
  });
}

async function enviarSolicitudDocente() {
  limpiarAutocompletadoReservaDocente();
  const libroId  = document.getElementById('sol-libro-id').value;
  const cantidad = tipoSolicitudDocente === 'clase' ? Number(document.getElementById('sol-cantidad').value) : 1;
  const materia  = tipoSolicitudDocente === 'clase' ? document.getElementById('sol-materia').value.trim() : null;
  const fecha    = document.getElementById('sol-fecha').value || null;
  const obs      = document.getElementById('sol-obs').value.trim();

  if (!libroId) return msgBox('sol-msg', 'error', 'Seleccioná un libro de la lista.');
  if (tipoSolicitudDocente === 'clase' && !materia) return msgBox('sol-msg', 'error', 'Ingresá la materia/curso para la solicitud de lote.');

  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 40) {
    return msgBox('sol-msg', 'error', 'La cantidad debe ser un número entero entre 1 y 40.');
  }
  const observaciones = [
    tipoSolicitudDocente === 'clase' ? `Lote para clase: ${materia} — ${cantidad} ejemplares` : 'Uso personal docente',
    fecha ? `Fecha estimada: ${new Date(`${fecha}T00:00:00`).toLocaleDateString('es-AR')}` : '',
    obs,
  ].filter(Boolean).join(' | ');

  const { error } = await sb.rpc('solicitar_libro', {
    p_id_libro: Number(libroId),
    // Los lotes para clase se devuelven el mismo día; los préstamos personales
    // conservan el plazo habitual de dos semanas.
    p_dias: tipoSolicitudDocente === 'clase' ? 1 : 14,
    p_cantidad: cantidad,
    p_observaciones: observaciones,
  });
  if (error) return msgBox('sol-msg', 'error', 'Error al enviar: ' + error.message);

  msgBox('sol-msg', 'success', '✓ Solicitud enviada. La bibliotecaria verificará el libro y te avisará cuando esté listo.');
  ['sol-libro-id', 'sol-cantidad', 'sol-materia', 'sol-fecha', 'sol-obs'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = id === 'sol-cantidad' ? '1' : '';
  });
  document.getElementById('sol-libro-seleccionado').classList.add('hidden');
  // Refrescar la UI en caliente sin F5
  await cargarPrestamosDocente();
}

/* ── Tabs docente ───────────────────────────── */
function showTabDocente(tab) {
  if (tab === 'solicitar') limpiarAutocompletadoReservaDocente();
  ['prestamos', 'solicitar', 'cuenta'].forEach(t => {
    document.getElementById('dpanel-' + t).classList.toggle('hidden', t !== tab);
    const btn = document.getElementById('dtab-' + t);
    if (btn) btn.classList.toggle('active-tab', t === tab);
  });
  // Limpiar mensajes de error/éxito del formulario de contraseña al salir de esa vista
  const pwdMsg = document.getElementById('dpwd-msg');
  if (pwdMsg) { pwdMsg.classList.add('hidden'); pwdMsg.textContent = ''; }
  const pwdNueva = document.getElementById('dpwd-nueva');
  const pwdConf  = document.getElementById('dpwd-confirmar');
  if (pwdNueva) pwdNueva.value = '';
  if (pwdConf)  pwdConf.value  = '';
}

function extraerMateriaSolicitudLote(observaciones) {
  const match = String(observaciones ?? '').match(/Lote para clase:\s*(.*?)\s+—\s+\d+\s+ejemplares/i);
  return match?.[1]?.trim() ?? '';
}

function agruparRegistrosDocente(registros) {
  const grupos = new Map();
  registros.forEach(registro => {
    const clave = registro.idLote
      ? `${registro.origen}:${registro.idLote}:${registro.estado}`
      : `${registro.origen}:${registro.id}`;
    const actual = grupos.get(clave);
    if (actual) actual.cantidadFilas++;
    else grupos.set(clave, { ...registro, cantidadFilas: 1 });
  });
  return [...grupos.values()].map(grupo => ({
    ...grupo,
    cantidad: grupo.idLote ? Math.max(Number(grupo.cantidad) || 0, grupo.cantidadFilas) : 1,
    cantidadVisible: grupo.cantidadFilas,
  }));
}

/* ── Cambiar contraseña docente ─────────────── */
function cambiarPasswordDocente() {
  cambiarPasswordGenerico('dpwd-nueva', 'dpwd-confirmar', 'dpwd-msg');
}
