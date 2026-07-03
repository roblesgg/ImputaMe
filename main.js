const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

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

function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)); } catch {}
}

function saveSettings() {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch {}
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

function restoreAndStartTask(taskId, backMinutes) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.archived = false;
  startTask(taskId, backMinutes);
  openMain();
}

function editEntry(taskId, entryIndex, startMs, endMs) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !task.entries[entryIndex]) return;
  task.entries[entryIndex].start = startMs;
  task.entries[entryIndex].end = endMs || null;
  saveData(); broadcastState();
}

function deleteEntry(taskId, entryIndex) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !task.entries[entryIndex]) return;
  task.entries.splice(entryIndex, 1);
  if (state.activeTaskId === taskId && !task.entries.some(e => !e.end)) state.activeTaskId = null;
  saveData(); broadcastState();
}

function addCalendarEntry(taskId, newTaskName, newTaskColor, startMs, endMs) {
  let task = state.tasks.find(t => t.id === taskId);
  if (!task && newTaskName) {
    const id = Date.now().toString();
    const finalColor = settings.colorMode === 'manual' ? (newTaskColor || nextAutoColor()) : nextAutoColor();
    task = { id, name: newTaskName, color: finalColor, entries: [], archived: false, groupId: null };
    state.tasks.push(task);
  }
  if (!task || startMs == null) return;
  task.entries.push({ start: startMs, end: endMs || null });
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
  if (widgetWin && !widgetWin.isDestroyed()) { widgetWin.show(); widgetWin.focus(); scheduleWidgetAutoHide(); }
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

function makeWindow(file, w, h, opts = {}) {
  const win = new BrowserWindow({
    width: w, height: h,
    frame: false, transparent: true, hasShadow: false,
    resizable: true, roundedCorners: true,
    icon: APP_ICON_PATH,
    ...opts,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  try { win.setBackgroundMaterial('acrylic'); } catch {}
  win.loadFile(path.join(__dirname, 'src', file));
  return win;
}

function createWidgetWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const W = 320, H = 172;
  widgetWin = makeWindow('widget.html', W, H, {
    x: width - W - 20, y: height - H - 20,
    alwaysOnTop: true, skipTaskbar: true,
    minWidth: 280, minHeight: 140,
    maxWidth: 460, maxHeight: 260,
  });
  widgetWin.once('ready-to-show', () => { widgetWin.show(); sendStateToWindow(widgetWin); scheduleWidgetAutoHide(); });
}

function openMain() {
  if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus(); sendStateToWindow(mainWin); return; }
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWin = makeWindow('main.html', 560, 660, {
    center: true,
    minWidth: 380, minHeight: 480,
    maxWidth: Math.min(900, width), maxHeight: Math.min(1000, height),
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
  setTimeout(() => {
    openMain();
    if (mainWin) {
      mainWin.once('show', () => {
        if (splash.isDestroyed()) return;
        splash.webContents.send('leave');
        setTimeout(() => { if (!splash.isDestroyed()) splash.close(); }, 340);
      });
    }
  }, 4000);
}

function openCalendar() {
  if (calendarWin && !calendarWin.isDestroyed()) { calendarWin.show(); calendarWin.focus(); sendStateToWindow(calendarWin); return; }
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  calendarWin = makeWindow('calendar.html', Math.min(1280, width), 760, {
    minWidth: 760, minHeight: 520,
    maxWidth: Math.min(1600, width), maxHeight: Math.min(1000, height),
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
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  groupsWin = makeWindow('groups.html', 420, 620, {
    minWidth: 340, minHeight: 420,
    maxWidth: Math.min(700, width), maxHeight: Math.min(1000, height),
  });
  groupsWin.once('ready-to-show', () => { groupsWin.show(); sendStateToWindow(groupsWin); });
  groupsWin.on('closed', () => { groupsWin = null; });
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
    case 'archive-task':  archiveTask(payload.taskId, payload.groupId, payload.groupName); break;
    case 'restore-and-start-task': restoreAndStartTask(payload.taskId, payload.backMinutes); break;
    case 'edit-entry':    editEntry(payload.taskId, payload.entryIndex, payload.startMs, payload.endMs); break;
    case 'delete-entry':  deleteEntry(payload.taskId, payload.entryIndex); break;
    case 'add-calendar-entry':
      addCalendarEntry(payload.taskId, payload.newTaskName, payload.newTaskColor, payload.startMs, payload.endMs);
      break;
    case 'save-settings':
      settings = { ...settings, ...payload };
      saveSettings(); resetReminderTimer();
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
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
    case 'get-state':     event.reply('state', getSerializableState()); break;
  }
});

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
    const idx = dialog.showMessageBoxSync({
      type: 'info',
      title: 'imputa.me',
      message: 'Hay una actualización disponible',
      detail: `Tu versión: ${app.getVersion()}\nNueva versión: ${info.version}\n\n¿Descargarla e instalarla ahora?`,
      buttons: ['Actualizar', 'Ahora no'],
      defaultId: 0, cancelId: 1, noLink: true,
    });
    manualCheck = false;
    if (idx === 0) autoUpdater.downloadUpdate();
  });

  autoUpdater.on('update-not-available', () => {
    if (manualCheck) {
      dialog.showMessageBoxSync({
        type: 'info', title: 'imputa.me', message: 'Todo al día',
        detail: `Ya tienes la última versión (${app.getVersion()}).`, buttons: ['Vale'],
      });
    }
    manualCheck = false;
  });

  autoUpdater.on('update-downloaded', (info) => {
    const idx = dialog.showMessageBoxSync({
      type: 'info', title: 'imputa.me',
      message: 'Actualización lista para instalar',
      detail: `Se ha descargado la versión ${info.version}. La app se reiniciará para instalarla.`,
      buttons: ['Reiniciar e instalar', 'Más tarde'],
      defaultId: 0, cancelId: 1, noLink: true,
    });
    if (idx === 0) setImmediate(() => autoUpdater.quitAndInstall());
  });

  autoUpdater.on('error', (err) => {
    if (manualCheck) {
      dialog.showMessageBoxSync({
        type: 'error', title: 'imputa.me', message: 'No se pudo comprobar la actualización',
        detail: String((err && err.message) || err), buttons: ['Vale'],
      });
    }
    manualCheck = false;
  });

  checkForUpdates(false);               // comprobación silenciosa al arrancar
}

function checkForUpdates(manual) {
  if (!autoUpdater) {
    if (manual) {
      dialog.showMessageBoxSync({
        type: 'info', title: 'imputa.me', message: 'Actualizaciones no disponibles',
        detail: 'Las actualizaciones automáticas solo funcionan en la versión instalada de la app.',
        buttons: ['Vale'],
      });
    }
    return;
  }
  manualCheck = manual;
  autoUpdater.checkForUpdates().catch(() => { manualCheck = false; });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  DATA_FILE = path.join(app.getPath('userData'), 'imputa-tasks.json');
  SETTINGS_FILE = path.join(app.getPath('userData'), 'imputa-settings.json');
  loadData();

  const trayIcon = nativeImage.createFromPath(APP_ICON_PATH).resize({ width: 32, height: 32, quality: 'best' });

  tray = new Tray(trayIcon);
  tray.setToolTip('imputa.me');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => openMain());

  startTick();
  resetReminderTimer();
  showSplashThenMain();
  setupAutoUpdate();
});

app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', () => { pauseActive(); saveData(); });
