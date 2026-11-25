/* ============================================================
   DB.JS — Cliente Supabase compartido (sitio público)
   ------------------------------------------------------------
   Requiere que config.js se cargue ANTES de este archivo.
   Expone window.supabaseClient para script.js / portal.js.
   ============================================================ */
if (!window.supabaseClient) {
  window.supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
}
