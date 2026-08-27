// Comprobación de sintaxis del JavaScript que va DENTRO de los .html.
// `node --check` solo sabe de ficheros .js, así que los <script> incrustados de las
// vistas no los miraba nadie: un paréntesis de más en calendar.html se descubría
// abriendo la app. Esto los extrae y los pasa por el mismo --check.
// Se ejecuta antes de publicar, junto a check-refs.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ficheros = process.argv.slice(2);
if (!ficheros.length) {
  console.error('uso: node check-syntax.js <fichero.html> [...]');
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'imputa-syntax-'));
let mal = 0;

for (const f of ficheros) {
  const src = fs.readFileSync(f, 'utf8');
  // Solo los <script> sin src: los que tienen src son ficheros .js aparte, que ya
  // se comprueban por su cuenta.
  const bloques = [...src.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  if (!bloques.length) { console.log(`${f}  ->  sin script propio`); continue; }

  const destino = path.join(tmp, path.basename(f) + '.js');
  fs.writeFileSync(destino, bloques.join('\n;\n'));
  try {
    execFileSync(process.execPath, ['--check', destino], { stdio: 'pipe' });
    console.log(`${f}  ->  ok`);
  } catch (e) {
    mal++;
    const salida = String(e.stderr || '').trim().split('\n');
    console.log(`${f}  ->  SINTAXIS: ${salida[salida.length - 1] || 'error'}`);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(mal ? 1 : 0);
