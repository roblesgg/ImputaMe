// Ejecuta de verdad renderGroups() de src/groups.html con un DOM minimo, para saber si
// revienta ANTES de compilar. Es lo que le falto a la 2.5.2: un fallo en la primera
// vuelta del bucle dejaba la pestaña entera en blanco y no lo veia ningun comprobador
// estatico.
const fs = require('fs');
const path = require('path');

const raiz = process.argv[2] || '.';
const html = fs.readFileSync(path.join(raiz, 'src/groups.html'), 'utf8');
const compartido = fs.readFileSync(path.join(raiz, 'src/shared.js'), 'utf8');
const propio = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');

// ── DOM de juguete ─────────────────────────────────────────────────────────
function crearEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [], style: {}, dataset: {}, classes: new Set(),
    _html: '', textContent: '', title: '', draggable: false, value: '',
    get className() { return [...this.classes].join(' '); },
    set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    classList: {
      add: (...c) => c.forEach(x => el.classes.add(x)),
      remove: (...c) => c.forEach(x => el.classes.delete(x)),
      contains: (c) => el.classes.has(c),
      toggle: (c, f) => (f === undefined ? (el.classes.has(c) ? el.classes.delete(c) : el.classes.add(c)) : (f ? el.classes.add(c) : el.classes.delete(c))),
    },
    appendChild: (c) => { el.children.push(c); return c; },
    insertBefore: (c) => { el.children.unshift(c); return c; },
    replaceWith: () => {},
    remove: () => {},
    addEventListener: () => {},
    setPointerCapture: () => {},
    focus: () => {}, select: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10 }),
    // La clave del test: querySelector solo encuentra lo que el innerHTML declara.
    querySelector: (sel) => {
      const clase = sel.replace(/^\./, '');
      return el._html.includes(`class="${clase}`) || el._html.includes(`class="${clase} `) ||
             new RegExp(`class="[^"]*\\b${clase}\\b`).test(el._html) ? crearEl('button') : null;
    },
    querySelectorAll: () => [],
  };
  return el;
}

const almacen = {};
const document = {
  createElement: crearEl,
  getElementById: (id) => (almacen[id] || (almacen[id] = crearEl())),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  head: crearEl(), body: crearEl(),
  documentElement: { style: { setProperty: () => {} }, dataset: {} },
};
const window = { addEventListener: () => {}, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), innerWidth: 800, innerHeight: 600, dispatchEvent: () => {}, location: { search: '' } };
// Se guardan los manejadores para poder inyectar el estado por el mismo camino que
// usa la app: 'let currentState' no es accesible desde fuera del script.
const manejadores = {};
const ipcRenderer = { on: (canal, fn) => { (manejadores[canal] = manejadores[canal] || []).push(fn); }, send: () => {} };
const requireStub = (m) => (m === 'electron' ? { ipcRenderer, shell: { openExternal: () => {} } } : {});
const confirm = () => false;
const alert = () => {};

// ── Datos como los del usuario ─────────────────────────────────────────────
const grupos = ['Inicio', 'Pujante', 'Bitec', 'CX', 'Zukan', 'Catman']
  .map((name, i) => ({ id: 'g' + i, name, order: i + 1 }));
const tareas = [
  { id: 't1', name: 'Formación Carlos Mollá', color: '#818cf8', archived: true, groupId: 'g0', entries: [], subtasks: [], totalSecs: 34980, todaySecs: 0 },
  { id: 't2', name: 'Charla Presentación', color: '#34d399', archived: true, groupId: 'g0', entries: [], subtasks: [{ id: 's1', name: 'preparar', totalSecs: 600, todaySecs: 0 }], totalSecs: 3600, todaySecs: 0 },
  { id: 't3', name: 'Reunión CX', color: '#a78bfa', archived: true, groupId: 'g3', entries: [], subtasks: [], totalSecs: 10800, todaySecs: 0 },
  { id: 't4', name: 'Tarea suelta en el panel', color: '#f87171', archived: false, groupId: null, entries: [], subtasks: [], totalSecs: 60, todaySecs: 60 },
  { id: 't5', name: 'Archivada huérfana', color: '#fbbf24', archived: true, groupId: 'gBORRADA', entries: [], subtasks: [], totalSecs: 120, todaySecs: 0 },
  { id: 't6', name: 'En la papelera', color: '#60a5fa', archived: false, groupId: null, deleted: true, deletedAt: Date.now(), entries: [], subtasks: [], totalSecs: 0, todaySecs: 0, inTrash: true },
];

const escenarios = [
  { nombre: 'con secciones y tareas', estado: { tasks: tareas, groups: grupos, activeTaskId: 't4', settings: { groupSort: 'created', groupSortDir: 'asc' }, trashRetentionDays: 30 } },
  { nombre: 'orden personalizado',    estado: { tasks: tareas, groups: grupos, activeTaskId: null, settings: { groupSort: 'custom', groupSortDir: 'asc' }, trashRetentionDays: 30 } },
  { nombre: 'sin secciones',          estado: { tasks: tareas.map(t => ({ ...t, archived: false, groupId: null })), groups: [], activeTaskId: null, settings: {}, trashRetentionDays: 30 } },
  { nombre: 'del todo vacio',         estado: { tasks: [], groups: [], activeTaskId: null, settings: {}, trashRetentionDays: 30 } },
];

let fallos = 0;
for (const esc of escenarios) {
  Object.keys(almacen).forEach(k => delete almacen[k]);
  Object.keys(manejadores).forEach(k => delete manejadores[k]);
  const sandbox = { document, window, ipcRenderer, require: requireStub, confirm, alert, console,
                    setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Set, Map, Number, String, Array, Object, RegExp, prompt: () => null, URLSearchParams, Promise, Event: class {}, performance, location: { search: '' } };
  const ctx = require('vm').createContext(sandbox);
  try {
    require('vm').runInContext(compartido + '\n' + propio, ctx, { filename: 'groups.js' });
    document.getElementById('searchInput').value = '';
    (manejadores.state || []).forEach(fn => fn(null, esc.estado));   // como el IPC real
    const pintado = document.getElementById('groupsList').children.length;
    console.log(`  ${esc.nombre.padEnd(24)} -> ok (${pintado} tarjetas)`);
    if (esc.estado.groups.length && pintado === 0) { console.log('     AVISO: no ha pintado nada'); fallos++; }
  } catch (e) {
    console.log(`  ${esc.nombre.padEnd(24)} -> REVIENTA: ${e.message}`);
    fallos++;
  }
}
process.exit(fallos ? 1 : 0);
