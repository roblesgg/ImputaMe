// Pasa TODAS las comprobaciones y sale con codigo != 0 si alguna falla.
//
// Por que existe: encadenar los comprobadores a mano en una linea de terminal es facil
// de estropear. En la 2.7.2 se colo un error de sintaxis en groups.html porque la linea
// terminaba en `; echo "comprobadores limpios"`, y ese `;` imprime el mensaje de bien
// aunque lo anterior haya fallado. El script entero de la pagina no llegaba a
// ejecutarse y la pestaña Tareas salia vacia. Con un solo punto de entrada no hay forma
// de leer un "ok" que no sea de verdad.
//
//   node check-all.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const htmls = fs.readdirSync('src').filter(f => f.endsWith('.html')).map(f => path.join('src', f));
const js = ['main.js', 'sync.js', 'src/shared.js', 'src/calendar-dnd.js'].filter(f => fs.existsSync(f));

const pasos = [
  ['sintaxis de los .js', [...js.flatMap(f => ['--check', f])], true],
  ['sintaxis dentro de los .html', ['check-syntax.js', ...htmls], false],
  ['referencias y funciones sueltas', ['check-refs.js', ...js, ...htmls], false],
  ['pintado de la pestaña Tareas', ['check-render.js', '.'], false],
];

let fallos = 0;
for (const [nombre, args, esNodeDirecto] of pasos) {
  process.stdout.write(`  ${nombre.padEnd(34)}`);
  try {
    if (esNodeDirecto) {
      // node --check solo admite un fichero por llamada.
      for (let i = 0; i < args.length; i += 2) {
        execFileSync(process.execPath, [args[i], args[i + 1]], { stdio: 'pipe' });
      }
    } else {
      execFileSync(process.execPath, args, { stdio: 'pipe' });
    }
    console.log('ok');
  } catch (e) {
    fallos++;
    console.log('FALLA');
    const salida = String(e.stdout || '') + String(e.stderr || '');
    salida.trim().split('\n').slice(-12).forEach(l => console.log('      ' + l));
  }
}

console.log(fallos ? `\n  ${fallos} comprobacion(es) FALLAN: no publicar.` : '\n  Todo en orden.');
process.exit(fallos ? 1 : 0);
