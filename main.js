const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, dialog, nativeTheme, Notification } = require('electron');
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

// Recorrido de novedades que se muestra UNA vez al actualizar. Solo para quien va por el
// canal estable: en el de prueba las versiones se suceden a diario y sería un incordio.
// Un mismo recorrido puede valer para varias versiones (2.2.1 solo arreglaba que este
// no llegara a salir), y por eso se comparte el objeto: así se detecta que ya se ha
// visto y no se repite palabra por palabra en la siguiente actualización.
const NOVEDADES_2_2 = {
  title: 'Novedades de imputa.me 2.2',
  steps: [
    { icon:'cursor', title:'Se acabó el parpadeo del cursor',
      text:'Al pasar el ratón por botones, campos y agarradores el cursor se quedaba parpadeando entre la flecha y la mano. Ya no: ahora se mantiene estable mientras mueves el ratón.' },
    { icon:'calendar', title:'Las tareas ya no se pisan',
      text:'Al estirar una tarea por sus extremos en el calendario, ahora hace tope justo donde llega la de al lado. Si la arrastras a fondo, una acaba exactamente cuando empieza la otra.' },
    { icon:'calendar', title:'Horas legibles en cada tarea',
      text:'La duración baja a su propia línea, así que la hora de inicio y la de fin se leen enteras sin cortarse.' },
    { icon:'screen', title:'Mejor con varios monitores',
      text:'Al esconder el panel flotante ya no asoma un instante en la pantalla de al lado: ahora entra y sale con un desvanecido sin salir nunca de su monitor.' },
    { icon:'spark', title:'Se esconde a tu ritmo',
      text:'Si usas "esconder cuando el ratón sale", puedes ajustar el retardo en medios segundos, e incluso ponerlo a cero para que se esconda al instante.' },
    { icon:'bell', title:'Actualizaciones sin sorpresas',
      text:'Cuando haya una versión nueva te avisa sola con una notificación, pero no se descarga ni se instala nada sin que tú lo decidas.' },
    { icon:'spark', title:'Esto que estás viendo',
      text:'A partir de ahora, cada versión estable te recibe con un recorrido como este. Puedes repasarlo cuando quieras desde Ajustes → Ver novedades.' },
  ],
};

const NOVEDADES_2_3 = {
  title: 'Novedades de imputa.me 2.3',
  steps: [
    { icon:'bar', title:'La barra flotante ya no se pierde',
      text:'Se quedaba sin aparecer al encender el ordenador, y con varios monitores podía acabar plantada en medio de la pantalla. Ahora se recoloca sola al arrancar, cuando conectas o desconectas pantallas, y vuelve siempre a su sitio al cerrar el panel.' },
    { icon:'cursor', title:'Se enciende cuando estás al lado',
      text:'Antes se iluminaba desde bastante lejos. Ahora reacciona con el ratón ya pegado, y en Ajustes → Barra flotante puedes decidir a qué distancia exacta se enciende.' },
    { icon:'spark', title:'Se mueve con suavidad',
      text:'El panel iba a trompicones al abrirse y al cambiar de pestaña porque se le animaba el tamaño paso a paso. Ahora entra y sale con un desvanecido limpio.' },
    { icon:'screen', title:'Arrastrar ya no se queda pegado',
      text:'Si al agrandar el panel soltabas el ratón fuera de la ventana, se quedaba enganchado como si siguieras pulsando hasta hacer clic en otro sitio. Arreglado, también al mover la barrita.' },
    { icon:'guide', title:'El tutorial te lleva de la mano',
      text:'Ahora es un recorrido guiado: empieza en el Panel y te lleva solo al Calendario, a Guardadas y a Ajustes. Tú solo le das a Siguiente. Además arranca en el momento de pulsarlo, y en las páginas largas se desplaza sola hasta lo que te está explicando.' },
    { icon:'pencil', title:'Renombrar con un clic',
      text:'Cada tarea del Panel y cada sección de Guardadas tiene su lápiz al lado del botón de borrar. Ya no hay que adivinar que era doble clic (que sigue funcionando).' },
    { icon:'folder', title:'Ordena tus secciones',
      text:'En Guardadas hay un botón nuevo para ordenar las secciones: alfabéticamente, por orden de creación, o a tu manera arrastrándolas por su asa. Tu orden se guarda.' },
  ],
};

const NOVEDADES_2_4 = {
  title: 'Novedades de imputa.me 2.4',
  steps: [
    { icon:'lista', title:'Subtareas',
      text:'Dentro de una tarea puedes crear subtareas: en "Cocina", el horno y el frigorífico. La flechita de cada tarea del Panel las despliega, cada una lleva su propio tiempo y su play, y todo lo que hagas dentro suma en la tarea. Sus notas van como siempre, una por sesión.' },
    { icon:'spark', title:'El Panel, reorganizado',
      text:'Lo que estás haciendo ahora ocupa el sitio de honor: una tarjeta grande con su cronómetro, su nota y el botón de pausar. El total del día baja a una línea fina y la lista de abajo ya no repite la tarea que está arriba.' },
    { icon:'guide', title:'Accesos rápidos',
      text:'Bajo la lista de tareas tienes cuatro botones: Calendario, Guardadas, Ajustes, y uno que vuelve a poner en marcha la última tarea que estuviste haciendo, con su nombre puesto.' },
    { icon:'enlace', title:'Botón para imputar',
      text:'En Ajustes → Enlace para imputar pega la dirección del sitio donde metes las horas de verdad. Aparecerá un botón "Imputar" en el Panel y en el Calendario que te lleva ahí de un clic.' },
    { icon:'reloj', title:'Hora de salida',
      text:'Dile a qué hora terminas y, si a esa hora sigue habiendo una tarea en marcha, te aviso. La misma hora toda la semana o una distinta cada día, con los que no trabajes cancelados. Y si quieres, que te la pare yo sola.' },
    { icon:'ojo', title:'Descansa la vista',
      text:'La regla 20-20-20 que recomiendan los oftalmólogos: cada 20 minutos, mira 20 segundos a algo que esté a unos 6 metros. Salen unos ojos flotantes con la cuenta atrás; eliges cada cuánto, cuánto duran, dónde y de qué tamaño, y un clic los quita hasta la próxima.' },
    { icon:'calendar', title:'Tu semana y tu mes',
      text:'En el calendario, debajo de las tareas del día están ahora las de la semana y las del mes, cada bloque con el tiempo de cada tarea y su total. Y en cada rato puedes elegir a qué subtarea fue.' },
    { icon:'screen', title:'La barra y tus monitores',
      text:'Si desconectas la pantalla donde tenías la barra flotante, se pasa sola a la que quede, y al volver a conectarla se va otra vez a ella. La reconoce por sus medidas, porque Windows le cambia el identificador al reconectarla.' },
  ],
};

// La 2.4 contaba las novedades y ya: un resumen leído, sin enseñar dónde estaba nada.
// Este es corto a propósito, porque lo que explica de verdad viene después: el
// recorrido guiado, que va señalando cada cosa en su sitio.
const NOVEDADES_2_4_1 = {
  title: 'Novedades de imputa.me 2.4',
  steps: [
    { icon:'guide', title:'Ahora te lo enseño, no te lo cuento',
      text:'Hasta ahora las novedades eran una presentación que leías y cerrabas, y luego tocaba buscarse la vida. A partir de aquí, el recorrido va por la app señalando cada cosa nueva en el sitio donde está.' },
    { icon:'lista', title:'Lo que trae la 2.4',
      text:'Subtareas dentro de cada tarea, el Panel reorganizado con lo que estás haciendo en grande, accesos rápidos, hora de salida, la regla 20-20-20 para descansar la vista, un botón para imputar y los totales de semana y mes en el calendario.' },
    { icon:'spark', title:'Tú solo dale a Siguiente',
      text:'El recorrido empieza en el Panel y te lleva solo al Calendario, a Guardadas y a Ajustes. Solo verás lo que sea nuevo para ti, y puedes dejarlo a medias cuando quieras: lo visto queda visto. Lo tienes siempre en Ajustes → Ver tutorial.' },
  ],
};

const NOVEDADES_2_5 = {
  title: 'Novedades de imputa.me 2.5',
  steps: [
    { icon:'guide', title:'Te lo enseño donde está',
      text:'Como en la 2.4: cuando acabes de leer esto, el recorrido te lleva por la app señalando cada cosa nueva en su sitio. Solo verás lo que no hayas visto ya, y con darle a Siguiente basta.' },
    { icon:'bell', title:'No molestar',
      text:'Silencia de golpe todo lo que sale por encima: el recordatorio de las horas, los ojos del 20-20-20 y las notificaciones. Los minutos u horas que quieras, y los cronómetros siguen contando igual.' },
    { icon:'bar', title:'La barra, con su menú',
      text:'Clic derecho sobre la barra flotante: esconderla un rato, cambiarla de pantalla o de borde, pausar la tarea, o pasarte al modo clásico de ventanas. Y ya no se queda detrás de lo que pongas a pantalla completa.' },
    { icon:'folder', title:'Guardadas, como un esquema',
      text:'Cada tarea guardada despliega sus subtareas con el tiempo que llevan, y pulsando una retomas la tarea justo en ella. Con botones para abrirlo y cerrarlo todo, y ordenado ascendente o descendente.' },
    { icon:'calendar', title:'Los días que trabajas',
      text:'Quita el sábado y el domingo del calendario y las columnas se reparten el hueco. Y si una semana suelta sí trabajas un sábado, lo metes solo en esa semana desde el botón "Días".' },
    { icon:'pencil', title:'Clic derecho en el calendario',
      text:'Sobre cualquier rato del calendario: guardar la tarea en una sección, retomarla desde ahora o alargar ese rato hasta ahora — conservando su subtarea y su nota — y editarlo o eliminarlo.' },
    { icon:'spark', title:'Y por debajo',
      text:'24 colores de tarea en vez de 8, animaciones bastante más fluidas, el panel flotante se adapta de tamaño con animación al cambiar de pestaña, los ojos avisan cuando toca de verdad, y el instalador ya no te pide cerrar la app a mano al actualizar.' },
  ],
};

const WHATS_NEW = {
  '2.2.0': NOVEDADES_2_2,
  '2.2.1': NOVEDADES_2_2,
  '2.3.0': NOVEDADES_2_3,
  '2.4.0': NOVEDADES_2_4,
  '2.4.1': NOVEDADES_2_4_1,
  '2.5.0': NOVEDADES_2_5,
};

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
let leaveTimer = null;
let eyeCareWin = null;
let eyeCareTimer = null;
let eyeCareNextAt = 0;       // momento del próximo aviso de la regla 20-20-20
let eyeCareHideTimer = null;
let leaveNotifiedOn = null;   // 'YYYY-MM-DD' del último aviso, para no repetirlo
let tickTimer = null;
let syncWin = null;
let updateWin = null;
let whatsNewWin = null;
let dockWin = null;              // ventana transparente de la BARRITA (click-through)
let dockPanelWin = null;         // ventana del PANEL: sin transparencia y con acrílico
let dockExpanded = false;
// Recorrido guiado en marcha: encadena Panel → Calendario → Guardadas → Ajustes.
let tourActive = false;
const TOUR_ORDER = ['main', 'calendar', 'groups', 'settings'];
let dockHitRects = [];           // zonas "clicables" del dock, en coords de su ventana
let dockOutsideSince = 0;        // desde cuándo el cursor está fuera del panel desplegado
let lastBarRaiseAt = 0;          // para no reordenar ventanas en cada evento (ver 'set-dock-config')
let dockBarRect = null;          // rectángulo de la barrita, para saber si el ratón se acerca
let dockBarNear = null;
let dockHitTimer = null;
let dockIgnoring = null;
let pendingUpdateState = null;   // último estado enviado a la ventana de actualización
let updateInfo = null;           // { version } si hay una actualización disponible (para el botón del panel)
let syncStatus = { loggedIn: false, email: null };

// Módulo de sincronización opcional (Supabase). Si falla el require, la app sigue local.
let sync = null;
try { sync = require('./sync'); } catch {}

// ── Estado ──────────────────────────────────────────────────────────────────
let state = {
  tasks: [],           // { id, name, color, subtasks: [{id,name}], entries: [{start, end, subId}], archived, groupId }
  groups: [],          // { id, name }
  activeTaskId: null,
  activeSubId: null,   // subtarea en marcha dentro de la tarea activa (null = la tarea a secas)
};

