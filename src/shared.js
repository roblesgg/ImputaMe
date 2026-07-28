// Utilidades compartidas por las distintas ventanas (cargar antes que el script propio de cada .html)
const COLORS = ['#6366f1','#f472b6','#34d399','#fbbf24','#60a5fa','#f87171','#a78bfa','#2dd4bf'];

// Modo "embed": la página va dentro de un iframe del dock (barra flotante), no como
// ventana propia. Se oculta el chrome de ventana (X, minimizar, asa de arrastre) porque
// esos controles no tienen sentido embebidos. La navegación (Calendario, Ajustes...) se
// sigue haciendo por IPC, y el proceso principal la redirige al propio dock.
const IS_EMBEDDED = new URLSearchParams(location.search).get('embed') === '1';
if (IS_EMBEDDED && document.body) document.body.classList.add('embedded');

// ── Tema de color ────────────────────────────────────────────────────────────
// El proceso principal manda la paleta ya resuelta y aquí se aplica como variables
// CSS. Se hace así (y no con insertCSS desde main) porque insertCSS solo llega al
// frame principal, y en modo dock cada vista va dentro de un iframe.
function applyThemeVars(t) {
  if (!t) return;
  const s = document.documentElement.style;
  s.setProperty('--bg', t.bg);
  s.setProperty('--bg2', t.bg2);
  s.setProperty('--bg3', t.bg3);
  s.setProperty('--border', t.border);
  s.setProperty('--text', t.text);
  s.setProperty('--text2', t.text2);
  s.setProperty('--accent', t.accent);
  s.setProperty('--accent2', t.accent2);
  s.setProperty('--surface', t.surface);
  s.setProperty('color-scheme', t.scheme);
  document.documentElement.dataset.theme = t.key || '';
}
(function () {
  let ipc = null;
  try { ipc = require('electron').ipcRenderer; } catch { return; }
  ipc.on('theme', (_, t) => applyThemeVars(t));
  ipc.send('action', { type: 'get-theme' });   // la respuesta vuelve a ESTE frame
  // Dentro del dock, la vista existe aunque el panel esté plegado: hasta que se despliega
  // no se ve nada (ver isViewVisibleToUser).
  ipc.on('dock-expanded', () => {
    window.__dockExpanded = true;
    window.dispatchEvent(new Event('dock-expanded'));
  });
})();

// ¿Está esta vista realmente a la vista del usuario? Embebida en el dock, no lo está
// mientras el panel siga plegado; sin esto el tutorial arrancaría a escondidas y daría
// sus pasos por vistos sin que nadie los llegue a ver.
function isViewVisibleToUser() {
  return !IS_EMBEDDED || window.__dockExpanded === true;
}

// Blanco o negro según la luminosidad del color de fondo, para que el texto
// siempre se lea bien encima de cualquier color de tarea (incluidos los que
// el usuario elija manualmente).
function contrastTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1a1a24' : '#ffffff';
}

// A partir de un <input type=number> (minutos) y uno type=time, calcula hace
// cuántos minutos empezó algo: si hay hora, tiene prioridad sobre los minutos.
function computeBackMinutes(minId, timeId) {
  const timeVal = document.getElementById(timeId).value;
  if (timeVal) {
    const [h, m] = timeVal.split(':').map(Number);
    const start = new Date();
    start.setHours(h, m, 0, 0);
    let diffMin = Math.round((Date.now() - start.getTime()) / 60000);
    if (diffMin < 0) diffMin += 24 * 60;
    return diffMin;
  }
  return parseInt(document.getElementById(minId).value) || 0;
}

