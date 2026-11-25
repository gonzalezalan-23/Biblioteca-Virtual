/* ============================================================
   PRÉSTAMOS
   ============================================================ */
let prestamos = [];
let cursos = [];

async function cargarCursos() {
  const { data, error } = await supabaseClient
    .from('cursos')
    .select('id,nombre,division')
    .order('nombre', { ascending: true })
    .order('division', { ascending: true });

  if (error) {
    console.error('Error al cargar cursos:', error.message);
    return;
  }

  cursos = data || [];
  const sel = document.getElementById('f-curso');
  if (!sel) return;
  sel.innerHTML =
    '<option value="">Seleccioná curso</option>' +
    cursos.map(c => `<option value="${c.nombre}|${c.division}">${c.nombre}° ${c.division}</option>`).join('') +
    '<option disabled>──────────</option>' +
    '<option value="Docente|—">Docente</option>';
}

async function obtenerOCrearCurso(ano, division) {
  if (!ano) return null;

  // Caso especial: docente (sin división)
  const esDocente = ano === 'Docente';
  const query = supabaseClient.from('cursos').select('id').eq('nombre', ano);
  if (!esDocente) query.eq('division', division);

  const { data: cursoExistente, error } = await query.maybeSingle();
  if (error) throw error;
  if (cursoExistente) return cursoExistente.id;

  const registro = esDocente ? { nombre: ano, division: '—' } : { nombre: ano, division };
  const { data: cursoCreado, error: errorCursoCreado } = await supabaseClient
    .from('cursos')
    .insert([registro])
    .select()
    .single();

  if (errorCursoCreado) throw errorCursoCreado;
  return cursoCreado.id;
}

async function obtenerOCrearUsuario({ nombre, apellido, dni, email, telefono, direccion, id_curso, anio_actual }) {
  // Si el autofill ya encontró al usuario, usamos su id directamente
  if (_usuarioEnFormulario && String(_usuarioEnFormulario.dni) === String(dni)) {
    const id = _usuarioEnFormulario.id;
    await sincronizarUsuarioSiCambio(id, { nombre, apellido, email, telefono, direccion, id_curso });
    return id;
  }

  const { data: existente, error } = await supabaseClient
    .from('usuarios')
    .select('id')
    .eq('dni', dni)
    .maybeSingle();

  if (error) throw error;

  if (existente) {
    await sincronizarUsuarioSiCambio(existente.id, { nombre, apellido, email, telefono, direccion, id_curso });
    return existente.id;
  }

  const { data: creado, error: errorCrear } = await supabaseClient
    .from('usuarios')
    .insert([{ nombre, apellido, dni, email, telefono, direccion, id_curso, 'año_actual': anio_actual }])
    .select('id')
    .single();

  if (errorCrear) throw errorCrear;
  return creado.id;
}

async function cargarPrestamos() {
  const [{ data: prestamosData, error: errorPrestamos },
         { data: usuariosData, error: errorUsuarios },
         { data: cursosData, error: errorCursos },
         { data: librosData, error: errorLibros },
         { data: stockData, error: errorStock }] = await Promise.all([
    supabaseClient.from('prestamos').select('id,id_stock,id_usuario,fecha_prestamo,fecha_devolucion,estado').order('fecha_prestamo', { ascending: false }),
    supabaseClient.from('usuarios').select('id,nombre,apellido,dni,email,telefono,direccion,id_curso,año_actual'),
    supabaseClient.from('cursos').select('id,nombre,division'),
    supabaseClient.from('libros').select('id,titulo'),
    supabaseClient.from('stock').select('id,id_libro,nro_inventario'),
  ]);

  if (errorPrestamos) {
    console.error('Error al cargar préstamos:', errorPrestamos.message);
    return;
  }
  if (errorUsuarios) {
    console.error('Error al cargar usuarios:', errorUsuarios.message);
    return;
  }
  if (errorCursos) {
    console.error('Error al cargar cursos:', errorCursos.message);
    return;
  }
  if (errorLibros) {
    console.error('Error al cargar libros para préstamos:', errorLibros.message);
    return;
  }

  const usuariosMap = (usuariosData || []).reduce((acc, usuario) => {
    acc[usuario.id] = usuario;
    return acc;
  }, {});

  const cursosMap = (cursosData || []).reduce((acc, curso) => {
    acc[curso.id] = curso;
    return acc;
  }, {});

  const librosMap = (librosData || []).reduce((acc, libro) => {
    acc[libro.id] = libro;
    return acc;
  }, {});
  const stockMap = (stockData || []).reduce((acc, stock) => {
    acc[stock.id] = stock;
    return acc;
  }, {});

  prestamos = (prestamosData || []).map(item => {
    const usuario = usuariosMap[item.id_usuario] || {};
    const curso = usuario.id_curso ? cursosMap[usuario.id_curso] : null;
    const stock = item.id_stock ? stockMap[item.id_stock] : null;
    const libro = stock ? librosMap[stock.id_libro] : null;

    // Detección automática de vencidos
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const vencido = item.estado === 'activo'
      && item.fecha_devolucion
      && new Date(item.fecha_devolucion + 'T00:00:00') < hoy;
    const estadoFinal = vencido ? 'vencido' : item.estado;

    return {
      id: item.id,
      idLote: item.id_lote,
      cantidad: Number(item.cantidad_lote) || 1,
      observaciones: item.observaciones || '',
      nombre: usuario.nombre ? `${usuario.nombre} ${usuario.apellido}` : 'Usuario desconocido',
      dni: usuario.dni || '—',
      curso: curso ? `${curso.nombre} ${curso.division}` : '—',
      email: usuario.email || '—',
      tel: usuario.telefono || '',
      domicilio: usuario.direccion || '',
      libro: libro ? libro.titulo : 'Libro eliminado',
      isbn: stock ? stock.nro_inventario : '—',
      libroId: libro ? libro.id : null,
      stockId: item.id_stock,
      fechaPrestamo: item.fecha_prestamo,
      fechaDevolucion: item.fecha_devolucion,
      estado: estadoFinal,
      cursoClase: _extraerMateriaLote(item.observaciones),
    };
  });
}

