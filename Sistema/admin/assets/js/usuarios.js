/* ============================================================
   USUARIOS
   ============================================================ */
let usuarios = [];
let errorCargaUsuarios = null;

function escapeHtml(val) {
  return String(val ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function capitalizarNombre(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/(?:^|\s|-)\S/g, c => c.toUpperCase());
}

async function cargarUsuarios() {
  errorCargaUsuarios = null;
  const campos = [
    'id,nombre,apellido,dni,email,telefono,direccion,id_curso,activo',
    'id,nombre,apellido,dni,email,telefono,id_curso,activo',
    'id,nombre,apellido,dni,email,id_curso,activo',
  ];
  let data = null;
  let error = null;

  for (const select of campos) {
    const resultado = await supabaseClient
      .from('usuarios')
      .select(select)
      .order('apellido', { ascending: true })
      .order('nombre', { ascending: true });
    data = resultado.data;
    error = resultado.error;
    if (!error) break;

    const faltaColumna = error.code === '42703'
      || error.code === 'PGRST204'
      || /column .* does not exist|could not find the .* column/i.test(error.message ?? '');
    if (!faltaColumna) break;
    console.warn(`[USUARIOS] Reintentando la consulta sin campos opcionales: ${error.message}`);
  }

  if (error) {
    errorCargaUsuarios = error.message;
    usuarios = [];
    console.error('Error al cargar usuarios:', error.message);
    return;
  }

  // Si la columna 'activo' existe, filtra los inactivos en el cliente.
  // Si no existe aún (activo === undefined), muestra todos.
  usuarios = (data || [])
    .filter(u => u.activo !== false)
    .map(u => ({ ...u, curso: obtenerNombreCurso(u.id_curso) }));
  poblarCursosUsuario();
}

function obtenerNombreCurso(idCurso) {
  const curso = cursos.find(c => c.id === idCurso);
  if (!curso) return '—';
  // Docentes tienen division '—': mostrar solo el nombre sin el guín
  return curso.division && curso.division !== '—'
    ? `${curso.nombre}° ${curso.division}`
    : curso.nombre;
}

function poblarCursosUsuario() {
  const sel = document.getElementById('user-curso');
  if (!sel) return;
  sel.innerHTML =
    '<option value="">Seleccioná curso</option>' +
    cursos
      .filter(c => c.nombre !== 'Docente')
      .map(c => `<option value="${c.nombre}|${c.division}">${c.nombre}° ${c.division}</option>`)
      .join('') +
    '<option disabled>──────────</option>' +
    '<option value="Docente|—">Docente</option>';
}

function normalizarTexto(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function renderUsuarios() {
  const q = normalizarTexto(document.getElementById('user-search').value);
  const orden = document.getElementById('user-sort')?.value || 'apellido';

  let lista = usuarios.filter(u => {
    const haystack = normalizarTexto(`${u.nombre} ${u.apellido} ${u.dni ?? ''} ${u.email ?? ''} ${u.curso ?? ''}`);
    return haystack.includes(q);
  });

  lista.sort((a, b) => {
    if (orden === 'nombre')   return normalizarTexto(a.nombre).localeCompare(normalizarTexto(b.nombre));
    if (orden === 'apellido') return normalizarTexto(a.apellido).localeCompare(normalizarTexto(b.apellido));
    return 0;
  });


  const tbody = document.getElementById('user-tbody');
  tbody.innerHTML = '';

  if (!lista.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.style.cssText = 'text-align:center;color:var(--muted);padding:2rem;';
    td.textContent = errorCargaUsuarios
      ? `No se pudo cargar la lista de usuarios: ${errorCargaUsuarios}`
      : q
        ? 'No hay usuarios que coincidan con la búsqueda.'
        : 'No hay usuarios activos para mostrar. Las cuentas pendientes aparecen en Notificaciones.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  lista.forEach((u, i) => {
    const tr = document.createElement('tr');

    // Wrapper flex para los botones
    const tdAccion = document.createElement('td');
    const wrapBtn = document.createElement('div');
    wrapBtn.style.cssText = 'display:flex;gap:.4rem;align-items:center;';

    const btnEditar = document.createElement('button');
    btnEditar.className = 'btn btn-ghost';
    btnEditar.style.cssText = 'padding:.3rem .65rem;font-size:.78rem;';
    btnEditar.textContent = '✏ Editar';
    btnEditar.addEventListener('click', () => abrirEdicionUsuario(u.id));

    const btnEliminar = document.createElement('button');
    btnEliminar.className = 'btn btn-danger';
    btnEliminar.style.cssText = 'padding:.3rem .65rem;font-size:.78rem;';
    btnEliminar.textContent = '🗑 Eliminar';
    btnEliminar.addEventListener('click', () => eliminarUsuario(u.id));

    wrapBtn.append(btnEditar, btnEliminar);
    tdAccion.appendChild(wrapBtn);

    // Columna # con padding correcto
    const tdNum = document.createElement('td');
    tdNum.style.cssText = 'color:var(--muted);font-size:.8rem;';
    tdNum.textContent = i + 1;

    const tdNombre = document.createElement('td');
    tdNombre.style.fontWeight = '600';
    tdNombre.textContent = `${capitalizarNombre(u.apellido)}, ${capitalizarNombre(u.nombre)}`;
    const tdDni    = document.createElement('td'); tdDni.textContent    = u.dni;
    const tdEmail  = document.createElement('td'); tdEmail.textContent  = u.email    || '—';
    const tdTel    = document.createElement('td'); tdTel.textContent    = u.telefono || '—';
    const tdCurso  = document.createElement('td'); tdCurso.textContent  = u.curso    || '—';

    tr.append(tdNum, tdNombre, tdDni, tdEmail, tdTel, tdCurso, tdAccion);
    tbody.appendChild(tr);
  });
}

async function procesarGuardadoUsuario() {
  const nombre   = capitalizarNombre(document.getElementById('user-nombre').value.trim());
  const apellido  = capitalizarNombre(document.getElementById('user-apellido').value.trim());
  const dni = document.getElementById('user-dni').value.trim();
  const email = document.getElementById('user-email').value.trim();
  const telefono = document.getElementById('user-tel').value.trim();
  const direccion = document.getElementById('user-dom').value.trim();
  const cursoText  = document.getElementById('user-curso').value;
  const anioActual  = new Date().getFullYear();  // siempre el año actual, sin depender del select

  if (!validarCamposUsuario({ nombre, apellido, dni, email, telefono, curso: cursoText, direccion })) {
    mostrarNotificacion('Corregí los errores marcados en el formulario.', 'warning');
    return;
  }

  const [ano, division] = cursoText.split('|');
  if (!ano || !division) {
    mostrarNotificacion('Seleccioná un curso válido.', 'warning');
    return;
  }

  const idCurso = await obtenerOCrearCurso(ano, division);
  if (!idCurso) {
    mostrarNotificacion('No se pudo cargar el curso asociado.', 'error');
    return;
  }

  const { error } = await supabaseClient
    .from('usuarios')
    .insert([{ nombre, apellido, dni, email, telefono, direccion, id_curso: idCurso, año_actual: anioActual }]);

  if (error) {
    mostrarNotificacion('Error al guardar usuario: ' + error.message, 'error');
    console.error(error);
    return;
  }

  mostrarNotificacion('Usuario guardado correctamente.', 'success');
  await cargarUsuarios();
  renderUsuarios();
  limpiarFormularioUsuario();
}

function limpiarFormularioUsuario() {
  ['user-nombre', 'user-apellido', 'user-dni', 'user-email', 'user-tel', 'user-dom', 'user-curso'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

async function eliminarUsuario(id) {
  const usuario = usuarios.find(u => u.id === id);
  const nombreCompleto = usuario
    ? `${capitalizarNombre(usuario.apellido)}, ${capitalizarNombre(usuario.nombre)}`
    : 'este usuario';

  // 1. Consulta previa: verificar préstamos activos o pendientes
  const { data: prestamosActivos, error: errorConsulta } = await supabaseClient
    .from('prestamos')
    .select('id')
    .eq('id_usuario', id)
    .in('estado', ['activo', 'pendiente'])
    .limit(1);

  if (errorConsulta) {
    mostrarNotificacion('Error al verificar préstamos del usuario.', 'error');
    console.error(errorConsulta);
    return;
  }

  // 2. Bloquear si tiene préstamos activos o pendientes
  if (prestamosActivos.length > 0) {
    mostrarNotificacion(
      `No se puede eliminar a ${nombreCompleto}: tiene libros pendientes de devolución.`,
      'warning'
    );
    return;
  }

  // 3. Sin préstamos activos: confirmar y borrar físicamente
  if (!window.confirm(`¿Eliminar a ${nombreCompleto}? Esta acción no se puede deshacer.`)) return;

  const { error: errorDelete } = await supabaseClient
    .from('usuarios')
    .delete()
    .eq('id', id);

  if (errorDelete) {
    // Captura el caso de FK por préstamos históricos (devueltos/rechazados)
    if (errorDelete.code === '23503') {
      mostrarNotificacion(
        `No se puede eliminar a ${nombreCompleto}: tiene historial de préstamos registrado. Desactivá el usuario en su lugar.`,
        'warning'
      );
    } else {
      mostrarNotificacion('Error al eliminar usuario: ' + errorDelete.message, 'error');
    }
    console.error(errorDelete);
    return;
  }

  // Elimina del cache local
  usuarios = usuarios.filter(u => u.id !== id);
  mostrarNotificacion(`${nombreCompleto} eliminado correctamente.`, 'success');
  renderUsuarios();
}

function abrirEdicionUsuario(id) {
  const u = usuarios.find(x => x.id === id);
  if (!u) return;

  document.getElementById('edit-user-id').value = id;
  document.getElementById('edit-user-nombre').value = u.nombre || '';
  document.getElementById('edit-user-apellido').value = u.apellido || '';
  document.getElementById('edit-user-dni').value = u.dni || '';
  document.getElementById('edit-user-email').value = u.email || '';
  document.getElementById('edit-user-tel').value = u.telefono || '';
  document.getElementById('edit-user-dom').value = u.direccion || '';

  // Poblar y seleccionar curso
  const sel = document.getElementById('edit-user-curso');
  sel.innerHTML =
    '<option value="">Seleccioná curso</option>' +
    cursos
      .filter(c => c.nombre !== 'Docente')
      .map(c => `<option value="${c.nombre}|${c.division}">${c.nombre}° ${c.division}</option>`)
      .join('') +
    '<option disabled>──────────</option>' +
    '<option value="Docente|—">Docente</option>';
  if (u.id_curso) {
    const curso = cursos.find(c => c.id === u.id_curso);
    if (curso) {
      sel.value = curso.nombre === 'Docente' ? 'Docente|—' : `${curso.nombre}|${curso.division}`;
    }
  }

  const modal = document.getElementById('modal-edit-usuario');
  modal.style.display = 'flex';
}

async function guardarEdicionUsuario() {
  const id = parseInt(document.getElementById('edit-user-id').value);
  const nombre   = capitalizarNombre(document.getElementById('edit-user-nombre').value.trim());
  const apellido  = capitalizarNombre(document.getElementById('edit-user-apellido').value.trim());
  const dni = document.getElementById('edit-user-dni').value.trim();
  const email = document.getElementById('edit-user-email').value.trim();
  const telefono = document.getElementById('edit-user-tel').value.trim();
  const direccion = document.getElementById('edit-user-dom').value.trim();
  const cursoText = document.getElementById('edit-user-curso').value;

  if (!validarCamposUsuarioEdit({ nombre, apellido, dni, email, telefono, curso: cursoText, direccion })) {
    mostrarNotificacion('Corregí los errores marcados en el formulario.', 'warning');
    return;
  }

  const [ano, division] = cursoText.split('|');
  const idCurso = await obtenerOCrearCurso(ano, division);
  if (!idCurso) {
    mostrarNotificacion('No se pudo cargar el curso.', 'error');
    return;
  }

  const { error } = await supabaseClient
    .from('usuarios')
    .update({ nombre, apellido, dni, email, telefono, direccion, id_curso: idCurso })
    .eq('id', id);

  if (error) {
    mostrarNotificacion('Error al actualizar usuario: ' + error.message, 'error');
    console.error(error);
    return;
  }

  mostrarNotificacion('Usuario actualizado correctamente.', 'success');
  document.getElementById('modal-edit-usuario').style.display = 'none';
  await cargarUsuarios();
  renderUsuarios();
}

function cerrarModalUsuario(e) {
  if (e.target === document.getElementById('modal-edit-usuario'))
    document.getElementById('modal-edit-usuario').style.display = 'none';
}