// ── Tutorial guiado ───────────────────────────────────────────────────────────
// Recorrido "siguiente / siguiente / omitir tutorial": cada paso señala un elemento
// real de la ventana y lo explica. Cada paso lleva la versión en la que se introdujo;
// al abrir una ventana solo se muestran los pasos que el usuario aún no ha visto ni
// saltado (settings.tutorialSeenSteps), así que cada actualización futura que añada
// pasos nuevos solo enseña "la parte nueva", no el recorrido entero otra vez.
const TUTORIAL_STEPS = [
  { id:'main-total',     window:'main', version:'1.2.19', selector:'.total-banner',
    title:'Total de hoy', text:'Aquí ves el tiempo acumulado de todas tus tareas de hoy, sumando en tiempo real.' },
  { id:'main-nav',       window:'main', version:'1.2.19', selector:'#navButtons',
    title:'Calendario, Guardadas y Ajustes', text:'Desde aquí abres el Calendario (tu historial completo, editable), las tareas Guardadas (archivadas por grupos) y los Ajustes de la app.' },
  { id:'main-note',      window:'main', version:'1.2.19', selector:'#activeNoteRow',
    title:'Nota rápida', text:'Anota qué estás haciendo exactamente ahora mismo dentro de esta tarea. Se ve reflejada en el calendario y se borra sola al pausar.' },
  { id:'main-update',    window:'main', version:'1.2.19', selector:'#updateBtn',
    title:'Actualización disponible', text:'Cuando haya una versión nueva de imputa.me, aparece este aviso. Haz clic para instalarla.' },
  { id:'main-back',      window:'main', version:'1.2.19', selector:'.back-row',
    title:'¿Ya llevas tiempo?', text:'Si empezaste una tarea antes de abrir la app, pon aquí cuántos minutos llevas (o la hora exacta): al darle a play se descontará ese tiempo.' },
  { id:'main-playpause', window:'main', version:'1.2.19', selector:'#tasksList .task-pill-actions .icon-btn:last-child',
    title:'Iniciar / pausar', text:'Play o pausa el cronómetro de esta tarea. Solo puede haber una activa a la vez: al iniciar otra, esta se pausa sola.' },
  { id:'main-rename',    window:'main', version:'1.2.19', selector:'#tasksList .task-name',
    title:'Renombrar', text:'Doble clic sobre el nombre para renombrarla de aquí en adelante. El calendario ya hecho conserva el nombre que tenía en cada momento (cada entrada guarda el suyo).' },
  { id:'main-color',     window:'main', version:'1.2.19', selector:'#tasksList .task-dot',
    title:'Color', text:'Haz clic en el punto de color para cambiarlo.' },
  { id:'main-save',      window:'main', version:'1.2.19', selector:'#tasksList .icon-btn[title="Guardar en un grupo"]',
    title:'Guardar en un grupo', text:'Archiva la tarea en "Guardadas" para tenerla ordenada, sin que ocupe sitio en el panel principal. Podrás retomarla cuando quieras.' },
  { id:'main-addtask',   window:'main', version:'1.2.19', selector:'.new-task-area .btn-primary',
    title:'Añadir tarea', text:'Crea una tarea nueva. En cuanto le des a play, empieza a contar el tiempo.' },

  { id:'cal-grid',       window:'calendar', version:'1.2.19', selector:'#gridScroll',
    title:'La cuadrícula', text:'Arrastra sobre un hueco libre para crear una entrada a mano. Haz clic en un bloque para editarlo (su nombre y nota, solo de esa entrada) y, si está en marcha o ya ha terminado, para pausarla, reanudarla o reiniciarla con otra nota.' },
  { id:'cal-day',        window:'calendar', version:'1.2.19', selector:'#weekHeader',
    title:'Elegir día', text:'Haz clic en la cabecera de un día para seleccionarlo: se marca aquí y se resume en el panel de la izquierda.' },
  { id:'cal-summary',    window:'calendar', version:'1.2.19', selector:'.day-totals',
    title:'Resumen del día', text:'Cuánto tiempo llevas en cada tarea el día que tengas seleccionado.' },
  { id:'cal-legend',     window:'calendar', version:'1.2.19', selector:'.task-legend',
    title:'Tareas', text:'Haz clic en una tarea para mostrar u ocultar sus bloques en la cuadrícula.' },
  { id:'cal-minical',    window:'calendar', version:'1.2.19', selector:'.mini-cal',
    title:'Mini calendario', text:'Para saltar rápido a otra semana o mes.' },
  { id:'cal-export',     window:'calendar', version:'1.2.19', selector:'.export-btn',
    title:'Exportar', text:'Descarga tus horas en un CSV listo para abrir en Excel, del rango que quieras.' },
];

function tutAllStepIds() { return TUTORIAL_STEPS.map(s => s.id); }

