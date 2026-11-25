/* ============================================================
   ACADÉMICO — Módulo desactivado
   Tabla 'academico' eliminada: sección migrada a Material de Estudio.
   Las funciones se mantienen como stubs para no romper script.js.
   ============================================================ */
let registrosAcademicos = [];

function normalizarTextoAcad(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function cargarAcademico()     { registrosAcademicos = []; }
function renderAcademico()           { /* no-op: elementos HTML eliminados */ }
function poblarCursoAcademico()      { /* no-op */ }
function limpiarFormularioAcademico(){ /* no-op */ }

async function procesarGuardadoAcademico() {
  console.warn('procesarGuardadoAcademico: módulo desactivado.');
}

async function eliminarAcademico() {
  console.warn('eliminarAcademico: módulo desactivado.');
}
