/* ── SUPABASE ───────────────────────────────────── */
// La instancia única viene de config.js + db.js (cargados antes).
const sb = window.supabaseClient;

/* ── HELPERS DE SEGURIDAD ───────────────────────── */
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

// DNI: 7 u 8 dígitos (regla única para todos los formularios)
function dniValido(dni) {
  return /^\d{7,8}$/.test(String(dni).trim());
}

/* ── ESTADO ─────────────────────────────────────── */
let librosPublicos = [];
let categoriasPublicas = [];

const CAT_EMOJIS = { Ciencias:'🔭', Literatura:'📖', Informática:'💻', Historia:'🏛', Matemáticas:'📐' };
const FALLBACK_COLORS = ['#2563eb','#22c55e','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
const FALLBACK_IMG = 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=600&q=80';

/* ── INIT ───────────────────────────────────────── */
async function initPublic() {
  await Promise.all([cargarLibrosPublicos(), cargarCategoriasPublicas()]);
  renderBooks();
  buildCarousel();
  await cargarEstadisticas();
}

/* ── CARGA DE DATOS ─────────────────────────────── */
async function cargarLibrosPublicos() {
  const { data: librosData, error: errLibros } = await sb
    .from('libros')
    .select('id,titulo,url_drive,palabras_clave,autores(nombre),categorias(nombre)')
    .order('titulo', { ascending: true });

  if (errLibros) { console.error('Error cargando libros:', errLibros.message); return; }

  const { data: stockData } = await sb.from('stock').select('id_libro');
  const stockCount = (stockData || []).reduce((acc, s) => {
    acc[s.id_libro] = (acc[s.id_libro] || 0) + 1; return acc;
  }, {});

  // Préstamos no devueltos vía vista pública (no expone quién tiene el libro)
  const { data: prestadosData } = await sb
    .from('prestamos_publicos')
    .select('id_libro');
  const prestadosCount = (prestadosData || []).reduce((acc, p) => {
    if (p.id_libro) acc[p.id_libro] = (acc[p.id_libro] || 0) + 1;
    return acc;
  }, {});

  librosPublicos = (librosData || []).map(b => {
    const total = stockCount[b.id] || 0;
    const prestados = prestadosCount[b.id] || 0;
    const stock = Math.max(0, total - prestados);
    const pdfUrl = b.url_drive || null;
    // Ocultar libros sin acceso: sin digital Y sin stock físico
    if (!pdfUrl && stock === 0) return null;
    return {
      id: b.id,
      titulo: b.titulo,
      autor: b.autores?.nombre || '—',
      categoria: b.categorias?.nombre || '—',
      descripcion: b.descripcion || '',
      palabrasClave: b.palabras_clave || '',
      stock,
      pdfUrl,
    };
  }).filter(Boolean);
}

async function cargarCategoriasPublicas() {
  const { data, error } = await sb.from('categorias').select('id,nombre,descripcion,color,imagen_url');
  if (error) { console.error('Error cargando categorías:', error.message); return; }

  const { data: librosData } = await sb.from('libros').select('id_categoria');
  const counts = (librosData || []).reduce((acc, l) => {
    acc[l.id_categoria] = (acc[l.id_categoria] || 0) + 1; return acc;
  }, {});

  categoriasPublicas = (data || []).map((c, idx) => ({
    id: c.id,
    name: c.nombre,
    books: counts[c.id] || 0,
    desc: c.descripcion || '',
    hex: c.color || FALLBACK_COLORS[idx % FALLBACK_COLORS.length],
    img: c.imagen_url || FALLBACK_IMG,
  })).filter(c => c.books > 0);
}

async function cargarEstadisticas() {
  // Estadísticas vía RPC SECURITY DEFINER (el anónimo no necesita
  // acceso directo a las tablas, en especial a `usuarios`).
  const { data, error } = await sb.rpc('public_stats');
  if (error || !data || !data.length) {
    console.error('Error cargando estadísticas:', error?.message);
    return;
  }
  const s = Array.isArray(data) ? data[0] : data;
  const pct = s.prestamos_total ? Math.round((s.devueltos / s.prestamos_total) * 100) : 0;

  animarNumero('stat-libros', s.ejemplares || 0);
  animarNumero('stat-usuarios', s.libros || 0);
  setStatText('stat-devolucion', `${pct}%`);
  animarNumero('stat-categorias', s.categorias || 0);
}

function animarNumero(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const duration = 1200;
  const start = performance.now();
  const update = now => {
    const progress = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(ease * target).toLocaleString('es-AR');
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

function setStatText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/* ── NAVBAR scroll ──────────────────────────────── */
window.addEventListener('scroll', () => {
  document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 20);
});

/* ── HAMBURGER ──────────────────────────────────── */
function toggleMenu() {
  const menu = document.getElementById('mobile-menu');
  const btn = document.getElementById('hamburger-btn');
  const open = menu.classList.toggle('open');
  btn.setAttribute('aria-expanded', open);
  btn.textContent = open ? '✕' : '☰';
}
document.addEventListener('click', e => {
  const menu = document.getElementById('mobile-menu');
  if (!menu.contains(e.target) && !document.getElementById('hamburger-btn').contains(e.target)) {
    menu.classList.remove('open');
    document.getElementById('hamburger-btn').setAttribute('aria-expanded', false);
    document.getElementById('hamburger-btn').textContent = '☰';
  }
});

/* ── SEARCH ─────────────────────────────────────── */
function doSearch(q) {
  const container = document.getElementById('search-results');
  const term = q.toLowerCase().trim();

  if (!term) { container.style.display = 'none'; container.innerHTML = ''; return; }

  const results = librosPublicos.filter(b => {
    const haystack = `${b.titulo} ${b.autor} ${b.descripcion} ${b.palabrasClave} ${b.categoria}`.toLowerCase();
    return haystack.includes(term);
  });

  container.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'sr-header';

  if (!results.length) {
    header.textContent = 'Sin resultados';
    const msg = document.createElement('div');
    msg.className = 'sr-item';
    msg.style.cssText = 'color:var(--muted);font-size:.875rem;';
    msg.textContent = `No encontramos libros para "${q}". Probá otro término.`;
    container.append(header, msg);
  } else {
    const MAX = 3;
    const preview = results.slice(0, MAX);
    header.textContent = `${results.length} resultado${results.length > 1 ? 's' : ''} para "${q}"`;
    container.appendChild(header);

    preview.forEach(b => {
      const item = document.createElement('div');
      item.className = 'sr-item';
      item.setAttribute('tabindex', '0');
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', `Ver ${b.titulo}`);
      if (b.pdfUrl) {
        const url = urlSegura(b.pdfUrl);
        item.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
        item.addEventListener('keydown', e => { if (e.key === 'Enter') window.open(url, '_blank', 'noopener'); });
        item.style.cursor = 'pointer';
      } else {
        item.style.cursor = 'default';
      }

      const emoji = CAT_EMOJIS[b.categoria] || '📚';
      const cover = document.createElement('div'); cover.className = 'sr-cover'; cover.textContent = emoji;
      const info = document.createElement('div');
      const title = document.createElement('div'); title.className = 'sr-title'; title.textContent = b.titulo;
      const meta = document.createElement('div'); meta.className = 'sr-meta';
      meta.textContent = `${b.autor} · ${b.stock > 0 ? `${b.stock} disponible${b.stock !== 1 ? 's' : ''}` : 'Sin stock'}`;
      info.append(title, meta);
      const badge = document.createElement('span');
      badge.className = 'badge-pill badge-blue sr-badge';
      badge.textContent = b.categoria;

      item.append(cover, info, badge);
      container.appendChild(item);
    });

    if (results.length > MAX) {
      const verMas = document.createElement('div');
      verMas.className = 'sr-item sr-ver-mas';
      verMas.setAttribute('tabindex', '0');
      verMas.setAttribute('role', 'button');
      verMas.textContent = `Ver catálogo completo para "${q}" →`;
      const irCatalogo = () => {
        document.getElementById('catalogo-input').value = q;
        filtrarCatalogo();
        container.style.display = 'none';
        document.getElementById('destacados').scrollIntoView({ behavior: 'smooth' });
      };
      verMas.addEventListener('click', irCatalogo);
      verMas.addEventListener('keydown', e => { if (e.key === 'Enter') irCatalogo(); });
      container.appendChild(verMas);
    }
  }
  container.style.display = 'block';
}

/* ── CATÁLOGO COMPLETO ───────────────────────────── */
// Mantener la portada compacta; el resto del catálogo se recorre con paginación.
const POR_PAGINA = 8;
let paginaActual = 1;
let librosFiltrados = [];

function poblarFiltrosCatalogo() {
  const sel = document.getElementById('catalogo-cat');
  if (!sel) return;
  sel.innerHTML = '<option value="">Todas las categorías</option>';
  categoriasPublicas.forEach(c => {
    const o = document.createElement('option');
    o.value = c.name; o.textContent = c.name;
    sel.appendChild(o);
  });
}

function filtrarCatalogo() {
  const q = (document.getElementById('catalogo-input')?.value || '').toLowerCase().trim();
  const cat = document.getElementById('catalogo-cat')?.value || '';
  const stock = document.getElementById('catalogo-stock')?.value || '';
  const formato = document.getElementById('catalogo-formato')?.value || '';

  librosFiltrados = librosPublicos.filter(b => {
    const matchQ = !q || `${b.titulo} ${b.autor} ${b.descripcion} ${b.palabrasClave} ${b.categoria}`.toLowerCase().includes(q);
    const matchCat = !cat || b.categoria === cat;
    const matchStock = !stock ||
      (stock === 'disponible' && b.stock > 0);
    const matchFormato = !formato ||
      (formato === 'digital' && b.pdfUrl) ||
      (formato === 'fisico' && !b.pdfUrl);
    return matchQ && matchCat && matchStock && matchFormato;
  });

  paginaActual = 1;
  renderCatalogo();
}

function renderCatalogo() {
  const grid = document.getElementById('books-grid');
  const paginacion = document.getElementById('catalogo-paginacion');
  const countEl = document.getElementById('catalogo-count');
  grid.innerHTML = '';
  paginacion.innerHTML = '';

  const total = librosFiltrados.length;
  if (countEl) countEl.textContent = `${total} libro${total !== 1 ? 's' : ''}`;

  if (!total) {
    const msg = document.createElement('p');
    msg.style.cssText = 'color:var(--muted);text-align:center;padding:3rem;grid-column:1/-1;';
    msg.textContent = 'No hay libros que coincidan con la búsqueda.';
    grid.appendChild(msg);
    return;
  }

  const totalPags = Math.ceil(total / POR_PAGINA);
  const inicio = (paginaActual - 1) * POR_PAGINA;
  const pagina = librosFiltrados.slice(inicio, inicio + POR_PAGINA);

  pagina.forEach(b => {
    const catData = categoriasPublicas.find(c => c.name === b.categoria);
    const color = catData?.hex || '#94a3b8';
    const emoji = CAT_EMOJIS[b.categoria] || '📚';

    const card = document.createElement('div');
    card.className = 'book-card' + (!b.pdfUrl ? ' book-card-sin-pdf' : '');

    // ── Portada ──────────────────────────────────
    const cover = document.createElement('div');
    cover.className = 'book-cover';
    cover.style.background = `linear-gradient(135deg,${color}22,${color}44)`;
    const emojiEl = document.createElement('span'); emojiEl.style.fontSize = '3.5rem'; emojiEl.textContent = emoji;
    const pill = document.createElement('span'); pill.className = 'book-cat-pill'; pill.textContent = b.categoria;
    cover.append(emojiEl, pill);

    // ── Cuerpo ───────────────────────────────────
    const body = document.createElement('div');
    body.className = 'book-body';
    body.style.cssText = 'display:flex;flex-direction:column;flex:1;';

    const titleEl = document.createElement('div'); titleEl.className = 'book-title'; titleEl.textContent = b.titulo;
    const authorEl = document.createElement('div'); authorEl.className = 'book-author'; authorEl.textContent = b.autor;

    // ── Badges ───────────────────────────────────
    const badges = document.createElement('div');
    badges.style.cssText = 'display:flex;flex-direction:column;gap:.4rem;margin-top:.75rem;';

    const stockBadge = document.createElement('span');
    const hayStock = b.stock > 0;
    stockBadge.textContent = hayStock
      ? `✔ ${b.stock} ejemplar${b.stock !== 1 ? 'es' : ''} disponible${b.stock !== 1 ? 's' : ''}`
      : '✘ Sin stock físico';
    stockBadge.style.cssText = `
      display:inline-block;font-size:.72rem;font-weight:600;padding:.25rem .6rem;
      border-radius:.375rem;width:fit-content;
      background:${hayStock ? '#dcfce7' : '#fee2e2'};
      color:${hayStock ? '#166534' : '#991b1b'};
      border:1px solid ${hayStock ? '#bbf7d0' : '#fecaca'};
    `;
    badges.appendChild(stockBadge);

    if (b.pdfUrl) {
      const pdfBadge = document.createElement('span');
      pdfBadge.textContent = '📶 Disponible online';
      pdfBadge.style.cssText = `
        display:inline-block;font-size:.72rem;font-weight:600;padding:.25rem .6rem;
        border-radius:.375rem;width:fit-content;
        background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe;
      `;
      badges.appendChild(pdfBadge);
    }

    // ── Acciones ─────────────────────────────────
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-direction:column;gap:.5rem;margin-top:auto;padding-top:.75rem;';

    if (b.pdfUrl) {
      const link = document.createElement('a');
      link.className = 'btn-pdf';
      link.href = urlSegura(b.pdfUrl); link.target = '_blank'; link.rel = 'noopener';
      link.textContent = '📚 Ver PDF';
      link.style.cssText = 'display:block;text-align:center;width:100%;box-sizing:border-box;';
      actions.appendChild(link);
    }

    const btnSolicitar = document.createElement('button');
    btnSolicitar.className = 'btn-solicitar';
    btnSolicitar.textContent = hayStock ? '📋 Solicitar préstamo' : 'Sin disponibilidad';
    btnSolicitar.disabled = !hayStock;
    btnSolicitar.style.cssText = `
      width:100%;padding:.6rem 1rem;border:none;border-radius:.5rem;
      font-size:.875rem;font-weight:600;cursor:${hayStock ? 'pointer' : 'not-allowed'};
      background:${hayStock ? '#2563eb' : '#e5e7eb'};
      color:${hayStock ? '#fff' : '#9ca3af'};
      transition:background .2s ease;
    `;
    if (hayStock) {
      btnSolicitar.addEventListener('mouseover', () => { btnSolicitar.style.background = '#1d4ed8'; });
      btnSolicitar.addEventListener('mouseout',  () => { btnSolicitar.style.background = '#2563eb'; });
    }
    btnSolicitar.addEventListener('click', () => abrirModalPrestamo(b));
    actions.appendChild(btnSolicitar);

    body.append(titleEl, authorEl, badges, actions);
    card.append(cover, body);
    grid.appendChild(card);
  });

  // Paginación
  if (totalPags <= 1) return;

  const btnPrev = document.createElement('button');
  btnPrev.className = 'pag-btn'; btnPrev.textContent = '←';
  btnPrev.disabled = paginaActual === 1;
  btnPrev.addEventListener('click', () => { paginaActual--; renderCatalogo(); window.scrollTo({ top: document.getElementById('destacados').offsetTop - 80, behavior: 'smooth' }); });
  paginacion.appendChild(btnPrev);

  for (let i = 1; i <= totalPags; i++) {
    const btn = document.createElement('button');
    btn.className = 'pag-btn' + (i === paginaActual ? ' active' : '');
    btn.textContent = i;
    btn.addEventListener('click', () => { paginaActual = i; renderCatalogo(); window.scrollTo({ top: document.getElementById('destacados').offsetTop - 80, behavior: 'smooth' }); });
    paginacion.appendChild(btn);
  }

  const btnNext = document.createElement('button');
  btnNext.className = 'pag-btn'; btnNext.textContent = '→';
  btnNext.disabled = paginaActual === totalPags;
  btnNext.addEventListener('click', () => { paginaActual++; renderCatalogo(); window.scrollTo({ top: document.getElementById('destacados').offsetTop - 80, behavior: 'smooth' }); });
  paginacion.appendChild(btnNext);
}

function renderBooks() {
  librosFiltrados = [...librosPublicos];
  poblarFiltrosCatalogo();
  renderCatalogo();
}

/* ── CAROUSEL ───────────────────────────────────── */
let currentCat = 0;

function getPosition(catIdx, activeIdx) {
  const n = categoriasPublicas.length;
  let diff = (catIdx - activeIdx + n) % n;
  if (diff > 2) diff -= n;
  return { '-2':'left2', '-1':'left1', '0':'center', '1':'right1', '2':'right2' }[diff] || null;
}

function buildCarousel() {
  const track = document.getElementById('carousel-track');
  const dots = document.getElementById('carousel-dots');
  track.innerHTML = '';
  dots.innerHTML = '';

  if (!categoriasPublicas.length) return;

  categoriasPublicas.forEach((cat, i) => {
    const card = document.createElement('div');
    card.className = 'cat-card';
    card.setAttribute('role', 'tabpanel');
    card.setAttribute('aria-label', cat.name);
    card.dataset.idx = i;

    const img = document.createElement('img');
    img.src = cat.img || ''; img.alt = `Categoría ${cat.name}`; img.loading = 'lazy';
    const overlay = document.createElement('div'); overlay.className = 'cat-overlay';
    const topBar = document.createElement('div'); topBar.className = 'cat-top-bar'; topBar.style.background = cat.hex;
    const content = document.createElement('div'); content.className = 'cat-content';
    const labelEl = document.createElement('div'); labelEl.className = 'cat-label'; labelEl.style.color = cat.hex;
    labelEl.textContent = `${cat.books} LIBRO${cat.books !== 1 ? 'S' : ''}`;
    const titleEl = document.createElement('div'); titleEl.className = 'cat-title'; titleEl.textContent = cat.name;
    const descEl = document.createElement('div'); descEl.className = 'cat-desc'; descEl.textContent = cat.desc || '';
    content.append(labelEl, titleEl, descEl);
    card.append(img, overlay, topBar, content);

    card.addEventListener('click', () => { currentCat = i; updateCarousel(); });
    card.addEventListener('keydown', e => { if (e.key === 'Enter') { currentCat = i; updateCarousel(); } });
    track.appendChild(card);

    const dot = document.createElement('div');
    dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('role', 'tab'); dot.setAttribute('aria-label', cat.name); dot.setAttribute('tabindex', '0');
    dot.addEventListener('click', () => { currentCat = i; updateCarousel(); });
    dot.addEventListener('keydown', e => { if (e.key === 'Enter') { currentCat = i; updateCarousel(); } });
    dots.appendChild(dot);
  });

  updateCarousel();
}

function updateCarousel() {
  document.querySelectorAll('.cat-card').forEach((card, i) => {
    const pos = getPosition(i, currentCat);
    card.dataset.pos = pos || 'hidden';
    card.style.display = pos ? '' : 'none';
    card.setAttribute('aria-selected', pos === 'center');
    card.setAttribute('tabindex', pos === 'center' ? '0' : '-1');
  });
  document.querySelectorAll('.carousel-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === currentCat);
    dot.setAttribute('aria-selected', i === currentCat);
  });
}

function carouselNext() { currentCat = (currentCat + 1) % categoriasPublicas.length; updateCarousel(); }
function carouselPrev() { currentCat = (currentCat - 1 + categoriasPublicas.length) % categoriasPublicas.length; updateCarousel(); }

document.addEventListener('keydown', e => {
  if (['ArrowLeft','ArrowRight'].includes(e.key) && document.activeElement.classList.contains('cat-card')) {
    e.key === 'ArrowRight' ? carouselNext() : carouselPrev();
  }
});

setInterval(() => { if (!document.hidden && categoriasPublicas.length) carouselNext(); }, 4500);

/* ── MODAL DE SOLICITUD DE PRÉSTAMO ─────────────── */
let libroSeleccionado = null;
let usuarioSesionPrestamo = null;   // fila 'usuarios' del usuario autenticado

function mostrarToastSesion() {
  const toast = document.getElementById('toast-sesion');
  if (!toast) return;
  toast.style.display = 'flex';
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 260);
  }, 3500);
}

