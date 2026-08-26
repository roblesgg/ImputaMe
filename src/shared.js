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
  s.setProperty('--panel', t.panel || t.surface);
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
  // El proceso principal avisa de que esta vista es una parada del recorrido guiado.
  ipc.on('tutorial-tour', () => {
    window.__tutorialTour = true;
    window.dispatchEvent(new Event('tutorial-tour'));
  });
  // Preguntar al cargar: si esta vista nace cuando el panel YA está abierto (al cambiar
  // de pestaña el iframe se recarga), el aviso de arriba se envió antes de existir.
  ipc.send('action', { type: 'am-i-visible' });
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
  { id:'main-hero',      window:'main', version:'2.3.2', selector:'#heroCard',
    title:'La tarea en marcha', text:'Lo que estés haciendo ahora ocupa el sitio de honor: su cronómetro en grande, su nota y el botón de pausar. Cuando no hay nada corriendo, esta misma tarjeta te lo dice.' },
  { id:'main-nav',       window:'main', version:'1.2.19', selector:'#quickGrid',
    title:'Accesos rápidos', text:'Desde aquí abres el Calendario (tu historial completo, editable), las tareas Guardadas (archivadas por secciones) y los Ajustes. El cuarto botón vuelve a poner en marcha la última tarea que estuviste haciendo.' },
  { id:'main-note',      window:'main', version:'1.2.19', selector:'#activeNoteRow',
    title:'Nota rápida', text:'Anota qué estás haciendo exactamente ahora mismo dentro de esta tarea. Se ve reflejada en el calendario y se borra sola al pausar.' },
  { id:'main-update',    window:'main', version:'1.2.19', selector:'#updateBtn',
    title:'Actualización disponible', text:'Cuando haya una versión nueva de imputa.me, aparece este aviso. Haz clic para instalarla.' },
  { id:'main-back',      window:'main', version:'1.2.19', selector:'.back-row',
    title:'¿Ya llevas tiempo?', text:'Si empezaste una tarea antes de abrir la app, pon aquí cuántos minutos llevas (o la hora exacta): al darle a play se descontará ese tiempo.' },
  { id:'main-playpause', window:'main', version:'1.2.19', selector:'#tasksList .task-pill-actions .icon-btn:last-child',
    title:'Iniciar / pausar', text:'Play o pausa el cronómetro de esta tarea. Solo puede haber una activa a la vez: al iniciar otra, esta se pausa sola.' },
  { id:'main-rename',    window:'main', version:'1.2.19', selector:'#tasksList .task-pill-actions .icon-btn:first-child',
    title:'Renombrar', text:'El lápiz cambia el nombre de aquí en adelante. El calendario ya hecho conserva el nombre que tenía en cada momento: cada entrada guarda el suyo.' },
  { id:'main-subs',      window:'main', version:'2.3.4', selector:'#tasksList .task-chevron',
    title:'Subtareas', text:'La flechita despliega las subtareas de una tarea: dentro de "Cocina" puedes tener horno, frigorífico... Cada una lleva su propio tiempo y su play, y todo lo que hagas dentro suma en la tarea. Sus notas van igual que siempre, por sesión.' },
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
  { id:'cal-totales',    window:'calendar', version:'2.3.1', selector:'#weekTotalsList',
    title:'Semana y mes', text:'Debajo del día tienes lo que llevas cada tarea en la semana que estás viendo y en el mes entero, con su total. Haz clic en cualquiera para mostrar u ocultar sus bloques en la cuadrícula.' },
  { id:'cal-minical',    window:'calendar', version:'1.2.19', selector:'.mini-cal',
    title:'Mini calendario', text:'Para saltar rápido a otra semana o mes.' },
  { id:'cal-export',     window:'calendar', version:'1.2.19', selector:'.export-btn',
    title:'Exportar', text:'Descarga tus horas en un CSV listo para abrir en Excel, del rango que quieras.' },

  { id:'grp-search',     window:'groups', version:'2.2.2', selector:'#searchInput',
    title:'Buscar entre lo guardado', text:'Escribe aquí para encontrar una tarea archivada, esté en la sección que esté.' },
  { id:'grp-newsection', window:'groups', version:'2.2.2', selector:'.groups-topbar .btn-ghost',
    title:'Secciones', text:'Crea secciones para agrupar tus tareas archivadas como te venga bien: por cliente, por proyecto, por lo que quieras.' },
  { id:'grp-sort',       window:'groups', version:'2.2.2', selector:'#sortBtn',
    title:'Ordenar las secciones', text:'Alfabéticamente, por orden de creación o a tu manera arrastrándolas. Tú eliges.' },
  { id:'grp-rename',     window:'groups', version:'2.2.2', selector:'#groupsList .group-edit',
    title:'Cambiar el nombre', text:'El lápiz renombra la sección. Cada tarea guardada tiene el suyo propio para lo mismo.' },
  { id:'grp-restore',    window:'groups', version:'2.2.2', selector:'#groupsList .archived-task-row',
    title:'Retomar una tarea', text:'Haz clic en una tarea guardada para devolverla al Panel y seguir contando donde la dejaste.' },
  { id:'grp-trash',      window:'groups', version:'2.2.2', selector:'.trash-card',
    title:'La papelera', text:'Lo que borras se queda aquí 30 días antes de irse del todo, por si te arrepientes. Su historial del calendario no se toca nunca.' },

  { id:'set-theme',      window:'settings', version:'2.2.2', selector:'#themeGrid',
    title:'Temas y color', text:'Ocho paletas, clara incluida. Y justo debajo eliges el color de los botones por separado del fondo.' },
  { id:'set-dock',       window:'settings', version:'2.2.2', selector:'.row:has(#dockMode)',
    title:'La barra flotante', text:'Es el modo por defecto: una barra discreta en el borde. Aquí ajustas su borde, color, largo, grosor, transparencia, monitor y cuándo se cierra sola.' },
  { id:'set-beta',       window:'settings', version:'2.2.2', selector:'.row:has(#betaUpdates)',
    title:'Versiones de prueba', text:'Enciéndelo y recibirás las versiones nada más publicarse, antes que nadie. Apagado, solo llegan las estables.' },
  { id:'set-impute',     window:'settings', version:'2.4.0', selector:'#imputeUrl',
    title:'Enlace para imputar', text:'Pega aquí la dirección del sitio donde metes las horas de verdad. En cuanto la pongas, sale un botón "Imputar" en el Panel y en el Calendario que te lleva ahí.' },
  { id:'set-leave',      window:'settings', version:'2.4.0', selector:'.row:has(#leaveEnabled)',
    title:'Hora de salida', text:'Dile a qué hora terminas y te aviso si sigue habiendo una tarea en marcha. Puedes poner la misma hora toda la semana o una distinta cada día, cancelar los que no trabajes, y hasta que te pare la tarea sola.' },
  { id:'set-eyecare',    window:'settings', version:'2.4.0', selector:'.row:has(#eyeCareEnabled)',
    title:'Descansa la vista', text:'La regla 20-20-20: cada 20 minutos, 20 segundos mirando a lo lejos. Salen unos ojos con la cuenta atrás, y aquí eliges cada cuánto, cuánto duran, dónde aparecen y de qué tamaño.' },
  { id:'set-actions',    window:'settings', version:'2.2.2', selector:'.btn-grid',
    title:'Copias de seguridad y más', text:'Exporta tus datos a un archivo y restáuralos cuando quieras. Aquí también repites este tutorial, revisas las novedades y buscas actualizaciones.' },
];

