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
  // Alguien ha vuelto a lanzar la app mientras ya estaba corriendo: solo traemos el
  // panel al frente, no dejamos que se abra un proceso duplicado.
  openMain();
});

const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TASK_COLORS = ['#6366f1','#f472b6','#34d399','#fbbf24','#60a5fa','#f87171','#a78bfa','#2dd4bf'];

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
  const taskItems = state.tasks.filter(t => !t.archived).map(t => ({
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
    { label: 'Buscar actualizaciones…', click: () => checkForUpdates(true) },
    { label: 'Salir', click: () => { saveData(); app.quit(); } },
  ]);
}

// ── Acciones ─────────────────────────────────────────────────────────────────
function startTask(taskId, backMinutes) {
  pauseActive();
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  state.activeTaskId = taskId;
  const start = backMinutes ? Date.now() - backMinutes * 60000 : Date.now();
  task.entries.push({ start, end: null });
  saveData(); broadcastState(); resetReminderTimer();
}

function pauseActive() {
  const task = getActiveTask();
  if (task) {
    const last = task.entries[task.entries.length - 1];
    if (last && !last.end) last.end = Date.now();
  }
  state.activeTaskId = null;
  saveData(); broadcastState();
}

function switchTask(taskId, backMinutes) {
  if (state.activeTaskId === taskId) pauseActive();
  else startTask(taskId, backMinutes);
}

function createTask(name, color) {
  const id = Date.now().toString();
  const finalColor = settings.colorMode === 'manual' ? (color || nextAutoColor()) : nextAutoColor();
  state.tasks.push({ id, name, color: finalColor, entries: [], archived: false, groupId: null });
  saveData(); broadcastState();
  return id;
}

function deleteTask(taskId) {
  if (state.activeTaskId === taskId) pauseActive();
  state.tasks = state.tasks.filter(t => t.id !== taskId);
  saveData(); broadcastState();
}

function editTaskColor(taskId, color) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !color) return;
  task.color = color;
  saveData(); broadcastState();
}

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

function editEntry(taskId, entryIndex, startMs, endMs, note) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !task.entries[entryIndex]) return;
  const e = task.entries[entryIndex];
  // Solo se aplica lo que llega. Al redimensionar se envía ÚNICAMENTE el borde que se
  // arrastra: si se mandaban los dos, el borde no tocado se pisaba con un valor viejo
  // (el calendario no se reconstruye con el ratón encima) y "se movía solo". Igual con
  // la nota: es propia de ESTA entrada (no de la tarea), así que no toca el nombre ni
  // el resto de veces que se ha hecho la misma tarea.
  if (startMs !== undefined && startMs !== null) e.start = startMs;
  if (endMs !== undefined) e.end = endMs;
  if (note !== undefined) {
    const n = (note || '').trim().slice(0, 500);
    if (n) e.note = n; else delete e.note;
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
  const entry = { start: startMs, end: endMs || null };
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
  const css = `:root{ --bg: rgba(18,18,28,${bgAlphaFromOpacity(settings.bgOpacity)}) !important; }`;
  const doInsert = async () => {
    try {
      if (win.__bgCssKey) { try { await win.webContents.removeInsertedCSS(win.__bgCssKey); } catch {} }
      win.__bgCssKey = await win.webContents.insertCSS(css);
    } catch {}
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', doInsert);
  else doInsert();
}

function applyTranslucencyAll() {
  [mainWin, calendarWin, groupsWin, settingsWin, widgetWin, syncWin, updateWin].forEach(w => applyTranslucency(w));
}

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

function openMain() {
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
    openMain();
    if (mainWin && !mainWin.isDestroyed()) mainWin.once('show', closeSplash);
    else closeSplash();
    // Cierre de seguridad: pase lo que pase (si 'show' no llega, la ventana tarda,
    // etc.) el splash nunca se queda enganchado.
    setTimeout(closeSplash, 2500);
  }, 3500);
}

function openCalendar() {
  if (calendarWin && !calendarWin.isDestroyed()) { calendarWin.show(); calendarWin.focus(); sendStateToWindow(calendarWin); return; }
  calendarWin = makeWindow('calendar.html', 1280, 760, {
    minWidth: 760, minHeight: 520,
    maxWidth: 1600, maxHeight: 1000,
  });
  calendarWin.once('ready-to-show', () => { calendarWin.show(); sendStateToWindow(calendarWin); });
  calendarWin.on('closed', () => { calendarWin = null; });
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = makeWindow('settings.html', 380, 380, {
    minWidth: 340, minHeight: 360,
    maxWidth: 520, maxHeight: 560,
  });
  settingsWin.once('ready-to-show', () => { settingsWin.show(); settingsWin.webContents.send('settings', settings); });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function openGroups() {
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
    })),
    groups: state.groups,
    activeTaskId: state.activeTaskId,
    todayTotal: totalTodaySeconds(),
    settings,
    updateAvailable: updateInfo,
  };
}

function sendStateToWindow(win) {
  if (win && !win.isDestroyed()) win.webContents.send('state', getSerializableState());
}