async function abrirModalPrestamo(libro) {
  // La sesión REAL de Supabase reemplaza al flag manipulable window._sesionActiva
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { mostrarToastSesion(); return; }

  // Los datos del solicitante salen de SU fila en 'usuarios', no del formulario.
  const { data: user } = await sb
    .from('usuarios')
    .select('id, nombre, apellido, dni, email, telefono, id_curso, activo')
    .eq('email', session.user.email)
    .maybeSingle();

  if (!user || user.activo === false) { mostrarToastSesion(); return; }
  usuarioSesionPrestamo = user;

  libroSeleccionado = libro;
  document.getElementById('modal-libro-titulo').textContent = libro.titulo;
  document.getElementById('modal-libro-stock').textContent = `Stock: ${libro.stock} disponible${libro.stock !== 1 ? 's' : ''}`;
  document.getElementById('modal-error').style.display = 'none';
  document.getElementById('form-solicitud-prestamo').reset();

  // Precargar los datos personales como SOLO LECTURA (no se pueden suplantar)
  const prefill = {
    'solicitud-nombre': user.nombre,
    'solicitud-apellido': user.apellido,
    'solicitud-dni': user.dni,
    'solicitud-email': user.email,
    'solicitud-telefono': user.telefono || '',
  };
  for (const [id, valor] of Object.entries(prefill)) {
    const el = document.getElementById(id);
    if (el) { el.value = valor ?? ''; el.readOnly = true; }
  }

  // Curso / división: precargar desde el curso del usuario (si existe)
  if (user.id_curso) {
    const { data: curso } = await sb
      .from('cursos')
      .select('nombre, division')
      .eq('id', user.id_curso)
      .maybeSingle();
    const elCurso = document.getElementById('solicitud-curso');
    const elDiv = document.getElementById('solicitud-division');
    if (curso && elCurso && elDiv) {
      elCurso.value = curso.nombre ?? '';
      elDiv.value = curso.division && curso.division !== '—' ? curso.division : '';
      elCurso.readOnly = true;
      elDiv.readOnly = true;
    }
  }

  document.getElementById('modal-prestamo').style.display = 'flex';
}

