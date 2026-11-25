/* ============================================================
   VALIDACIONES
   ============================================================ */

const REGEX_DNI    = /^\d{7,8}$/;
const REGEX_EMAIL  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGEX_TEL    = /^[\d\s\-()+]{7,20}$/;
const REGEX_NOMBRE = /^[a-zA-Z\u00C0-\u024F\s'-]+$/; // letras, acentos, espacios, guion, apóstrofe

function validarDNI(dni) {
  const limpio = dni.replace(/\./g, '');
  return REGEX_DNI.test(limpio) && !/^0+$/.test(limpio); // rechaza "0", "00000000", etc.
}
function validarEmail(email)  { return REGEX_EMAIL.test(email); }
function validarTelefono(tel) { return !tel || REGEX_TEL.test(tel); }
function validarNombre(val)   { return val.length >= 2 && REGEX_NOMBRE.test(val); }

/* Marca el input con borde rojo y muestra mensaje debajo */
function setFieldError(inputId, msg) {
  const el = document.getElementById(inputId);
  if (!el) return;

  if (msg) {
    el.style.borderColor = '#ef4444';
    el.style.boxShadow   = '0 0 0 2px rgba(239,68,68,.2)';
  } else {
    el.style.borderColor = '';
    el.style.boxShadow   = '';
  }

  // Busca o crea el span de hint dentro del mismo wrapper del input
  const parent = el.parentNode;
  let hint = parent.querySelector('.field-hint');
  if (!hint) {
    hint = document.createElement('span');
    hint.className = 'field-hint';
    hint.style.cssText = 'font-size:.75rem;margin-top:.3rem;display:block;min-height:1rem;';
    parent.appendChild(hint);
  }
  hint.textContent = msg;
  hint.style.color = msg ? '#ef4444' : 'transparent';
}

function clearFieldErrors(...ids) {
  ids.forEach(id => setFieldError(id, ''));
}

/* Valida los campos de usuario y devuelve true si todo está OK.
   ids: objeto con los IDs de cada campo del formulario. */
function validarCamposUsuario({ nombre, apellido, dni, email, telefono, curso, direccion }) {
  let ok = true;

  if (!nombre || !validarNombre(nombre)) {
    setFieldError('user-nombre', !nombre ? 'El nombre es obligatorio.' : 'Solo letras y espacios.');
    ok = false;
  } else clearFieldErrors('user-nombre');

  if (!apellido || !validarNombre(apellido)) {
    setFieldError('user-apellido', !apellido ? 'El apellido es obligatorio.' : 'Solo letras y espacios.');
    ok = false;
  } else clearFieldErrors('user-apellido');

  if (!dni) {
    setFieldError('user-dni', 'El DNI es obligatorio.'); ok = false;
  } else if (!validarDNI(dni)) {
    setFieldError('user-dni', 'El DNI debe tener entre 7 y 8 dígitos numéricos.'); ok = false;
  } else {
    clearFieldErrors('user-dni');
  }

  if (!email) {
    setFieldError('user-email', 'El correo es obligatorio.'); ok = false;
  } else if (!validarEmail(email)) {
    setFieldError('user-email', 'Ingresá un correo válido (ej: alumno@gmail.com).'); ok = false;
  } else {
    clearFieldErrors('user-email');
  }

  if (telefono && !validarTelefono(telefono)) {
    setFieldError('user-tel', 'Formato de teléfono inválido (ej: 11-2345-6789).'); ok = false;
  } else {
    clearFieldErrors('user-tel');
  }

  if (!direccion) {
    setFieldError('user-dom', 'El domicilio es obligatorio.'); ok = false;
  } else {
    clearFieldErrors('user-dom');
  }

  if (!curso) { setFieldError('user-curso', 'Seleccioná un curso.'); ok = false; }
  else         clearFieldErrors('user-curso');

  return ok;
}

/* Versión para el modal de edición (mismos IDs con prefijo "edit-") */
function validarCamposUsuarioEdit({ nombre, apellido, dni, email, telefono, curso, direccion }) {
  let ok = true;

  if (!nombre || !validarNombre(nombre)) {
    setFieldError('edit-user-nombre', !nombre ? 'El nombre es obligatorio.' : 'Solo letras y espacios.');
    ok = false;
  } else clearFieldErrors('edit-user-nombre');

  if (!apellido || !validarNombre(apellido)) {
    setFieldError('edit-user-apellido', !apellido ? 'El apellido es obligatorio.' : 'Solo letras y espacios.');
    ok = false;
  } else clearFieldErrors('edit-user-apellido');

  if (!dni) {
    setFieldError('edit-user-dni', 'El DNI es obligatorio.'); ok = false;
  } else if (!validarDNI(dni)) {
    setFieldError('edit-user-dni', 'El DNI debe tener entre 7 y 8 dígitos numéricos.'); ok = false;
  } else {
    clearFieldErrors('edit-user-dni');
  }

  if (!email) {
    setFieldError('edit-user-email', 'El correo es obligatorio.'); ok = false;
  } else if (!validarEmail(email)) {
    setFieldError('edit-user-email', 'Ingresá un correo válido.'); ok = false;
  } else {
    clearFieldErrors('edit-user-email');
  }

  if (telefono && !validarTelefono(telefono)) {
    setFieldError('edit-user-tel', 'Formato de teléfono inválido.'); ok = false;
  } else {
    clearFieldErrors('edit-user-tel');
  }

  if (!direccion) {
    setFieldError('edit-user-dom', 'El domicilio es obligatorio.'); ok = false;
  } else {
    clearFieldErrors('edit-user-dom');
  }

  if (!curso) { setFieldError('edit-user-curso', 'Seleccioná un curso.'); ok = false; }
  else         clearFieldErrors('edit-user-curso');

  return ok;
}

/* Valida los campos del formulario de alta de préstamo */
function validarCamposPrestamo({ nombre, apellido, dni, email, telefono, curso }) {
  let ok = true;

  if (!nombre || !validarNombre(nombre)) {
    setFieldError('f-nombre', !nombre ? 'El nombre es obligatorio.' : 'Solo letras y espacios.');
    ok = false;
  } else clearFieldErrors('f-nombre');

  if (!apellido || !validarNombre(apellido)) {
    setFieldError('f-apellido', !apellido ? 'El apellido es obligatorio.' : 'Solo letras y espacios.');
    ok = false;
  } else clearFieldErrors('f-apellido');

  if (!dni) {
    setFieldError('f-dni', 'El DNI es obligatorio.'); ok = false;
  } else if (!validarDNI(dni)) {
    setFieldError('f-dni', 'El DNI debe tener entre 7 y 8 dígitos numéricos.'); ok = false;
  } else {
    clearFieldErrors('f-dni');
  }

  if (!email) {
    setFieldError('f-email', 'El correo es obligatorio.'); ok = false;
  } else if (!validarEmail(email)) {
    setFieldError('f-email', 'Ingresá un correo válido.'); ok = false;
  } else {
    clearFieldErrors('f-email');
  }

  if (telefono && !validarTelefono(telefono)) {
    setFieldError('f-tel', 'Formato de teléfono inválido.'); ok = false;
  } else {
    clearFieldErrors('f-tel');
  }

  if (!curso) { setFieldError('f-curso', 'Seleccioná un curso.'); ok = false; }
  else         clearFieldErrors('f-curso');

  return ok;
}