function normalizarTexto(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function _extraerMateriaLote(observaciones) {
  const match = String(observaciones ?? '').match(/Lote para clase:\s*(.*?)\s+—\s+\d+\s+ejemplares/i);
  return match?.[1]?.trim() ?? '';
}

function _agruparPrestamosLote(lista) {
  const grupos = new Map();
  lista.forEach(prestamo => {
    const clave = prestamo.idLote
      ? `lote:${prestamo.idLote}:${prestamo.estado}`
      : `prestamo:${prestamo.id}`;
    const grupo = grupos.get(clave);
    if (grupo) grupo.cantidadFilas++;
    else grupos.set(clave, { ...prestamo, cantidadFilas: 1 });
  });
  return [...grupos.values()].map(grupo => ({
    ...grupo,
    cantidad: grupo.idLote ? Math.max(Number(grupo.cantidad) || 0, grupo.cantidadFilas) : 1,
  }));
}

function renderLoans() {
  const q      = normalizarTexto(document.getElementById('loan-search').value);
  const filtro = document.getElementById('loan-filter').value;
  const orden  = document.getElementById('loan-sort').value;
  const fecha  = document.getElementById('loan-fecha-filter')?.value ?? '';

  let lista = prestamos.filter(p => {
    const haystack = normalizarTexto(`${p.nombre} ${p.libro} ${p.dni} ${p.cursoClase || ''}`);
    const matchQ     = haystack.includes(q);
    const matchF     = filtro === 'todos'
      ? true
      : filtro === 'pendientes'
        ? p.estado !== 'devuelto' && p.estado !== 'rechazado'
        : p.estado === filtro;
    const matchFecha = !fecha || p.fechaDevolucion === fecha;
    return matchQ && matchF && matchFecha;
  });

  lista = _agruparPrestamosLote(lista);

  // Orden por defecto "Prioridad": primero los que faltan aprobar
  // (estado 'pendiente'), después los vencidos, y recién al final el resto.
  // Dentro de cada grupo siguen las opciones de fecha del select.
  if (orden === 'prioridad') {
    const prioridad = p =>
      p.estado === 'pendiente' ? 0 :
      p.estado === 'vencido'    ? 1 : 2;
    lista.sort((a, b) => {
      const d = prioridad(a) - prioridad(b);
      return d !== 0 ? d
        : (b.fechaPrestamo || '').localeCompare(a.fechaPrestamo || '');
    });
  }
  else if (orden === 'fecha-desc') lista.sort((a,b) => (b.fechaPrestamo || '').localeCompare(a.fechaPrestamo || ''));
  else if (orden === 'fecha-asc') lista.sort((a,b) => (a.fechaPrestamo || '').localeCompare(b.fechaPrestamo || ''));
  else lista.sort((a,b) => a.nombre.localeCompare(b.nombre));

  const container = document.getElementById('loan-list');
  const empty = document.getElementById('loan-empty');
  container.innerHTML = '';

  empty.style.display = lista.length ? 'none' : 'block';
  if (!lista.length) return;

  // Botón recordatorios: mostrar solo si hay préstamos activos/vencidos con email
  const conEmail = lista.filter(p => p.estado !== 'devuelto' && p.email && p.email !== '—');
  const btnRecordatorio = document.getElementById('btn-recordatorios');
  if (btnRecordatorio) btnRecordatorio.style.display = conEmail.length ? 'inline-flex' : 'none';

  lista.forEach(p => {
    const initials = p.nombre.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  const estadoMap = { pendiente: ['badge-yellow','Pendiente'], activo: ['badge-green','Activo'], vencido: ['badge-red','Vencido'], devuelto: ['badge-blue','Devuelto'], rechazado: ['badge-gray','Rechazado'] };
    const [badgeClass, badgeText] = estadoMap[p.estado] || ['badge-gray', p.estado];

    const div = document.createElement('div');
    div.className = 'loan-card';

    const avatarDiv = document.createElement('div'); avatarDiv.className = 'loan-avatar'; avatarDiv.textContent = initials;
    const infoDiv = document.createElement('div'); infoDiv.className = 'loan-info';
    const nameDiv = document.createElement('div'); nameDiv.className = 'loan-name';
    nameDiv.textContent = p.nombre + ' · ';
    const dniSpan = document.createElement('span'); dniSpan.style.cssText = 'font-weight:400;color:var(--muted);'; dniSpan.textContent = 'DNI ' + p.dni;
    nameDiv.appendChild(dniSpan);
    const metaDiv = document.createElement('div'); metaDiv.className = 'loan-meta';
    const identificador = p.idLote || p.cursoClase
      ? `${p.cantidad} ejemplar${p.cantidad === 1 ? '' : 'es'} · Profesor de ${p.cursoClase || p.curso}`
      : `${p.isbn && p.isbn !== '—' ? p.isbn + ' · ' : ''}${p.curso}`;
    metaDiv.textContent = `📗 ${p.libro} · ${identificador} · Vence: ${formatDate(p.fechaDevolucion)}`;
    infoDiv.append(nameDiv, metaDiv);

    const actionsDiv = document.createElement('div'); actionsDiv.className = 'loan-actions';
    const badge = document.createElement('span'); badge.className = `badge ${badgeClass}`; badge.textContent = badgeText;
    actionsDiv.appendChild(badge);

    if (p.estado === 'pendiente') {
      const btnAprobar = document.createElement('button');
      btnAprobar.className = 'btn btn-success';
      btnAprobar.textContent = '✔ Aprobar';
      btnAprobar.addEventListener('click', () => aprobarSolicitud(p.id));
      const btnRechazar = document.createElement('button');
      btnRechazar.className = 'btn btn-danger';
      btnRechazar.textContent = '✕ Rechazar';
      btnRechazar.addEventListener('click', () => rechazarSolicitud(p.id));
      actionsDiv.append(btnAprobar, btnRechazar);
    } else if (p.estado === 'devuelto') {
      const btnReactivar = document.createElement('button');
      btnReactivar.className = 'btn btn-ghost';
      btnReactivar.style.cssText = 'font-size:.8rem;padding:.35rem .7rem;';
      btnReactivar.textContent = '↺ Reactivar';
      btnReactivar.title = 'Deshacer devolución por error';
      btnReactivar.addEventListener('click', () => p.idLote ? reactivarLote(p.idLote) : reactivarPrestamo(p.id));
      actionsDiv.appendChild(btnReactivar);
    } else {
      const btn = document.createElement('button'); btn.className = 'btn btn-success'; btn.textContent = p.idLote ? `✔ Devolver lote (${p.cantidad})` : '✔ Devuelto';
      btn.addEventListener('click', () => p.idLote ? marcarLoteDevuelto(p.idLote, p.cantidad) : marcarDevuelto(p.id));
      actionsDiv.appendChild(btn);
    }

    // Botón ✔ Editar — visible para todos los estados excepto rechazado
    if (p.estado !== 'rechazado') {
      const btnEditar = document.createElement('button');
      btnEditar.className = 'btn btn-ghost';
      btnEditar.style.cssText = 'font-size:.8rem;padding:.35rem .7rem;';
      btnEditar.textContent = '✏';
      btnEditar.title = 'Editar préstamo';
      btnEditar.addEventListener('click', () => abrirEdicionPrestamo(p.id));
      actionsDiv.appendChild(btnEditar);
    }

    // Botón individual de recordatorio (visible si tiene email y no está cerrado)
    if (p.email && p.email !== '—' && p.estado !== 'devuelto' && p.estado !== 'rechazado') {
      const btnCorreo = document.createElement('button');
      btnCorreo.className = 'btn btn-ghost';
      btnCorreo.style.cssText = 'font-size:.8rem;padding:.35rem .6rem;';
      btnCorreo.textContent = '📧';
      btnCorreo.title = `Enviar recordatorio a ${p.nombre}`;
      btnCorreo.addEventListener('click', async () => {
        btnCorreo.disabled = true;
        btnCorreo.textContent = '⏳';
        const tituloCorreo = p.idLote ? `${p.libro} (${p.cantidad} ejemplares)` : p.libro;
        const ok = await enviarCorreoIndividual(p.email, p.nombre, tituloCorreo, p.fechaDevolucion);
        btnCorreo.disabled = false;
        btnCorreo.textContent = '📧';
        if (ok) mostrarNotificacion(`Recordatorio enviado a ${p.nombre}.`, 'success');
      });
      actionsDiv.appendChild(btnCorreo);
    }

    // Resaltar visualmente los vencidos
    if (p.estado === 'vencido') {
      div.style.borderColor = '#fca5a5';
      div.style.background  = '#fff7f7';
    }

    div.append(avatarDiv, infoDiv, actionsDiv);
    container.appendChild(div);
  });
}

// Días por defecto para el vencimiento de un préstamo
const DIAS_PRESTAMO = 14;

function calcularFechaDevolucion(diasDesdeHoy = DIAS_PRESTAMO) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + diasDesdeHoy);
  return fecha.toISOString().split('T')[0];
}

