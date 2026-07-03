// Utilidades compartidas por las distintas ventanas (cargar antes que el script propio de cada .html)
const COLORS = ['#6366f1','#f472b6','#34d399','#fbbf24','#60a5fa','#f87171','#a78bfa','#2dd4bf'];

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