function broadcastState() {
  updateTrayTitle();
  [widgetWin, mainWin, calendarWin, groupsWin].forEach(w => sendStateToWindow(w));
}

ipcMain.on('action', (event, { type, payload }) => {
  switch (type) {
    case 'start-task':    startTask(payload.taskId, payload.backMinutes); break;
    case 'pause':         pauseActive(); break;
    case 'switch-task':   switchTask(payload.taskId, payload.backMinutes); break;
    case 'create-task': {
      const id = createTask(payload.name, payload.color);
      startTask(id, payload.backMinutes);
      openMain();
      break;
    }
    case 'delete-task':   deleteTask(payload.taskId); break;
    case 'edit-task-color': editTaskColor(payload.taskId, payload.color); break;
    case 'rename-task':   renameTask(payload.taskId, payload.name); break;
    case 'archive-task':  archiveTask(payload.taskId, payload.groupId, payload.groupName); break;
    case 'create-group':  createGroup(payload.name); break;
    case 'rename-group':  renameGroup(payload.groupId, payload.name); break;
    case 'delete-group':  deleteGroup(payload.groupId); break;
    case 'move-task-to-group': moveTaskToGroup(payload.taskId, payload.groupId); break;
    case 'restore-and-start-task': restoreAndStartTask(payload.taskId, payload.backMinutes); break;
    case 'edit-entry':    editEntry(payload.taskId, payload.entryIndex, payload.startMs, payload.endMs, payload.note); break;
    case 'delete-entry':  deleteEntry(payload.taskId, payload.entryIndex); break;
    case 'add-calendar-entry':
      addCalendarEntry(payload.taskId, payload.newTaskName, payload.newTaskColor, payload.startMs, payload.endMs, payload.note);
      break;
    case 'save-settings':
      settings = { ...settings, ...payload };
      saveSettings(); resetReminderTimer(); applyLoginItem(); applyTranslucencyAll();
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
      break;
    case 'set-bg-opacity':
      settings.bgOpacity = Math.max(0, Math.min(100, Number(payload.value)));
      saveSettings(); applyTranslucencyAll();
      break;
    case 'open-main':     openMain(); break;
    case 'open-calendar': openCalendar(); break;
    case 'open-settings': openSettings(); break;
    case 'open-groups':   openGroups(); break;
    case 'close-widget':
      if (widgetHideTimer) { clearTimeout(widgetHideTimer); widgetHideTimer = null; }
      if (widgetWin && !widgetWin.isDestroyed()) widgetWin.hide();
      break;
    case 'close-main':    if (mainWin && !mainWin.isDestroyed()) mainWin.hide(); break;
    case 'min-main':      if (mainWin && !mainWin.isDestroyed()) mainWin.minimize(); break;
    case 'close-calendar': if (calendarWin && !calendarWin.isDestroyed()) calendarWin.hide(); break;
    case 'close-settings': if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide(); break;
    case 'close-groups':   if (groupsWin && !groupsWin.isDestroyed()) groupsWin.hide(); break;
    case 'open-sync':     openSync(); break;
    case 'close-sync':    if (syncWin && !syncWin.isDestroyed()) syncWin.hide(); break;
    case 'open-update-window': openUpdateWindow(); break;   // desde el botón rojo del panel
    case 'update-download': if (autoUpdater) autoUpdater.downloadUpdate(); break;
    case 'update-install':  if (autoUpdater) setImmediate(() => autoUpdater.quitAndInstall()); break;
    case 'close-update':    if (updateWin && !updateWin.isDestroyed()) updateWin.close(); break;
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
    // Fijamos también el ancho/alto en cada movimiento (no solo x/y): al cruzar a una
    // pantalla con distinta escala (DPI), Windows reescala la ventana sola, y si no se
    // reafirma aquí el tamaño original se va agrandando sin parar mientras se arrastra.
    win.setBounds({
      x: bounds.x + (p.x - cursor.x),
      y: bounds.y + (p.y - cursor.y),
      width: bounds.width,
      height: bounds.height,
    });
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
  setInterval(() => checkForUpdates(false), 4 * 60 * 60 * 1000);  // y cada 4 horas mientras esté abierta
}

function checkForUpdates(manual) {
  if (!autoUpdater) {
    if (manual) { openUpdateWindow(); sendUpdateState({ phase: 'unavailable' }); }
    return;
  }
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
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('sync-status', s);
    },
  }).catch(() => {});

  const trayIcon = nativeImage.createFromPath(APP_ICON_PATH).resize({ width: 32, height: 32, quality: 'best' });

  tray = new Tray(trayIcon);
  tray.setToolTip('imputa.me');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => openMain());

  startTick();
  resetReminderTimer();
  applyLoginItem();                         // sincroniza el registro con el ajuste guardado
  // Si arranca solo por el inicio de sesión de Windows (--hidden), vamos directos
  // a la bandeja sin abrir el panel; en un arranque normal sí mostramos el panel.
  if (!process.argv.includes('--hidden')) showSplashThenMain();
  setupAutoUpdate();
});

app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', () => { pauseActive(); saveData(); });