let settings = {
  reminderMinutes: 10,
  // Enlace a donde imputas de verdad las horas (el portal de tu empresa, una hoja...).
  // Si está puesto, aparece un botón "Imputar" en el Panel y en el Calendario.
  imputeUrl: '',
  // ── Hora de salida ──────────────────────────────────────────────────────────
  // Aviso al terminar la jornada para que no se quede una tarea corriendo toda la
  // noche. Viene apagado: la hora de salida es cosa de cada uno, no hay defecto que
  // valga para todos. Los días van por getDay(): 0 = domingo ... 6 = sábado, y null
  // significa "ese día no me avises".
  leaveEnabled: false,
  leaveSameEveryDay: true,      // una sola hora para toda la semana
  leaveTime: '18:00',
  leaveDays: { 1:'18:00', 2:'18:00', 3:'18:00', 4:'18:00', 5:'18:00', 6:null, 0:null },
  leaveAutoStop: false,   // además de avisar, parar sola la tarea que siga en marcha
  // ── Regla 20-20-20 ──────────────────────────────────────────────────────────
  // Cada 20 minutos, mirar 20 segundos a algo que esté a unos 6 metros. Apagada por
  // defecto: es un aviso que interrumpe, y eso se pide, no se impone.
  eyeCareEnabled: false,
  eyeCareEvery: 20,      // minutos entre avisos
  eyeCareRest: 20,       // segundos que dura la cuenta atrás
  eyeCarePos: 'top',     // topLeft | top | topRight | bottomLeft | bottom | bottomRight
  eyeCareSize: 150,      // ancho de la burbuja en px (el alto va en proporción)
  widgetAutoHide: true,
  widgetAutoHideSeconds: 10,
  colorMode: 'auto', // 'auto' | 'manual'
  openAtLogin: false, // arrancar al iniciar sesión en Windows (desactivado por defecto)
  bgOpacity: 50,       // 0 = muy translúcida (se ve más el blur), 100 = muy opaca. Blur siempre puesto.
  tutorialSeenSteps: [], // ids de pasos del tutorial guiado ya vistos u omitidos (ver TUTORIAL_STEPS en shared.js)
  groupSort: 'created',  // orden de las secciones en Guardadas: 'created' | 'alpha' | 'custom'
  groupSortDir: 'asc',   // y en qué sentido: 'asc' | 'desc'
  // Días que se ven en el calendario, por getDay() (0 = domingo ... 6 = sábado). Por
  // defecto la semana entera; quien no trabaje el fin de semana puede quitarlo y las
  // columnas se reparten el hueco.
  weekDays: [1, 2, 3, 4, 5, 6, 0],
  // Excepciones para UNA semana concreta: { 'AAAA-MM-DD del lunes': [días visibles] }.
  // Sirve para el sábado suelto que sí se trabaja sin cambiar el ajuste general.
  weekOverrides: {},
  dockMode: true,      // modo barra flotante lateral: es el modo por defecto (instalación nueva)
  dockDisplayId: null, // en qué pantalla se ancla el dock (null = la de referencia)
  dockDisplayKey: null, // huella de esa pantalla: al reconectarla Windows puede darle otro id
  dockHiddenUntil: 0,   // 0 = visible; -1 = escondida a mano; si no, marca de tiempo en la que vuelve
  dndUntil: 0,          // No molestar: 0 = apagado; -1 = hasta apagarlo; si no, cuándo se apaga solo
  theme: DEFAULT_THEME, // fondo/paleta base de toda la app (ver THEMES)
  accent: null,         // color de acento; null = el que trae el tema (ver ACCENTS)
  dockAnchor: 'right', // borde al que se pega la barrita: left | right | top | bottom
  dockBarWidth: 7,     // grosor de la barrita (px)
  dockBarLength: 110,  // largo de la barrita (px)
  dockBarPos: 50,      // posición a lo largo del borde, en % (0 = arriba/izq, 100 = abajo/der)
  dockBarOffset: 4,    // cuánto se despega del borde hacia el centro (px)
  dockNearDistance: 45, // a cuántos px del ratón se enciende la barrita (antes 110, fijo)
  dockBarOpacity: 30,  // opacidad de la barrita EN REPOSO (al acercar el ratón va al máximo)
  dockBarColor: '#ffffff',
  dockPanelWidth: 460,  // ancho del panel en las vistas normales (anclajes laterales)
  dockPanelHeight: 620, // alto del panel cuando se ancla arriba/abajo (más generoso: hay ancho de sobra)
  dockCloseMode: 'button',  // 'button' | 'clickOutside' | 'mouseLeave'
  dockCloseSeconds: 3,      // con 'mouseLeave', segundos fuera antes de esconderse (admite decimales y 0)
  blurEnabled: true,        // difuminado del fondo (acrílico de Windows) sí/no
  // Canal de actualizaciones. Con betaUpdates, llegan TODAS las versiones que se publican
  // (las de prueba van marcadas como "prerelease" en GitHub); sin él, solo las marcadas
  // como estables.
  betaUpdates: false,
  lastSeenVersion: null,    // última versión cuyas novedades ya se han visto
  lastSeenWhatsNew: null,   // y de qué hablaban, para no repetir el mismo recorrido
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
    if (!Array.isArray(t.subtasks)) t.subtasks = [];
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

// Segundos de UNA subtarea (o de la tarea "a secas", con subId null): mismo cálculo
// que el de la tarea, filtrando por la subtarea a la que se apuntó cada entrada.
function secondsForSub(task, subId, desde) {
  let total = 0;
  for (const entry of task.entries) {
    if ((entry.subId || null) !== (subId || null)) continue;
    const fin = entry.end || Date.now();
    if (desde != null && fin < desde) continue;
    total += Math.max(0, fin - (desde != null ? Math.max(entry.start, desde) : entry.start));
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
    { label: 'No molestar', type: 'checkbox', checked: dndActive(), click: () => setDnd(dndActive() ? null : 0) },
    { type: 'separator' },
    // Interruptor de escape: permite salir del modo dock desde la bandeja aunque su
    // interfaz no se viera bien, sin depender de abrir Ajustes dentro del propio dock.
    { label: 'Modo barra flotante (dock)', type: 'checkbox', checked: !!settings.dockMode, click: () => toggleDockMode() },
    // Si la barra se escondió desde su menú, esta es la forma de recuperarla.
    { label: 'Mostrar la barra ahora', click: () => hideDockFor(null), visible: !!settings.dockMode && dockIsHidden() },
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
function startTask(taskId, backMinutes, subId, note) {
  pauseActive();
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const sub = subId ? (task.subtasks || []).find(x => x.id === subId) : null;
  state.activeTaskId = taskId;
  state.activeSubId = sub ? sub.id : null;
  const start = backMinutes ? Date.now() - backMinutes * 60000 : Date.now();
  // nameAtTime: "foto" del nombre de la tarea al crear la entrada. El calendario es
  // un registro de lo que pasó, así que si luego renombras la tarea esta entrada no
  // cambia con ella (solo las que se creen después, con el nombre nuevo). La subtarea
  // guarda el suyo por lo mismo: borrarla no debe reescribir el historial.
  const entry = { start, end: null, nameAtTime: task.name };
  if (sub) { entry.subId = sub.id; entry.subNameAtTime = sub.name; }
  // Al continuar desde una entrada anterior se hereda su nota: sigues en lo mismo.
  const n = (note || '').trim().slice(0, 500);
  if (n) entry.note = n;
  task.entries.push(entry);
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
  state.activeSubId = null;
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

function switchTask(taskId, backMinutes, subId, note) {
  // Pulsar el play de lo que ya está corriendo lo pausa; si es otra tarea u otra
  // subtarea de la misma tarea, se cambia a ella.
  const mismaSub = (state.activeSubId || null) === (subId || null);
  if (state.activeTaskId === taskId && mismaSub) pauseActive();
  else startTask(taskId, backMinutes, subId, note);
}

// ── Subtareas ────────────────────────────────────────────────────────────────
// Viven dentro de la tarea ("Cocina" → horno, frigorífico...) y no son tareas aparte:
// cada entrada del calendario apunta a la suya, así que el tiempo de la tarea sigue
// siendo la suma de todo lo que se ha hecho dentro, sin cambiar nada de lo de antes.
function addSubtask(taskId, name) {
  const task = state.tasks.find(t => t.id === taskId);
  const n = (name || '').trim();
  if (!task || !n) return;
  if (!Array.isArray(task.subtasks)) task.subtasks = [];
  task.subtasks.push({ id: `${Date.now()}-${task.subtasks.length}`, name: n.slice(0, 120) });
  saveData(); broadcastState();
}

function renameSubtask(taskId, subId, name) {
  const task = state.tasks.find(t => t.id === taskId);
  const sub = task && (task.subtasks || []).find(x => x.id === subId);
  const n = (name || '').trim();
  if (!sub || !n) return;
  sub.name = n.slice(0, 120);   // las entradas ya hechas conservan su subNameAtTime
  saveData(); broadcastState();
}

// Quitarla de la lista NO borra su historial: las entradas guardan el nombre que tenía
// y se siguen viendo en el calendario, igual que al eliminar una tarea.
function deleteSubtask(taskId, subId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.subtasks = (task.subtasks || []).filter(x => x.id !== subId);
  if (state.activeTaskId === taskId && state.activeSubId === subId) pauseActive();
  saveData(); broadcastState();
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
  // Reiniciar con otra nota se queda en la misma subtarea: sigues en lo mismo.
  const entry = { start: Date.now(), end: null, nameAtTime: task.name };
  const sub = state.activeSubId ? (task.subtasks || []).find(x => x.id === state.activeSubId) : null;
  if (sub) { entry.subId = sub.id; entry.subNameAtTime = sub.name; }
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
  // La entrada se reanuda entera: vuelve con su subtarea y con su nota. Sin esta línea
  // el panel se quedaba creyendo que no había subtarea en marcha.
  state.activeSubId = entry.subId || null;
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
// Saca una tarea de Guardadas y la devuelve al panel principal. No toca su historial:
// las entradas del calendario se quedan exactamente como estaban.
function unarchiveTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !task.archived) return;
  task.archived = false;
  task.groupId = null;
  saveData(); broadcastState();
}

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
    if (!group) { group = { id: Date.now().toString(), name, order: nextGroupOrder() }; state.groups.push(group); }
    gid = group.id;
  }
  if (!gid || !state.groups.some(g => g.id === gid)) return;
  if (state.activeTaskId === taskId) pauseActive();
  task.archived = true;
  task.groupId = gid;
  saveData(); broadcastState();
}

function nextGroupOrder() {
  return state.groups.reduce((max, g) => Math.max(max, Number(g.order) || 0), 0) + 1;
}

// Las secciones se sirven ya ordenadas para que Guardadas solo tenga que pintarlas.
// 'created' usa el id, que es la marca de tiempo de cuando se creó.
function sortedGroups() {
  const gs = [...state.groups];
  const byCreation = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  if (settings.groupSort === 'alpha') {
    gs.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));
  } else if (settings.groupSort === 'custom') {
    gs.sort((a, b) => {
      const ao = Number(a.order), bo = Number(b.order);
      if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
      return byCreation(a, b);   // las que nunca se han arrastrado, por antigüedad
    });
  } else {
    gs.sort(byCreation);
  }
  // El sentido se aplica al final, así vale para los tres criterios por igual.
  return settings.groupSortDir === 'desc' ? gs.reverse() : gs;
}

// Guarda el orden manual que deja el usuario al arrastrar secciones.
function reorderGroups(ids) {
  if (!Array.isArray(ids)) return;
  if (settings.groupSortDir === 'desc') ids = [...ids].reverse();
  ids.forEach((id, i) => {
    const g = state.groups.find(x => x.id === id);
    if (g) g.order = i + 1;
  });
  settings.groupSort = 'custom';   // arrastrar implica que manda el orden manual
  saveSettings(); saveData(); broadcastState();
}