async function reactivarPrestamo(id) {
  const prestamo = prestamos.find(p => p.id === id);
  if (!prestamo) return;

  if (!window.confirm('¿Reactivar este préstamo? El ejemplar volverá a figurar como prestado.')) return;

  // Verificar que el ejemplar físico no esté activo en otro préstamo
  const { data: conflicto, error: errCheck } = await supabaseClient
    .from('prestamos')
    .select('id')
    .eq('id_stock', prestamo.stockId)
    .in('estado', ['activo', 'pendiente'])
    .neq('id', id)
    .limit(1)
    .maybeSingle();

  if (errCheck) {
    mostrarNotificacion('Error al verificar disponibilidad del ejemplar.', 'error');
    console.error(errCheck);
    return;
  }

  if (conflicto) {
    mostrarNotificacion(
      'No se puede reactivar: el ejemplar físico ya está asignado a otro préstamo activo.',
      'error'
    );
    return;
  }

  const nuevaDevolucion = calcularFechaDevolucion();
  const { error } = await supabaseClient
    .from('prestamos')
    .update({ estado: 'activo', fecha_devolucion: nuevaDevolucion })
    .eq('id', id);

  if (error) {
    mostrarNotificacion('Error al reactivar el préstamo: ' + error.message, 'error');
    console.error(error);
    return;
  }

  await cargarPrestamos();
  renderLoans();
  if (typeof renderStats === 'function') renderStats();
  mostrarNotificacion('Préstamo reactivado correctamente.', 'success');
}

