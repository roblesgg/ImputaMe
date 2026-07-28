const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Instancia única: sin esto, cada vez que se relanzaba la app (acceso directo, inicio con
// Windows, doble clic...) mientras ya había una corriendo, se abría un PROCESO NUEVO entero
// -con su propio icono de bandeja y su propio panel- en vez de traer al frente el que ya
// estaba abierto. De ahí que a veces aparecieran dos paneles a la vez.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.on('second-instance', () => {
  // Alguien ha vuelto a lanzar la app mientras ya estaba corriendo: solo la traemos al
  // frente (por donde se quedó), no dejamos que se abra un proceso duplicado.
  openLastView();
});

const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TASK_COLORS = ['#6366f1','#f472b6','#34d399','#fbbf24','#60a5fa','#f87171','#a78bfa','#2dd4bf'];
// ── Temas de color ───────────────────────────────────────────────────────────
// Cada tema define la paleta completa. Se envía a TODAS las ventanas (y a los iframes
// del dock) por IPC y cada página la aplica como variables CSS; no se usa insertCSS
// porque ese solo llega al frame principal y dejaría las vistas del dock sin tema.
// `base` es el RGB del fondo, al que se le aplica la opacidad elegida por el usuario.
const THEMES = {
  indigo:   { name:'Índigo',   base:'18,18,28',    accent:'#818cf8', accent2:'#6366f1', surface:'#1c1c2a', scheme:'dark' },
  grafito:  { name:'Grafito',  base:'16,16,18',    accent:'#a1a1aa', accent2:'#71717a', surface:'#1b1b1e', scheme:'dark' },
  pizarra:  { name:'Pizarra',  base:'24,28,36',    accent:'#94a3b8', accent2:'#64748b', surface:'#212733', scheme:'dark' },
  oceano:   { name:'Océano',   base:'12,22,34',    accent:'#38bdf8', accent2:'#0284c7', surface:'#12212f', scheme:'dark' },
  bosque:   { name:'Bosque',   base:'12,24,20',    accent:'#34d399', accent2:'#059669', surface:'#122420', scheme:'dark' },
  vino:     { name:'Vino',     base:'28,14,20',    accent:'#fb7185', accent2:'#e11d48', surface:'#291520', scheme:'dark' },
  ambar:    { name:'Ámbar',    base:'28,20,10',    accent:'#fbbf24', accent2:'#d97706', surface:'#2a1f12', scheme:'dark' },
  claro:    { name:'Claro',    base:'244,244,249', accent:'#4f46e5', accent2:'#4338ca', surface:'#ffffff', scheme:'light' },
};
const DEFAULT_THEME = 'indigo';

// Color de acento (botones, resaltados) elegible aparte del fondo: cada tema trae el
// suyo por defecto, pero se puede cambiar sin tocar los grises/negros/blancos del fondo.
const ACCENTS = {
  indigo:   { name:'Índigo',   accent:'#818cf8', accent2:'#6366f1' },
  azul:     { name:'Azul',     accent:'#38bdf8', accent2:'#0284c7' },
  turquesa: { name:'Turquesa', accent:'#2dd4bf', accent2:'#0d9488' },
  verde:    { name:'Verde',    accent:'#34d399', accent2:'#059669' },
  ambar:    { name:'Ámbar',    accent:'#fbbf24', accent2:'#d97706' },
  naranja:  { name:'Naranja',  accent:'#fb923c', accent2:'#ea580c' },
  rojo:     { name:'Rojo',     accent:'#fb7185', accent2:'#e11d48' },
  rosa:     { name:'Rosa',     accent:'#f472b6', accent2:'#db2777' },
  violeta:  { name:'Violeta',  accent:'#a78bfa', accent2:'#7c3aed' },
  gris:     { name:'Gris',     accent:'#a1a1aa', accent2:'#71717a' },
};

const TRASH_RETENTION_DAYS = 30;   // cuánto tiempo se puede restaurar una tarea desde la papelera
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// ¿Está esta tarea ahora mismo en la papelera? (borrada, no eliminada del todo y aún
// dentro del plazo de restauración).
function isInTrash(t) {
  return t.deleted && !t.purged && t.deletedAt && (Date.now() - t.deletedAt < TRASH_RETENTION_MS);
}

let DATA_FILE;
let SETTINGS_FILE;

let tray = null;
let widgetWin = null;
let calendarWin = null;
let mainWin = null;
let settingsWin = null;
let groupsWin = null;
let splashWin = null;
let reminderTimer = null;
let tickTimer = null;
let syncWin = null;
let updateWin = null;
let dockWin = null;              // barra flotante lateral (modo dock, opcional)
let dockExpanded = false;
let pendingUpdateState = null;   // último estado enviado a la ventana de actualización
let updateInfo = null;           // { version } si hay una actualización disponible (para el botón del panel)
let syncStatus = { loggedIn: false, email: null };

// Módulo de sincronización opcional (Supabase). Si falla el require, la app sigue local.
let sync = null;
try { sync = require('./sync'); } catch {}

// ── Estado ──────────────────────────────────────────────────────────────────
let state = {
  tasks: [],           // { id, name, color, entries: [{start, end}], archived, groupId }
  groups: [],          // { id, name }
  activeTaskId: null,
};

let settings = {
  reminderMinutes: 10,
  widgetAutoHide: true,
  widgetAutoHideSeconds: 10,
  colorMode: 'auto', // 'auto' | 'manual'
  openAtLogin: false, // arrancar al iniciar sesión en Windows (desactivado por defecto)
  bgOpacity: 50,       // 0 = muy translúcida (se ve más el blur), 100 = muy opaca. Blur siempre puesto.
  tutorialSeenSteps: [], // ids de pasos del tutorial guiado ya vistos u omitidos (ver TUTORIAL_STEPS en shared.js)
  dockMode: false,     // modo barra flotante lateral (en vez de ventanas sueltas)
  dockDisplayId: null, // en qué pantalla se ancla el dock (null = la de referencia)
  theme: DEFAULT_THEME, // fondo/paleta base de toda la app (ver THEMES)
  accent: null,         // color de acento; null = el que trae el tema (ver ACCENTS)
  dockAnchor: 'right', // borde al que se pega la barrita: left | right | top | bottom
  dockBarWidth: 7,     // grosor de la barrita (px)
  dockBarLength: 110,  // largo de la barrita (px)
  dockBarPos: 50,      // posición a lo largo del borde, en % (0 = arriba/izq, 100 = abajo/der)
  dockBarOffset: 4,    // cuánto se despega del borde hacia el centro (px)
  dockBarOpacity: 30,  // opacidad de la barrita EN REPOSO (al acercar el ratón va al máximo)
  dockBarColor: '#ffffff',
  dockPanelWidth: 460,  // ancho del panel en las vistas normales (anclajes laterales)
  dockPanelHeight: 460, // alto del panel cuando se ancla arriba/abajo
  dockCalendarWidth: 1180, // el calendario se abre bastante más ancho (y se puede estirar)
  lastView: 'panel',    // última vista abierta: la app vuelve a abrirse por donde la dejaste
};

function nextAutoColor() {
  return TASK_COLORS[state.tasks.length % TASK_COLORS.length];
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {}
  if (!Array.isArray(state.groups)) state.groups = [];
  state.tasks.forEach(t => {
    if (t.archived === undefined) t.archived = false;
    if (t.groupId === undefined) t.groupId = null;
    if (t.deleted === undefined) t.deleted = false;
    // Migración: las entradas de antes de esto no tenían "foto" del nombre de la
    // tarea en ese momento (el calendario leía el nombre actual, en vivo). Se les
    // pone el nombre que tiene ahora mismo como punto de partida; a partir de aquí
    // cada entrada nueva guarda el suyo propio y ya no cambia si renombras la tarea.
    t.entries.forEach(e => { if (e.nameAtTime === undefined) e.nameAtTime = t.name; });
  });
  try {
    if (fs.existsSync(SETTINGS_FILE)) settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {}
}

function saveDataRaw() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)); } catch {}
}
function saveData() {
  saveDataRaw();
  if (sync) sync.schedulePush();   // sube los cambios al servidor (si hay sesión)
}