function createGroup(name) {
  const n = (name || '').trim();
  if (!n) return null;
  let group = state.groups.find(g => g.name.toLowerCase() === n.toLowerCase());
  if (!group) { group = { id: Date.now().toString(), name: n.slice(0, 60), order: nextGroupOrder() }; state.groups.push(group); }
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

function restoreAndStartTask(taskId, backMinutes, subId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.archived = false;
  startTask(taskId, backMinutes, subId);   // se puede retomar directamente en una subtarea
  openMain();
}

function editEntry(taskId, entryIndex, startMs, endMs, note, name, subId) {
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
  // La subtarea de ESTA entrada: para corregir a qué parte de la tarea fue este rato.
  // '' (o null) la deja sin subtarea, apuntada a la tarea a secas.
  if (subId !== undefined) {
    const sub = subId ? (task.subtasks || []).find(x => x.id === subId) : null;
    if (sub) { e.subId = sub.id; e.subNameAtTime = sub.name; }
    else { delete e.subId; delete e.subNameAtTime; }
    // Si se le quita la subtarea a la entrada en curso, el panel tiene que enterarse.
    if (state.activeTaskId === taskId && entryIndex === task.entries.length - 1 && !e.end) {
      state.activeSubId = sub ? sub.id : null;
    }
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
  if (dndActive()) { reminderTimer = setTimeout(showReminder, getReminderMs()); return; }
  if (widgetWin && !widgetWin.isDestroyed()) { widgetWin.showInactive(); scheduleWidgetAutoHide(); }
  else createWidgetWindow();
  reminderTimer = setTimeout(showReminder, getReminderMs());
}

// ── No molestar ──────────────────────────────────────────────────────────────
// Mientras está puesto no sale NINGÚN aviso por encima de lo que estés haciendo: ni
// el recordatorio de las horas, ni los ojos del 20-20-20, ni las notificaciones de
// hora de salida o de actualización. Lo que sí sigue funcionando es lo que no
// interrumpe: los cronómetros cuentan igual y, si lo pediste, la tarea se para sola
// a tu hora aunque no te lo diga.
function dndActive() {
  const d = Number(settings.dndUntil) || 0;
  if (d === -1) return true;
  if (d > Date.now()) return true;
  if (d !== 0) { settings.dndUntil = 0; saveSettings(); broadcastState(); }   // ya venció
  return false;
}

// minutos = 0 lo deja puesto hasta que se quite; null lo quita.
function setDnd(minutos) {
  if (minutos === null) settings.dndUntil = 0;
  else if (!minutos) settings.dndUntil = -1;
  else settings.dndUntil = Date.now() + minutos * 60000;
  saveSettings();
  if (dndActive()) {
    // Lo que ya estuviera asomando se retira en el acto.
    hideEyeCare();
    try { if (widgetWin && !widgetWin.isDestroyed()) widgetWin.hide(); } catch {}
  }
  broadcastState(); updateTrayTitle();
}

// ── Aviso de hora de salida ──────────────────────────────────────────────────
// Fecha local en 'AAAA-MM-DD'. No vale toISOString(), que pasa a UTC y a última hora
// de la tarde ya devuelve el día siguiente.
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Devuelve la hora de salida de hoy ('HH:MM') o null si hoy no toca avisar.
function leaveTimeForToday() {
  if (!settings.leaveEnabled) return null;
  if (settings.leaveSameEveryDay) return settings.leaveTime || null;
  const dias = settings.leaveDays || {};
  return dias[new Date().getDay()] || null;
}

function checkLeaveTime() {
  const hhmm = leaveTimeForToday();
  if (!hhmm || !state.activeTaskId) return;   // sin tarea corriendo no hay nada que parar

  const hoy = ymd(new Date());
  if (leaveNotifiedOn === hoy) return;

  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return;
  const objetivo = new Date();
  objetivo.setHours(h, m, 0, 0);

  // Con No molestar puesto no se avisa, y tampoco se marca como avisado: si se quita
  // dentro de la ventana de una hora, el aviso todavía llega.
  if (dndActive() && !settings.leaveAutoStop) return;

  const retraso = Date.now() - objetivo.getTime();
  // Se avisa desde la hora en punto y hasta una hora después: así el aviso no se
  // pierde si el ordenador estaba suspendido justo en ese minuto, pero tampoco salta
  // a deshora si se abre la app por la noche.
  if (retraso < 0 || retraso > 60 * 60000) return;

  leaveNotifiedOn = hoy;
  // Se lee la tarea ANTES de pararla: si no, el aviso no sabría de qué hablar.
  const task = state.tasks.find(t => t.id === state.activeTaskId);
  if (settings.leaveAutoStop) {
    pauseActive();
    saveData(); broadcastState(); updateTrayTitle();
  }
  if (!dndActive()) notifyLeaveTime(task, settings.leaveAutoStop);
}

function notifyLeaveTime(task, parada) {
  const nombre = task ? task.name : 'una tarea';
  const llevas = task ? fmtDuration(todaySecondsForTask(task)) : '';
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: 'imputa.me · hora de salida',
      body: parada
        ? `He parado "${nombre}"${llevas ? ` (${llevas} hoy)` : ''}. Hasta mañana.`
        : `Sigues con "${nombre}"${llevas ? ` (${llevas} hoy)` : ''}. ¿La paras antes de irte?`,
      icon: APP_ICON_PATH,
      silent: false,
    });
    n.on('click', () => openMain());   // el panel, con el play/pausa a mano
    n.show();
  } catch {}
}

function fmtDuration(secs) {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function startLeaveWatcher() {
  if (leaveTimer) clearInterval(leaveTimer);
  leaveTimer = setInterval(checkLeaveTime, 30000);
  checkLeaveTime();
}

// ── Menú del clic derecho sobre la barra ─────────────────────────────────────
// Menú nativo a propósito: se pinta por encima de todo, se coloca solo y se cierra
// como el usuario espera, sin tener que resolver nada de eso dentro de la ventana
// transparente y click-through de la barra.
function showDockContextMenu() {
  if (!dockWin || dockWin.isDestroyed()) return;
  const activa = getActiveTask();
  const displays = screen.getAllDisplays();
  const actual = dockDisplay();

  const esconder = (min, etiqueta) => ({ label: etiqueta, click: () => hideDockFor(min) });

  const plantilla = [
    { label: 'imputa.me', enabled: false },
    { label: `Hoy: ${formatDuration(totalTodaySeconds())}`, enabled: false },
    { type: 'separator' },
    activa
      ? { label: `Pausar «${activa.name}»`, click: () => pauseActive() }
      : { label: 'No hay ninguna tarea en marcha', enabled: false },
    { type: 'separator' },
    dndActive()
      ? { label: 'Quitar el modo no molestar', click: () => setDnd(null) }
      : {
          label: 'No molestar',
          submenu: [15, 30, 60, 120, 480].map(m => ({
            label: m < 60 ? `${m} minutos` : `${m / 60} hora${m > 60 ? 's' : ''}`,
            click: () => setDnd(m),
          })).concat([{ type: 'separator' }, { label: 'Hasta que lo quite', click: () => setDnd(0) }]),
        },
    {
      label: 'Esconder la barra',
      submenu: [
        esconder(15, '15 minutos'),
        esconder(30, '30 minutos'),
        esconder(60, '1 hora'),
        esconder(120, '2 horas'),
        esconder(480, '8 horas'),
        { type: 'separator' },
        esconder(0, 'Hasta que la muestre yo'),
      ],
    },
    {
      label: 'Cambiar de pantalla',
      enabled: displays.length > 1,
      submenu: displays.map((d, i) => ({
        label: `Pantalla ${i + 1}${d.bounds.x === 0 && d.bounds.y === 0 ? ' (principal)' : ''} · ${d.size.width}×${d.size.height}`,
        type: 'radio',
        checked: d.id === actual.id,
        click: () => {
          settings.dockDisplayId = d.id;
          settings.dockDisplayKey = displayKey(d);
          saveSettings(); positionDock(); syncDockBounds(); ensureDockBarVisible();
        },
      })),
    },
    {
      label: 'Cambiar de borde',
      submenu: [['left', 'Izquierda'], ['right', 'Derecha'], ['top', 'Arriba'], ['bottom', 'Abajo']].map(([v, etiqueta]) => ({
        label: etiqueta,
        type: 'radio',
        checked: (settings.dockAnchor || 'right') === v,
        click: () => { settings.dockAnchor = v; saveSettings(); positionDock(); syncDockBounds(); },
      })),
    },
    { type: 'separator' },
    { label: 'Calendario', click: () => openCalendar() },
    { label: 'Guardadas', click: () => openGroups() },
    { label: 'Ajustes', click: () => openSettings() },
  ];

  if (normalizeUrl(settings.imputeUrl)) {
    plantilla.push({ label: 'Imputar…', click: () => openImputeUrl() });
  }

  plantilla.push(
    { type: 'separator' },
    // Modo clásico = ventanas sueltas de siempre, sin barra flotante.
    { label: 'Cambiar a modo clásico (ventanas)', click: () => toggleDockMode() },
    { label: 'Salir de imputa.me', click: () => { saveData(); app.quit(); } },
  );

  try { Menu.buildFromTemplate(plantilla).popup({ window: dockWin }); } catch {}
}

// ── Días visibles del calendario ─────────────────────────────────────────────
const DIAS_SEMANA = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'],
                     [5, 'Viernes'], [6, 'Sábado'], [0, 'Domingo']];

function defaultWeekDays() {
  const d = Array.isArray(settings.weekDays) ? settings.weekDays : [];
  return d.length ? d : [1, 2, 3, 4, 5, 6, 0];
}

function weekDaysFor(clave) {
  const ov = settings.weekOverrides && settings.weekOverrides[clave];
  return Array.isArray(ov) ? ov : defaultWeekDays();
}

// Las excepciones son de usar y tirar: pasado un año no le importan a nadie y solo
// engordarían el fichero de ajustes.
function pruneWeekOverrides() {
  const ovs = settings.weekOverrides;
  if (!ovs) return;
  const limite = Date.now() - 365 * 86400000;
  Object.keys(ovs).forEach(k => {
    const t = Date.parse(k + 'T00:00:00');
    if (Number.isFinite(t) && t < limite) delete ovs[k];
  });
}

// Menú para elegir qué días se ven. Los cambios de aquí son SOLO de esa semana; el
// ajuste permanente está en Ajustes, y desde aquí se puede volver a él.
function showWeekDaysMenu(clave) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(clave || ''))) return;
  const win = BrowserWindow.getFocusedWindow() || dockPanelWin || calendarWin;
  const visibles = weekDaysFor(clave);
  const hayExcepcion = !!(settings.weekOverrides && settings.weekOverrides[clave]);

  const plantilla = [
    { label: 'Días de esta semana', enabled: false },
    { type: 'separator' },
    ...DIAS_SEMANA.map(([n, etiqueta]) => ({
      label: etiqueta,
      type: 'checkbox',
      checked: visibles.includes(n),
      click: () => {
        const nuevos = visibles.includes(n) ? visibles.filter(x => x !== n) : [...visibles, n];
        if (!nuevos.length) return;   // dejar la semana sin días no tiene sentido
        if (!settings.weekOverrides) settings.weekOverrides = {};
        settings.weekOverrides[clave] = nuevos;
        pruneWeekOverrides(); saveSettings(); broadcastState();
      },
    })),
    { type: 'separator' },
    {
      label: 'Volver a mis días de siempre',
      enabled: hayExcepcion,
      click: () => {
        delete settings.weekOverrides[clave];
        saveSettings(); broadcastState();
      },
    },
    { label: 'Cambiar mis días de siempre…', click: () => openSettings() },
  ];
  try { Menu.buildFromTemplate(plantilla).popup(win ? { window: win } : {}); } catch {}
}

// ── Menú del clic derecho sobre una entrada del calendario ───────────────────
// Sirve sobre todo para archivar la tarea en una sección sin tener que ir al panel,
// que es donde estaba ese botón hasta ahora.
function showCalendarContextMenu(taskId, entryIndex) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const win = BrowserWindow.getFocusedWindow() || dockPanelWin || calendarWin;
  const enMarcha = state.activeTaskId === task.id;

  const avisar = (canal, datos) => {
    [calendarWin, dockPanelWin].forEach(w => {
      if (w && !w.isDestroyed()) sendToAllFrames(w, canal, datos);
    });
  };

  const secciones = sortedGroups().map(g => ({
    label: g.name,
    type: 'radio',
    checked: task.archived && task.groupId === g.id,
    click: () => archiveTask(task.id, g.id),
  }));

  const plantilla = [
    { label: task.name, enabled: false },
    { type: 'separator' },
  ];

  if (task.deleted) {
    plantilla.push({ label: 'Restaurar la tarea', click: () => restoreTask(task.id) });
  } else {
    plantilla.push({
      label: task.archived ? 'Mover a otra sección' : 'Guardar en una sección',
      submenu: secciones.concat(
        secciones.length ? [{ type: 'separator' }] : [],
        [{ label: 'Sección nueva…', click: () => avisar('ask-new-group', task.id) }],
      ),
    });
    if (task.archived) {
      plantilla.push({ label: 'Sacar de Guardadas', click: () => unarchiveTask(task.id) });
    }
    // Mismos controles que el popup de la entrada, para no tener que abrirlo.
    const entrada = task.entries[entryIndex];
    const enCurso = entrada && entrada.end == null;
    plantilla.push({ type: 'separator' });
    if (enMarcha && enCurso) {
      plantilla.push({ label: 'Pausar', click: () => pauseActive() });
    } else if (entrada && !enMarcha) {
      // Las dos maneras de retomar: una entrada nueva desde ahora, o estirar esta
      // hasta ahora. En ambas se conservan la subtarea y la nota de este rato.
      const sub = entrada.subId && (task.subtasks || []).some(x => x.id === entrada.subId)
        ? entrada.subId : undefined;
      plantilla.push(
        { label: 'Nueva entrada desde ahora', click: () => startTask(task.id, 0, sub, entrada.note) },
        { label: 'Alargar esta hasta ahora', click: () => resumeEntry(task.id, entryIndex) },
      );
    }
  }

  plantilla.push(
    { type: 'separator' },
    { label: 'Editar esta entrada…', click: () => avisar('open-entry-popup', { taskId: task.id, entryIndex }) },
    { label: 'Eliminar esta entrada', click: () => deleteEntry(task.id, entryIndex) },
  );

  try { Menu.buildFromTemplate(plantilla).popup(win ? { window: win } : {}); } catch {}
}