function tutAllStepIds() { return TUTORIAL_STEPS.map(s => s.id); }

// Orden del recorrido guiado por las distintas pantallas.
const TUTORIAL_WINDOW_ORDER = ['main', 'calendar', 'groups', 'settings'];
function hasMoreWindows(windowName) {
  return TUTORIAL_WINDOW_ORDER.indexOf(windowName) < TUTORIAL_WINDOW_ORDER.length - 1;
}

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
  if (!pending.length) {
    // Si el recorrido va en marcha y aquí no queda nada que enseñar, sigue solo a la
    // siguiente pantalla en vez de dejar al usuario parado sin saber qué hacer.
    if (window.__tutorialTour && !window.__tutorialHopped) {
      window.__tutorialHopped = true;
      try { require('electron').ipcRenderer.send('action', { type: 'tutorial-next', payload: { from: windowName } }); } catch {}
    }
    return false;
  }
  runTutorial(pending, onDone, windowName);
  return true;
}

function runTutorial(steps, onDone, windowName) {
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
    // Si no se ha omitido, el recorrido continúa solo en la siguiente vista que tenga
    // pasos pendientes: el usuario solo tiene que ir dando a "Siguiente".
    if (skipAll) ipc.send('action', { type: 'tutorial-stop' });
    else if (window.__tutorialTour) ipc.send('action', { type: 'tutorial-next', payload: { from: windowName } });
  }

  function next() {
    if (idx >= steps.length - 1) { finish(false); return; }
    idx++;
    reposition();
  }

  // yaColocado = ya se ha desplazado la página hasta el objetivo; sin esto se volvería
  // a comprobar sin fin cuando el elemento es más alto que la ventana.
  function reposition(yaColocado) {
    const step = steps[idx];
    const el = document.querySelector(step.selector);
    if (!el || !tutIsVisible(el)) { next(); return; }   // el objetivo desapareció (p.ej. se pausó la tarea): pasamos al siguiente

    // Páginas largas (Ajustes, Guardadas): el objetivo puede estar fuera de la parte
    // visible. Antes se señalaba igual y tanto el foco como el recuadro se iban fuera
    // de la ventana, donde no se veían ni se podían pulsar.
    if (yaColocado !== true) {
      const r0 = el.getBoundingClientRect();
      const fuera = r0.top < 8 || r0.bottom > window.innerHeight - 8;
      if (fuera) {
        try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { el.scrollIntoView(); }
        requestAnimationFrame(() => reposition(true));
        return;
      }
    }

    // Se da por visto en cuanto se enseña, no al terminar el recorrido entero. Con 26
    // pasos repartidos por cuatro pantallas, quien lo dejaba a medias se lo encontraba
    // otra vez desde el principio en cada arranque.
    markSeen([step.id]);

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
          <button class="tut-btn-primary tut-next">${idx === steps.length - 1 ? (window.__tutorialTour && hasMoreWindows(windowName) ? 'Continuar →' : 'Entendido') : 'Siguiente'}</button>
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
    let top = r.bottom + pad + 14;                                   // debajo del objetivo
    if (top + cardH > window.innerHeight - 12) top = r.top - pad - 14 - cardH;   // no cabe: encima
    // Y pase lo que pase, dentro de la ventana: es la red de seguridad que faltaba.
    top = Math.max(12, Math.min(top, window.innerHeight - cardH - 12));
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

// ── Pedir un texto ───────────────────────────────────────────────────────────
// window.prompt() NO existe en Electron: es un no-op que devuelve undefined sin
// enseñar nada, así que todo lo que colgaba de él (crear y renombrar subtareas,
// reiniciar una tarea con otra nota) simplemente no hacía nada al pulsarlo.
// Esta es la sustituta, con el aspecto de la app y disponible en todas las vistas.
// Devuelve una promesa con el texto, o null si se cancela.
function askText({ title, text, value = '', okLabel = 'Guardar', placeholder = '', maxLength = 200 }) {
  return new Promise((resolve) => {
    if (!document.getElementById('ask-text-styles')) {
      const st = document.createElement('style');
      st.id = 'ask-text-styles';
      st.textContent = `
        .ask-backdrop { position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);-webkit-app-region:no-drag; }
        .ask-card {
          position:fixed;z-index:10001;left:50%;top:50%;transform:translate(-50%,-50%);
          width:min(340px, calc(100vw - 40px));
          background:var(--surface, #1c1c2a);border:1px solid var(--border, #333);
          border-radius:var(--radius-sm, 12px);padding:18px;
          display:flex;flex-direction:column;gap:11px;
          box-shadow:0 20px 60px rgba(0,0,0,.55);-webkit-app-region:no-drag;
        }
        .ask-title { font-size:14px;font-weight:700;color:var(--text, #fff); }
        .ask-text { font-size:12.5px;color:var(--text2, #999);line-height:1.45; }
        .ask-input {
          background:var(--bg, #111);border:1px solid var(--border, #333);border-radius:9px;
          color:var(--text, #fff);font-family:inherit;font-size:13.5px;padding:9px 11px;outline:none;
        }
        .ask-input:focus { border-color:var(--accent, #818cf8); }
        .ask-actions { display:flex;justify-content:flex-end;gap:8px;margin-top:2px; }
        .ask-btn {
          border:none;border-radius:9px;font-family:inherit;font-size:12.5px;font-weight:600;
          padding:8px 15px;cursor:pointer;
        }
        .ask-btn.ghost { background:var(--bg2, #222);color:var(--text, #fff);border:1px solid var(--border, #333); }
        .ask-btn.ghost:hover { background:var(--bg3, #2a2a2a); }
        .ask-btn.primary { background:var(--accent2, #6366f1);color:#fff; }
        .ask-btn.primary:hover { filter:brightness(1.08); }
      `;
      document.head.appendChild(st);
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'ask-backdrop';
    const card = document.createElement('div');
    card.className = 'ask-card';
    card.innerHTML = `
      <div class="ask-title"></div>
      ${text ? '<div class="ask-text"></div>' : ''}
      <input type="text" class="ask-input">
      <div class="ask-actions">
        <button class="ask-btn ghost">Cancelar</button>
        <button class="ask-btn primary"></button>
      </div>`;
    card.querySelector('.ask-title').textContent = title || '';
    if (text) card.querySelector('.ask-text').textContent = text;
    card.querySelector('.ask-btn.primary').textContent = okLabel;

    const input = card.querySelector('.ask-input');
    input.value = value;
    input.placeholder = placeholder;
    input.maxLength = maxLength;

    let cerrado = false;
    const cerrar = (res) => {
      if (cerrado) return; cerrado = true;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove(); card.remove();
      resolve(res);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); cerrar(null); }
      if (e.key === 'Enter' && document.activeElement === input) { e.preventDefault(); cerrar(input.value); }
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.onclick = () => cerrar(null);
    card.querySelector('.ask-btn.ghost').onclick = () => cerrar(null);
    card.querySelector('.ask-btn.primary').onclick = () => cerrar(input.value);

    document.body.appendChild(backdrop);
    document.body.appendChild(card);
    input.focus();
    input.select();
  });
}
