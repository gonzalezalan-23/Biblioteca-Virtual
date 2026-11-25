/* ============================================================
   AUTH — Login via Supabase Auth
   Las credenciales se validan del lado del servidor (Supabase).
   ============================================================ */

async function iniciarSesion(email, password) {
  const errEl = document.getElementById('login-error');
  const btn = document.querySelector('.btn-login');
  const emailNormalizado = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalizado)) {
    if (errEl) {
      errEl.textContent = 'Ingresá el email completo registrado en Supabase Auth.';
      errEl.style.display = 'block';
    }
    return;
  }
  if (!password) {
    if (errEl) { errEl.textContent = 'Ingresá la contraseña.'; errEl.style.display = 'block'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Ingresando…'; }
  try {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email: emailNormalizado,
      password,
    });
    if (error) {
      const mensajes = {
        invalid_credentials: 'Email o contraseña incorrectos. Verificá el usuario en Authentication → Users.',
        email_not_confirmed: 'El email de Auth no está confirmado. Confirmalo en Supabase o desactivá la confirmación de emails.',
        user_banned: 'La cuenta de Auth está deshabilitada. Revisá su estado en Supabase.',
        too_many_requests: 'Hubo demasiados intentos. Esperá un momento y probá nuevamente.',
      };
      console.error('[ADMIN LOGIN]', error.status, error.code, error.message);
      if (errEl) {
        errEl.textContent = mensajes[error.code] || 'No se pudo iniciar sesión. Revisá la respuesta de Auth en la consola.';
        errEl.style.display = 'block';
      }
      return;
    }

    if (errEl) errEl.style.display = 'none';
    // El guardián de db.js (verificarAccesoProtegido) se encarga de
    // validar el rol admin antes de mostrar el panel.
    window.location.href = './index.html';
  } catch (error) {
    console.error('[ADMIN LOGIN] Error de red:', error);
    if (errEl) {
      errEl.textContent = 'No se pudo conectar con Supabase Auth. Revisá tu conexión e intentá nuevamente.';
      errEl.style.display = 'block';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Ingresar al Panel'; }
  }
}

function doLogin() {
  const u = document.getElementById('usr').value;
  const p = document.getElementById('pwd').value;
  iniciarSesion(u, p);
}

// Enter en el formulario de login (solo si la pantalla de login está visible)
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const screen = document.getElementById('login-screen');
  if (screen && screen.offsetParent !== null) doLogin();
});

function doLogout() {
  document.getElementById('modal-logout').classList.remove('hidden');
}

function cerrarModalLogout() {
  document.getElementById('modal-logout').classList.add('hidden');
}

async function confirmarLogout() {
  await supabaseClient.auth.signOut();
  sessionStorage.removeItem('panel_destino');
  window.location.href = 'login.html';
}