function tutIsVisible(el) {
  if (!el) return false;
  const cs = window.getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

// Arranca el tutorial de esta ventana si hay pasos pendientes (no vistos/saltados)
// cuyo elemento esté visible ahora mismo. Devuelve true si lo ha arrancado.
function startTutorialIfNeeded(windowName, seenIds, onDone) {
  const seen = new Set(seenIds || []);
  const pending = TUTORIAL_STEPS.filter(s =>
    s.window === windowName && !seen.has(s.id) && tutIsVisible(document.querySelector(s.selector)));
  if (!pending.length) return false;
  runTutorial(pending, onDone);
  return true;
}

function runTutorial(steps, onDone) {
  let ipc = null;
  try { ipc = require('electron').ipcRenderer; } catch { return; }

  let idx = 0;
  const backdrop = document.createElement('div'); backdrop.className = 'tut-backdrop';
  const spotlight = document.createElement('div'); spotlight.className = 'tut-spotlight';
  const card = document.createElement('div'); card.className = 'tut-card';
  document.body.appendChild(backdrop);
  document.body.appendChild(spotlight);
  document.body.appendChild(card);

  function markSeen(ids) {
    if (ids.length) ipc.send('action', { type: 'mark-tutorial-seen', payload: { ids } });
  }

  function cleanup() {
    window.removeEventListener('resize', reposition);
    [backdrop, spotlight, card].forEach(el => el.remove());
    if (onDone) onDone();
  }

  function finish(skipAll) {
    markSeen(skipAll ? tutAllStepIds() : steps.map(s => s.id));
    cleanup();
  }

  function next() {
    if (idx >= steps.length - 1) { finish(false); return; }
    idx++;
    reposition();
  }

  function reposition() {
    const step = steps[idx];
    const el = document.querySelector(step.selector);
    if (!el || !tutIsVisible(el)) { next(); return; }   // el objetivo desapareció (p.ej. se pausó la tarea): pasamos al siguiente

    const r = el.getBoundingClientRect();
    const pad = 6;
    spotlight.style.left = (r.left - pad) + 'px';
    spotlight.style.top = (r.top - pad) + 'px';
    spotlight.style.width = (r.width + pad * 2) + 'px';
    spotlight.style.height = (r.height + pad * 2) + 'px';

    card.innerHTML = `
      <div class="tut-card-title">${step.title}</div>
      <div class="tut-card-text">${step.text}</div>
      <div class="tut-card-footer">
        <button class="tut-skip">Omitir tutorial</button>
        <div class="tut-card-nav">
          <span class="tut-progress">${idx + 1}/${steps.length}</span>
          ${idx > 0 ? '<button class="tut-btn-ghost tut-prev">Atrás</button>' : ''}
          <button class="tut-btn-primary tut-next">${idx === steps.length - 1 ? 'Entendido' : 'Siguiente'}</button>
        </div>
      </div>`;
    card.querySelector('.tut-skip').onclick = () => finish(true);
    card.querySelector('.tut-next').onclick = next;
    const prevBtn = card.querySelector('.tut-prev');
    if (prevBtn) prevBtn.onclick = () => { idx--; reposition(); };

    const cardW = 320;
    card.style.width = cardW + 'px';
    let left = r.left + r.width / 2 - cardW / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - cardW - 12));
    card.style.left = left + 'px';

    const cardH = card.offsetHeight;
    let top = r.bottom + pad + 14;
    if (top + cardH > window.innerHeight - 12) top = r.top - pad - 14 - cardH;
    if (top < 12) top = Math.min(window.innerHeight - cardH - 12, Math.max(12, r.top));
    card.style.top = top + 'px';
  }

  window.addEventListener('resize', reposition);
  reposition();
}

// ── Arrastre de la ventana desde el asa (.win-drag) ──────────────────────────
// Se hace por JavaScript en vez de con -webkit-app-region: drag porque en la ventana
// del calendario esa zona nunca llegó a funcionar. El main process mueve la ventana
// comparando la posición del cursor con la que había al empezar.
(function () {
  function initWinDrag() {
    const handle = document.querySelector('.win-drag');
    if (!handle) return;
    let ipc = null;
    try { ipc = require('electron').ipcRenderer; } catch { return; }

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.classList.add('dragging');
      ipc.send('win-drag', 'start');

      const onMove = () => ipc.send('win-drag', 'move');
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        handle.classList.remove('dragging');
        ipc.send('win-drag', 'end');
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initWinDrag);
  else initWinDrag();
})();
