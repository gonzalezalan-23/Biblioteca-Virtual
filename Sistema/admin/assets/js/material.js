/* ============================================================
   MATERIAL DE ESTUDIO — con segmentación por ciclo/tecnicatura
   ============================================================ */
let materialItems = [];
let _cursosCache  = [];   // cursos reales traídos de Supabase

// Años por ciclo — la BD guarda el número entero (1-7)
const CICLO_BASICO  = [1, 2, 3];
const CICLO_TECNICO = [4, 5, 6, 7];

const ANIO_LABEL = {
  1: '1° Año', 2: '2° Año', 3: '3° Año',
  4: '4° Año', 5: '5° Año', 6: '6° Año', 7: '7° Año',
};

const TIPO_CONFIG = {
  pdf:   { label: 'PDF',   icon: '📄', badge: 'badge-red'    },
  link:  { label: 'Link',  icon: '🔗', badge: 'badge-blue'   },
  guia:  { label: 'Guía',  icon: '📋', badge: 'badge-yellow' },
  video: { label: 'Video', icon: '▶',  badge: 'badge-green'  },
  otro:  { label: 'Otro',  icon: '📁', badge: 'badge-gray'   },
};

function normalizarTextoMat(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function escapeHtmlMat(val) {
  return String(val ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─── Carga cursos reales desde Supabase (se llama al entrar a la sección) ─── */
async function cargarCursosMaterial() {
  if (_cursosCache.length) return;   // ya cargados
  const { data, error } = await supabaseClient
    .from('cursos')
    .select('id, nombre, division')
    .order('nombre');
  if (error) { console.error('Error al cargar cursos:', error.message); return; }
  _cursosCache = data || [];
}

function _tecnicaturaCurso(c) {
  const division = String(c.division ?? '').trim();
  if (division && division !== '—' && !/^[A-Za-z]$/.test(division)) return division;
  return String(c.nombre ?? '').replace(/^\s*\d+\s*(?:to|ro|do|°)?\s*/i, '').trim();
}

/* ─── Extrae el número de año desde el nombre del curso (ej: '4to' → 4) ─── */
function _anioDesdeNombre(nombre) {
  const m = String(nombre).match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

/* ─── Selector dinámico: al cambiar ciclo ─── */
function onMatCicloChange() {
  const ciclo   = document.getElementById('mat-ciclo').value;
  const anioSel = document.getElementById('mat-anio-sel');
  const tecWrap = document.getElementById('mat-tecnicatura-wrap');
  const tecSel  = document.getElementById('mat-tecnicatura');

  anioSel.innerHTML = '<option value="">Seleccioná el año…</option>';
  anioSel.disabled  = !ciclo;
  tecSel.innerHTML  = '<option value="">Seleccioná el curso…</option>';
  tecWrap.style.display = 'none';

  if (!ciclo) return;

  const numeros = ciclo === 'basico' ? CICLO_BASICO : CICLO_TECNICO;
  numeros.forEach(n => { anioSel.innerHTML += `<option value="${n}">${ANIO_LABEL[n]}</option>`; });
  if (ciclo === 'tecnico') tecWrap.style.display = '';
}

/* ─── Al cambiar el año en ciclo técnico: poblar cursos reales ─── */
function onMatAnioChange() {
  const ciclo  = document.getElementById('mat-ciclo').value;
  const tecSel = document.getElementById('mat-tecnicatura');
  if (ciclo !== 'tecnico') return;

  const anioNum = Number(document.getElementById('mat-anio-sel').value);
  tecSel.innerHTML = '<option value="">Seleccioná el curso…</option>';
  const opciones = [...new Set(_cursosCache.filter(c => _anioDesdeNombre(c.nombre) === anioNum)
    .map(_tecnicaturaCurso).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  opciones.forEach(nombre => { tecSel.innerHTML += `<option value="${escapeHtmlMat(nombre)}">${escapeHtmlMat(nombre)}</option>`; });
}

/* ─── Carga desde Supabase ─── */
async function cargarMaterial() {
  await cargarCursosMaterial();
  const { data, error } = await supabaseClient
    .from('material_estudio')
    .select('id,titulo,descripcion,materia,anio_escolar,ciclo,tecnicatura,tipo_recurso,url_recurso,fecha_creacion')
    .order('anio_escolar', { ascending: true })
    .order('fecha_creacion', { ascending: false });

  if (error) { console.error('Error al cargar material:', error.message); return; }
  materialItems = data || [];
}

/* ─── Render tarjetas ─── */
function renderMaterial() {
  const q        = normalizarTextoMat(document.getElementById('mat-search')?.value ?? '');
  const cicloFil = document.getElementById('mat-filter-ciclo')?.value  ?? '';
  const tecFil   = document.getElementById('mat-filter-tec')?.value    ?? '';
  const tipoFil  = document.getElementById('mat-filter-tipo')?.value   ?? '';

  const lista = materialItems.filter(m => {
    const anioN  = Number(m.anio_escolar);
    const esBas  = m.ciclo === 'basico';
    const esTec  = m.ciclo === 'tecnico';
    const hay    = normalizarTextoMat(`${m.titulo} ${m.materia} ${m.descripcion ?? ''} ${m.tecnicatura ?? ''}`);
    return hay.includes(q)
      && (!cicloFil || (cicloFil === 'basico' ? esBas : esTec))
      && (!tecFil   || m.tecnicatura === tecFil)
      && (!tipoFil || m.tipo_recurso === tipoFil);
  });

  const grid  = document.getElementById('mat-grid');
  const empty = document.getElementById('mat-empty');
  const count = document.getElementById('mat-count');
  grid.innerHTML = '';

  if (count) count.textContent = `${lista.length} recurso${lista.length !== 1 ? 's' : ''}`;
  if (!lista.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  lista.forEach(m => {
    const tipo  = TIPO_CONFIG[m.tipo_recurso] ?? TIPO_CONFIG.otro;
    const fecha = m.fecha_creacion
      ? new Date(m.fecha_creacion).toLocaleDateString('es-AR')
      : '—';

    const anioN      = Number(m.anio_escolar);
    const anioLabel  = anioN ? (ANIO_LABEL[anioN] ?? `${anioN}° Año`) : '—';
    const esBas      = CICLO_BASICO.includes(anioN);
    const cicloLabel = m.ciclo === 'basico' ? 'Ciclo Básico' : m.ciclo === 'tecnico' ? 'Énfasis Técnico' : '—';
    const tecLabel   = m.ciclo === 'tecnico' ? (m.tecnicatura ?? '') : '';

    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'display:flex;flex-direction:column;gap:.75rem;transition:box-shadow .2s;';
    card.addEventListener('mouseenter', () => card.style.boxShadow = '0 4px 20px rgba(0,0,0,.08)');
    card.addEventListener('mouseleave', () => card.style.boxShadow = '');

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:flex-start;gap:.75rem;';

    const iconBox = document.createElement('div');
    iconBox.style.cssText = 'width:42px;height:42px;border-radius:10px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:1.25rem;flex-shrink:0;border:1px solid var(--border);';
    iconBox.textContent = tipo.icon;

    const headInfo = document.createElement('div');
    headInfo.style.cssText = 'flex:1;min-width:0;';
    headInfo.innerHTML = `
      <p style="font-weight:600;font-size:.95rem;color:var(--text);line-height:1.35;margin:0 0 .3rem;word-break:break-word;">${escapeHtmlMat(m.titulo)}</p>
    `;
    head.append(iconBox, headInfo);

    const parts = [head];

    if (m.descripcion) {
      const desc = document.createElement('p');
      desc.style.cssText = 'font-size:.85rem;color:var(--muted);margin:0;line-height:1.5;';
      desc.textContent = m.descripcion;
      parts.push(desc);
    }

    // Chips de segmentación
    const chips = document.createElement('div');
    chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:.35rem;';
    chips.innerHTML = `
      <span style="font-size:.72rem;padding:.2rem .55rem;border-radius:6px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;">📅 ${escapeHtmlMat(anioLabel)}</span>
      <span style="font-size:.72rem;padding:.2rem .55rem;border-radius:6px;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;">🏫 ${escapeHtmlMat(cicloLabel)}</span>
      ${tecLabel ? `<span style="font-size:.72rem;padding:.2rem .55rem;border-radius:6px;background:#faf5ff;color:#7e22ce;border:1px solid #e9d5ff;">⚙ ${escapeHtmlMat(tecLabel)}</span>` : ''}
    `;
    parts.push(chips);

    const meta = document.createElement('div');
    meta.style.cssText = 'display:flex;flex-wrap:wrap;gap:.4rem;font-size:.78rem;color:var(--muted);border-top:1px solid var(--border);padding-top:.6rem;margin-top:auto;';
    meta.innerHTML = `
      <span>📚 ${escapeHtmlMat(m.materia)}</span>
      <span style="color:var(--border);">·</span>
      <span>🕐 ${fecha}</span>
    `;
    parts.push(meta);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:.5rem;';

    const btnVer = document.createElement('a');
    btnVer.href = urlSegura(m.url_recurso); btnVer.target = '_blank'; btnVer.rel = 'noopener noreferrer';
    btnVer.className = 'btn btn-primary';
    btnVer.style.cssText = 'font-size:.82rem;padding:.4rem .9rem;text-decoration:none;flex:1;justify-content:center;';
    btnVer.textContent = '🔗 Ver recurso';

    const btnDel = document.createElement('button');
    btnDel.className = 'btn btn-danger';
    btnDel.style.cssText = 'font-size:.8rem;padding:.4rem .65rem;';
    btnDel.title = 'Eliminar recurso';
    btnDel.textContent = '🗑';
    btnDel.addEventListener('click', () => eliminarMaterial(m.id, m.titulo));

    footer.append(btnVer, btnDel);
    parts.push(footer);
    card.append(...parts);
    grid.appendChild(card);
  });
}

/* ─── Insert ─── */
async function procesarGuardadoMaterial() {
  const titulo      = document.getElementById('mat-titulo').value.trim();
  const descripcion = document.getElementById('mat-desc').value.trim();
  const materia     = document.getElementById('mat-materia').value.trim();
  const ciclo       = document.getElementById('mat-ciclo').value;
  const anioRaw     = document.getElementById('mat-anio-sel').value;
  const tecnicatura = document.getElementById('mat-tecnicatura').value;
  const tipo        = document.getElementById('mat-tipo').value;
  const url         = document.getElementById('mat-url').value.trim();

  if (!titulo || !materia || !url) {
    mostrarNotificacion('Completá Título, Materia y URL del recurso.', 'warning'); return;
  }
  if (!ciclo) {
    mostrarNotificacion('Seleccioná el ciclo (Básico o Técnico).', 'warning'); return;
  }
  if (!anioRaw) {
    mostrarNotificacion('Seleccioná el año escolar.', 'warning'); return;
  }
  if (ciclo === 'tecnico' && !tecnicatura) {
    mostrarNotificacion('Seleccioná el curso para el ciclo técnico.', 'warning'); return;
  }
  let urlValida = false;
  try { urlValida = ['http:', 'https:'].includes(new URL(url).protocol); } catch {}
  if (!urlValida) {
    mostrarNotificacion('La URL debe comenzar con http:// o https://', 'warning'); return;
  }

  const anioEscolar = Number(anioRaw);
  if (!Number.isInteger(anioEscolar) || (ciclo === 'basico' ? !CICLO_BASICO.includes(anioEscolar) : !CICLO_TECNICO.includes(anioEscolar))) {
    mostrarNotificacion('El año no corresponde al ciclo seleccionado.', 'warning'); return;
  }

  const { error } = await supabaseClient
    .from('material_estudio')
    .insert([{
      titulo,
      descripcion:  descripcion || null,
      materia,
      anio_escolar: anioEscolar,
      ciclo,
      tecnicatura:  ciclo === 'tecnico' ? tecnicatura : null,
      tipo_recurso: tipo,
      url_recurso:  url,
    }]);

  if (error) { mostrarNotificacion('Error al guardar: ' + error.message, 'error'); console.error(error); return; }

  mostrarNotificacion(`"${titulo}" subido correctamente.`, 'success');

  // Reset formulario
  ['mat-titulo','mat-desc','mat-materia','mat-url'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('mat-ciclo').value       = '';
  document.getElementById('mat-anio-sel').innerHTML = '<option value="">Primero elegí el ciclo…</option>';
  document.getElementById('mat-anio-sel').disabled  = true;
  document.getElementById('mat-tecnicatura-wrap').style.display = 'none';
  document.getElementById('mat-tecnicatura').innerHTML = '<option value="">Seleccioná el curso…</option>';

  await cargarMaterial();
  renderMaterial();
}

/* ─── Delete ─── */
async function eliminarMaterial(id, titulo) {
  if (!window.confirm(`¿Eliminar "${titulo}"? Esta acción no se puede deshacer.`)) return;

  const { error } = await supabaseClient.from('material_estudio').delete().eq('id', id);
  if (error) { mostrarNotificacion('Error al eliminar: ' + error.message, 'error'); console.error(error); return; }

  mostrarNotificacion(`"${titulo}" eliminado.`, 'success');
  materialItems = materialItems.filter(m => m.id !== id);
  renderMaterial();
}