// ── Enlace para imputar ──────────────────────────────────────────────────────
// Se acepta lo que el usuario pegue: si no trae esquema, se le pone https://. Solo
// http y https, para que un enlace guardado no pueda acabar abriendo otra cosa.
function normalizeUrl(url) {
  if (!url) return '';
  const conEsquema = /^[a-zA-Z][\w+.-]*:\/\//.test(url) ? url : `https://${url}`;
  try {
    const u = new URL(conEsquema);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString();
  } catch { return ''; }
}

function openImputeUrl() {
  const url = normalizeUrl(settings.imputeUrl);
  if (!url) return;
  try { require('electron').shell.openExternal(url); } catch {}
}

// ── Regla 20-20-20 ───────────────────────────────────────────────────────────
const EYE_RATIO = 0.78;   // alto respecto al ancho de la burbuja

// La ventana mide exactamente lo que la burbuja: sin sombra no hay nada que se salga
// del redondeo, así que no hace falta reservarle hueco (y el tamaño de Ajustes vuelve
// a ser el de lo que se ve).
function eyeCareBounds() {
  const work = dockDisplay().workArea;
  const w = Math.max(80, Math.min(420, Number(settings.eyeCareSize) || 150));
  const h = Math.round(w * EYE_RATIO);
  const m = 18;   // separación del borde
  const pos = settings.eyeCarePos || 'top';
  const izq = work.x + m;
  const centro = work.x + Math.round((work.width - w) / 2);
  const der = work.x + work.width - w - m;
  const arriba = work.y + m;
  const abajo = work.y + work.height - h - m;
  const x = pos.includes('Left') ? izq : pos.includes('Right') ? der : centro;
  const y = pos.startsWith('bottom') ? abajo : arriba;
  return { x, y, width: w, height: h };
}

function createEyeCareWindow() {
  if (eyeCareWin && !eyeCareWin.isDestroyed()) return eyeCareWin;
  const b = eyeCareBounds();
  eyeCareWin = new BrowserWindow({
    ...b,
    // backgroundColor transparente EXPLÍCITO: sin él, una ventana transparent:true en
    // Windows se pinta con fondo opaco (negro) y ese fondo asoma por fuera del redondeo
    // de la burbuja. Es lo que dejaba las esquinas cuadradas negras. Las otras ventanas
    // transparentes (la barra y el botón de ocultar) ya lo llevaban; a esta se me pasó.
    // roundedCorners:false porque el redondeo lo pone el CSS de la burbuja; dejando
    // que Windows redondee además la ventana solo se añaden recortes raros encima.
    frame: false, transparent: true, hasShadow: false, backgroundColor: '#00000000',
    resizable: false, roundedCorners: false,
    // focusable:false para no sacar al usuario de lo que esté haciendo; el clic para
    // quitarla de en medio sigue llegando igual.
    skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false , backgroundThrottling: false},
  });
  // 'screen-saver' la pone por encima incluso de aplicaciones a pantalla completa,
  // que es justo cuando más falta hace acordarse de mirar a lo lejos.
  try { eyeCareWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
  eyeCareWin.loadFile(path.join(__dirname, 'src', 'eyecare.html'));
  eyeCareWin.on('closed', () => { eyeCareWin = null; });
  return eyeCareWin;
}

function showEyeCare(segundos, forzar) {
  // forzar = la vista previa de Ajustes, que la pide el usuario a propósito.
  if (dndActive() && !forzar) return;
  const win = createEyeCareWindow();
  if (!win || win.isDestroyed()) return;
  const secs = Math.max(1, Number(segundos) || Number(settings.eyeCareRest) || 20);
  try { win.setBounds(eyeCareBounds()); } catch {}
  const lanzar = () => {
    if (!win || win.isDestroyed()) return;
    try { win.showInactive(); win.webContents.send('eye-start', secs); } catch {}
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', lanzar);
  else lanzar();

  // Red de seguridad: si el renderer se atasca, la burbuja no se queda ahí clavada.
  if (eyeCareHideTimer) clearTimeout(eyeCareHideTimer);
  eyeCareHideTimer = setTimeout(hideEyeCare, (secs + 4) * 1000);
}

function hideEyeCare() {
  if (eyeCareHideTimer) { clearTimeout(eyeCareHideTimer); eyeCareHideTimer = null; }
  try { if (eyeCareWin && !eyeCareWin.isDestroyed()) eyeCareWin.hide(); } catch {}
}

function eyeCareEveryMin() {
  return Math.max(1, Math.min(180, Number(settings.eyeCareEvery) || 20));
}

// Se lleva la HORA del próximo aviso en vez de un setInterval largo. Dos motivos:
//   - startEyeCareTimer() se llamaba en cada cambio de Ajustes, y Ajustes lo manda en
//     cada movimiento de deslizador, así que toquetear el tamaño o la posición
//     reiniciaba la cuenta y el aviso se iba retrasando indefinidamente.
//   - un setInterval de 20 minutos no corre mientras el ordenador está suspendido, así
//     que al despertar la cuenta iba desfasada.
// Con una hora objetivo y un latido corto, ninguna de las dos cosas afecta.
function reprogramEyeCare(desdeCero) {
  if (!settings.eyeCareEnabled) { eyeCareNextAt = 0; return; }
  if (desdeCero || !eyeCareNextAt) eyeCareNextAt = Date.now() + eyeCareEveryMin() * 60000;
}

function startEyeCareTimer(desdeCero) {
  if (eyeCareTimer) { clearInterval(eyeCareTimer); eyeCareTimer = null; }
  if (!settings.eyeCareEnabled) { hideEyeCare(); eyeCareNextAt = 0; return; }
  reprogramEyeCare(desdeCero);
  eyeCareTimer = setInterval(tickEyeCare, 15000);
}

function tickEyeCare() {
  if (!settings.eyeCareEnabled || !eyeCareNextAt) return;
  if (Date.now() < eyeCareNextAt) return;
  eyeCareNextAt = Date.now() + eyeCareEveryMin() * 60000;
  showEyeCare();
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
  // El acrílico de Windows YA pone su propio tinte (grisáceo). Si nuestro tinte baja
  // demasiado, manda el suyo y el resultado se ve lavado/blanquecino en vez de "tu color
  // con el fondo difuminado". Por eso el mínimo no baja de ~0.30: en todo el recorrido
  // se sigue viendo el color del tema, cambiando cuánto se transparenta.
  return (0.30 + x * 0.64).toFixed(3);
}

function applyTranslucency(win) {
  if (!win || win.isDestroyed()) return;
  try { win.setOpacity(1); } catch {}
  try { win.setBackgroundColor('#00000000'); } catch {}   // deja ver el material de debajo
  // 'acrylic' = difuminado del sistema; 'none' = sin difuminar (solo el tinte).
  try { win.setBackgroundMaterial(settings.blurEnabled === false ? 'none' : 'acrylic'); } catch {}
}

// El acrílico lo pinta Windows y toma su tinte del modo claro/oscuro DEL SISTEMA: con
// Windows en claro salía blanquecino aunque el tema de la app fuese oscuro. Forzando el
// themeSource a juego con el tema elegido, el difuminado sale del color correcto.
function applySystemThemeSource() {
  const t = THEMES[settings.theme] || THEMES[DEFAULT_THEME];
  try { nativeTheme.themeSource = t.scheme === 'light' ? 'light' : 'dark'; } catch {}
}

function applyTranslucencyAll() {
  applySystemThemeSource();
  // La ventana de la barrita NO lleva material (es transparente a propósito); la del
  // panel sí, y por eso puede difuminar.
  [mainWin, calendarWin, groupsWin, settingsWin, widgetWin, syncWin, updateWin, dockPanelWin]
    .forEach(w => applyTranslucency(w));
  broadcastTheme();
}

// Paleta actual, ya resuelta (incluye el --bg con la opacidad elegida). Se manda a los
// renderers, que la aplican como variables CSS: así llega también a las vistas del dock,
// que van en iframes (insertCSS solo alcanzaría al frame principal).
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function themeVars() {
  const t = THEMES[settings.theme] || THEMES[DEFAULT_THEME];
  const acc = ACCENTS[settings.accent];   // si no hay elegido, manda el del tema
  const light = t.scheme === 'light';
  // El panel del dock lleva el contenido, así que su fondo sigue al deslizador pero con
  // un suelo bastante alto: con el alfa general (que puede bajar mucho) se transparentaba
  // tanto que no se leía nada y se perdían los bordes.
  const x = Math.max(0, Math.min(100, settings.bgOpacity == null ? 50 : Number(settings.bgOpacity))) / 100;
  const panelAlpha = (0.44 + x * 0.52).toFixed(3);
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
    panel: `rgba(${hexToRgb(t.surface)},${panelAlpha})`,
    scheme: t.scheme,
  };
}

