/* ============================================================
   INVENTARIO
   ============================================================ */
let libros = [];
let categorias = [];

function capitalize(str) {
  return String(str || '').trim().replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function escapeHtml(val) {
  return String(val ?? '').replace(/[&<>"']/g, c => (
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

function mostrarNotificacion(msg, tipo = 'success') {
  let toast = document.getElementById('toast-notif');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-notif';
    toast.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;padding:.75rem 1.25rem;border-radius:.5rem;color:#fff;font-size:.9rem;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.2);transition:opacity .3s;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.background = tipo === 'success' ? '#22c55e' : tipo === 'error' ? '#ef4444' : '#f59e0b';
  toast.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

/* ── Buscador predictivo de autores ─────────────────────────
   Reutilizable: recibe el id del input de texto y del dropdown.
   Guarda el id del autor seleccionado en el campo hidden
   `${inputId}-id`. Si el usuario escribe un nombre nuevo sin
   seleccionar sugerencia, el campo hidden queda vacío y
   resolverAutor() creará el autor al guardar.
──────────────────────────────────────────────────────────── */
function initAutorSearch(inputId, dropdownId) {
  const input    = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  const hiddenId = inputId + '-id';
  if (!input || !dropdown) return;

  let debounceTimer;

  input.addEventListener('input', () => {
    // Al editar manualmente, invalidar la selección previa
    document.getElementById(hiddenId).value = '';
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; return; }
    debounceTimer = setTimeout(() => buscarAutores(q, input, dropdown, hiddenId), 280);
  });

  // Cerrar dropdown al hacer clic fuera
  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

async function buscarAutores(q, input, dropdown, hiddenId) {
  const { data, error } = await supabaseClient
    .from('autores')
    .select('id, nombre')
    .ilike('nombre', `%${q}%`)
    .order('nombre')
    .limit(3);

  if (error || !data?.length) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; return; }

  dropdown.innerHTML = '';
  data.forEach(autor => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:.6rem .9rem;font-size:.9rem;cursor:pointer;color:var(--text);transition:background .15s;';
    item.textContent = autor.nombre;
    item.addEventListener('mouseenter', () => { item.style.background = 'var(--brand-light, #dbeafe)'; });
    item.addEventListener('mouseleave', () => { item.style.background = ''; });
    item.addEventListener('mousedown', e => {
      // mousedown antes de blur para que el click se registre
      e.preventDefault();
      input.value = autor.nombre;
      document.getElementById(hiddenId).value = autor.id;
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
    });
    dropdown.appendChild(item);
  });
  dropdown.style.display = 'block';
}

/* Resuelve el id_autor a usar al guardar:
   - Si hay un id en el campo hidden (selección de sugerencia) → lo usa.
   - Si no, busca coincidencia exacta (case-insensitive) en la BD.
   - Si tampoco existe → inserta el autor nuevo y devuelve su id. */
async function resolverAutor(nombre) {
  const nombreNorm = capitalize(nombre);

  // 1. Buscar exacto
  const { data: existente } = await supabaseClient
    .from('autores').select('id').ilike('nombre', nombreNorm).maybeSingle();
  if (existente) return existente.id;

  // 2. Crear nuevo
  const { data: nuevo, error } = await supabaseClient
    .from('autores').insert([{ nombre: nombreNorm }]).select('id').single();
  if (error) throw error;
  return nuevo.id;
}

async function cargarCategorias() {
  const { data, error } = await supabaseClient
    .from('categorias')
    .select('id,nombre')
    .order('nombre', { ascending: true });

  if (error) { console.error('Error al cargar categorías:', error.message); return; }

  categorias = data || [];
  poblarCategorias();
}

function poblarCategorias() {
  const catSelect    = document.getElementById('inv-cat');
  const editCatSelect = document.getElementById('edit-cat');
  const filterSelect = document.getElementById('inv-cat-filter');

  const opts = categorias.map(c => `<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`).join('');
  if (catSelect)     catSelect.innerHTML = opts;
  if (editCatSelect) editCatSelect.innerHTML = opts;
  if (filterSelect)  filterSelect.innerHTML = '<option value="">Todas las categorías</option>' + opts;
}

async function cargarInventario() {
  const { data: librosData, error: errorLibros } = await supabaseClient
    .from('libros')
    .select('id,titulo,isbn,editorial,edicion,anio_publicacion,paginas,url_drive,palabras_clave,id_autor,id_categoria,autores(id,nombre),categorias(id,nombre)');

  if (errorLibros) { console.error('Error al cargar libros:', errorLibros.message); return; }

  const { data: stockData, error: errorStock } = await supabaseClient
    .from('stock')
    .select('id,id_libro,nro_inventario');

  if (errorStock) { console.error('Error al cargar stock:', errorStock.message); return; }

  const stockMap = (stockData || []).reduce((acc, item) => {
    if (!acc[item.id_libro]) acc[item.id_libro] = [];
    acc[item.id_libro].push(item);
    return acc;
  }, {});

  libros = (librosData || []).map(book => {
    const autor     = capitalize(book.autores?.nombre || '');
    const categoria = book.categorias ? book.categorias.nombre : '';
    const stockItems = stockMap[book.id] || [];
    return {
      id:               book.id,
      titulo:           book.titulo,
      autor,
      categoria,
      stock:            stockItems.length,
      nrosInventario:   stockItems.map(item => item.nro_inventario),
      stockItems,
      id_autor:         book.id_autor,
      id_categoria:     book.id_categoria,
      isbn:             book.isbn             || '',
      editorial:        book.editorial        || '',
      edicion:          book.edicion          || '',
      anio_publicacion: book.anio_publicacion || '',
      paginas:          book.paginas          || '',
      url_drive:        book.url_drive        || '',
      palabras_clave:   book.palabras_clave   || '',
    };
  });
}

function renderInventario() {
  const q   = document.getElementById('inv-search').value.toLowerCase();
  const cat = document.getElementById('inv-cat-filter').value;

  const lista = libros.filter(l => {
    const matchQ = l.titulo.toLowerCase().includes(q)
      || l.autor.toLowerCase().includes(q)
      || (l.palabras_clave || '').toLowerCase().includes(q)
      || (l.isbn || '').toLowerCase().includes(q);
    const matchC = !cat || l.categoria === cat;
    return matchQ && matchC;
  });

  const tbody = document.getElementById('inv-tbody');
  tbody.innerHTML = '';

  lista.forEach((l, i) => {
    const stockColor = l.stock === 0 ? 'color:var(--danger);font-weight:700;' : l.stock <= 1 ? 'color:var(--warning);font-weight:600;' : '';
    const tr = document.createElement('tr');

    const btnToggle = document.createElement('button');
    btnToggle.id = `btn-toggle-${l.id}`;
    btnToggle.className = 'btn btn-ghost';
    btnToggle.style.cssText = 'padding:.4rem .6rem;font-size:.75rem;line-height:1;transition:transform .2s;';
    btnToggle.title = 'Ver ejemplares';
    btnToggle.innerHTML = '&#9660;';
    btnToggle.addEventListener('click', e => toggleDetalleStock(e, l.id));

    const btnEditar = document.createElement('button');
    btnEditar.className = 'btn btn-ghost';
    btnEditar.style.cssText = 'padding:.35rem .7rem;font-size:.8rem;';
    btnEditar.textContent = '✏ Editar';
    btnEditar.addEventListener('click', () => abrirEdicion(l.id));

    const btnEliminar = document.createElement('button');
    btnEliminar.className = 'btn btn-danger';
    btnEliminar.style.cssText = 'padding:.35rem .7rem;font-size:.8rem;';
    btnEliminar.textContent = '🗑 Eliminar';
    btnEliminar.addEventListener('click', () => eliminarLibro(l.id));

    const tdToggle  = document.createElement('td'); tdToggle.style.cssText = 'padding:.5rem .75rem;width:40px;'; tdToggle.appendChild(btnToggle);
    const tdNum     = document.createElement('td'); tdNum.style.cssText = 'color:var(--muted);font-size:.8rem;'; tdNum.textContent = i + 1;
    const tdTitulo  = document.createElement('td'); tdTitulo.style.fontWeight = '600'; tdTitulo.textContent = l.titulo;
    const tdAutor   = document.createElement('td'); tdAutor.textContent = l.autor;
    const tdCat     = document.createElement('td');
    const badge     = document.createElement('span'); badge.className = 'badge badge-blue'; badge.textContent = l.categoria;
    tdCat.appendChild(badge);
    const tdStock   = document.createElement('td'); tdStock.style.cssText = stockColor; tdStock.textContent = l.stock;
    const tdAcciones = document.createElement('td');
    const divAcciones = document.createElement('div'); divAcciones.style.cssText = 'display:flex;gap:.4rem;';
    divAcciones.append(btnEditar, btnEliminar);
    tdAcciones.appendChild(divAcciones);

    tr.append(tdToggle, tdNum, tdTitulo, tdAutor, tdCat, tdStock, tdAcciones);
    tbody.appendChild(tr);

    // ── Fila de detalle accordion ──────────────────────────────────────
    const detail = document.createElement('tr');
    detail.id = `stock-detail-${l.id}`;
    detail.style.display = 'none';
    const detailCell = document.createElement('td');
    detailCell.colSpan = 7;
    detailCell.style.cssText = 'padding:0;border-bottom:2px solid var(--border);';

    // Contenedor principal del panel
    const panel = document.createElement('div');
    panel.style.cssText = 'padding:1rem 1.25rem 1.25rem;background:#f8fafc;display:flex;flex-direction:column;gap:1rem;';

    // — Sección metadatos del libro —
    const metaItems = [
      l.isbn             && { label: 'ISBN',      val: l.isbn },
      l.editorial        && { label: 'Editorial', val: l.editorial },
      l.edicion          && { label: 'Edición',   val: l.edicion },
      l.anio_publicacion && { label: 'Año',       val: l.anio_publicacion },
      l.paginas          && { label: 'Páginas',   val: l.paginas },
      l.url_drive        && { label: 'PDF',        val: l.url_drive, isLink: true },
    ].filter(Boolean);

    if (metaItems.length) {
      const metaRow = document.createElement('div');
      metaRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:.5rem .75rem;';
      metaItems.forEach(({ label, val, isLink }) => {
        const chip = document.createElement('span');
        chip.style.cssText = 'background:#fff;border:1px solid var(--border);border-radius:8px;padding:.3rem .7rem;font-size:.78rem;color:var(--muted);display:inline-flex;gap:.3rem;align-items:center;';
        if (isLink) {
          chip.innerHTML = `<span style="font-weight:600;color:var(--text);">${label}:</span> <a href="${escapeHtml(urlSegura(val))}" target="_blank" rel="noopener noreferrer" style="color:var(--brand);text-decoration:underline;">Ver enlace</a>`;
        } else {
          chip.innerHTML = `<span style="font-weight:600;color:var(--text);">${label}:</span> ${escapeHtml(String(val))}`;
        }
        metaRow.appendChild(chip);
      });
      panel.appendChild(metaRow);
    }

    // — Sección ejemplares (tarjetas) —
    const invSection = document.createElement('div');
    const invHeader = document.createElement('p');
    invHeader.style.cssText = 'font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 .6rem;';
    invHeader.textContent = `Ejemplares · ${l.stock} en inventario`;
    invSection.appendChild(invHeader);

    const invGrid = document.createElement('div');
    invGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:.5rem;';

    const sortedNros = [...l.nrosInventario].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));

    if (sortedNros.length) {
      const nroToItem = Object.fromEntries(l.stockItems.map(s => [String(s.nro_inventario), s]));

      sortedNros.forEach(nro => {
        const stockItem = nroToItem[String(nro)];
        const tag = document.createElement('span');
        tag.style.cssText = 'display:inline-flex;align-items:center;gap:.35rem;background:#fff;border:1px solid var(--border);border-radius:8px;padding:.25rem .6rem;font-size:.82rem;font-weight:500;color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.04);';
        tag.innerHTML = `<span style="font-size:.9rem;">📖</span> ${escapeHtml(String(nro))}`;

        if (stockItem) {
          const btnDel = document.createElement('button');
          btnDel.title = 'Eliminar este ejemplar';
          btnDel.style.cssText = 'margin-left:.15rem;background:none;border:none;cursor:pointer;color:#ef4444;font-size:.9rem;line-height:1;padding:0 .15rem;';
          btnDel.textContent = '×';
          btnDel.addEventListener('click', e => { e.stopPropagation(); eliminarEjemplar(stockItem.id, String(nro), l.id); });
          tag.appendChild(btnDel);
        }

        invGrid.appendChild(tag);
      });
    } else {
      const empty = document.createElement('span');
      empty.style.cssText = 'font-size:.85rem;color:var(--muted);font-style:italic;';
      empty.textContent = 'Sin ejemplares registrados.';
      invGrid.appendChild(empty);
    }

    invSection.appendChild(invGrid);
    panel.appendChild(invSection);
    detailCell.appendChild(panel);
    detail.appendChild(detailCell);
    tbody.appendChild(detail);
  });

  if (!lista.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.style.cssText = 'text-align:center;color:var(--muted);padding:2rem;';
    td.textContent = 'No hay libros que coincidan.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

function toggleDetalleStock(event, id) {
  event.stopPropagation();
  const detailRow = document.getElementById(`stock-detail-${id}`);
  const btn       = document.getElementById(`btn-toggle-${id}`);
  if (!detailRow) return;
  const isOpen = detailRow.style.display === 'table-row';
  detailRow.style.display = isOpen ? 'none' : 'table-row';
  if (btn) btn.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
}

function generarCamposISBN() {
  const cantidad   = parseInt(document.getElementById('inv-stock').value) || 0;
  const contenedor = document.getElementById('inv-contenedor-isbns');
  const wrapper    = document.getElementById('inv-wrapper-isbns');
  contenedor.innerHTML = '';

  if (!wrapper) return;
  if (cantidad < 1) { wrapper.style.display = 'none'; return; }
  wrapper.style.display = 'block';

  for (let i = 1; i <= cantidad; i++) {
    const wDiv  = document.createElement('div');
    const label = document.createElement('label');
    label.className   = 'form-label';
    label.textContent = `Ejemplar ${i} *`;
    const input = document.createElement('input');
    input.className   = 'form-input clase-isbn-dinamica';
    input.type        = 'text';
    input.placeholder = 'Ej: INV-0042';
    input.required    = true;
    wDiv.append(label, input);
    contenedor.appendChild(wDiv);
  }
}

// Inicializa los campos de inventario al cargar el módulo
document.addEventListener('DOMContentLoaded', () => {
  generarCamposISBN();
  initAutorSearch('inv-autor',  'inv-autor-dropdown');
  initAutorSearch('edit-autor', 'edit-autor-dropdown');

  // Autocompletado por ISBN usando Open Library
  const isbnInput = document.getElementById('inv-isbn');
  if (!isbnInput) return;
  isbnInput.addEventListener('blur', async () => {
    const isbn = isbnInput.value.trim().replace(/[-\s]/g, '');
    if (!isbn || isbn.length < 10) return;
    // Solo autocompletar si el título está vacío (no sobreescribir datos ya ingresados)
    if (document.getElementById('inv-titulo').value.trim()) return;

    try {
      const res  = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
      const json = await res.json();
      const data = json[`ISBN:${isbn}`];
      if (!data) { mostrarNotificacion('ISBN no encontrado en Open Library.', 'warning'); return; }

      const titulo = data.title || '';
      const autor  = data.authors?.[0]?.name || '';
      const anio   = data.publish_date?.match(/\d{4}/)?.[0] || '';
      const editorial = data.publishers?.[0]?.name || '';
      const paginas   = data.number_of_pages || '';

      if (titulo)    document.getElementById('inv-titulo').value    = titulo;
      if (editorial) document.getElementById('inv-editorial').value = editorial;
      if (anio)      document.getElementById('inv-anio').value      = anio;
      if (paginas)   document.getElementById('inv-paginas').value   = paginas;
      if (autor) {
        document.getElementById('inv-autor').value = autor.trim();
      }

      mostrarNotificacion(`✓ Datos cargados desde Open Library para ISBN ${isbn}.`, 'success');
    } catch (err) {
      console.error('Error Open Library:', err);
      mostrarNotificacion('No se pudo consultar Open Library.', 'warning');
    }
  });
});

const ANIO_MAX = new Date().getFullYear();

function validarCamposLibro(titulo, autorCompleto, editorial, edicion, anio, paginas, esEdicion = false) {
  if (!titulo || !autorCompleto || !editorial || !edicion || !anio) {
    mostrarNotificacion('Completá Título, Autor, Editorial, Edición y Año.', 'warning');
    return false;
  }
  const anioNum = parseInt(anio);
  if (isNaN(anioNum) || anioNum < 1000 || anioNum > ANIO_MAX) {
    mostrarNotificacion(`El año debe estar entre 1000 y ${ANIO_MAX}.`, 'warning');
    return false;
  }
  // Páginas obligatorio
  if (!paginas || paginas === '') {
    mostrarNotificacion('El campo Páginas es obligatorio.', 'warning');
    return false;
  }
  const paginasNum = parseInt(paginas);
  if (isNaN(paginasNum) || paginasNum < 1) {
    mostrarNotificacion('El número de páginas debe ser mayor a 0.', 'warning');
    return false;
  }
  return true;
}

async function procesarGuardadoLibro() {
  const alertBox = document.getElementById('inv-alert');
  alertBox.style.display = 'none';

  const titulo          = document.getElementById('inv-titulo').value.trim();
  const autorCompleto   = document.getElementById('inv-autor').value.trim();
  const categoriaNombre = document.getElementById('inv-cat').value;
  const isbn            = document.getElementById('inv-isbn').value.trim();
  const editorial       = document.getElementById('inv-editorial').value.trim();
  const edicion         = document.getElementById('inv-edicion').value.trim();
  const anio            = document.getElementById('inv-anio').value.trim();
  const paginas         = document.getElementById('inv-paginas').value.trim();
  const urlDrive        = document.getElementById('inv-url').value.trim();
  const palabrasClave   = document.getElementById('inv-keywords').value.trim();

  const inputsInv = document.querySelectorAll('.clase-isbn-dinamica');
  const listaInv  = Array.from(inputsInv).map(i => i.value.trim()).filter(Boolean);

  // Validaciones
  if (!validarCamposLibro(titulo, autorCompleto, editorial, edicion, anio, paginas)) return;
  // Permitir 0 ejemplares si hay link digital; solo validar si hay filas
  if (listaInv.length > 0 && listaInv.length !== inputsInv.length) {
    mostrarNotificacion('Ingresá el N° de Inventario para todos los ejemplares.', 'warning');
    return;
  }

  // Validación digital vs físico: debe haber al menos uno
  if (!urlDrive && listaInv.length === 0) {
    mostrarNotificacion('⚠ El libro debe tener un link digital O al menos un ejemplar físico registrado.', 'warning');
    return;
  }

  // Validar que ningún Nº inventario ya exista en la BD
  const { data: nrosExistentes, error: errNros } = await supabaseClient
    .from('stock')
    .select('nro_inventario')
    .in('nro_inventario', listaInv);

  if (errNros) {
    mostrarNotificacion('Error al verificar números de inventario.', 'error');
    console.error(errNros);
    return;
  }
  if (nrosExistentes?.length) {
    const duplicados = nrosExistentes.map(r => r.nro_inventario).join(', ');
    mostrarNotificacion(`Número(s) de inventario ya registrado(s): ${duplicados}`, 'error');
    return;
  }

  const nombreAutor = capitalize(autorCompleto);

  try {
    const hiddenId = parseInt(document.getElementById('inv-autor-id').value);
    const idAutor  = hiddenId || await resolverAutor(nombreAutor);

    let { data: categoria } = await supabaseClient
      .from('categorias').select('id').eq('nombre', categoriaNombre).maybeSingle();

    if (!categoria) {
      const { data: nuevaCat, error: errC } = await supabaseClient
        .from('categorias').insert([{ nombre: categoriaNombre }]).select().single();
      if (errC) throw errC;
      categoria = nuevaCat;
    }

    const { data: libro, error: errL } = await supabaseClient
      .from('libros')
      .insert([{
        titulo,
        id_autor:         idAutor,
        id_categoria:     categoria.id,
        isbn:             isbn      || null,
        editorial:        editorial || null,
        edicion:          edicion   || null,
        anio_publicacion: anio      ? parseInt(anio) : null,
        paginas:          paginas   ? parseInt(paginas) : null,
        url_drive:        urlDrive  || null,
        palabras_clave:   palabrasClave || null,
      }])
      .select().single();

    if (errL) throw errL;

    const registrosStock = listaInv.map(nro => ({ id_libro: libro.id, nro_inventario: nro }));
    const { error: errS } = await supabaseClient.from('stock').insert(registrosStock);
    if (errS) throw errS;

    mostrarNotificacion(`"${titulo}" agregado con ${listaInv.length} ejemplar(es).`, 'success');
    alertBox.textContent = `"${titulo}" agregado con éxito (${listaInv.length} ejemplar(es) físico(s)).`;
    alertBox.style.display = 'block';
    setTimeout(() => alertBox.style.display = 'none', 3500);

    ['inv-titulo','inv-autor','inv-isbn','inv-editorial','inv-edicion','inv-anio','inv-paginas','inv-url','inv-keywords']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('inv-autor-id').value = '';
    document.getElementById('inv-stock').value = 1;
    generarCamposISBN();

    await cargarInventario();
    renderInventario();
    populateLibroSelect();
    if (typeof renderStats === 'function') renderStats();

  } catch (error) {
    console.error(error);
    mostrarNotificacion('Error al guardar: ' + error.message, 'error');
  }
}

function showInvAlert(msg, ok) {
  const el = document.getElementById('inv-alert');
  el.textContent = msg;
  el.className = 'alert ' + (ok ? 'alert-success' : 'alert-error');
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 3000);
}

async function eliminarLibro(id) {
  const libro = libros.find(x => x.id === id);
  const titulo = libro ? `"${libro.titulo}"` : 'este libro';

  // 1. Recopilar los IDs de stock de este libro
  const stockIds = (libro?.stockItems || []).map(s => s.id);

  // 2. Si tiene ejemplares en stock, verificar si alguno tiene préstamo activo/pendiente
  if (stockIds.length > 0) {
    const { data: prestamosActivos, error: errCheck } = await supabaseClient
      .from('prestamos')
      .select('id')
      .in('id_stock', stockIds)
      .in('estado', ['activo', 'pendiente'])
      .limit(1);

    if (errCheck) {
      mostrarNotificacion('Error al verificar préstamos del libro.', 'error');
      console.error(errCheck);
      return;
    }

    if (prestamosActivos.length > 0) {
      mostrarNotificacion(
        `No se puede eliminar ${titulo}: tiene ejemplares prestados pendientes de devolución.`,
        'warning'
      );
      return;
    }
  }

  // 3. Sin préstamos activos: confirmar y borrar
  if (!window.confirm(`¿Eliminar ${titulo} del inventario? Esta acción no se puede deshacer.`)) return;

  const { error } = await supabaseClient.from('libros').delete().eq('id', id);

  if (error) {
    // FK por préstamos históricos (devueltos): el libro tiene historial pero no activos
    if (error.code === '23503') {
      mostrarNotificacion(
        `No se puede eliminar ${titulo}: tiene historial de préstamos registrado.`,
        'warning'
      );
    } else {
      mostrarNotificacion('Error al eliminar el libro: ' + error.message, 'error');
    }
    console.error(error);
    return;
  }

  libros = libros.filter(l => l.id !== id);
  mostrarNotificacion(`${titulo} eliminado del inventario.`, 'success');
  renderInventario();
  populateLibroSelect();
}

function abrirEdicion(id) {
  const l = libros.find(x => x.id === id);
  if (!l) return;
  document.getElementById('edit-id').value                = id;
  document.getElementById('edit-titulo').value            = l.titulo;
  document.getElementById('edit-autor').value             = l.autor;
  document.getElementById('edit-autor-id').value          = l.id_autor || '';
  document.getElementById('edit-cat').value               = l.categoria;
  document.getElementById('edit-isbn').value              = l.isbn;
  document.getElementById('edit-editorial').value         = l.editorial;
  document.getElementById('edit-edicion').value           = l.edicion;
  document.getElementById('edit-anio').value              = l.anio_publicacion;
  document.getElementById('edit-paginas').value           = l.paginas;
  document.getElementById('edit-url').value               = l.url_drive;
  document.getElementById('edit-keywords').value          = l.palabras_clave;
  document.getElementById('modal-edit').style.display     = 'flex';
}

async function guardarEdicion() {
  const id    = parseInt(document.getElementById('edit-id').value);
  const libro = libros.find(x => x.id === id);
  if (!libro) return;

  const titulo          = document.getElementById('edit-titulo').value.trim()    || libro.titulo;
  const autorCompleto   = capitalize(document.getElementById('edit-autor').value.trim()) || libro.autor;
  const categoriaNombre = document.getElementById('edit-cat').value              || libro.categoria;
  const isbn            = document.getElementById('edit-isbn').value.trim();
  const editorial       = document.getElementById('edit-editorial').value.trim();
  const edicion         = document.getElementById('edit-edicion').value.trim();
  const anio            = document.getElementById('edit-anio').value.trim();
  const paginas         = document.getElementById('edit-paginas').value.trim();
  const urlDrive        = document.getElementById('edit-url').value.trim();
  const palabrasClave   = document.getElementById('edit-keywords').value.trim();

  if (!validarCamposLibro(titulo, autorCompleto, editorial, edicion, anio, paginas, true)) return;

  try {
    const hiddenId = parseInt(document.getElementById('edit-autor-id').value);
    const idAutor  = hiddenId || await resolverAutor(autorCompleto);

    let { data: categoria } = await supabaseClient
      .from('categorias').select('id').eq('nombre', categoriaNombre).maybeSingle();

    if (!categoria) {
      const { data: nuevaCat, error: errC } = await supabaseClient
        .from('categorias').insert([{ nombre: categoriaNombre }]).select().single();
      if (errC) throw errC;
      categoria = nuevaCat;
    }

    const { error: errUpdate } = await supabaseClient
      .from('libros')
      .update({
        titulo,
        id_autor:         idAutor,
        id_categoria:     categoria.id,
        isbn:             isbn      || null,
        editorial:        editorial || null,
        edicion:          edicion   || null,
        anio_publicacion: anio      ? parseInt(anio) : null,
        paginas:          paginas   ? parseInt(paginas) : null,
        url_drive:        urlDrive  || null,
        palabras_clave:   palabrasClave || null,
      })
      .eq('id', id);

    if (errUpdate) throw errUpdate;

    mostrarNotificacion('Libro actualizado correctamente.', 'success');
    await cargarInventario();
    renderInventario();
    populateLibroSelect();
    document.getElementById('modal-edit').style.display = 'none';
  } catch (error) {
    console.error(error);
    mostrarNotificacion('Error al actualizar el libro: ' + error.message, 'error');
  }
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-edit'))
    document.getElementById('modal-edit').style.display = 'none';
}

async function eliminarEjemplar(stockId, nroInventario, libroId) {
  if (!window.confirm(`¿Eliminar el ejemplar "${nroInventario}"? Esta acción no se puede deshacer.`)) return;

  // Verificar que no tenga préstamo activo o pendiente
  const { data: prestamo, error: errCheck } = await supabaseClient
    .from('prestamos')
    .select('id')
    .eq('id_stock', stockId)
    .in('estado', ['activo', 'pendiente'])
    .limit(1)
    .maybeSingle();

  if (errCheck) {
    mostrarNotificacion('Error al verificar el ejemplar.', 'error');
    console.error(errCheck);
    return;
  }
  if (prestamo) {
    mostrarNotificacion(`No se puede eliminar "${nroInventario}": tiene un préstamo activo.`, 'error');
    return;
  }

  const { error } = await supabaseClient.from('stock').delete().eq('id', stockId);
  if (error) {
    if (error.code === '23503') {
      mostrarNotificacion(`No se puede eliminar "${nroInventario}": tiene historial de préstamos.`, 'warning');
    } else {
      mostrarNotificacion('Error al eliminar el ejemplar: ' + error.message, 'error');
    }
    console.error(error);
    return;
  }

  // Actualizar cache local sin recargar todo el inventario
  const libro = libros.find(l => l.id === libroId);
  if (libro) {
    libro.stockItems    = libro.stockItems.filter(s => s.id !== stockId);
    libro.nrosInventario = libro.nrosInventario.filter(n => String(n) !== nroInventario);
    libro.stock         = libro.stockItems.length;
  }

  mostrarNotificacion(`Ejemplar "${nroInventario}" eliminado.`, 'success');
  renderInventario();
  populateLibroSelect();
}
