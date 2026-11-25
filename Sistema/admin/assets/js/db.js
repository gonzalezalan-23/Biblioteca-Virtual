/* ============================================================
   DB.JS — Cliente Supabase + guardián del panel admin
   ------------------------------------------------------------
   Requiere que ../assets/js/config.js se cargue ANTES.
   Reglas de acceso:
   1) Debe existir una sesión de Supabase Auth.
   2) La fila 'usuarios' de ese email debe tener rol = 'admin'
      y activo = true (validación server-side gracias a RLS).
   ============================================================ */
const supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
window.supabaseClient = supabaseClient;

// Perfil admin validado (se usa para mostrar datos en el sidebar)
window.adminPerfil = null;

/* Devuelve el perfil del usuario autenticado SOLO si es admin activo */
async function cargarPerfilAdmin(session) {
  if (!session?.user?.email) return null;
  const { data } = await supabaseClient
    .from('usuarios')
    .select('id, nombre, apellido, rol, activo')
    .eq('email', session.user.email)
    .maybeSingle();

  if (!data || data.rol !== 'admin' || data.activo === false) return null;
  return data;
}

async function verificarAccesoProtegido() {
  const esPaginaLogin = window.location.pathname.includes('login.html');
  const { data: { session }, error } = await supabaseClient.auth.getSession();

  // Sesión válida intentando entrar al login → llevamos al panel
  if (session && !error) {
    const perfil = await cargarPerfilAdmin(session);
    if (perfil) {
      window.adminPerfil = perfil;
      if (esPaginaLogin) { window.location.replace('./index.html'); return; }
      const contenedor = document.getElementById('app');
      if (contenedor) contenedor.style.display = 'block';
      renderSidebarProfile(session.user, perfil);
      // Aviso para que script.js arranque la carga de datos SOLO con sesión válida
      window._adminAutorizado = true;
      document.dispatchEvent(new CustomEvent('admin:autorizado', { detail: perfil }));
      return;
    }
    // Sesión existente pero NO es admin → cerrar sesión
    await supabaseClient.auth.signOut();
  }

  if (!esPaginaLogin) {
    window.location.replace('login.html');
  }
}

function renderSidebarProfile(user, perfil) {
  if (!user) return;
  const email = user.email || '';
  const avatar = email ? email.split('@')[0].slice(0, 2).toUpperCase() : 'BI';
  const nameEl = document.getElementById('sidebar-user-name');
  const emailEl = document.getElementById('sidebar-user-email');
  const avatarEl = document.getElementById('sidebar-user-avatar');

  if (nameEl) nameEl.textContent = perfil?.nombre || 'Bibliotecaria';
  if (emailEl) emailEl.textContent = email;
  if (avatarEl) avatarEl.textContent = avatar;
}

// Inicializar el guardián de inmediato
verificarAccesoProtegido();
