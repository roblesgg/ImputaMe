// Comprobación estática: detecta llamadas a funciones propias que no existen.
// `node --check` solo valida sintaxis, así que un borrado accidental (como el de
// offscreenPanelBounds, que dejó la app reventando al abrir el panel) pasaba
// desapercibido hasta fallar en ejecución. Se ejecuta antes de publicar.
const fs = require('fs');

function stripNoise(src) {
  return src
    // En los .html, el CSS de <style> no es JavaScript: sus funciones (var, rgba,
    // linear-gradient...) salían como "sin definir" y ahogaban los avisos de verdad.
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
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
  'applyThemeVars', 'tutAllStepIds', 'tutIsVisible', 'runTutorial', 'askText', 'pickImputeUrl']);

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
  return [...new Set(declaradas)].filter(n => {
    if (GLOBALS.has(n)) return false;   // vive en shared.js y la usan otras paginas
    const usos = src.match(new RegExp('\\b' + n + '\\b', 'g')) || [];
    return usos.length <= 1;            // solo aparece en su propia declaracion
  });
}

let bad = 0;
for (const file of process.argv.slice(2)) {
  const crudo = fs.readFileSync(file, 'utf8');
  const code = stripNoise(crudo);
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