function abrirEdicionPrestamo(id) {
  const p = prestamos.find(x => x.id === id);
  if (!p) return;

  document.getElementById('ep-id').value          = id;
  document.getElementById('ep-alumno').value      = p.idLote
    ? `${p.nombre} · Profesor/a de ${p.cursoClase || p.curso} (${p.cantidad} ejemplares)`
    : p.nombre;
  document.getElementById('ep-libro').value       = p.libro;
  document.getElementById('ep-ejemplar').value    = p.idLote
    ? `${p.cantidad} ejemplares del lote`
    : (p.isbn !== '—' ? p.isbn : '—');
  document.getElementById('ep-fecha-inicio').value = p.fechaPrestamo   || '';
  document.getElementById('ep-fecha-venc').value  = p.fechaDevolucion  || '';
  // El estado real en BD puede ser 'activo' aunque en memoria figure 'vencido'
  const estadoBD = p.estado === 'vencido' ? 'activo' : p.estado;
  document.getElementById('ep-estado').value      = estadoBD;

  document.getElementById('modal-edit-prestamo').classList.remove('hidden');
}

async function guardarEdicionPrestamo() {
  const id           = parseInt(document.getElementById('ep-id').value);
  const prestamoEditado = prestamos.find(p => p.id === id);
  const fechaInicio  = document.getElementById('ep-fecha-inicio').value;
  const fechaVenc    = document.getElementById('ep-fecha-venc').value;
  const estado       = document.getElementById('ep-estado').value;

  if (!fechaInicio || !fechaVenc) {
    mostrarNotificacion('Completá ambas fechas.', 'warning');
    return;
  }
  if (fechaVenc < fechaInicio) {
    mostrarNotificacion('La fecha de vencimiento no puede ser anterior a la de inicio.', 'warning');
    return;
  }
  if (prestamoEditado?.idLote && fechaVenc !== fechaInicio) {
    mostrarNotificacion('Los préstamos por lote para clase deben devolverse el mismo día.', 'warning');
    return;
  }

  let query = supabaseClient.from('prestamos').update({
      fecha_prestamo:   fechaInicio,
      fecha_devolucion: fechaVenc,
      estado,
    });
  query = prestamoEditado?.idLote
    ? query.eq('id_lote', prestamoEditado.idLote)
    : query.eq('id', id);
  const { error } = await query;

  if (error) {
    mostrarNotificacion('Error al guardar cambios: ' + error.message, 'error');
    console.error(error);
    return;
  }

  document.getElementById('modal-edit-prestamo').classList.add('hidden');
  await cargarPrestamos();
  renderLoans();
  if (typeof renderStats === 'function') renderStats();
  mostrarNotificacion('Préstamo actualizado correctamente.', 'success');
}

function cerrarModalPrestamo(e) {
  if (e.target === document.getElementById('modal-edit-prestamo'))
    document.getElementById('modal-edit-prestamo').classList.add('hidden');
}

async function marcarDevuelto(id) {
  const { error } = await supabaseClient
    .from('prestamos')
    .update({ estado: 'devuelto' })
    .eq('id', id);

  if (error) {
    mostrarNotificacion('Error al marcar el préstamo como devuelto: ' + error.message, 'error');
    console.error(error);
    return;
  }

  await cargarPrestamos();
  renderLoans();
  if (typeof renderStats === 'function') renderStats();
  mostrarNotificacion('Préstamo marcado como devuelto.', 'success');
}

async function marcarLoteDevuelto(idLote, cantidad) {
  if (!window.confirm(`¿Registrar la devolución de los ${cantidad} ejemplares del lote?`)) return;
  const { error } = await supabaseClient
    .from('prestamos')
    .update({ estado: 'devuelto' })
    .eq('id_lote', idLote)
    .in('estado', ['activo', 'vencido']);
  if (error) {
    mostrarNotificacion('Error al registrar la devolución del lote: ' + error.message, 'error');
    return;
  }
  await cargarPrestamos();
  renderLoans();
  if (typeof renderStats === 'function') renderStats();
  mostrarNotificacion('Devolución del lote registrada.', 'success');
}

async function reactivarLote(idLote) {
  const items = prestamos.filter(p => p.idLote === idLote);
  const stockIds = items.map(p => p.stockId).filter(Boolean);
  if (!items.length || !window.confirm(`¿Reactivar el lote completo de ${items.length} ejemplares?`)) return;
  const { data: conflictos, error: errCheck } = await supabaseClient
    .from('prestamos')
    .select('id_stock')
    .in('id_stock', stockIds)
    .in('estado', ['pendiente', 'activo', 'vencido']);
  if (errCheck || conflictos?.length) {
    mostrarNotificacion(errCheck ? 'No se pudo verificar el inventario.' : 'Uno o más ejemplares ya están prestados.', 'error');
    return;
  }
  const hoy = new Date().toISOString().slice(0, 10);
  const { error } = await supabaseClient
    .from('prestamos')
    .update({ estado: 'activo', fecha_devolucion: hoy })
    .eq('id_lote', idLote)
    .eq('estado', 'devuelto');
  if (error) { mostrarNotificacion('Error al reactivar el lote: ' + error.message, 'error'); return; }
  await cargarPrestamos();
  renderLoans();
  if (typeof renderStats === 'function') renderStats();
  mostrarNotificacion('Lote reactivado con devolución prevista para hoy.', 'success');
}