function cerrarModalPrestamo() {
  document.getElementById('modal-prestamo').style.display = 'none';
  document.getElementById('form-solicitud-prestamo')?.reset();
  libroSeleccionado = null;
  usuarioSesionPrestamo = null;
  // Devolver los campos a editables para el próximo uso
  ['solicitud-nombre','solicitud-apellido','solicitud-dni','solicitud-email','solicitud-telefono','solicitud-curso','solicitud-division']
    .forEach(id => { const el = document.getElementById(id); if (el) el.readOnly = false; });
}

async function enviarSolicitudPrestamo(e) {
  e.preventDefault();

  if (!libroSeleccionado || !usuarioSesionPrestamo) {
    mostrarErrorModal('Error: sesión no válida. Recargá la página e intentá nuevamente.');
    return;
  }

  const dias = Number(document.getElementById('solicitud-dias')?.value);
  if (!Number.isInteger(dias) || dias < 1 || dias > 30) {
    mostrarErrorModal('El plazo debe ser de entre 1 y 30 días.');
    return;
  }

  try {
    const { error } = await sb.rpc('solicitar_libro', {
      p_id_libro: libroSeleccionado.id,
      p_dias: dias,
    });
    if (error) throw new Error(error.message);

    // Éxito
    // (capturamos los datos ANTES de cerrar: cerrarModalPrestamo() limpia
    //  libroSeleccionado / usuarioSesionPrestamo y tiraba un TypeError
    //  que mostraba "Error: ..." justo después de una reserva exitosa)
    const tituloLibro  = libroSeleccionado?.titulo ?? '';
    const alumnoNombre = `${usuarioSesionPrestamo?.nombre ?? ''} ${usuarioSesionPrestamo?.apellido ?? ''}`.trim();
    cerrarModalPrestamo();
    alert(`✅ Solicitud registrada!\n\nLibro: ${tituloLibro}\nAlumno: ${alumnoNombre}\n\nLa bibliotecaria revisará tu solicitud pronto.`);
    
  } catch (err) {
    console.error('Error al registrar solicitud:', err);
    mostrarErrorModal(`Error: ${err.message}`);
  }
}

function mostrarErrorModal(mensaje) {
  const errorEl = document.getElementById('modal-error');
  errorEl.textContent = mensaje;
  errorEl.style.display = 'block';
}

/* ── ARRANCAR ───────────────────────────────────── */
initPublic();