function saveSettings() {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch {}
}

// Registra (o quita) imputa.me del arranque de Windows según el ajuste.
// Al arrancar por el login se le pasa "--hidden" para ir directo a la bandeja
// sin abrir el panel. En desarrollo no se toca el registro (apuntaría a electron.exe).
function applyLoginItem() {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!settings.openAtLogin, args: ['--hidden'] });
  } catch {}
}

// ── Utilidades de tiempo ─────────────────────────────────────────────────────
function totalSecondsForTask(task) {
  let total = 0;
  for (const entry of task.entries) {
    total += ((entry.end || Date.now()) - entry.start);
  }
  return Math.floor(total / 1000);
}

function todaySecondsForTask(task) {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  let total = 0;
  for (const entry of task.entries) {
    const entryEnd = entry.end || Date.now();
    if (entryEnd < startOfDay.getTime()) continue;
    const from = Math.max(entry.start, startOfDay.getTime());
    total += Math.max(0, entryEnd - from);
  }
  return Math.floor(total / 1000);
}

function totalTodaySeconds() {
  return state.tasks.reduce((sum, t) => sum + todaySecondsForTask(t), 0);
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m`;
  return `${m}m ${String(s).padStart(2,'0')}s`;
}

function getActiveTask() {
  return state.tasks.find(t => t.id === state.activeTaskId) || null;
}

// ── Tray ─────────────────────────────────────────────────────────────────────
function updateTrayTitle() {
  if (!tray) return;
  const active = getActiveTask();
  tray.setToolTip(`imputa.me · ${formatDuration(totalTodaySeconds())}${active ? ' · ' + active.name : ''}`);
  tray.setContextMenu(buildTrayMenu());
}

function buildTrayMenu() {
  const active = getActiveTask();
  const taskItems = state.tasks.filter(t => !t.archived && !t.deleted).map(t => ({
    label: `${t.id === state.activeTaskId ? '▶ ' : '    '}${t.name}  (${formatDuration(todaySecondsForTask(t))})`,
    click: () => switchTask(t.id),
  }));
  return Menu.buildFromTemplate([
    { label: 'imputa.me', enabled: false },
    { label: `Hoy: ${formatDuration(totalTodaySeconds())}`, enabled: false },
    { type: 'separator' },
    ...taskItems,
    { type: 'separator' },
    { label: 'Panel', click: () => openMain() },
    { label: 'Calendario', click: () => openCalendar() },
    { label: 'Guardadas', click: () => openGroups() },
    { label: 'Ajustes', click: () => openSettings() },
    { label: `Sincronizar (móvil)${syncStatus.loggedIn ? ' ✓' : ''}…`, click: () => openSync() },
    { label: 'Pausar', click: () => pauseActive(), enabled: !!active },
    { type: 'separator' },
    // Interruptor de escape: permite salir del modo dock desde la bandeja aunque su
    // interfaz no se viera bien, sin depender de abrir Ajustes dentro del propio dock.
    { label: 'Modo barra flotante (dock)', type: 'checkbox', checked: !!settings.dockMode, click: () => toggleDockMode() },
    { label: 'Buscar actualizaciones…', click: () => checkForUpdates(true) },
    { label: 'Salir', click: () => { saveData(); app.quit(); } },
  ]);
}

function toggleDockMode() {
  const wasDock = !!settings.dockMode;
  settings.dockMode = !wasDock;
  saveSettings();
  applyDockMode(wasDock);
  updateTrayTitle();
}

// ── Acciones ─────────────────────────────────────────────────────────────────
function startTask(taskId, backMinutes) {
  pauseActive();
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  state.activeTaskId = taskId;
  const start = backMinutes ? Date.now() - backMinutes * 60000 : Date.now();
  // nameAtTime: "foto" del nombre de la tarea al crear la entrada. El calendario es
  // un registro de lo que pasó, así que si luego renombras la tarea esta entrada no
  // cambia con ella (solo las que se creen después, con el nombre nuevo).
  task.entries.push({ start, end: null, nameAtTime: task.name });
  saveData(); broadcastState(); resetReminderTimer();
}

function pauseActive() {
  const task = getActiveTask();
  if (task) {
    const last = task.entries[task.entries.length - 1];
    if (last && !last.end) {
      last.end = Date.now();
      // La nota se QUEDA con la entrada: es parte del registro de lo que hiciste en esa
      // sesión (se ve en el calendario). Al retomar la tarea se crea una entrada nueva
      // sin nota, así que el campo del panel vuelve a estar en blanco solo, sin tener
      // que borrar la de antes (que antes se perdía al pausar).
    }
  }
  state.activeTaskId = null;
  saveData(); broadcastState();
}

// Nota rápida sobre la tarea que está corriendo AHORA MISMO (desde el panel principal),
// para poder anotar sin querer que "formación" de hoy es en concreto un vídeo de sales.
// Se guarda en la propia entrada en curso, así que ya se ve reflejada en el calendario.
function setActiveEntryNote(note) {
  const task = getActiveTask();
  if (!task) return;
  const last = task.entries[task.entries.length - 1];
  if (!last || last.end) return;
  const n = (note || '').trim().slice(0, 500);
  if (n) last.note = n; else delete last.note;
  saveData(); broadcastState();
}

function switchTask(taskId, backMinutes) {
  if (state.activeTaskId === taskId) pauseActive();
  else startTask(taskId, backMinutes);
}

// Cierra la sesión en curso de la tarea activa (como al pausar) y arranca ENSEGUIDA
// una nueva entrada para esa misma tarea, con una nota distinta. Sirve para partir
// el tiempo en dos cuando cambias de lo que estás haciendo dentro de la misma tarea,
// sin tener que pausar y volver a darle a play a mano.
function restartActiveTaskWithNote(note) {
  const task = getActiveTask();
  if (!task) return;
  const last = task.entries[task.entries.length - 1];
  if (last && !last.end) { last.end = Date.now(); }   // la nota de esa sesión se conserva en su entrada
  const entry = { start: Date.now(), end: null, nameAtTime: task.name };
  const n = (note || '').trim().slice(0, 500);
  if (n) entry.note = n;
  task.entries.push(entry);
  saveData(); broadcastState(); resetReminderTimer();
}

// Reabre una entrada ya cerrada (le quita la hora de fin) para que siga sumando hasta
// ahora, como si nunca se hubiera parado. Antes cierra lo que estuviera activo (si era
// otra tarea), para que solo haya una entrada "en curso" a la vez.
function resumeEntry(taskId, entryIndex) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !task.entries[entryIndex]) return;
  const entry = task.entries[entryIndex];
  if (entry.end == null) return;   // ya está en curso
  pauseActive();
  entry.end = null;
  // El resto de la app (el propio pauseActive, la nota rápida del panel principal...)
  // da por hecho que la entrada "en curso" es SIEMPRE la última del array. Si se
  // reanuda una que no lo era, hay que moverla al final para no romper eso: si no,
  // el panel mostraba/editaba la nota de otra entrada distinta (parecía que se borraba).
  task.entries.splice(entryIndex, 1);
  task.entries.push(entry);
  state.activeTaskId = taskId;
  saveData(); broadcastState(); resetReminderTimer();
}

function createTask(name, color) {
  const id = Date.now().toString();
  const finalColor = settings.colorMode === 'manual' ? (color || nextAutoColor()) : nextAutoColor();
  state.tasks.push({ id, name, color: finalColor, entries: [], archived: false, groupId: null });
  saveData(); broadcastState();
  return id;
}

// Borrado "suave": la tarea desaparece del panel, de Guardadas y de los selectores,
// pero sus entradas SIGUEN en el calendario (con su nombre, nota y horas de siempre),
// porque el calendario es un registro de lo que de verdad ha pasado, no una vista en
// vivo de las tareas actuales.
function deleteTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  if (state.activeTaskId === taskId) pauseActive();
  task.deleted = true;
  task.deletedAt = Date.now();   // para la papelera (se puede restaurar durante TRASH_RETENTION_DAYS)
  task.purged = false;
  saveData(); broadcastState();
}

// Devuelve la tarea a la vida: reaparece en el panel principal (sin sección). Vale
// tanto desde la papelera como desde el calendario (aunque ya haya caducado en la
// papelera), porque sus entradas nunca se han ido.
function restoreTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.deleted = false;
  task.archived = false;
  task.groupId = null;
  delete task.deletedAt;
  delete task.purged;
  saveData(); broadcastState();
}

// "Eliminar definitivamente" desde la papelera: la saca de la lista de la papelera,
// pero sus entradas SIGUEN en el calendario (el calendario es un registro permanente),
// así que todavía se puede restaurar desde allí si hiciera falta.
function purgeTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.purged = true;
  saveData(); broadcastState();
}

function editTaskColor(taskId, color) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !color) return;
  task.color = color;
  saveData(); broadcastState();
}

// Solo cambia el nombre "en vivo" de la tarea: las entradas ya creadas guardan su
// propio nameAtTime y no se tocan (el calendario es un registro fijo). Afecta a las
// entradas que se creen A PARTIR DE AHORA. Para corregir una entrada ya existente,
// se edita su nombre desde el propio popup del calendario (solo cambia esa).
function renameTask(taskId, name) {
  const task = state.tasks.find(t => t.id === taskId);
  const n = (name || '').trim();
  if (!task || !n) return;
  task.name = n.slice(0, 120);
  saveData(); broadcastState();
}

// ── Grupos guardados ─────────────────────────────────────────────────────────
function archiveTask(taskId, groupId, groupName) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  let gid = groupId;
  if (!gid && groupName) {
    const name = groupName.trim();
    if (!name) return;
    let group = state.groups.find(g => g.name.toLowerCase() === name.toLowerCase());
    if (!group) { group = { id: Date.now().toString(), name }; state.groups.push(group); }
    gid = group.id;
  }
  if (!gid || !state.groups.some(g => g.id === gid)) return;
  if (state.activeTaskId === taskId) pauseActive();
  task.archived = true;
  task.groupId = gid;
  saveData(); broadcastState();
}

function createGroup(name) {
  const n = (name || '').trim();
  if (!n) return null;
  let group = state.groups.find(g => g.name.toLowerCase() === n.toLowerCase());
  if (!group) { group = { id: Date.now().toString(), name: n.slice(0, 60) }; state.groups.push(group); }
  saveData(); broadcastState();
  return group.id;
}

function renameGroup(groupId, name) {
  const g = state.groups.find(x => x.id === groupId);
  const n = (name || '').trim();
  if (!g || !n) return;
  g.name = n.slice(0, 60);
  saveData(); broadcastState();
}

function deleteGroup(groupId) {
  if (!state.groups.some(g => g.id === groupId)) return;
  // Las tareas de la sección vuelven al panel principal (no se pierden).
  state.tasks.forEach(t => { if (t.groupId === groupId) { t.archived = false; t.groupId = null; } });
  state.groups = state.groups.filter(g => g.id !== groupId);
  saveData(); broadcastState();
}

// Mueve una tarea (ya guardada) de una sección a otra sin sacarla de "Guardadas".
function moveTaskToGroup(taskId, groupId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !state.groups.some(g => g.id === groupId)) return;
  if (state.activeTaskId === taskId) pauseActive();
  task.groupId = groupId;
  task.archived = true;
  saveData(); broadcastState();
}

function restoreAndStartTask(taskId, backMinutes) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.archived = false;
  startTask(taskId, backMinutes);
  openMain();
}

function editEntry(taskId, entryIndex, startMs, endMs, note, name) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !task.entries[entryIndex]) return;
  const e = task.entries[entryIndex];
  // Solo se aplica lo que llega. Al redimensionar se envía ÚNICAMENTE el borde que se
  // arrastra: si se mandaban los dos, el borde no tocado se pisaba con un valor viejo
  // (el calendario no se reconstruye con el ratón encima) y "se movía solo". Igual con
  // la nota: es propia de ESTA entrada, así que no toca el resto de veces que se ha
  // hecho la misma tarea. El nombre (nameAtTime) también es solo de esta entrada: no
  // renombra la tarea ni cambia otras entradas (para eso, doble clic en el panel).
  if (startMs !== undefined && startMs !== null) e.start = startMs;
  if (endMs !== undefined) e.end = endMs;
  if (note !== undefined) {
    const n = (note || '').trim().slice(0, 500);
    if (n) e.note = n; else delete e.note;
  }
  if (name !== undefined) {
    const nm = (name || '').trim().slice(0, 120);
    if (nm) e.nameAtTime = nm;
  }
  saveData(); broadcastState();
}

function deleteEntry(taskId, entryIndex) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !task.entries[entryIndex]) return;
  task.entries.splice(entryIndex, 1);
  if (state.activeTaskId === taskId && !task.entries.some(e => !e.end)) state.activeTaskId = null;
  saveData(); broadcastState();
}

function addCalendarEntry(taskId, newTaskName, newTaskColor, startMs, endMs, note) {
  let task = state.tasks.find(t => t.id === taskId);
  if (!task && newTaskName) {
    const id = Date.now().toString();
    const finalColor = settings.colorMode === 'manual' ? (newTaskColor || nextAutoColor()) : nextAutoColor();
    task = { id, name: newTaskName, color: finalColor, entries: [], archived: false, groupId: null };
    state.tasks.push(task);
  }
  if (!task || startMs == null) return;
  const entry = { start: startMs, end: endMs || null, nameAtTime: task.name };
  const n = (note || '').trim().slice(0, 500);
  if (n) entry.note = n;
  task.entries.push(entry);
  saveData(); broadcastState();
}

// ── Reminder widget ───────────────────────────────────────────────────────────
function getReminderMs() {
  return (settings.reminderMinutes || 10) * 60000;
}

function resetReminderTimer() {
  if (reminderTimer) clearTimeout(reminderTimer);
  if (state.activeTaskId) reminderTimer = setTimeout(showReminder, getReminderMs());
}

function showReminder() {
  if (!state.activeTaskId) return;
  if (widgetWin && !widgetWin.isDestroyed()) { widgetWin.showInactive(); scheduleWidgetAutoHide(); }
  else createWidgetWindow();
  reminderTimer = setTimeout(showReminder, getReminderMs());
}

let widgetHideTimer = null;
function scheduleWidgetAutoHide() {
  if (widgetHideTimer) clearTimeout(widgetHideTimer);
  widgetHideTimer = null;
  if (!settings.widgetAutoHide) return;
  const ms = (settings.widgetAutoHideSeconds || 10) * 1000;
  widgetHideTimer = setTimeout(() => {
    if (widgetWin && !widgetWin.isDestroyed()) widgetWin.hide();
  }, ms);
}

// El blur (acrílico) está SIEMPRE puesto. El deslizador controla la opacidad del
// tinte oscuro que va sobre el cristal: más opaco (tapa el blur, más sólido) o más
// translúcido (se ve más el blur del escritorio). Como el material no cambia, no
// aparece el "gris" de togglear el material en caliente.
function bgAlphaFromOpacity(op) {
  const x = Math.max(0, Math.min(100, op == null ? 50 : Number(op))) / 100;
  return (0.20 + x * 0.72).toFixed(3);   // 0 → 0.20 (muy translúcido) .. 100 → 0.92 (muy opaco)
}

function applyTranslucency(win) {
  if (!win || win.isDestroyed()) return;
  try { win.setOpacity(1); } catch {}
  try { win.setBackgroundColor('#00000000'); } catch {}   // mantiene la transparencia del cristal
  try { win.setBackgroundMaterial('acrylic'); } catch {}  // blur SIEMPRE
}

function applyTranslucencyAll() {
  // El dock NO lleva acrílico (ver createDock): se excluye a propósito.
  [mainWin, calendarWin, groupsWin, settingsWin, widgetWin, syncWin, updateWin].forEach(w => applyTranslucency(w));
  broadcastTheme();
}

// Paleta actual, ya resuelta (incluye el --bg con la opacidad elegida). Se manda a los
// renderers, que la aplican como variables CSS: así llega también a las vistas del dock,
// que van en iframes (insertCSS solo alcanzaría al frame principal).
function themeVars() {
  const t = THEMES[settings.theme] || THEMES[DEFAULT_THEME];
  const acc = ACCENTS[settings.accent];   // si no hay elegido, manda el del tema
  const light = t.scheme === 'light';
  return {
    key: settings.theme,
    bg: `rgba(${t.base},${bgAlphaFromOpacity(settings.bgOpacity)})`,
    bg2: light ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.06)',
    bg3: light ? 'rgba(0,0,0,0.085)' : 'rgba(255,255,255,0.10)',
    border: light ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.12)',
    text: light ? '#1a1a24' : '#f0f0f8',
    text2: light ? 'rgba(26,26,36,0.6)' : 'rgba(240,240,248,0.55)',
    accent: acc ? acc.accent : t.accent,
    accent2: acc ? acc.accent2 : t.accent2,
    accentKey: settings.accent || null,
    surface: t.surface,
    scheme: t.scheme,
  };
}

function broadcastTheme() {
  const vars = themeVars();
  [mainWin, calendarWin, groupsWin, settingsWin, widgetWin, syncWin, updateWin, dockWin, splashWin]
    .forEach(w => sendToAllFrames(w, 'theme', vars));
}

// Guardado diferido de ajustes: los deslizadores de la barra flotante disparan cambios
// decenas de veces por segundo y no hace falta escribir el archivo en cada uno.
const saveSettingsSoon = (() => {
  let t = null;
  return () => { clearTimeout(t); t = setTimeout(saveSettings, 400); };
})();

function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// La pantalla "de referencia" para abrir/posicionar ventanas nuevas: la que tenga el
// panel principal en ese momento (si no existe todavía, la principal del sistema).
function getReferenceDisplay() {
  if (mainWin && !mainWin.isDestroyed()) {
    try { return screen.getDisplayMatching(mainWin.getBounds()); } catch {}
  }
  return screen.getPrimaryDisplay();
}

// Recalcula los límites min/max de una ventana según la pantalla en la que esté AHORA
// (guardados como "medidas de diseño" en win.__sizeSpec, sin recortar), y si con el
// nuevo límite ya no cabe, la encoge para que quede dentro del área de trabajo.
function adaptWindowToItsDisplay(win) {
  if (!win || win.isDestroyed() || !win.__sizeSpec) return;
  const { minWidth, minHeight, maxWidth, maxHeight } = win.__sizeSpec;
  let disp;
  try { disp = screen.getDisplayMatching(win.getBounds()); } catch { return; }
  const work = disp.workArea;
  const cappedMaxW = Math.max(minWidth, Math.min(maxWidth, work.width));
  const cappedMaxH = Math.max(minHeight, Math.min(maxHeight, work.height));
  try { win.setMaximumSize(cappedMaxW, cappedMaxH); } catch {}
  try { win.setMinimumSize(Math.min(minWidth, cappedMaxW), Math.min(minHeight, cappedMaxH)); } catch {}
  const b = win.getBounds();
  const newW = Math.min(b.width, cappedMaxW);
  const newH = Math.min(b.height, cappedMaxH);
  if (newW !== b.width || newH !== b.height) {
    const x = Math.min(Math.max(b.x, work.x), work.x + work.width - newW);
    const y = Math.min(Math.max(b.y, work.y), work.y + work.height - newH);
    try { win.setBounds({ x, y, width: newW, height: newH }); } catch {}
  }
}

// w/h son el tamaño "ideal" de arranque; minWidth/minHeight/maxWidth/maxHeight en opts
// son las medidas DE DISEÑO (sin recortar a ninguna pantalla en concreto): makeWindow las
// ajusta ya a la pantalla de referencia al crearla, y las reajusta sola si la ventana se
// mueve a otra pantalla (ver adaptWindowToItsDisplay, enganchado al evento 'move').
function makeWindow(file, w, h, opts = {}) {
  const { minWidth, minHeight, maxWidth, maxHeight, x, y, center, ...restOpts } = opts;
  const disp = getReferenceDisplay();
  const work = disp.workArea;

  const designMinW = minWidth || 0;
  const designMinH = minHeight || 0;
  const designMaxW = maxWidth || 100000;
  const designMaxH = maxHeight || 100000;
  const cappedMaxW = Math.max(designMinW, Math.min(designMaxW, work.width));
  const cappedMaxH = Math.max(designMinH, Math.min(designMaxH, work.height));
  const initW = Math.max(Math.min(designMinW, cappedMaxW), Math.min(w, cappedMaxW));
  const initH = Math.max(Math.min(designMinH, cappedMaxH), Math.min(h, cappedMaxH));

  let posX = x, posY = y;
  if (posX == null && posY == null && center !== false) {
    posX = work.x + Math.round((work.width - initW) / 2);
    posY = work.y + Math.round((work.height - initH) / 2);
  }

  const win = new BrowserWindow({
    width: initW, height: initH,
    x: posX, y: posY,
    minWidth: Math.min(designMinW, cappedMaxW), minHeight: Math.min(designMinH, cappedMaxH),
    maxWidth: cappedMaxW, maxHeight: cappedMaxH,
    frame: false, transparent: true, hasShadow: false,
    resizable: true, roundedCorners: true,
    icon: APP_ICON_PATH,
    ...restOpts,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.__sizeSpec = { minWidth: designMinW, minHeight: designMinH, maxWidth: designMaxW, maxHeight: designMaxH };
  win.on('move', debounce(() => adaptWindowToItsDisplay(win), 200));
  win.loadFile(path.join(__dirname, 'src', file));
  applyTranslucency(win);
  return win;
}

function createWidgetWindow() {
  const work = getReferenceDisplay().workArea;
  const W = 320, H = 172;
  widgetWin = makeWindow('widget.html', W, H, {
    x: work.x + work.width - W - 20, y: work.y + work.height - H - 20,
    alwaysOnTop: true, skipTaskbar: true,
    show: false,          // no mostrar al crear: mostramos sin activar (ver showInactive)
    minWidth: 280, minHeight: 140,
    maxWidth: 460, maxHeight: 260,
  });
  // showInactive: aparece encima pero SIN robar el foco, para no sacarte de lo que
  // estuvieras escribiendo en otra aplicación.
  widgetWin.once('ready-to-show', () => { widgetWin.showInactive(); sendStateToWindow(widgetWin); scheduleWidgetAutoHide(); });
}

// ── Modo dock (barra flotante lateral) ────────────────────────────────────────
// La ventana tiene tamaño FIJO (el del panel desplegado) y NO se redimensiona: el
// plegar/desplegar es puramente CSS dentro del renderer (fluido), y la parte transparente
// deja pasar los clics al escritorio con setIgnoreMouseEvents (el renderer decide cuándo,
// según si el ratón está sobre algo interactivo). Sin material acrílico: acrílico rellena
// toda la ventana de gris aunque el DOM sea transparente (era el "recuadro gris raro").
// La ventana del dock cubre TODA el área de trabajo de la pantalla elegida y es
// transparente + click-through: así la posición de la barra (cualquiera de los 4 bordes
// o de las 4 esquinas), el tamaño del panel y las animaciones son puro CSS, sin tener
// que recalcular ni redimensionar la ventana (que era lo que iba a tirones).
const DOCK_ANCHORS = ['left','right','top','bottom'];

function dockDisplay() {
  const displays = screen.getAllDisplays();
  if (settings.dockDisplayId != null) {
    const d = displays.find(x => x.id === settings.dockDisplayId);
    if (d) return d;
  }
  return getReferenceDisplay();
}

// Config visual del dock que se envía al renderer (anclaje, colores, tamaños...).
function dockConfig() {
  const anchor = DOCK_ANCHORS.includes(settings.dockAnchor) ? settings.dockAnchor : 'right';
  return {
    anchor,
    barWidth: Math.max(3, Math.min(24, Number(settings.dockBarWidth) || 7)),
    barLength: Math.max(30, Math.min(600, Number(settings.dockBarLength) || 110)),
    barPos: Math.max(0, Math.min(100, settings.dockBarPos == null ? 50 : Number(settings.dockBarPos))),
    barOffset: Math.max(0, Math.min(120, settings.dockBarOffset == null ? 4 : Number(settings.dockBarOffset))),
    barOpacity: Math.max(5, Math.min(100, Number(settings.dockBarOpacity) || 30)),
    barColor: settings.dockBarColor || '#ffffff',
    panelWidth: Math.max(320, Math.min(1600, Number(settings.dockPanelWidth) || 460)),
    panelHeight: Math.max(260, Math.min(1200, Number(settings.dockPanelHeight) || 460)),
    calendarWidth: Math.max(420, Math.min(1900, Number(settings.dockCalendarWidth) || 1180)),
  };
}

// Toda el área de trabajo de la pantalla elegida.
function computeDockBounds() {
  const work = dockDisplay().workArea;
  return { x: work.x, y: work.y, width: work.width, height: work.height };
}

// Empuja la config visual al renderer del dock (al crearlo y al cambiar Ajustes).
function sendDockConfig() {
  if (!dockWin || dockWin.isDestroyed()) return;
  const send = () => { try { dockWin.webContents.send('dock-config', dockConfig()); } catch {} };
  if (dockWin.webContents.isLoading()) dockWin.webContents.once('did-finish-load', send);
  else send();
}

function createDock() {
  if (dockWin && !dockWin.isDestroyed()) return;
  dockWin = new BrowserWindow({
    ...computeDockBounds(),
    frame: false, transparent: true, hasShadow: false, backgroundColor: '#00000000',
    resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true,
    roundedCorners: false, focusable: true,
    icon: APP_ICON_PATH,
    webPreferences: { nodeIntegration: true, contextIsolation: false, nodeIntegrationInSubFrames: true },
  });
  dockExpanded = false;
  // Sin acrílico ni insertCSS de --bg: la ventana es transparente de verdad; el panel del
  // dock pinta su propio fondo. Arranca dejando pasar los clics (solo la barra captura).
  try { dockWin.setIgnoreMouseEvents(true, { forward: true }); } catch {}
  dockWin.loadFile(path.join(__dirname, 'src', 'dock.html'));
  sendDockConfig();
  dockWin.once('ready-to-show', () => { if (dockWin && !dockWin.isDestroyed()) dockWin.showInactive(); });
  dockWin.on('closed', () => { dockWin = null; dockExpanded = false; });

  // Red de seguridad: la ventana cubre toda el área de trabajo, y quien decide si los
  // clics pasan al escritorio es el renderer. Si el renderer se cuelga o se muere, esa
  // decisión deja de actualizarse, así que forzamos click-through (y si ha muerto del
  // todo, salimos del modo dock) para no dejar la pantalla bloqueada.
  dockWin.webContents.on('unresponsive', () => {
    try { dockWin.setIgnoreMouseEvents(true, { forward: true }); } catch {}
  });
  dockWin.webContents.on('render-process-gone', () => {
    destroyDock();
    settings.dockMode = false; saveSettings(); updateTrayTitle();
    openMain();
  });
}

function destroyDock() {
  if (dockWin && !dockWin.isDestroyed()) dockWin.close();
  dockWin = null; dockExpanded = false;
}

// Reposiciona el dock y le reenvía la config (pantalla, lado, grosor, color...).
function positionDock() {
  if (!dockWin || dockWin.isDestroyed()) return;
  try { dockWin.setBounds(computeDockBounds()); } catch {}
  sendDockConfig();
}

// Recuerda por dónde andaba el usuario para volver a abrir ahí (ver openLastView).
// Ajustes no cuenta: no es una "pestaña" a la que tenga sentido volver al arrancar.
function rememberView(view) {
  if (view === 'settings' || settings.lastView === view) return;
  settings.lastView = view;
  saveSettingsSoon();
}

// Abre la app por donde se quedó la última vez (panel, calendario o guardadas).
function openLastView() {
  checkForUpdatesIfStale();
  const v = settings.lastView;
  if (settings.dockMode) { dockNavigate(v && v !== 'settings' ? v : 'panel'); return; }
  if (v === 'calendar') openCalendar();
  else if (v === 'groups') openGroups();
  else openMain();
}

// Enseña una vista dentro del dock (en vez de abrir una ventana suelta).
function dockNavigate(view) {
  checkForUpdatesIfStale();
  rememberView(view);
  if (!dockWin || dockWin.isDestroyed()) createDock();
  const send = () => { try { dockWin.webContents.send('dock-navigate', view); } catch {} };
  if (dockWin.webContents.isLoading()) dockWin.webContents.once('did-finish-load', send);
  else send();
  try { dockWin.showInactive(); } catch {}
}

// Aplica el modo dock al cambiarlo en Ajustes (o al arrancar). wasDock = estado anterior.
function applyDockMode(wasDock) {
  if (settings.dockMode) {
    // Al entrar en modo dock, escondemos las ventanas sueltas y creamos la barra.
    [mainWin, calendarWin, groupsWin, settingsWin].forEach(w => { try { if (w && !w.isDestroyed()) w.hide(); } catch {} });
    createDock();
    if (!wasDock) dockNavigate('panel');
    else positionDock();   // reajusta a la pantalla elegida
  } else if (wasDock) {
    destroyDock();
    openMain();
  }
}

function openMain() {
  checkForUpdatesIfStale();   // aprovecha que el usuario vuelve a la app para refrescar, sin esperar al temporizador
  if (settings.dockMode) { dockNavigate('panel'); return; }
  rememberView('panel');
  if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus(); sendStateToWindow(mainWin); return; }
  mainWin = makeWindow('main.html', 560, 660, {
    minWidth: 380, minHeight: 480,
    maxWidth: 900, maxHeight: 1000,
  });
  mainWin.once('ready-to-show', () => { mainWin.show(); sendStateToWindow(mainWin); });
  mainWin.on('closed', () => { mainWin = null; });
}

function createSplash() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const S = 300;
  splashWin = new BrowserWindow({
    width: S, height: S,
    x: Math.round((width - S) / 2), y: Math.round((height - S) / 2),
    frame: false, transparent: true, hasShadow: false,
    resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true,
    show: false,
    icon: APP_ICON_PATH,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  splashWin.loadFile(path.join(__dirname, 'src', 'splash.html'));
  splashWin.once('ready-to-show', () => splashWin.show());
  return splashWin;
}

function showSplashThenMain() {
  const splash = createSplash();
  let closed = false;
  const closeSplash = () => {
    if (closed) return; closed = true;
    if (!splash || splash.isDestroyed()) return;
    try { splash.webContents.send('leave'); } catch {}
    setTimeout(() => { if (splash && !splash.isDestroyed()) splash.close(); }, 340);
  };
  setTimeout(() => {
    openLastView();
    const first = mainWin || calendarWin || groupsWin;
    if (first && !first.isDestroyed()) first.once('show', closeSplash);
    else closeSplash();
    // Cierre de seguridad: pase lo que pase (si 'show' no llega, la ventana tarda,
    // etc.) el splash nunca se queda enganchado.
    setTimeout(closeSplash, 2500);
  }, 3500);
}

function openCalendar() {
  if (settings.dockMode) { dockNavigate('calendar'); return; }
  checkForUpdatesIfStale();
  rememberView('calendar');
  if (calendarWin && !calendarWin.isDestroyed()) { calendarWin.show(); calendarWin.focus(); sendStateToWindow(calendarWin); return; }
  calendarWin = makeWindow('calendar.html', 1280, 760, {
    minWidth: 760, minHeight: 520,
    maxWidth: 1600, maxHeight: 1000,
  });
  calendarWin.once('ready-to-show', () => { calendarWin.show(); sendStateToWindow(calendarWin); });
  calendarWin.on('closed', () => { calendarWin = null; });
}

function openSettings() {
  if (settings.dockMode) { dockNavigate('settings'); return; }
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = makeWindow('settings.html', 430, 720, {
    minWidth: 380, minHeight: 420,
    maxWidth: 560, maxHeight: 900,
  });
  settingsWin.once('ready-to-show', () => { settingsWin.show(); settingsWin.webContents.send('settings', settings); });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function openGroups() {
  if (settings.dockMode) { dockNavigate('groups'); return; }
  checkForUpdatesIfStale();
  rememberView('groups');
  if (groupsWin && !groupsWin.isDestroyed()) { groupsWin.show(); groupsWin.focus(); sendStateToWindow(groupsWin); return; }
  groupsWin = makeWindow('groups.html', 420, 620, {
    minWidth: 340, minHeight: 420,
    maxWidth: 700, maxHeight: 1000,
  });
  groupsWin.once('ready-to-show', () => { groupsWin.show(); sendStateToWindow(groupsWin); });
  groupsWin.on('closed', () => { groupsWin = null; });
}

function openSync() {
  if (syncWin && !syncWin.isDestroyed()) { syncWin.show(); syncWin.focus(); return; }
  syncWin = makeWindow('sync.html', 400, 520, { minWidth: 360, minHeight: 460, maxWidth: 520, maxHeight: 680 });
  syncWin.once('ready-to-show', () => { syncWin.show(); syncWin.webContents.send('sync-status', syncStatus); });
  syncWin.on('closed', () => { syncWin = null; });
}

// Ventana de actualización con el estilo de la app (sustituye a los diálogos nativos,
// que quedaban ocultos tras el splash). Su contenido cambia según el estado que le
// envía el auto-updater vía 'update-state'.
function openUpdateWindow() {
  if (updateWin && !updateWin.isDestroyed()) { updateWin.show(); updateWin.focus(); return; }
  updateWin = makeWindow('update.html', 400, 320, {
    alwaysOnTop: true, resizable: false,
    minWidth: 360, minHeight: 280, maxWidth: 460, maxHeight: 380,
  });
  updateWin.once('ready-to-show', () => {
    updateWin.show(); updateWin.focus();
    try { updateWin.moveTop(); } catch {}
    if (pendingUpdateState) updateWin.webContents.send('update-state', pendingUpdateState);
  });
  updateWin.on('closed', () => { updateWin = null; });
}

function sendUpdateState(state) {
  pendingUpdateState = state;
  if (updateWin && !updateWin.isDestroyed()) updateWin.webContents.send('update-state', state);
}

// ── IPC ───────────────────────────────────────────────────────────────────────
function getSerializableState() {
  return {
    tasks: state.tasks.map(t => ({
      ...t,
      todaySecs: todaySecondsForTask(t),
      totalSecs: totalSecondsForTask(t),
      inTrash: isInTrash(t),   // para la sección "Papelera" de Guardadas
    })),
    groups: state.groups,
    activeTaskId: state.activeTaskId,
    todayTotal: totalTodaySeconds(),
    settings,
    updateAvailable: updateInfo,
    trashRetentionDays: TRASH_RETENTION_DAYS,
  };
}

// webContents.send() SOLO llega al frame principal. En modo dock las vistas (panel,
// calendario, guardadas, ajustes) viven en un iframe, así que sin reenviar a los
// sub-frames se quedaban con el estado del momento en que cargaron: las acciones se
// ejecutaban de verdad pero la interfaz no se refrescaba nunca (parecía que restaurar,
// eliminar de la papelera o reanudar una tarea "no hacían nada").
function sendToAllFrames(win, channel, payload) {
  if (!win || win.isDestroyed()) return;
  try { win.webContents.send(channel, payload); } catch {}
  try {
    (win.webContents.mainFrame.frames || []).forEach(f => { try { f.send(channel, payload); } catch {} });
  } catch {}
}

function sendStateToWindow(win) {
  if (!win || win.isDestroyed()) return;
  sendToAllFrames(win, 'state', getSerializableState());
}

function broadcastState() {
  updateTrayTitle();
  // dockWin comparte webContents con sus iframes: enviarle el estado llega a la vista
  // embebida (panel/calendario/guardadas) que tenga cargada en ese momento.
  [widgetWin, mainWin, calendarWin, groupsWin, dockWin].forEach(w => sendStateToWindow(w));
}

ipcMain.on('action', (event, { type, payload }) => {
  switch (type) {
    case 'start-task':    startTask(payload.taskId, payload.backMinutes); break;
    case 'pause':         pauseActive(); break;
    case 'switch-task':   switchTask(payload.taskId, payload.backMinutes); break;
    case 'restart-task-with-note': restartActiveTaskWithNote(payload && payload.note); break;
    case 'resume-entry':  resumeEntry(payload.taskId, payload.entryIndex); break;
    case 'create-task': {
      const id = createTask(payload.name, payload.color);
      startTask(id, payload.backMinutes);
      openMain();
      break;
    }
    case 'delete-task':   deleteTask(payload.taskId); break;
    case 'restore-task':  restoreTask(payload.taskId); break;
    case 'purge-task':    purgeTask(payload.taskId); break;
    case 'edit-task-color': editTaskColor(payload.taskId, payload.color); break;
    case 'rename-task':   renameTask(payload.taskId, payload.name); break;
    case 'set-active-note': setActiveEntryNote(payload.note); break;
    case 'archive-task':  archiveTask(payload.taskId, payload.groupId, payload.groupName); break;
    case 'create-group':  createGroup(payload.name); break;
    case 'rename-group':  renameGroup(payload.groupId, payload.name); break;
    case 'delete-group':  deleteGroup(payload.groupId); break;
    case 'move-task-to-group': moveTaskToGroup(payload.taskId, payload.groupId); break;
    case 'restore-and-start-task': restoreAndStartTask(payload.taskId, payload.backMinutes); break;
    case 'edit-entry':    editEntry(payload.taskId, payload.entryIndex, payload.startMs, payload.endMs, payload.note, payload.name); break;
    case 'delete-entry':  deleteEntry(payload.taskId, payload.entryIndex); break;
    case 'add-calendar-entry':
      addCalendarEntry(payload.taskId, payload.newTaskName, payload.newTaskColor, payload.startMs, payload.endMs, payload.note);
      break;
    case 'save-settings': {
      const wasDock = settings.dockMode;
      settings = { ...settings, ...payload };
      saveSettings(); resetReminderTimer(); applyLoginItem(); applyTranslucencyAll();
      applyDockMode(wasDock);   // crea/destruye el dock si ha cambiado el modo
      // En modo dock, Ajustes es un iframe: al guardar volvemos al panel. Fuera de él,
      // se cierra la ventana de Ajustes como siempre.
      if (settings.dockMode && wasDock) dockNavigate('panel');
      else if (!settings.dockMode && settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
      break;
    }
    case 'set-bg-opacity':
      settings.bgOpacity = Math.max(0, Math.min(100, Number(payload.value)));
      saveSettings(); applyTranslucencyAll();
      break;
    case 'mark-tutorial-seen': {
      const ids = Array.isArray(payload && payload.ids) ? payload.ids : [];
      const seen = new Set(settings.tutorialSeenSteps || []);
      ids.forEach(id => seen.add(id));
      settings.tutorialSeenSteps = [...seen];
      saveSettings(); broadcastState();
      break;
    }
    case 'reset-tutorial':
      settings.tutorialSeenSteps = [];
      saveSettings(); broadcastState();
      openMain();
      break;
    case 'open-main':     openMain(); break;
    case 'open-calendar': openCalendar(); break;
    case 'open-settings': openSettings(); break;
    case 'open-groups':   openGroups(); break;
    case 'close-widget':
      if (widgetHideTimer) { clearTimeout(widgetHideTimer); widgetHideTimer = null; }
      if (widgetWin && !widgetWin.isDestroyed()) widgetWin.hide();
      break;
    case 'close-main':
      if (settings.dockMode && dockWin && !dockWin.isDestroyed()) dockWin.webContents.send('dock-collapse');
      else if (mainWin && !mainWin.isDestroyed()) mainWin.hide();
      break;
    case 'dock-set-ignore-mouse':
      if (dockWin && !dockWin.isDestroyed()) {
        try { dockWin.setIgnoreMouseEvents(!!(payload && payload.ignore), { forward: true }); } catch {}
      }
      break;
    case 'dock-focus':
      checkForUpdatesIfStale();
      if (dockWin && !dockWin.isDestroyed()) { try { dockWin.focus(); } catch {} }
      break;
    // Vista previa en vivo mientras se toquetea la barra en Ajustes (sin darle a Guardar).
    case 'set-dock-config': {
      const { preview, ...vals } = payload || {};
      settings = { ...settings, ...vals };
      saveSettingsSoon();   // los deslizadores disparan esto muchas veces por segundo
      if (settings.dockMode) { createDock(); positionDock(); }
      // Con el panel abierto la barrita se oculta; al ajustarla hay que verla.
      if (preview && dockWin && !dockWin.isDestroyed()) {
        try { dockWin.webContents.send('dock-bar-preview'); } catch {}
      }
      break;
    }
    // El interruptor de "modo barra flotante" se aplica al momento (no al Guardar), y
    // deja el dock en Ajustes para poder seguir configurándolo sin perder de vista nada.
    case 'set-dock-mode': {
      const wasDock = !!settings.dockMode;
      settings.dockMode = !!(payload && payload.enabled);
      saveSettings();
      if (settings.dockMode) {
        [mainWin, calendarWin, groupsWin, settingsWin].forEach(w => { try { if (w && !w.isDestroyed()) w.hide(); } catch {} });
        createDock();
        if (!wasDock) dockNavigate('settings'); else positionDock();
      } else if (wasDock) {
        destroyDock();
        openSettings();
      }
      updateTrayTitle();
      break;
    }
    case 'get-theme':     event.reply('theme', themeVars()); break;
    case 'set-theme':
      if (payload && payload.theme !== undefined) {
        settings.theme = THEMES[payload.theme] ? payload.theme : DEFAULT_THEME;
      }
      if (payload && payload.accent !== undefined) {
        settings.accent = ACCENTS[payload.accent] ? payload.accent : null;   // null = el del tema
      }
      saveSettings(); broadcastTheme();
      break;
    case 'get-settings':  event.reply('settings', settings); break;
    case 'min-main':      if (mainWin && !mainWin.isDestroyed()) mainWin.minimize(); break;
    case 'close-calendar':
      if (settings.dockMode) dockNavigate('panel');
      else if (calendarWin && !calendarWin.isDestroyed()) calendarWin.hide();
      break;
    case 'close-settings':
      if (settings.dockMode) dockNavigate('panel');
      else if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
      break;
    case 'close-groups':
      if (settings.dockMode) dockNavigate('panel');
      else if (groupsWin && !groupsWin.isDestroyed()) groupsWin.hide();
      break;
    case 'open-sync':     openSync(); break;
    case 'close-sync':    if (syncWin && !syncWin.isDestroyed()) syncWin.hide(); break;
    case 'open-update-window': openUpdateWindow(); break;   // desde el botón rojo del panel
    case 'update-download': if (autoUpdater) autoUpdater.downloadUpdate(); break;
    case 'update-install':  if (autoUpdater) setImmediate(() => autoUpdater.quitAndInstall()); break;
    case 'close-update':    if (updateWin && !updateWin.isDestroyed()) updateWin.close(); break;
    case 'check-for-updates': checkForUpdates(true); break;   // botón "Buscar actualizaciones" de Ajustes
    case 'get-state':     event.reply('state', getSerializableState()); break;
  }
});

// Arrastre de ventana desde el asa (.win-drag). Lo hacemos a mano porque
// -webkit-app-region: drag no funcionaba en la ventana del calendario. Guardamos la
// posición del cursor y de la ventana al empezar, y en cada movimiento reposicionamos
// según cuánto se ha desplazado el cursor.
let winDragState = null;
ipcMain.on('win-drag', (event, phase) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (phase === 'start') {
    winDragState = { win, cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() };
  } else if (phase === 'move' && winDragState && winDragState.win === win) {
    const p = screen.getCursorScreenPoint();
    const { cursor, bounds } = winDragState;
    const x = bounds.x + (p.x - cursor.x);
    const y = bounds.y + (p.y - cursor.y);
    // Solo tocamos el ancho/alto cuando de verdad se ha desviado del original (al cruzar
    // a una pantalla con distinta escala/DPI, Windows reescala la ventana sola). Antes se
    // reafirmaba el tamaño en CADA movimiento incluso sin hacer falta, y ese setBounds de
    // más (compitiendo con el reescalado del sistema) es lo que se veía como pequeños
    // saltos/tirones mientras se arrastraba. Así solo se corrige cuando hay algo que corregir.
    const current = win.getBounds();
    if (current.width !== bounds.width || current.height !== bounds.height) {
      win.setBounds({ x, y, width: bounds.width, height: bounds.height });
    } else {
      win.setPosition(x, y);
    }
  } else if (phase === 'end') {
    winDragState = null;
  }
});

// Exportar CSV: abre un diálogo nativo "Guardar como…" y escribe el archivo.
// El contenido lo genera el renderer (que ya tiene el estado y sabe qué rango exportar).
ipcMain.handle('export-csv', async (_e, { content, defaultName }) => {
  try {
    const parent = calendarWin && !calendarWin.isDestroyed() ? calendarWin : undefined;
    const baseDir = app.getPath('documents') || app.getPath('home') || app.getPath('desktop') || '';
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      title: 'Exportar horas',
      defaultPath: path.join(baseDir, defaultName || 'imputa-horas.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, '﻿' + (content || ''), 'utf8');  // BOM para que Excel respete los acentos
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// ── Copia de seguridad (export/import de tareas y grupos a un .json local) ────
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

ipcMain.handle('export-backup', async () => {
  try {
    const parent = settingsWin && !settingsWin.isDestroyed() ? settingsWin : (mainWin || undefined);
    const baseDir = app.getPath('documents') || app.getPath('home') || app.getPath('desktop') || '';
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      title: 'Exportar copia de seguridad',
      defaultPath: path.join(baseDir, `imputa-backup-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'Copia de seguridad de imputa.me', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    const payload = { imputaBackup: true, exportedAt: new Date().toISOString(), tasks: state.tasks, groups: state.groups };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// Guarda el backup ya leído entre 'import-backup' (que solo calcula qué hay que
// decidir) y 'apply-import-backup' (que lo aplica), para no tener que mandar todo
// el JSON de un lado a otro dos veces por IPC.
let pendingImport = null;

ipcMain.handle('import-backup', async () => {
  try {
    const parent = settingsWin && !settingsWin.isDestroyed() ? settingsWin : (mainWin || undefined);
    const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
      title: 'Restaurar copia de seguridad',
      filters: [{ name: 'Copia de seguridad de imputa.me', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
    const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (!raw || !Array.isArray(raw.tasks) || !Array.isArray(raw.groups)) {
      return { ok: false, error: 'El archivo no es una copia de seguridad válida de imputa.me.' };
    }
    // Compara cada tarea/grupo de la copia con lo que ya hay en local por id: si no
    // existe es nuevo (se añade sin preguntar), si es idéntico se ignora en silencio,
    // y si existe pero con datos distintos es un conflicto que hay que decidir.
    const conflicts = [];
    let newCount = 0, sameCount = 0;
    const localTasksById = new Map(state.tasks.map(t => [t.id, t]));
    const localGroupsById = new Map(state.groups.map(g => [g.id, g]));
    raw.tasks.forEach(t => {
      const local = localTasksById.get(t.id);
      if (!local) newCount++;
      else if (deepEqual(local, t)) sameCount++;
      else conflicts.push({ kind: 'task', id: t.id, key: `task:${t.id}`, name: t.name, localName: local.name });
    });
    raw.groups.forEach(g => {
      const local = localGroupsById.get(g.id);
      if (!local) newCount++;
      else if (deepEqual(local, g)) sameCount++;
      else conflicts.push({ kind: 'group', id: g.id, key: `group:${g.id}`, name: g.name, localName: local.name });
    });
    pendingImport = raw;
    return { ok: true, newCount, sameCount, conflicts };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('apply-import-backup', async (_e, payload) => {
  if (!pendingImport) return { ok: false, error: 'No hay ninguna copia cargada.' };
  const raw = pendingImport; pendingImport = null;
  const res = (payload && payload.resolutions) || {};
  pauseActive();   // evita que un reemplazo deje la tarea activa en un estado ambiguo
  raw.groups.forEach(g => {
    const idx = state.groups.findIndex(x => x.id === g.id);
    if (idx === -1) { state.groups.push(g); return; }
    if (deepEqual(state.groups[idx], g)) return;
    if (res[`group:${g.id}`] === 'replace') state.groups[idx] = g;
  });
  raw.tasks.forEach(t => {
    const idx = state.tasks.findIndex(x => x.id === t.id);
    if (idx === -1) { state.tasks.push(t); return; }
    if (deepEqual(state.tasks[idx], t)) return;
    if (res[`task:${t.id}`] === 'replace') state.tasks[idx] = t;
  });
  saveData(); broadcastState();
  return { ok: true };
});

// Login/logout de sincronización (respuestas asíncronas)
ipcMain.handle('sync-login', async (_e, { email, password }) => sync ? sync.login(email, password) : { ok: false, error: 'Sync no disponible' });
ipcMain.handle('sync-logout', async () => sync ? sync.logout() : { ok: true });
ipcMain.handle('sync-status', async () => syncStatus);

function startTick() {
  tickTimer = setInterval(() => {
    updateTrayTitle();
    if (state.activeTaskId) broadcastState();
  }, 1000);
}

// ── Auto-actualización (electron-updater + GitHub Releases) ───────────────────
// Comprueba al arrancar si hay una versión más nueva publicada en GitHub Releases.
// Si la hay, avisa con un diálogo nativo y, con un botón, la descarga e instala.
// No necesita ninguna ventana de la app (funciona aunque el panel esté cerrado).
let autoUpdater = null;
let manualCheck = false;   // true cuando el usuario pulsa "Buscar actualizaciones…"
let lastAutoCheckAt = 0;
const AUTO_CHECK_THROTTLE_MS = 10 * 60 * 1000;   // como mucho una comprobación automática cada 10 min

// Comprueba actualizaciones si ha pasado un rato desde la última vez (se llama al
// volver al panel): así, si estaba abierta de fondo cuando salió una versión nueva,
// no hay que esperar al temporizador de 1h ni acordarse de pulsar "Buscar
// actualizaciones" a mano — basta con volver a la app.
function checkForUpdatesIfStale() {
  if (!autoUpdater) return;
  if (Date.now() - lastAutoCheckAt < AUTO_CHECK_THROTTLE_MS) return;
  checkForUpdates(false);
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;          // en desarrollo no existe app-update.yml
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    autoUpdater = null;                 // dependencia no instalada aún
    return;
  }
  autoUpdater.autoDownload = false;     // primero preguntamos; el botón confirma
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    manualCheck = false;
    updateInfo = { version: info.version };
    broadcastState();                    // muestra el botón rojo "Actualizar" en el panel
    openUpdateWindow();
    sendUpdateState({ phase: 'available', current: app.getVersion(), version: info.version });
  });

  autoUpdater.on('download-progress', (p) => {
    sendUpdateState({ phase: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p.percent || 0))) });
  });

  autoUpdater.on('update-not-available', () => {
    if (manualCheck) { openUpdateWindow(); sendUpdateState({ phase: 'uptodate', current: app.getVersion() }); }
    manualCheck = false;
  });

  autoUpdater.on('update-downloaded', (info) => {
    openUpdateWindow();
    sendUpdateState({ phase: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    if (manualCheck) { openUpdateWindow(); sendUpdateState({ phase: 'error', message: String((err && err.message) || err) }); }
    manualCheck = false;
  });

  checkForUpdates(false);                              // al arrancar
  setTimeout(() => checkForUpdates(false), 15000);     // reintento por si la red aún no estaba lista (p.ej. arranque con Windows)
  setInterval(() => checkForUpdates(false), 60 * 60 * 1000);  // y cada hora mientras esté abierta
}

function checkForUpdates(manual) {
  if (!autoUpdater) {
    if (manual) { openUpdateWindow(); sendUpdateState({ phase: 'unavailable' }); }
    return;
  }
  lastAutoCheckAt = Date.now();
  manualCheck = manual;
  if (manual) { openUpdateWindow(); sendUpdateState({ phase: 'checking' }); }
  autoUpdater.checkForUpdates().catch((err) => {
    if (manualCheck) { openUpdateWindow(); sendUpdateState({ phase: 'error', message: String((err && err.message) || err) }); }
    manualCheck = false;
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  DATA_FILE = path.join(app.getPath('userData'), 'imputa-tasks.json');
  SETTINGS_FILE = path.join(app.getPath('userData'), 'imputa-settings.json');
  loadData();

  // Sincronización opcional (Supabase). Si hay sesión guardada, arranca sola.
  if (sync) sync.init({
    sessionFile: path.join(app.getPath('userData'), 'imputa-sync.json'),
    getState: () => state,
    saveRaw: saveDataRaw,
    onChange: () => { saveDataRaw(); broadcastState(); },
    onStatus: (s) => {
      syncStatus = s;
      if (tray) tray.setContextMenu(buildTrayMenu());
      if (syncWin && !syncWin.isDestroyed()) syncWin.webContents.send('sync-status', s);
      // Ajustes puede estar como ventana o embebido en el dock (iframe): a los dos.
      sendToAllFrames(settingsWin, 'sync-status', s);
      sendToAllFrames(dockWin, 'sync-status', s);
    },
  }).catch(() => {});

  const trayIcon = nativeImage.createFromPath(APP_ICON_PATH).resize({ width: 32, height: 32, quality: 'best' });

  tray = new Tray(trayIcon);
  tray.setToolTip('imputa.me');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => openLastView());

  startTick();
  resetReminderTimer();
  applyLoginItem();                         // sincroniza el registro con el ajuste guardado
  // Si arranca solo por el inicio de sesión de Windows (--hidden), vamos directos
  // a la bandeja sin abrir el panel; en un arranque normal sí mostramos el panel.
  if (!process.argv.includes('--hidden')) showSplashThenMain();
  setupAutoUpdate();
});

app.on('window-all-closed', e => e.preventDefault());
// saveSettings() explícito: saveSettingsSoon puede tener un guardado pendiente (p. ej.
// la última vista abierta) que se perdería si la app se cierra antes de que salte.
app.on('before-quit', () => { pauseActive(); saveData(); saveSettings(); });