function formatDate(str) {
  if (!str) return '—';
  const [y,m,d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function esFechaPasada(valorFecha) {
  if (!valorFecha) return false;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const ingresada = new Date(valorFecha + 'T00:00:00');
  return ingresada < hoy;
}

/* ============================================================
   ALTA PRÉSTAMO
   ============================================================ */
let filaPrestamoCount = 0;

function cargarEjemplaresEnFila(fila, bookId, selIsbn) {
  selIsbn.innerHTML = '<option value="">Seleccioná ejemplar</option>';
  if (!bookId) return;
  const book = libros.find(b => b.id === bookId);
  if (!book || !book.stockItems.length) {
    selIsbn.innerHTML = '<option value="">Sin ejemplares</option>'; return;
  }
  const prestadosIds = prestamos.filter(p => p.estado !== 'devuelto').map(p => p.stockId);
  const seleccionadosEnForm = Array.from(document.querySelectorAll('.fila-prestamo'))
    .filter(f => f !== fila)
    .map(f => parseInt(f.querySelector('select').value))
    .filter(Boolean);
  const disponibles = book.stockItems.filter(item =>
    !prestadosIds.includes(item.id) && !seleccionadosEnForm.includes(item.id)
  );
  if (!disponibles.length) {
    selIsbn.innerHTML = '<option value="">Sin ejemplares disponibles</option>'; return;
  }
  disponibles.forEach(item => {
    const o = document.createElement('option'); o.value = item.id; o.textContent = item.nro_inventario;
    selIsbn.appendChild(o);
  });
}

function agregarFilaPrestamo() {
  const contenedor = document.getElementById('filas-prestamo');

  const fila = document.createElement('div');
  fila.className = 'fila-prestamo';
  fila.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:.75rem;align-items:end;background:var(--bg);border-radius:10px;padding:.75rem;';

  // — Libro: input predictivo —
  const divLibro = document.createElement('div'); divLibro.style.position = 'relative';
  const lblLibro = document.createElement('label'); lblLibro.className = 'form-label'; lblLibro.textContent = 'Libro *';
  const inputLibro = document.createElement('input');
  inputLibro.className = 'form-input';
  inputLibro.placeholder = 'Buscar libro…';
  inputLibro.autocomplete = 'off';
  // Campo oculto que guarda el id del libro seleccionado
  const hiddenLibroId = document.createElement('input'); hiddenLibroId.type = 'hidden'; hiddenLibroId.value = '';
  const dropdown = document.createElement('div');
  dropdown.style.cssText = 'display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.1);z-index:100;max-height:200px;overflow-y:auto;';
  divLibro.append(lblLibro, inputLibro, hiddenLibroId, dropdown);

  const divIsbn = document.createElement('div');
  const lblIsbn = document.createElement('label'); lblIsbn.className = 'form-label'; lblIsbn.textContent = 'Ejemplar *';
  const selIsbn = document.createElement('select'); selIsbn.className = 'form-input form-select';
  selIsbn.innerHTML = '<option value="">Primero seleccioná libro</option>';
  divIsbn.append(lblIsbn, selIsbn);

  const divFecha = document.createElement('div');
  const lblFecha = document.createElement('label'); lblFecha.className = 'form-label'; lblFecha.textContent = 'Devolución *';
  const inputFecha = document.createElement('input'); inputFecha.className = 'form-input'; inputFecha.type = 'date';
  inputFecha.value = calcularFechaDevolucion();
  inputFecha.min = new Date().toISOString().split('T')[0];
  inputFecha.addEventListener('change', () => {
    if (esFechaPasada(inputFecha.value)) {
      mostrarNotificacion('⚠ La fecha de devolución no puede ser anterior a hoy.', 'warning');
      inputFecha.value = calcularFechaDevolucion();
      inputFecha.focus();
    }
  });
  divFecha.append(lblFecha, inputFecha);

  const btnEliminar = document.createElement('button');
  btnEliminar.className = 'btn btn-danger'; btnEliminar.textContent = '✕';
  btnEliminar.addEventListener('click', () => {
    if (document.querySelectorAll('.fila-prestamo').length > 1) fila.remove();
  });

  // — Lógica del buscador predictivo —
  function mostrarSugerencias(q) {
    const norm = q.toLowerCase();
    const resultados = libros.filter(l => l.titulo.toLowerCase().includes(norm)).slice(0, 8);
    dropdown.innerHTML = '';
    if (!resultados.length) { dropdown.style.display = 'none'; return; }
    resultados.forEach(l => {
      const item = document.createElement('div');
      item.style.cssText = 'padding:.55rem .9rem;font-size:.88rem;cursor:pointer;color:var(--text);transition:background .15s;';
      const sinStock = l.stock === 0;
      item.textContent = sinStock ? `${l.titulo} — Sin stock` : `${l.titulo} (Stock: ${l.stock})`;
      if (sinStock) item.style.color = 'var(--muted)';
      item.addEventListener('mouseenter', () => { item.style.background = 'var(--brand-light,#dbeafe)'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        if (sinStock) { mostrarNotificacion('Este libro no tiene stock disponible.', 'warning'); return; }
        inputLibro.value = l.titulo;
        hiddenLibroId.value = l.id;
        dropdown.style.display = 'none';
        cargarEjemplaresEnFila(fila, l.id, selIsbn);
      });
      dropdown.appendChild(item);
    });
    dropdown.style.display = 'block';
  }

  inputLibro.addEventListener('input', () => {
    hiddenLibroId.value = '';
    selIsbn.innerHTML = '<option value="">Primero seleccioná libro</option>';
    const q = inputLibro.value.trim();
    if (q.length < 1) { dropdown.style.display = 'none'; return; }
    mostrarSugerencias(q);
  });
  inputLibro.addEventListener('focus', () => {
    if (inputLibro.value.trim().length >= 1) mostrarSugerencias(inputLibro.value.trim());
  });
  document.addEventListener('click', e => {
    if (!divLibro.contains(e.target)) dropdown.style.display = 'none';
  });

  fila.append(divLibro, divIsbn, divFecha, btnEliminar);
  contenedor.appendChild(fila);
}

function populateLibroSelect() {
  if (!document.querySelector('.fila-prestamo')) agregarFilaPrestamo();
}

async function registrarPrestamo() {
  const nombre   = document.getElementById('f-nombre')?.value.trim()   ?? '';
  const apellido = document.getElementById('f-apellido')?.value.trim() ?? '';
  const dni      = document.getElementById('f-dni')?.value.trim()      ?? '';
  const email    = document.getElementById('f-email')?.value.trim()    ?? '';
  const curso    = document.getElementById('f-curso')?.value           ?? '';

  if (!validarCamposPrestamo({ nombre, apellido, dni, email, telefono: document.getElementById('f-tel')?.value.trim() ?? '', curso })) {
    mostrarNotificacion('Corregí los errores marcados en el formulario.', 'warning');
    return;
  }

  const filas = document.querySelectorAll('.fila-prestamo');
  const items = [];
  for (const fila of filas) {
    const hiddenLibroId = fila.querySelector('input[type="hidden"]');
    const selIsbn       = fila.querySelector('select');
    const inputFecha    = fila.querySelector('input[type="date"]');
    const bookId        = parseInt(hiddenLibroId?.value);
    const stockId       = parseInt(selIsbn?.value);
    const devolucion    = inputFecha?.value;
    if (!bookId || !stockId || !devolucion) {
      mostrarNotificacion('Completá libro, ejemplar y fecha en todas las filas.', 'warning');
      return;
    }
    if (esFechaPasada(devolucion)) {
      mostrarNotificacion('⚠ La fecha de devolución no puede ser anterior a hoy.', 'warning');
      inputFecha.value = calcularFechaDevolucion();
      inputFecha.focus();
      return;
    }
    items.push({ stockId, devolucion });
  }

  try {
    const [ano, division] = curso.split('|');
    const idCurso = await obtenerOCrearCurso(ano, division);

    const usuarioId = await obtenerOCrearUsuario({
      nombre:      typeof capitalizarNombre === 'function' ? capitalizarNombre(nombre)   : nombre,
      apellido:    typeof capitalizarNombre === 'function' ? capitalizarNombre(apellido) : apellido,
      dni,
      email,
      telefono:    document.getElementById('f-tel')?.value.trim()  ?? '',
      direccion:   document.getElementById('f-dom')?.value.trim()  ?? '',
      id_curso:    idCurso,
      anio_actual: new Date().getFullYear(),
    });

    const registros = items.map(item => ({
      id_stock: item.stockId,
      fecha_devolucion: item.devolucion || calcularFechaDevolucion(),
    }));

    // Validar stock disponible para cada libro antes de insertar
    for (const fila of document.querySelectorAll('.fila-prestamo')) {
      const bookId = parseInt(fila.querySelector('input[type="hidden"]')?.value);
      if (!bookId) continue;
      const libro = libros.find(l => l.id === bookId);
      const prestadosActivos = prestamos.filter(
        p => p.libroId === bookId && p.estado !== 'devuelto' && p.estado !== 'rechazado'
      ).length;
      const disponible = (libro?.stock ?? 0) - prestadosActivos;
      if (disponible <= 0) {
        mostrarNotificacion('Error: Stock insuficiente para realizar el préstamo', 'error');
        return;
      }
    }

    const { data: cantidadRegistrada, error } = await supabaseClient.rpc('registrar_prestamos_admin', {
      p_id_usuario: usuarioId,
      p_items: registros,
    });
    if (error) throw error;

    mostrarNotificacion(`✅ ${registros.length} préstamo${registros.length > 1 ? 's' : ''} registrado${registros.length > 1 ? 's' : ''} correctamente.`, 'success');
    limpiarFormulario();
    await cargarPrestamos();
    await cargarInventario();
    renderLoans();
    if (typeof renderStats === 'function') renderStats();
    renderInventario();
  } catch (err) {
    console.error(err);
    mostrarNotificacion('Error al registrar el préstamo: ' + err.message, 'error');
  }
}

function limpiarFormulario() {
  ['f-nombre','f-apellido','f-dni','f-tel','f-email','f-dom'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-curso').value = '';
  document.getElementById('filas-prestamo').innerHTML = '';
  filaPrestamoCount = 0;
  _usuarioEnFormulario = null;
  agregarFilaPrestamo();
}

// Guarda el usuario encontrado por DNI para no repetir la búsqueda en registrarPrestamo
let _usuarioEnFormulario = null;

async function buscarUsuarioPorDNI(dni) {
  if (!dni) return null;
  if (typeof usuarios !== 'undefined' && usuarios.length) {
    const u = usuarios.find(x => String(x.dni) === String(dni));
    if (u) return u;
  }
  const { data, error } = await supabaseClient
    .from('usuarios')
    .select('id,nombre,apellido,dni,email,telefono,direccion,año_actual,id_curso')
    .eq('dni', dni)
    .maybeSingle();
  if (error) { console.error('Error buscando usuario por DNI:', error.message); return null; }
  return data || null;
}

async function autofillUsuarioEnFormulario(dni) {
  _usuarioEnFormulario = null;
  const user = await buscarUsuarioPorDNI(dni);
  if (!user) return false;

  _usuarioEnFormulario = user;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  set('f-nombre',   user.nombre   || '');
  set('f-apellido', user.apellido || '');
  set('f-tel',      user.telefono || '');
  set('f-email',    user.email    || '');
  set('f-dom',      user.direccion|| '');

  const cursoSel = document.getElementById('f-curso');
  if (cursoSel && user.id_curso) {
    if (!cursos.length) await cargarCursos();
    const c = cursos.find(c => c.id === user.id_curso);
    if (c) {
      const val = c.nombre === 'Docente' ? 'Docente|—' : `${c.nombre}|${c.division}`;
      // Forzar la opción si todavía no existe en el select (race condition)
      if (!cursoSel.querySelector(`option[value="${val}"]`)) await cargarCursos();
      cursoSel.value = val;
    }
  }

  const anioSel = document.getElementById('f-anio');
  if (anioSel) {
    const año = user['año_actual'] || '';
    if (año) anioSel.value = String(año);
  }

  return true;
}

// Actualiza el usuario en Supabase si los datos del formulario difieren del snapshot original
async function sincronizarUsuarioSiCambio(id, payload) {
  if (!id) return;
  const original = _usuarioEnFormulario;
  const cambio = original && (
    payload.nombre     !== original.nombre     ||
    payload.apellido   !== original.apellido   ||
    payload.email      !== original.email      ||
    payload.telefono   !== original.telefono   ||
    payload.direccion  !== original.direccion  ||
    payload.id_curso   !== original.id_curso
  );
  if (!cambio) return;
  const { error } = await supabaseClient
    .from('usuarios')
    .update(payload)
    .eq('id', id);
  if (error) console.error('Error al sincronizar datos del alumno:', error.message);
  else {
    // Refleja el cambio en el cache local para que la tabla de usuarios no quede desactualizada
    if (typeof usuarios !== 'undefined') {
      const idx = usuarios.findIndex(u => u.id === id);
      if (idx !== -1) usuarios[idx] = { ...usuarios[idx], ...payload };
    }
  }
}

const EMAILJS_SERVICE                = 'service_bytd01h';
const EMAILJS_TEMPLATE_CONFIRMACION  = 'template_confirmacion';
const EMAILJS_TEMPLATE_APROBACION    = 'template_aprobacion';
const EMAILJS_TEMPLATE_RECHAZO       = 'template_rechazo';
const EMAILJS_TEMPLATE_RECORDATORIO  = 'template_899iqtk';
const EMAILJS_KEY                    = '1Uu73DKwGR4ADExX9';

// emailjs se inicializa una sola vez al cargar el módulo
emailjs.init(EMAILJS_KEY);

// ============================================================
//  EMAIL — funciones unificadas
// ============================================================

/**
 * Función unitaria: envía un correo de recordatorio a UN destinatario.
 * Puede llamarse desde un botón individual o desde el bucle masivo.
 */
async function enviarCorreoIndividual(emailUsuario, nombreUsuario, tituloLibro, fechaVencimiento) {
  if (!emailUsuario || emailUsuario === '—') {
    mostrarNotificacion('Este alumno no tiene email registrado.', 'warning');
    return false;
  }

  const diasRestantes = fechaVencimiento
    ? Math.ceil((new Date(fechaVencimiento + 'T00:00:00') - new Date()) / 86400000)
    : null;

  const estadoTexto = diasRestantes === null
    ? 'fecha de devolución no registrada'
    : diasRestantes < 0
      ? `VENCIDO hace ${Math.abs(diasRestantes)} día(s)`
      : `vence en ${diasRestantes} día(s) (${formatDate(fechaVencimiento)})`;

  try {
    await emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE_RECORDATORIO, {
      to_email: emailUsuario,
      to_name:  nombreUsuario,
      libro:    tituloLibro,
      estado:   estadoTexto,
    });
    return true;
  } catch (err) {
    console.error('Error al enviar correo a', emailUsuario, err);
    return false;
  }
}

/** Envío masivo: itera todos los préstamos activos/vencidos con email y llama enviarCorreoIndividual. */
async function enviarRecordatorios() {
  const candidatos = prestamos.filter(p =>
    p.estado !== 'devuelto' && p.estado !== 'rechazado'
    && p.email && p.email !== '—'
    && p.fechaDevolucion
  );

  if (!candidatos.length) {
    mostrarNotificacion('No hay préstamos pendientes con email registrado.', 'warning');
    return;
  }

  let enviados = 0;
  for (const p of candidatos) {
    const ok = await enviarCorreoIndividual(p.email, p.nombre, p.libro, p.fechaDevolucion);
    if (ok) enviados++;
  }

  mostrarNotificacion(`✅ Recordatorios enviados a ${enviados} alumno(s).`, 'success');
}

/** Llamada interna para notificar aprobación / rechazo de solicitud. */
async function enviarEmailEstadoSolicitud(prestamo, tipo) {
  if (!prestamo.email || prestamo.email === '—') return;
  const variables = {
    to_email:         prestamo.email,
    to_name:          prestamo.nombre,
    libro:            prestamo.libro,
    isbn:             prestamo.isbn || '—',
    estado:           tipo === 'aprobacion' ? 'Aprobado' : 'Rechazado',
    fecha_prestamo:   prestamo.fechaPrestamo   ? formatDate(prestamo.fechaPrestamo)   : '—',
    fecha_devolucion: prestamo.fechaDevolucion ? formatDate(prestamo.fechaDevolucion) : '—',
  };
  const templateId = tipo === 'aprobacion' ? EMAILJS_TEMPLATE_APROBACION : EMAILJS_TEMPLATE_RECHAZO;
  try {
    await emailjs.send(EMAILJS_SERVICE, templateId, variables);
  } catch (err) {
    console.error('Error al enviar email de estado:', err);
  }
}

async function aprobarSolicitud(id) {
  const prestamo = prestamos.find(p => p.id === id);

  // Verificar stock físico disponible antes de aprobar
  if (prestamo?.libroId) {
    const libro = libros.find(l => l.id === prestamo.libroId);
    const prestadosActivos = prestamos.filter(
      p => p.libroId === prestamo.libroId && p.estado !== 'devuelto' && p.estado !== 'rechazado' && p.id !== id
    ).length;
    const disponible = (libro?.stock ?? 0) - prestadosActivos;
    if (disponible <= 0) {
      mostrarNotificacion('Error: Stock insuficiente para realizar el préstamo', 'error');
      return;
    }
  }

  const { error } = await supabaseClient.rpc('aprobar_prestamo_pendiente', { p_id_prestamo: id });

  if (error) {
    mostrarNotificacion('Error al aprobar la solicitud: ' + error.message, 'error');
    console.error(error);
    return;
  }

  await cargarPrestamos();
  renderLoans();
  const prestamoAprobado = prestamos.find(p => p.id === id);
  if (prestamoAprobado) {
    await enviarEmailEstadoSolicitud(prestamoAprobado, 'aprobacion');
  }
  mostrarNotificacion('Solicitud aprobada y notificación enviada.', 'success');
}

async function rechazarSolicitud(id) {
  const { error } = await supabaseClient
    .from('prestamos')
    .update({ estado: 'rechazado' })
    .eq('id', id);

  if (error) {
    mostrarNotificacion('Error al rechazar la solicitud: ' + error.message, 'error');
    console.error(error);
    return;
  }

  await cargarPrestamos();
  renderLoans();
  const prestamoRechazado = prestamos.find(p => p.id === id);
  if (prestamoRechazado) {
    await enviarEmailEstadoSolicitud(prestamoRechazado, 'rechazo');
  }
  mostrarNotificacion('Solicitud rechazada y notificación enviada.', 'success');
}

function mostrarNotificacion(msg, tipo = 'success') {
  let toast = document.getElementById('toast-notif');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-notif';
    document.body.appendChild(toast);
  }
  const esError = tipo === 'error';
  toast.style.cssText = [
    'position:fixed;top:1.5rem;right:1.5rem;',
    'padding:.9rem 1.4rem;border-radius:.75rem;',
    'color:#fff;font-size:.95rem;font-weight:600;',
    'z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.25);',
    'transition:opacity .3s,transform .3s;',
    'display:flex;align-items:center;gap:.6rem;',
    esError ? 'background:#dc2626;border:2px solid #b91c1c;min-width:320px;' : '',
    !esError ? `background:${tipo === 'success' ? '#22c55e' : '#f59e0b'};` : '',
  ].join('');
  // Seguridad: NUNCA innerHTML con el mensaje — los nombres de solicitantes
  // vienen de un formulario público y podrían contener HTML malicioso (XSS).
  toast.textContent = '';
  if (esError) {
    const icono = document.createElement('span');
    icono.style.fontSize = '1.2rem';
    icono.textContent = '🚫';
    const texto = document.createElement('span');
    texto.textContent = msg;
    toast.append(icono, texto);
  } else {
    toast.textContent = msg;
  }
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = '0'; }, esError ? 5000 : 3000);
}

document.addEventListener('DOMContentLoaded', () => {
  const dniInput = document.getElementById('f-dni');
  if (!dniInput) return;

  // Limpiar snapshot cuando el operador borra el DNI y escribe uno nuevo
  dniInput.addEventListener('input', () => {
    if (!dniInput.value.trim()) _usuarioEnFormulario = null;
  });

  dniInput.addEventListener('blur', async () => {
    const val = dniInput.value.trim();
    if (val.length >= 7) await autofillUsuarioEnFormulario(val);
  });

  dniInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = dniInput.value.trim();
      if (val.length >= 7) await autofillUsuarioEnFormulario(val);
    }
  });
});
