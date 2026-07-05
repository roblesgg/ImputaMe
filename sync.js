// ── Sincronización opcional con Supabase (mismo backend que la app móvil) ──────
// Diseño SEGURO:
//  - Si no hay sesión iniciada, la app funciona 100% local (esto no hace nada).
//  - NUNCA borra datos locales. Las eliminaciones NO se propagan en esta v1
//    (borrar en un dispositivo no borra en el otro), para evitar pérdidas.
//  - Correlación por `remoteId` (uuid) guardado en cada tarea y cada entrada.
//  - Empuja al guardar (debounce) y baja por realtime cuando el móvil cambia algo.
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');

const SUPABASE_URL = 'https://ndtgbixtzvnsjbyawgch.supabase.co';
const SUPABASE_ANON = 'sb_publishable_Sm4qZor5R-1DkmjgtDLafw_PwkMi3M4';

let supabase = null;
let cb = {};                 // { getState, saveRaw, onChange, onStatus, sessionFile }
let sessionFile = null;
let currentUser = null;
let channel = null;
let pushTimer = null, pullTimer = null;

// Almacenamiento de sesión en archivo (el proceso main de Electron no tiene localStorage)
function fileStorage() {
  const read = () => { try { return JSON.parse(fs.readFileSync(sessionFile, 'utf8')); } catch { return {}; } };
  const write = (d) => { try { fs.writeFileSync(sessionFile, JSON.stringify(d)); } catch {} };
  return {
    getItem: (k) => { const d = read(); return k in d ? d[k] : null; },
    setItem: (k, v) => { const d = read(); d[k] = v; write(d); },
    removeItem: (k) => { const d = read(); delete d[k]; write(d); },
  };
}

async function init(opts) {
  cb = opts;
  sessionFile = opts.sessionFile;
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: fileStorage() },
  });
  try {
    const { data } = await supabase.auth.getSession();
    if (data && data.session) { currentUser = data.session.user; await startSync(); }
  } catch {}
  emitStatus();
}

function emitStatus() {
  if (cb.onStatus) cb.onStatus({ loggedIn: !!currentUser, email: currentUser ? currentUser.email : null });
}

async function login(email, password) {
  if (!supabase) return { ok: false, error: 'Sync no disponible' };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: traducir(error.message) };
  currentUser = data.user;
  emitStatus();
  await startSync();
  return { ok: true, email: currentUser.email };
}

async function logout() {
  stopSync();
  try { await supabase.auth.signOut(); } catch {}
  currentUser = null;
  emitStatus();
  return { ok: true };
}

async function startSync() {
  if (!currentUser) return;
  await pullNow();   // primero traemos y fusionamos lo del servidor
  await pushNow();   // luego subimos lo local (asigna remoteIds a lo que no lo tenga)
  subscribe();
}

function stopSync() {
  if (channel) { try { supabase.removeChannel(channel); } catch {} channel = null; }
  clearTimeout(pushTimer); clearTimeout(pullTimer);
}

function subscribe() {
  if (channel) { try { supabase.removeChannel(channel); } catch {} channel = null; }
  channel = supabase
    .channel('imputame-desktop')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tareas' }, schedulePull)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fichajes' }, schedulePull)
    .subscribe();
}

// Sube el estado local a Supabase (upsert por id). No borra nada remoto.
async function pushNow() {
  if (!currentUser) return;
  const st = cb.getState();
  const uid = currentUser.id;
  const tareas = [], fichajes = [];
  let assigned = false;
  for (const t of st.tasks) {
    if (t.archived) continue;                       // las archivadas no se sincronizan
    if (!t.remoteId) { t.remoteId = crypto.randomUUID(); assigned = true; }
    tareas.push({ id: t.remoteId, user_id: uid, nombre: t.name, color: t.color });
    for (const e of t.entries) {
      if (!e.remoteId) { e.remoteId = crypto.randomUUID(); assigned = true; }
      fichajes.push({ id: e.remoteId, user_id: uid, tarea_id: t.remoteId, inicio_ms: e.start, fin_ms: e.end == null ? null : e.end });
    }
  }
  if (assigned && cb.saveRaw) cb.saveRaw();          // persistir los remoteId nuevos (sin re-disparar sync)
  try {
    if (tareas.length) await supabase.from('tareas').upsert(tareas);
    if (fichajes.length) await supabase.from('fichajes').upsert(fichajes);
  } catch { /* sin conexión: se reintenta en el próximo guardado */ }
}

// Baja de Supabase y fusiona en local (aditivo: nunca borra tareas/entradas locales).
async function pullNow() {
  if (!currentUser) return;
  let t, f;
  try {
    [t, f] = await Promise.all([
      supabase.from('tareas').select('*'),
      supabase.from('fichajes').select('*'),
    ]);
  } catch { return; }
  if (!t || !f || t.error || f.error) return;

  const st = cb.getState();
  const byRemote = new Map();
  st.tasks.forEach((x) => { if (x.remoteId) byRemote.set(x.remoteId, x); });
  let changed = false;

  for (const rt of t.data) {
    let local = byRemote.get(rt.id);
    if (!local) {
      local = { id: rt.id, remoteId: rt.id, name: rt.nombre, color: rt.color, entries: [], archived: false, groupId: null };
      st.tasks.push(local); byRemote.set(rt.id, local); changed = true;
    } else {
      if (local.name !== rt.nombre) { local.name = rt.nombre; changed = true; }
      if (local.color !== rt.color) { local.color = rt.color; changed = true; }
    }
  }
  for (const rf of f.data) {
    const task = byRemote.get(rf.tarea_id);
    if (!task) continue;
    let e = task.entries.find((x) => x.remoteId === rf.id);
    if (!e) { task.entries.push({ start: rf.inicio_ms, end: rf.fin_ms, remoteId: rf.id }); changed = true; }
    else if (e.start !== rf.inicio_ms || e.end !== rf.fin_ms) { e.start = rf.inicio_ms; e.end = rf.fin_ms; changed = true; }
  }

  // Refleja la tarea activa a partir de una entrada abierta (fin == null)
  let active = null;
  for (const tk of st.tasks) { if (!tk.archived && tk.entries.some((e) => e.end == null)) { active = tk.id; break; } }
  if (st.activeTaskId !== active) { st.activeTaskId = active; changed = true; }

  if (changed && cb.onChange) cb.onChange();          // guarda (raw) + refresca ventanas/tray, sin re-empujar
}

function schedulePush() { if (!currentUser) return; clearTimeout(pushTimer); pushTimer = setTimeout(() => { pushNow(); }, 2500); }
function schedulePull() { clearTimeout(pullTimer); pullTimer = setTimeout(() => { pullNow(); }, 800); }

function traducir(msg) {
  if (/Invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(msg)) return 'Confirma tu email antes de entrar.';
  return msg;
}

module.exports = { init, login, logout, schedulePush, isLoggedIn: () => !!currentUser };
