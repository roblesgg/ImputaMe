// Comprobación estática: detecta llamadas a funciones propias que no existen.
// `node --check` solo valida sintaxis, así que un borrado accidental (como el de
// offscreenPanelBounds, que dejó la app reventando al abrir el panel) pasaba
// desapercibido hasta fallar en ejecución. Se ejecuta antes de publicar.
const fs = require('fs');

// De un .html solo interesa el JavaScript de sus <script> propios. Antes se analizaba
// el fichero entero, y el texto en castellano metía ruido constante: cualquier palabra
// seguida de un paréntesis —"la app (…)", "las horas (…)"— salía como función sin
// definir. Un aviso que salta siempre acaba ignorándose, y así fue como se coló un error
// de sintaxis de verdad en groups.html.
function soloJs(file, src) {
  if (!file.endsWith('.html')) return src;
  return [...src.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1]).join('\n;\n');
}

function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""');
}

const GLOBALS = new Set(['require', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'setImmediate', 'parseInt', 'parseFloat', 'isNaN', 'String', 'Number', 'Boolean', 'Array',
  'Object', 'Symbol', 'Promise', 'Error', 'Date', 'Math', 'JSON', 'console', 'process', 'fetch',
  'encodeURIComponent', 'decodeURIComponent', 'queueMicrotask', 'structuredClone',
  'requestAnimationFrame', 'cancelAnimationFrame', 'alert', 'confirm', 'prompt', 'Event', 'URLSearchParams', 'performance',
  'Set', 'Map', 'WeakMap', 'WeakSet', 'RegExp', 'Proxy', 'Reflect', 'async', 'URL', 'Image',
  // definidas en shared.js, que las páginas cargan con <script src> aparte:
  'isViewVisibleToUser', 'startTutorialIfNeeded', 'computeBackMinutes', 'contrastTextColor',
  'applyThemeVars', 'tutAllStepIds', 'tutIsVisible', 'runTutorial', 'askText', 'pickImputeUrl',
  // definida en calendar-dnd.js, que calendar.html carga aparte:
  'createCalendarDnD']);

const KEYWORDS = /^(if|for|while|switch|catch|return|typeof|function|new|await|case|do|else|of|in|delete|void|throw|yield|super|this)$/;

// Funciones declaradas que no llama nadie. Suena a mania del orden, pero ha cazado ya
// tres veces lo mismo: un parche que se aplica a medias deja la funcion escrita y sin
// enganchar, y la interfaz simplemente no reacciona (el color desde el calendario, la
// subtarea nueva desde su popup, esta misma comprobacion). Sintaxis correcta,
// referencias correctas: lo que falta es la llamada.
// OJO: se mira el fichero CRUDO, no el que pasa por stripNoise. Muchas funciones solo
// se llaman desde un onclick="..." del HTML, y stripNoise se lleva por delante lo que
// va entre comillas: sobre el texto limpio parecerian todas muertas.
function huerfanas(src) {
  const declaradas = [...src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
  // Una IIFE con nombre  -- (function loQueSea() { ... })()  --  aparece una sola vez y
  // aun asi se ejecuta: no esta muerta.
  const iife = new Set([...src.matchAll(/\(\s*function\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
  return [...new Set(declaradas)].filter(n => {
    if (GLOBALS.has(n) || iife.has(n)) return false;   // de otro fichero, o una IIFE
    const usos = src.match(new RegExp('\\b' + n + '\\b', 'g')) || [];
    return usos.length <= 1;            // solo aparece en su propia declaracion
  });
}

let bad = 0;
for (const file of process.argv.slice(2)) {
  const crudo = fs.readFileSync(file, 'utf8');
  const code = stripNoise(soloJs(file, crudo));
  const declared = new Set(GLOBALS);

  for (const m of code.matchAll(/\b(?:function\s*\*?\s*|class\s+)([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const id = part.trim().split(':').pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(id)) declared.add(id);
    }
  }
  for (const m of code.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const part of m[1].split(',')) {
      const id = part.trim().replace(/[.:={}\[\]].*$/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(id)) declared.add(id);
    }
  }

  // Metodos abreviados de un objeto literal:  { nombre(args) { ... } }  no son llamadas,
  // pero se escriben igual que una. Sin esto, cada metodo de un API devuelta como objeto
  // salia como funcion inexistente.
  for (const m of code.matchAll(/[,{]\s*([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/g)) declared.add(m[1]);

  const missing = new Set();
  for (const m of code.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const name = m[2];
    if (KEYWORDS.test(name) || declared.has(name)) continue;
    missing.add(name);
  }

  const sueltas = huerfanas(crudo);
  const aviso = sueltas.length ? '   (declaradas y sin usar: ' + sueltas.join(', ') + ')' : '';
  if (missing.size) { bad = 1; console.log(file + '  ->  SIN DEFINIR: ' + [...missing].join(', ') + aviso); }
  else console.log(file + '  ->  ok' + aviso);
}
process.exit(bad);
