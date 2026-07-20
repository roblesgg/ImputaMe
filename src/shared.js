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