function broadcastTheme() {
  const vars = themeVars();
  [mainWin, calendarWin, groupsWin, settingsWin, widgetWin, syncWin, updateWin, dockWin, splashWin]
    .forEach(w => sendToAllFrames(w, 'theme', vars));
  sendToAllFrames(dockPanelWin, 'theme', vars);
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
  // En modo dock las ventanas sueltas están escondidas y sus límites pueden apuntar a
  // un monitor que ya no existe: ahí la referencia buena es la principal.
  if (!settings.dockMode && mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) {
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
    // OJO: en Windows, backgroundMaterial (el acrílico que da el desenfoque) se ignora
    // si la ventana es transparent:true. Estaba así, de modo que el "blur" nunca existió
    // y solo se veía el tinte con alfa. Con transparent:false + backgroundColor
    // transparente + backgroundMaterial, el sistema sí difumina lo que hay detrás, y las
    // esquinas las redondea el propio Windows (roundedCorners).
    frame: false, transparent: false, hasShadow: false,
    backgroundColor: '#00000000',
    backgroundMaterial: settings.blurEnabled === false ? 'none' : 'acrylic',
    resizable: true, roundedCorners: true,
    icon: APP_ICON_PATH,
    ...restOpts,
    // Sin frenado en segundo plano: estas ventanas animan aunque no tengan el foco.
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  win.__sizeSpec = { minWidth: designMinW, minHeight: designMinH, maxWidth: designMaxW, maxHeight: designMaxH };
  win.on('focus', () => checkForUpdatesIfStale());   // volver a la app = buen momento para mirar
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

// Huella de una pantalla, para reconocerla aunque vuelva con otro id (Windows los
// reasigna al desconectar y volver a conectar un monitor).
function displayKey(d) {
  if (!d) return null;
  return `${d.bounds.width}x${d.bounds.height}@${d.bounds.x},${d.bounds.y}:${d.scaleFactor}`;
}

// La pantalla donde vive la barra flotante. Si la elegida no está conectada ahora
// mismo, se usa la que haya, PERO no se toca el ajuste: en cuanto vuelva a aparecer,
// la barra se va sola otra vez a ella.
function dockDisplay() {
  const displays = screen.getAllDisplays();
  if (settings.dockDisplayId != null) {
    const porId = displays.find(x => x.id === settings.dockDisplayId);
    if (porId) return porId;
    if (settings.dockDisplayKey) {
      const porHuella = displays.find(x => displayKey(x) === settings.dockDisplayKey);
      if (porHuella) return porHuella;
    }
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
    panelHeight: Math.max(260, Math.min(1400, Number(settings.dockPanelHeight) || 620)),
    calendarWidth: Math.max(420, Math.min(1900, Number(settings.dockCalendarWidth) || 1180)),
    closeMode: ['button','clickOutside','mouseLeave'].includes(settings.dockCloseMode) ? settings.dockCloseMode : 'button',
    closeSeconds: Math.max(0, Math.min(30, Number(settings.dockCloseSeconds) ?? 3)),
  };
}

// Toda el área de trabajo de la pantalla elegida (ventana de la barrita).
function computeDockBounds() {
  const work = dockDisplay().workArea;
  return { x: work.x, y: work.y, width: work.width, height: work.height };
}

// Dónde va el panel: pegado a su borde, ocupando todo el largo de ese borde.
function computePanelBounds(view) {
  const work = dockDisplay().workArea;
  const c = dockConfig();
  const vertical = c.anchor === 'left' || c.anchor === 'right';
  if (vertical) {
    const width = Math.min(view === 'calendar' ? c.calendarWidth : c.panelWidth, work.width);
    return {
      x: c.anchor === 'left' ? work.x : work.x + work.width - width,
      y: work.y, width, height: work.height,
    };
  }
  const height = Math.min(c.panelHeight, work.height);
  return {
    x: work.x,
    y: c.anchor === 'top' ? work.y : work.y + work.height - height,
    width: work.width, height,
  };
}

let dockPanelView = 'panel';
let dockPanelShownAt = 0;   // cuándo se mostró el panel (ver el blur de clic-fuera)

function createDockPanel() {
  if (dockPanelWin && !dockPanelWin.isDestroyed()) return;
  dockPanelWin = new BrowserWindow({
    ...computePanelBounds(dockPanelView),
    show: false,
    frame: false, hasShadow: false,
    // SIN transparent: en Windows el acrílico (lo que difumina el fondo de verdad) se
    // ignora en ventanas transparentes. Por eso el panel salió de la ventana de la
    // barrita, que sí tiene que ser transparente para dejar pasar los clics.
    transparent: false, backgroundColor: '#00000000',
    backgroundMaterial: settings.blurEnabled === false ? 'none' : 'acrylic',
    resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true, roundedCorners: true,
    icon: APP_ICON_PATH,
    webPreferences: { nodeIntegration: true, contextIsolation: false, nodeIntegrationInSubFrames: true , backgroundThrottling: false},
  });
  try { dockPanelWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}   // igual que la barra
  dockPanelWin.loadFile(path.join(__dirname, 'src', 'dock-panel.html'));
  const push = () => {
    try { dockPanelWin.webContents.send('dock-config', dockConfig()); } catch {}
    sendStateToWindow(dockPanelWin);
  };
  if (dockPanelWin.webContents.isLoading()) dockPanelWin.webContents.once('did-finish-load', push);
  else push();
  // Clic fuera = el panel pierde el foco. Con dos salvaguardas, porque si no el panel se
  // cerraba justo al abrirse: (1) un margen desde que se muestra, porque al aparecer aún
  // no tiene el foco asentado y salta un blur; y (2) si el foco ha ido a otra ventana de
  // la propia app (Ajustes, el aviso de actualización...), eso no es "clicar fuera".
  dockPanelWin.on('blur', () => {
    if (settings.dockCloseMode !== 'clickOutside' || !dockExpanded) return;
    if (Date.now() - dockPanelShownAt < 700) return;
    setTimeout(() => {
      if (settings.dockCloseMode !== 'clickOutside' || !dockExpanded) return;
      const f = BrowserWindow.getFocusedWindow();
      if (f && !f.isDestroyed()) return;   // el foco sigue dentro de la app
      collapseDockPanel();
    }, 140);
  });
  dockPanelWin.on('closed', () => { dockPanelWin = null; });
}

// Le dice a la ventana de la barrita cómo de grande es AHORA el panel, para que coloque
// su botón de esconder justo por fuera (el calendario es bastante más ancho que el resto).
// Anima el cambio de tamaño/posición de una ventana. Hace falta porque al pasar del
// panel normal al calendario (mucho más ancho) la ventana daba un salto seco; Electron
// solo sabe animar bounds en macOS, así que se interpola a mano.
function animateWindowBounds(win, target, ms = 190, fromOverride, onFrame) {
  if (!win || win.isDestroyed()) return;
  // OJO: el punto de partida se pasa explícitamente cuando lo sabemos. Leerlo con
  // getBounds() justo después de un setBounds era una carrera: si Windows aún no lo había
  // aplicado devolvía la posición vieja, se creía que ya estaba en destino y no animaba
  // nada... dejando la ventana fuera de la pantalla y el panel invisible.
  let from = fromOverride;
  if (!from) { try { from = win.getBounds(); } catch { return; } }
  if (win.__boundsTween) { clearTimeout(win.__boundsTween); win.__boundsTween = null; }
  // Cada animación lleva su marca: así el salvavidas de abajo no puede colocar la ventana
  // en el destino de una animación ya sustituida por otra (p. ej. abrir justo tras cerrar).
  const token = (win.__boundsToken = (win.__boundsToken || 0) + 1);
  const same = from.x === target.x && from.y === target.y && from.width === target.width && from.height === target.height;
  // Red de seguridad: pase lo que pase con la animación, la ventana acaba en su sitio.
  const land = () => {
    if (win.__boundsToken !== token) return;
    try { if (win && !win.isDestroyed()) win.setBounds(target); } catch {}
  };
  if (same) { land(); return; }

  // setTimeout encadenado y no setInterval de 16 ms: en Windows la resolución de los
  // temporizadores hace que un intervalo de 16 acabe disparando a ~15,6 o ~31 ms, y esos
  // fotogramas dobles son los tirones que se ven. Encadenando a 6 ms se pide bastante más
  // de lo que la pantalla puede dibujar y es ella la que marca el ritmo. La posición sale
  // del reloj, no del número de fotograma, así que perder alguno no descoloca nada.
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);   // suave al final, como el resto de la app
  let ultimo = null;
  const paso = () => {
    if (!win || win.isDestroyed() || win.__boundsToken !== token) { win.__boundsTween = null; return; }
    const t = Math.min(1, (performance.now() - start) / ms);
    const k = ease(t);
    const b = {
      x: Math.round(from.x + (target.x - from.x) * k),
      y: Math.round(from.y + (target.y - from.y) * k),
      width: Math.round(from.width + (target.width - from.width) * k),
      height: Math.round(from.height + (target.height - from.height) * k),
    };
    // Si redondeado no ha cambiado nada, no se molesta al gestor de ventanas: cada
    // setBounds es una llamada al sistema, y de balde solo resta fluidez.
    if (!ultimo || b.x !== ultimo.x || b.y !== ultimo.y || b.width !== ultimo.width || b.height !== ultimo.height) {
      ultimo = b;
      try { win.setBounds(b); } catch {}
      if (onFrame) { try { onFrame(b, k); } catch {} }
    }
    if (t >= 1) { win.__boundsTween = null; land(); return; }
    win.__boundsTween = setTimeout(paso, 6);
  };
  win.__boundsTween = setTimeout(paso, 0);
  setTimeout(() => { if (!win.__boundsTween) land(); }, ms + 120);
}

// El botón de esconder ya no tiene ventana propia: se pinta dentro de la de la barra
// (ver .hide-btn en dock.html), que es la que ya tenía un sistema de zonas clicables que
// funciona. Aquí solo queda su tamaño, para calcular dónde va su centro.
const HIDE_BTN = 34;

// Le dice a la ventana de la barra dónde pintar el botón: el CENTRO del círculo, en
// coordenadas de esa ventana (cubre toda el área de trabajo, así que basta con restarle
// su origen). El destino se recibe como parámetro y NO se relee con getBounds(): justo
// después de un setBounds, Windows devuelve a veces los límites anteriores, y ese era el
// motivo de que el botón acabara colocado respecto a un panel que ya no existía.
function positionDockHide(panelBounds) {
  if (!dockWin || dockWin.isDestroyed() || !panelBounds) return;
  const b = panelBounds;
  let origen;
  try { origen = dockWin.getBounds(); } catch { return; }
  const gap = 12, r = HIDE_BTN / 2;
  const anchor = dockConfig().anchor;
  let cx, cy;
  if (anchor === 'right')       { cx = b.x - gap - r;            cy = b.y + b.height / 2; }
  else if (anchor === 'left')   { cx = b.x + b.width + gap + r;  cy = b.y + b.height / 2; }
  else if (anchor === 'top')    { cy = b.y + b.height + gap + r; cx = b.x + b.width / 2; }
  else                          { cy = b.y - gap - r;            cx = b.x + b.width / 2; }
  try {
    dockWin.webContents.send('dock-hide-btn', {
      visible: true,
      x: Math.round(cx - origen.x),
      y: Math.round(cy - origen.y),
    });
  } catch {}
}

function showDockHide(panelBounds) {
  positionDockHide(panelBounds);   // se pasa el destino conocido, NO se relee con getBounds()
}
function hideDockHide() {
  if (!dockWin || dockWin.isDestroyed()) return;
  try { dockWin.webContents.send('dock-hide-btn', { visible: false }); } catch {}
}

// Punto de partida al abrir y de llegada al cerrar. Es un desplazamiento CORTO y HACIA
// DENTRO de la pantalla, no hacia fuera: sacándolo por el borde, con dos monitores la
// ventana asomaba un instante en el monitor de al lado antes de esconderse. La sensación
// de entrar/salir la da el desvanecido que lo acompaña.
const PANEL_SLIDE = 54;
// La barrita tiene que estar SIEMPRE visible y con las medidas del área de trabajo. Si la
// ventana se creó cuando el escritorio aún se montaba (arranque con Windows) o cambian los
// monitores, sus medidas se quedan viejas: entonces su "borde derecho" cae en mitad de la
// pantalla física (la barrita aparece flotando en medio) o directamente fuera (desaparece).
// ¿Está la barra escondida a propósito ahora mismo? -1 es "hasta que yo la muestre";
// un número mayor que cero es el momento en el que vuelve sola.
function dockIsHidden() {
  const h = Number(settings.dockHiddenUntil) || 0;
  if (h === -1) return true;
  if (h > Date.now()) return true;
  if (h !== 0) { settings.dockHiddenUntil = 0; saveSettings(); }   // ya venció
  return false;
}

// minutos = 0 la esconde hasta que se pida mostrarla; null la vuelve a mostrar.
function hideDockFor(minutos) {
  if (minutos === null) settings.dockHiddenUntil = 0;
  else if (!minutos) settings.dockHiddenUntil = -1;
  else settings.dockHiddenUntil = Date.now() + minutos * 60000;
  saveSettings();
  if (dockIsHidden()) {
    collapseDockPanel();
    try { if (dockWin && !dockWin.isDestroyed()) dockWin.hide(); } catch {}
  } else {
    ensureDockBarVisible();
  }
  updateTrayTitle();
}

// Las tres ventanas del dock viven en el mismo nivel ('screen-saver'), asi que quien
// se reafirma el ultimo queda arriba. Reafirmar el de la barra cada pocos segundos
// (lo que la mantiene por encima de lo que va a pantalla completa) la ponia por encima
// del panel y de su boton de esconder, y el boton dejaba de recibir los clics. Aqui se
// vuelve a dejar el orden que toca: barra, luego panel, luego boton.
function restackDock() {
  try { if (dockWin && !dockWin.isDestroyed()) dockWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
  if (!dockExpanded) return;
  try { if (dockPanelWin && !dockPanelWin.isDestroyed() && dockPanelWin.isVisible()) dockPanelWin.moveTop(); } catch {}
}

function ensureDockBarVisible() {
  if (!settings.dockMode) return;
  createDock();
  if (!dockWin || dockWin.isDestroyed()) return;
  // Escondida a propósito: el vigilante no debe sacarla otra vez.
  if (dockIsHidden()) { try { if (dockWin.isVisible()) dockWin.hide(); } catch {} return; }
  try { if (!dockWin.isVisible()) dockWin.showInactive(); } catch {}
  restackDock();
  syncDockBounds();
}

function syncDockBounds() {
  if (!dockWin || dockWin.isDestroyed()) return;
  let cur, want;
  try { cur = dockWin.getBounds(); want = computeDockBounds(); } catch { return; }
  if (cur.x !== want.x || cur.y !== want.y || cur.width !== want.width || cur.height !== want.height) {
    try { dockWin.setBounds(want); } catch {}
  }
  // El panel abierto también se recoloca, por si cambió la pantalla bajo sus pies.
  // Si el panel se está redimensionando (cambio de pestaña), no se le toca: colocarlo
  // de golpe a medio camino rompería la animación.
  if (dockExpanded && dockPanelWin && !dockPanelWin.isDestroyed() && !dockPanelWin.__boundsTween) {
    const pb = computePanelBounds(dockPanelView);
    try { dockPanelWin.setBounds(pb); } catch {}
    positionDockHide(pb);
  }
}

function fadeWindow(win, from, to, ms, done) {
  if (!win || win.isDestroyed()) return;
  if (win.__fade) { clearTimeout(win.__fade); win.__fade = null; }
  const token = (win.__fadeToken = (win.__fadeToken || 0) + 1);
  const start = performance.now();
  try { win.setOpacity(from); } catch {}
  const paso = () => {
    if (!win || win.isDestroyed() || win.__fadeToken !== token) { win.__fade = null; return; }
    const t = Math.min(1, (performance.now() - start) / ms);
    // Suavizado también aquí: en lineal se nota que arranca y para de golpe.
    const k = 1 - Math.pow(1 - t, 3);
    try { win.setOpacity(from + (to - from) * k); } catch {}
    if (t >= 1) { win.__fade = null; if (done) { try { done(); } catch {} } return; }
    win.__fade = setTimeout(paso, 6);
  };
  win.__fade = setTimeout(paso, 0);
}

function offscreenPanelBounds(b, anchor) {
  if (anchor === 'right')  return { ...b, x: b.x - PANEL_SLIDE };
  if (anchor === 'left')   return { ...b, x: b.x + PANEL_SLIDE };
  if (anchor === 'bottom') return { ...b, y: b.y - PANEL_SLIDE };
  return { ...b, y: b.y + PANEL_SLIDE };   // top
}

// Entra deslizando LA VENTANA desde fuera de la pantalla. Animar solo el contenido
// dejaba a la vista el rectángulo acrílico de la ventana (el "panel gris" de detrás).
function showDockPanel() {
  createDockPanel();
  if (!dockPanelWin || dockPanelWin.isDestroyed()) return;
  const target = computePanelBounds(dockPanelView);
  const wasVisible = dockPanelWin.isVisible();
  // La ventana se coloca YA en su sitio: la sensación de aparecer la da el desvanecido.
  // Antes se desplazaba fotograma a fotograma y por eso iba a tirones.
  try {
    dockPanelWin.setBounds(target);
    if (!wasVisible) dockPanelWin.setOpacity(0);
    dockPanelWin.showInactive(); dockPanelWin.moveTop(); dockPanelWin.focus();
  } catch {}
  dockExpanded = true; dockOutsideSince = 0; dockPanelShownAt = Date.now();
  showDockHide(target);
  if (wasVisible) { try { dockPanelWin.setOpacity(1); } catch {} }
  else fadeWindow(dockPanelWin, 0, 1, 170);
  sendToAllFrames(dockPanelWin, 'dock-expanded');
}

// Sale deslizando la ventana entera y, al terminar, se esconde.
function collapseDockPanel() {
  dockExpanded = false; dockOutsideSince = 0;
  if (dockWin && !dockWin.isDestroyed()) { try { dockWin.webContents.send('dock-collapse'); } catch {} }
  // Se escondia de golpe aqui arriba y luego se le pedia un desvanecido que ya no se
  // veia. Ahora solo se corta en seco si no hay panel del que despedirse.
  if (!dockPanelWin || dockPanelWin.isDestroyed() || !dockPanelWin.isVisible()) { hideDockHide(); return; }
  hideDockHide();
  fadeWindow(dockPanelWin, 1, 0, 150, () => {
    try {
      if (dockPanelWin && !dockPanelWin.isDestroyed()) { dockPanelWin.hide(); dockPanelWin.setOpacity(1); }
    } catch {}
    ensureDockBarVisible();   // al cerrarse el panel, la barrita tiene que estar ahí
  });
}

// Empuja la config visual al renderer del dock (al crearlo y al cambiar Ajustes).
function sendDockConfig() {
  const cfg = dockConfig();
  [dockWin, dockPanelWin].forEach(w => {
    if (!w || w.isDestroyed()) return;
    const send = () => { try { w.webContents.send('dock-config', cfg); } catch {} };
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send);
    else send();
  });
  if (dockPanelWin && !dockPanelWin.isDestroyed() && dockExpanded) {
    try { dockPanelWin.setBounds(computePanelBounds(dockPanelView)); } catch {}
  }
}

// Decide si el dock captura el ratón o deja pasar los clics al escritorio, mirando dónde
// está el cursor de verdad. Se hace desde el proceso principal (y no con mousemove en la
// página) porque el ratón sobre un iframe NO genera eventos en el documento que lo
// contiene: al entrar directo sobre el calendario, la ventana se quedaba en modo "dejar
// pasar los clics" y no se podía pulsar nada.
function setDockIgnore(ignore) {
  if (ignore === dockIgnoring) return;
  dockIgnoring = ignore;
  if (dockWin && !dockWin.isDestroyed()) {
    try { dockWin.setIgnoreMouseEvents(ignore); } catch {}
  }
}

function updateDockHitTest() {
  if (!dockWin || dockWin.isDestroyed()) return;
  let p, b;
  try { p = screen.getCursorScreenPoint(); b = dockWin.getBounds(); } catch { return; }
  const x = p.x - b.x, y = p.y - b.y;
  const inside = dockHitRects.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  setDockIgnore(!inside);

  // Revelado de la barrita al acercarse: se calcula aquí porque la ventana ya no recibe
  // los movimientos del ratón (ese reenvío era lo que hacía parpadear el cursor).
  const radio = Math.max(10, Math.min(200, Number(settings.dockNearDistance) || 45));
  const near = !dockExpanded && !!dockBarRect &&
    Math.hypot(Math.max(dockBarRect.x - x, 0, x - (dockBarRect.x + dockBarRect.w)),
               Math.max(dockBarRect.y - y, 0, y - (dockBarRect.y + dockBarRect.h))) < radio;
  if (near !== dockBarNear) {
    dockBarNear = near;
    try { dockWin.webContents.send('dock-bar-near', near); } catch {}
  }

  // Auto-esconder cuando el cursor lleva un rato fuera del panel abierto. El panel es
  // ahora otra ventana, así que "dentro" incluye también sus límites (si no, contaría
  // como fuera en cuanto el ratón entrase en el propio panel).
  if (dockExpanded && settings.dockCloseMode === 'mouseLeave') {
    let overPanel = false;
    if (dockPanelWin && !dockPanelWin.isDestroyed() && dockPanelWin.isVisible()) {
      try {
        const pb = dockPanelWin.getBounds();
        overPanel = p.x >= pb.x && p.x <= pb.x + pb.width && p.y >= pb.y && p.y <= pb.y + pb.height;
      } catch {}
    }
    if (inside || overPanel) dockOutsideSince = 0;
    else {
      const now = Date.now();
      if (!dockOutsideSince) dockOutsideSince = now;
      else if (now - dockOutsideSince >= (Number(settings.dockCloseSeconds) ?? 3) * 1000) {
        dockOutsideSince = 0;
        collapseDockPanel();
      }
    }
  } else {
    dockOutsideSince = 0;
  }
}

function createDock() {
  if (dockWin && !dockWin.isDestroyed()) return;
  dockWin = new BrowserWindow({
    ...computeDockBounds(),
    frame: false, transparent: true, hasShadow: false, backgroundColor: '#00000000',
    resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true,
    roundedCorners: false, focusable: true,
    icon: APP_ICON_PATH,
    webPreferences: { nodeIntegration: true, contextIsolation: false, nodeIntegrationInSubFrames: true , backgroundThrottling: false},
  });
  dockExpanded = false;
  // Sin acrílico ni insertCSS de --bg: la ventana es transparente de verdad; el panel del
  // dock pinta su propio fondo. Arranca dejando pasar los clics (solo la barra captura).
  dockHitRects = []; dockIgnoring = null;
  setDockIgnore(true);
  if (dockHitTimer) clearInterval(dockHitTimer);
  dockHitTimer = setInterval(updateDockHitTest, 60);
  // 'screen-saver' es el nivel que queda por encima de las aplicaciones a pantalla
  // completa. Con el alwaysOnTop normal, un juego o un vídeo maximizado se ponía
  // delante y la barra desaparecía. La ventana es click-through salvo en la barra,
  // así que estar tan arriba no molesta a nada.
  try { dockWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
  dockWin.loadFile(path.join(__dirname, 'src', 'dock.html'));
  sendDockConfig();
  dockWin.once('ready-to-show', () => { if (dockWin && !dockWin.isDestroyed()) dockWin.showInactive(); });
  // El clic fuera se detecta en la ventana del PANEL (ver createDockPanel): esta ventana
  // es la de la barrita y no tiene foco propio.
  dockWin.on('closed', () => {
    if (dockHitTimer) { clearInterval(dockHitTimer); dockHitTimer = null; }
    dockWin = null; dockExpanded = false; dockHitRects = []; dockIgnoring = null;
  });

  // Red de seguridad: la ventana cubre toda el área de trabajo, y quien decide si los
  // clics pasan al escritorio es el renderer. Si el renderer se cuelga o se muere, esa
  // decisión deja de actualizarse, así que forzamos click-through (y si ha muerto del
  // todo, salimos del modo dock) para no dejar la pantalla bloqueada.
  dockWin.webContents.on('unresponsive', () => {
    try { dockWin.setIgnoreMouseEvents(true); } catch {}
  });
  dockWin.webContents.on('render-process-gone', () => {
    destroyDock();
    settings.dockMode = false; saveSettings(); updateTrayTitle();
    openMain();
  });
}

function destroyDock() {
  if (dockPanelWin && !dockPanelWin.isDestroyed()) dockPanelWin.close();
  dockPanelWin = null;
  if (dockHitTimer) { clearInterval(dockHitTimer); dockHitTimer = null; }
  if (dockWin && !dockWin.isDestroyed()) dockWin.close();
  dockWin = null; dockExpanded = false; dockHitRects = []; dockIgnoring = null;
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
  if (view !== 'panel' && view !== 'calendar') return;   // Guardadas/Ajustes no se recuerdan
  if (settings.lastView === view) return;
  settings.lastView = view;
  saveSettingsSoon();
}

// Abre la app por donde se quedó la última vez (panel, calendario o guardadas).
function openLastView() {
  checkForUpdatesIfStale();
  const v = settings.lastView;   // se lee ANTES: openMain() lo sobrescribe con 'panel'
  if (settings.dockMode) { dockNavigate(v && v !== 'settings' ? v : 'panel'); return; }
  // En modo ventanas el panel se abre SIEMPRE: es el único sitio con los botones para
  // navegar. Si no, al recordar "Guardadas" o "Calendario" se abría solo esa ventana y no
  // había forma de volver (y al cerrarla no quedaba nada visible: parecía que la app se
  // rompía). La vista recordada se abre encima del panel.
  openMain();
  if (v === 'calendar') openCalendar();
}

// Evita quedarse sin ninguna ventana a la vista al cerrar el calendario o Guardadas.
function ensureSomeWindowVisible() {
  if (settings.dockMode) return;
  const anyVisible = [mainWin, calendarWin, groupsWin]
    .some(w => w && !w.isDestroyed() && w.isVisible());
  if (!anyVisible) openMain();
}

// Enseña una vista dentro del dock (en vez de abrir una ventana suelta).
function dockNavigate(view) {
  checkForUpdatesIfStale();
  rememberView(view);
  if (!dockWin || dockWin.isDestroyed()) createDock();
  dockPanelView = view;
  showDockPanel();
  const send = () => { try { dockPanelWin.webContents.send('dock-navigate', view); } catch {} };
  if (dockPanelWin.webContents.isLoading()) dockPanelWin.webContents.once('did-finish-load', send);
  else send();
  if (dockWin && !dockWin.isDestroyed()) { try { dockWin.webContents.send('dock-expand'); } catch {} }
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
    frame: false, transparent: true, hasShadow: false, backgroundColor: '#00000000',
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

// ── Novedades al actualizar ───────────────────────────────────────────────────
function openWhatsNew() {
  if (whatsNewWin && !whatsNewWin.isDestroyed()) { whatsNewWin.show(); whatsNewWin.focus(); return; }
  whatsNewWin = makeWindow('whatsnew.html', 440, 430, {
    alwaysOnTop: true, resizable: false,
    minWidth: 400, minHeight: 380, maxWidth: 520, maxHeight: 520,
  });
  whatsNewWin.once('ready-to-show', () => {
    whatsNewWin.show(); whatsNewWin.focus();
    try { whatsNewWin.moveTop(); } catch {}
  });
  whatsNewWin.on('closed', () => { whatsNewWin = null; });
}

// Se enseña una sola vez por versión y SOLO en el canal estable: en el de prueba salen
// versiones a diario y sería un incordio verlo cada vez.
function whatsNewSignature(notes) {
  if (!notes) return '';
  return (notes.steps || []).map(s => s.title).join('|');
}

function maybeShowWhatsNew() {
  const v = app.getVersion();
  if (settings.lastSeenVersion === v) return;
  // Lo que decide si hay recorrido es que ESA versión tenga novedades escritas, y solo
  // las estables las tienen. Antes se descartaba además a quien tuviera Betatester
  // activado, y eso también le ocultaba las novedades de las estables, que es justo lo
  // que había que enseñar.
  const notes = WHATS_NEW[v];
  const sig = whatsNewSignature(notes);
  const yaVisto = !!sig && sig === settings.lastSeenWhatsNew;
  settings.lastSeenVersion = v;      // se marca aunque no haya notas, para no reintentarlo
  if (sig) settings.lastSeenWhatsNew = sig;
  saveSettings();
  // Si la versión nueva cuenta exactamente lo mismo que la anterior, no se repite:
  // ya se leyó una vez y volver a soltarlo entero es justo lo que molestaba.
  if (!notes || yaVisto) return;
  setTimeout(() => openWhatsNew(), 1200);   // tras el arranque, sin pisar al splash
}

function sendUpdateState(state) {
  pendingUpdateState = state;
  if (updateWin && !updateWin.isDestroyed()) updateWin.webContents.send('update-state', state);
}

// ── IPC ───────────────────────────────────────────────────────────────────────
function getSerializableState() {
  return {
    tasks: state.tasks.map(t => {
      const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
      return {
        ...t,
        todaySecs: todaySecondsForTask(t),
        totalSecs: totalSecondsForTask(t),
        inTrash: isInTrash(t),   // para la sección "Papelera" de Guardadas
        subtasks: (t.subtasks || []).map(sub => ({
          ...sub,
          todaySecs: secondsForSub(t, sub.id, hoy0.getTime()),
          totalSecs: secondsForSub(t, sub.id, null),
        })),
        // Tiempo apuntado a la tarea sin subtarea ninguna, para que la suma cuadre.
        ownTodaySecs: secondsForSub(t, null, hoy0.getTime()),
      };
    }),
    groups: sortedGroups(),
    activeTaskId: state.activeTaskId,
    activeSubId: state.activeSubId || null,
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
// Avisa a TODAS las vistas de que hay un recorrido en marcha. Hace falta además de la
// respuesta a 'am-i-visible' porque, si la vista de destino ya era la que estaba
// abierta, el iframe no se recarga y esa página nunca llega a preguntar.
function broadcastTourFlag() {
  [dockPanelWin, mainWin, calendarWin, groupsWin, settingsWin].forEach(w => {
    if (w && !w.isDestroyed()) sendToAllFrames(w, 'tutorial-tour');
  });
}

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
  [widgetWin, mainWin, calendarWin, groupsWin, dockWin, dockPanelWin].forEach(w => sendStateToWindow(w));
}

ipcMain.on('action', (event, { type, payload }) => {
  switch (type) {
    case 'start-task':    startTask(payload.taskId, payload.backMinutes, payload.subId); break;
    case 'add-subtask':    addSubtask(payload.taskId, payload.name); break;
    case 'rename-subtask': renameSubtask(payload.taskId, payload.subId, payload.name); break;
    case 'delete-subtask': deleteSubtask(payload.taskId, payload.subId); break;
    case 'pause':         pauseActive(); break;
    case 'switch-task':   switchTask(payload.taskId, payload.backMinutes, payload.subId, payload.note); break;
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
    case 'unarchive-task': unarchiveTask(payload.taskId); break;
    case 'create-group':  createGroup(payload.name); break;
    case 'rename-group':  renameGroup(payload.groupId, payload.name); break;
    case 'delete-group':  deleteGroup(payload.groupId); break;
    case 'move-task-to-group': moveTaskToGroup(payload.taskId, payload.groupId); break;
    case 'set-eye-care': {
      const p = payload || {};
      const antesActivo = !!settings.eyeCareEnabled;
      const antesCada = settings.eyeCareEvery;
      if (p.eyeCareEnabled !== undefined) settings.eyeCareEnabled = !!p.eyeCareEnabled;
      if (p.eyeCareEvery !== undefined) settings.eyeCareEvery = Math.max(1, Math.min(180, Number(p.eyeCareEvery) || 20));
      if (p.eyeCareRest !== undefined) settings.eyeCareRest = Math.max(5, Math.min(120, Number(p.eyeCareRest) || 20));
      if (p.eyeCarePos !== undefined) settings.eyeCarePos = p.eyeCarePos;
      if (p.eyeCareSize !== undefined) settings.eyeCareSize = Math.max(80, Math.min(420, Number(p.eyeCareSize) || 150));
      saveSettingsSoon(); broadcastState();
      // La cuenta atrás solo vuelve a empezar si se acaba de encender o si cambia cada
      // cuánto avisa. Mover el tamaño o la posición no debe retrasar el próximo aviso.
      const reiniciar = (!antesActivo && settings.eyeCareEnabled) || antesCada !== settings.eyeCareEvery;
      startEyeCareTimer(reiniciar);
      // Al tocar la posición o el tamaño se enseña un momento, para verlo mientras se ajusta.
      if (p.preview) showEyeCare(p.previewSeconds || 3, true);
      break;
    }
    case 'eye-done': hideEyeCare(); break;
    case 'set-leave': {
      const p = payload || {};
      settings.leaveEnabled = !!p.leaveEnabled;
      settings.leaveSameEveryDay = p.leaveSameEveryDay !== false;
      if (typeof p.leaveTime === 'string') settings.leaveTime = p.leaveTime;
      if (p.leaveDays && typeof p.leaveDays === 'object') settings.leaveDays = p.leaveDays;
      settings.leaveAutoStop = !!p.leaveAutoStop;
      leaveNotifiedOn = null;   // cambiar la hora vuelve a habilitar el aviso de hoy
      saveSettings(); broadcastState();
      startLeaveWatcher();
      break;
    }
    case 'set-impute-url': {
      const url = String((payload && payload.url) || '').trim().slice(0, 2000);
      settings.imputeUrl = normalizeUrl(url);
      saveSettings(); broadcastState();
      break;
    }
    case 'open-impute-url': openImputeUrl(); break;
    case 'set-week-days': {
      const dias = Array.isArray(payload && payload.days)
        ? payload.days.map(Number).filter(d => d >= 0 && d <= 6) : [];
      settings.weekDays = dias.length ? [...new Set(dias)] : [1, 2, 3, 4, 5, 6, 0];
      saveSettings(); broadcastState();
      break;
    }
    case 'set-week-override': {
      const clave = String((payload && payload.week) || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(clave)) break;
      if (!settings.weekOverrides || typeof settings.weekOverrides !== 'object') settings.weekOverrides = {};
      if (payload.days === null) {
        delete settings.weekOverrides[clave];   // vuelve a lo de siempre
      } else {
        const dias = Array.isArray(payload.days) ? payload.days.map(Number).filter(d => d >= 0 && d <= 6) : [];
        settings.weekOverrides[clave] = [...new Set(dias)];
      }
      pruneWeekOverrides();
      saveSettings(); broadcastState();
      break;
    }
    case 'week-days-menu': showWeekDaysMenu(payload && payload.week); break;
    case 'set-group-sort':
      if (payload && payload.sort !== undefined) {
        settings.groupSort = ['alpha', 'created', 'custom'].includes(payload.sort) ? payload.sort : 'created';
      }
      if (payload && payload.dir !== undefined) {
        settings.groupSortDir = payload.dir === 'desc' ? 'desc' : 'asc';
      }
      saveSettings(); broadcastState();
      break;
    case 'reorder-groups': reorderGroups(payload && payload.ids); break;
    case 'restore-and-start-task': restoreAndStartTask(payload.taskId, payload.backMinutes, payload.subId); break;
    case 'edit-entry':    editEntry(payload.taskId, payload.entryIndex, payload.startMs, payload.endMs, payload.note, payload.name, payload.subId); break;
    case 'delete-entry':  deleteEntry(payload.taskId, payload.entryIndex); break;
    case 'add-calendar-entry':
      addCalendarEntry(payload.taskId, payload.newTaskName, payload.newTaskColor, payload.startMs, payload.endMs, payload.note);
      break;
    case 'save-settings': {
      const wasDock = settings.dockMode;
      settings = { ...settings, ...payload };
      saveSettings(); resetReminderTimer(); applyLoginItem(); applyTranslucencyAll();
      applyDockMode(wasDock);   // crea/destruye el dock si ha cambiado el modo
      // El botón es "Aplicar": deja los ajustes aplicados pero SIN cerrarlos ni sacarte
      // de la pantalla, para poder seguir tocando cosas.
      break;
    }
    case 'set-blur':
      settings.blurEnabled = !!(payload && payload.enabled);
      saveSettings();
      // El material solo se puede cambiar en caliente en algunas ventanas; el panel del
      // dock se recrea para que el cambio se vea seguro.
      applyTranslucencyAll();
      if (dockPanelWin && !dockPanelWin.isDestroyed()) {
        const wasVisible = dockPanelWin.isVisible();
        dockPanelWin.close(); dockPanelWin = null;
        if (wasVisible) showDockPanel();
      }
      break;
    // Aplicar un ajuste suelto al momento (los controles de Ajustes no deben esperar a
    // que se pulse "Aplicar" para verse).
    case 'set-setting': {
      const key = payload && payload.key;
      if (!key || !(key in settings)) break;
      settings[key] = payload.value;
      saveSettingsSoon();
      if (key === 'reminderMinutes' || key === 'widgetAutoHide' || key === 'widgetAutoHideSeconds') resetReminderTimer();
      if (key === 'openAtLogin') applyLoginItem();
      broadcastState();   // p. ej. colorMode lo usan los selectores de color
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
      tourActive = true;   // el recorrido empieza por el Panel y de ahí va solo
      openMain();
      setTimeout(broadcastTourFlag, 400);
      break;
    // Una vista recién cargada pregunta si el usuario la está viendo ya. Hace falta
    // porque al cambiar de pestaña el iframe se recarga y se pierde el aviso 'dock-expanded'.
    case 'am-i-visible':
      if (dockExpanded) { try { event.reply('dock-expanded'); } catch {} }
      if (tourActive) { try { event.reply('tutorial-tour'); } catch {} }
      break;
    // Recorrido asistido: al acabar los pasos de una vista, lleva solo a la siguiente.
    // Las vistas que ya no tengan nada pendiente lo mandan también, para no dejar al
    // usuario plantado en una pantalla sin explicación ninguna.
    case 'tutorial-next': {
      if (!tourActive) break;   // no hay recorrido en marcha: nadie tiene que ir a ningún lado
      const idx = TOUR_ORDER.indexOf(payload && payload.from);
      const next = idx >= 0 ? TOUR_ORDER[idx + 1] : null;
      if (!next) { tourActive = false; break; }
      const open = { calendar: openCalendar, groups: openGroups, settings: openSettings };
      setTimeout(() => { try { open[next](); } catch {} }, 260);
      break;
    }
    case 'tutorial-stop': tourActive = false; break;
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
    case 'dock-hit-rects':
      dockHitRects = (payload && Array.isArray(payload.rects)) ? payload.rects : [];
      dockBarRect = (payload && payload.barRect) || null;
      updateDockHitTest();
      break;
    case 'set-dnd': setDnd(payload && payload.minutes === null ? null : Number(payload && payload.minutes) || 0); break;
    case 'calendar-context-menu': showCalendarContextMenu(payload && payload.taskId, payload && payload.entryIndex); break;
    case 'dock-context-menu': showDockContextMenu(); break;
    case 'show-dock-bar': hideDockFor(null); break;
    case 'dock-expand':            // la barrita pide abrir el panel
      showDockPanel();
      break;
    case 'dock-collapse-panel':     // la barrita (o su botón) pide cerrarlo
      collapseDockPanel();
      break;
    case 'dock-view-changed':
      if (payload && payload.view) {
        dockPanelView = payload.view;
        rememberView(payload.view);
        // El calendario tiene su propio ancho: al cambiar de vista se reajusta. La
        // ventana se ANIMA hasta el tamaño nuevo en vez de dar el salto: así se ve que
        // el panel se adapta, no solo que un contenido sustituye al otro. El punto de
        // partida se lee aquí y se pasa explícito (ver animateWindowBounds).
        if (dockPanelWin && !dockPanelWin.isDestroyed()) {
          let desde = null;
          try { desde = dockPanelWin.getBounds(); } catch {}
          const nb = computePanelBounds(dockPanelView);
          animateWindowBounds(dockPanelWin, nb, 260, desde, (b) => positionDockHide(b));
          // Y al acabar, siempre. onFrame no basta: si el tamaño no cambia entre dos
          // vistas (panel, guardadas y ajustes son igual de anchos), la animación no
          // llega a dar un solo fotograma y el botón se quedaba donde estuviera.
          setTimeout(() => positionDockHide(computePanelBounds(dockPanelView)), 300);
        }
      }
      break;
    case 'dock-panel-resize':
      if (dockPanelWin && !dockPanelWin.isDestroyed() && payload) {
        const work = dockDisplay().workArea;
        const c = dockConfig();
        const vertical = c.anchor === 'left' || c.anchor === 'right';
        const size = Number(payload.size) || 0;
        try {
          let nb;
          if (vertical) {
            const width = Math.max(320, Math.min(size, work.width));
            nb = { x: c.anchor === 'left' ? work.x : work.x + work.width - width, y: work.y, width, height: work.height };
          } else {
            const height = Math.max(260, Math.min(size, work.height));
            nb = { x: work.x, y: c.anchor === 'top' ? work.y : work.y + work.height - height, width: work.width, height };
          }
          dockPanelWin.setBounds(nb);
          // Se le pasan los límites que acabamos de fijar, no los que devuelva getBounds:
          // justo después de un setBounds puede seguir dando los de antes.
          positionDockHide(nb);
        } catch {}
      }
      break;
    case 'dock-panel-resize-end': {
      // Se recuerda por separado: el ancho del calendario no pisa el del resto.
      const c = dockConfig();
      const vertical = c.anchor === 'left' || c.anchor === 'right';
      const size = Number(payload && payload.size) || 0;
      if (size > 0) {
        if (!vertical) settings.dockPanelHeight = size;
        else if ((payload && payload.view) === 'calendar') settings.dockCalendarWidth = size;
        else settings.dockPanelWidth = size;
        saveSettingsSoon();
        sendDockConfig();   // la barrita necesita el tamaño para colocar su botón
      }
      break;
    }
    // El módulo screen no está disponible de forma fiable dentro de un iframe del dock:
    // la lista de monitores se pide aquí (por eso el desplegable salía vacío).
    case 'get-displays':
      event.reply('displays', screen.getAllDisplays().map((d, i) => ({
        id: d.id, index: i + 1,
        width: d.size.width, height: d.size.height,
        primary: d.bounds.x === 0 && d.bounds.y === 0,
      })));
      break;
    case 'dock-focus':
      checkForUpdatesIfStale();
      if (dockWin && !dockWin.isDestroyed()) { try { dockWin.focus(); } catch {} }
      break;
    // Vista previa en vivo mientras se toquetea la barra en Ajustes (sin darle a Guardar).
    case 'set-dock-config': {
      const { preview, ...vals } = payload || {};
      settings = { ...settings, ...vals };
      if (vals.dockDisplayId !== undefined) {
        const elegida = screen.getAllDisplays().find(d => d.id === vals.dockDisplayId);
        settings.dockDisplayKey = elegida ? displayKey(elegida) : null;
      }
      saveSettingsSoon();   // los deslizadores disparan esto muchas veces por segundo
      if (settings.dockMode) { createDock(); positionDock(); }
      // Con el panel abierto la barrita se oculta; al ajustarla hay que verla.
      if (preview && dockWin && !dockWin.isDestroyed()) {
        const now = Date.now();
        if (now - lastBarRaiseAt > 1500) {
          lastBarRaiseAt = now;
          try { dockWin.moveTop(); } catch {}   // si no, queda debajo de la ventana del panel
        }
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
    case 'get-whats-new': {
      const v = app.getVersion();
      const notes = WHATS_NEW[v];
      event.reply('whats-new', { version: v, title: notes && notes.title, steps: (notes && notes.steps) || [] });
      break;
    }
    case 'show-whats-new': openWhatsNew(); break;   // botón "Ver novedades" de Ajustes
    // Del resumen de novedades al recorrido guiado: los pasos del tutorial llevan la
    // versión en la que se añadieron, así que los pendientes son justo los de lo nuevo.
    case 'start-whats-new-tour':
      if (whatsNewWin && !whatsNewWin.isDestroyed()) whatsNewWin.close();
      tourActive = true;
      openMain();
      setTimeout(broadcastTourFlag, 400);   // por si el Panel ya era la vista abierta
      break;
    case 'close-whats-new':
      if (whatsNewWin && !whatsNewWin.isDestroyed()) whatsNewWin.close();
      break;
    case 'set-theme':
      if (payload && payload.theme !== undefined) {
        settings.theme = THEMES[payload.theme] ? payload.theme : DEFAULT_THEME;
        applySystemThemeSource();
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
      else { if (calendarWin && !calendarWin.isDestroyed()) calendarWin.hide(); ensureSomeWindowVisible(); }
      break;
    case 'close-settings':
      if (settings.dockMode) dockNavigate('panel');
      else if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
      break;
    case 'close-groups':
      if (settings.dockMode) dockNavigate('panel');
      else { if (groupsWin && !groupsWin.isDestroyed()) groupsWin.hide(); ensureSomeWindowVisible(); }
      break;
    case 'open-sync':     openSync(); break;
    case 'close-sync':    if (syncWin && !syncWin.isDestroyed()) syncWin.hide(); break;
    case 'open-update-window': openUpdateWindow(); break;   // desde el botón rojo del panel
    case 'update-download': if (autoUpdater) autoUpdater.downloadUpdate(); break;
    case 'update-install':  installUpdateNow(); break;
    case 'close-update':    if (updateWin && !updateWin.isDestroyed()) updateWin.close(); break;
    case 'check-for-updates': checkForUpdates(true); break;   // botón "Buscar actualizaciones" de Ajustes
    case 'set-beta-updates':
      settings.betaUpdates = !!(payload && payload.enabled);
      saveSettings();
      if (autoUpdater) {
        autoUpdater.allowPrerelease = settings.betaUpdates;
        lastAutoCheckAt = 0;              // que la próxima comprobación no la frene el límite
        checkForUpdates(true);            // mirar ya en el canal nuevo
      }
      break;
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
const AUTO_CHECK_THROTTLE_MS = 60 * 1000;   // como mucho una comprobación automática cada minuto

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
  // Nada se descarga ni se instala sin permiso: al detectar una versión nueva solo se
  // avisa, y el usuario decide si descargarla ("Descargar ahora") o dejarlo para luego.
  autoUpdater.autoDownload = false;
  // Si ya se descargó y la app se cierra por su cuenta, se aprovecha para instalarla
  // (no interrumpe nada, porque el usuario ya estaba saliendo).
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = !!settings.betaUpdates;   // canal betatester

  autoUpdater.on('update-available', (info) => {
    manualCheck = false;
    const isNew = !updateInfo || updateInfo.version !== info.version;
    updateInfo = { version: info.version };
    broadcastState();                    // muestra el botón rojo "Actualizar" en el panel
    openUpdateWindow();
    sendUpdateState({ phase: 'available', current: app.getVersion(), version: info.version });
    // Notificación del sistema, para enterarse aunque se esté en otra aplicación. Solo la
    // primera vez que se detecta esa versión, para no repetirla en cada comprobación.
    if (isNew) notifyUpdateAvailable(info.version);
  });

  autoUpdater.on('download-progress', (p) => {
    sendUpdateState({ phase: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p.percent || 0))) });
  });

  autoUpdater.on('update-not-available', () => {
    if (manualCheck) { openUpdateWindow(); sendUpdateState({ phase: 'uptodate', current: app.getVersion() }); }
    manualCheck = false;
  });

  autoUpdater.on('update-downloaded', (info) => {
    // Descargada, pero NO se instala sola: se avisa y el usuario elige cuándo reiniciar.
    openUpdateWindow();
    sendUpdateState({ phase: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    if (manualCheck) { openUpdateWindow(); sendUpdateState({ phase: 'error', message: String((err && err.message) || err) }); }
    manualCheck = false;
  });

  checkForUpdates(false);                              // al arrancar
  setTimeout(() => checkForUpdates(false), 15000);     // reintento por si la red aún no estaba lista (p.ej. arranque con Windows)
  setInterval(() => checkForUpdates(false), 5 * 60 * 1000);   // y cada 5 min mientras esté abierta
}

function notifyUpdateAvailable(version) {
  if (dndActive()) return;   // el botón del panel sigue estando; el aviso encima, no
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: 'imputa.me · actualización disponible',
      body: `Versión ${version} lista para descargar. Tú decides cuándo.`,
      icon: APP_ICON_PATH,
      silent: false,
    });
    n.on('click', () => { openUpdateWindow(); });
    n.show();
  } catch {}
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
  pruneWeekOverrides();
  applySystemThemeSource();
  // Instalación nueva: el recorrido va solo por las cuatro pantallas. En cualquier otro
  // caso hay que pedirlo desde Ajustes; si no, a quien le quedaran pasos sueltos se lo
  // encontraría paseándole por la app en cada arranque.
  if (!(settings.tutorialSeenSteps || []).length) tourActive = true;
  startLeaveWatcher();
  startEyeCareTimer();
  // No molestar se apaga solo al vencer: dndActive() lo caduca y avisa a las vistas.
  setInterval(() => { if (settings.dndUntil) dndActive(); }, 30000);

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

  // Conectar/desconectar monitores o cambiar su resolución deja las medidas viejas.
  ['display-added', 'display-removed', 'display-metrics-changed'].forEach(ev => {
    try {
      screen.on(ev, () => {
        // Varias pasadas: al desconectar un monitor, Windows tarda un poco en dejar
        // las áreas de trabajo definitivas, y una sola pasada inmediata las coge a medias.
        [0, 400, 1500, 4000].forEach(ms => setTimeout(() => {
          if (!settings.dockMode) return;
          positionDock(); syncDockBounds(); ensureDockBarVisible();
        }, ms));
      });
    } catch {}
  });
  setInterval(() => {
    if (!settings.dockMode) return;
    // dockIsHidden() caduca el escondite solo, y ensureDockBarVisible la devuelve
    // (y le reafirma el nivel, por si algo a pantalla completa se puso delante).
    if (dockIsHidden()) return;
    ensureDockBarVisible();
    syncDockBounds();
  }, 3000);

  startTick();
  resetReminderTimer();
  applyLoginItem();                         // sincroniza el registro con el ajuste guardado
  // Si arranca solo por el inicio de sesión de Windows (--hidden), no se abre el panel.
  // PERO en modo barra flotante la barrita ES la presencia de la app (ya es discreta de
  // por sí), así que hay que crearla igualmente: si no, arrancar con Windows dejaba la
  // app sin nada visible salvo el icono de la bandeja.
  if (process.argv.includes('--hidden')) {
    if (settings.dockMode) {
      createDock();
      // Arrancando con Windows, las pantallas todavía no son las definitivas: se recoloca
      // un par de veces después para que la barrita no quede fuera ni en medio.
      setTimeout(ensureDockBarVisible, 2500);
      setTimeout(ensureDockBarVisible, 8000);
    }
  } else {
    showSplashThenMain();
  }
  setupAutoUpdate();
  maybeShowWhatsNew();
});

// Cierre a conciencia antes de instalar una actualización.
// El instalador intenta cerrar la app por su cuenta y no siempre puede: las ventanas
// de imputa.me no salen en la barra de tareas, varias no tienen marco y alguna ni
// acepta el foco, así que el "cierra la aplicación y reintenta" salía una y otra vez.
// destroy() se salta cualquier manejador de cierre y garantiza que se van; la bandeja
// también, porque es lo último que mantiene la app en pie.
function installUpdateNow() {
  if (!autoUpdater) return;
  pauseActive(); saveData(); saveSettings();
  try { if (dockHitTimer) { clearInterval(dockHitTimer); dockHitTimer = null; } } catch {}
  try { if (tray) { tray.destroy(); tray = null; } } catch {}
  BrowserWindow.getAllWindows().forEach(w => { try { w.destroy(); } catch {} });
  // setImmediate para dejar que el ciclo de eventos procese las destrucciones antes
  // de lanzar el instalador.
  setImmediate(() => { try { autoUpdater.quitAndInstall(false, true); } catch {} });
}

app.on('window-all-closed', e => e.preventDefault());
// saveSettings() explícito: saveSettingsSoon puede tener un guardado pendiente (p. ej.
// la última vista abierta) que se perdería si la app se cierra antes de que salte.
app.on('before-quit', () => {
  pauseActive(); saveData(); saveSettings();
  // La bandeja se va con la app: si se queda, el instalador que se lanza al salir
  // (autoInstallOnAppQuit) puede seguir viendo el proceso vivo y pedir que la cierres.
  try { if (tray) { tray.destroy(); tray = null; } } catch {}
});
