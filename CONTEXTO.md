# imputa.me — Contexto del proyecto

## Qué es

App de escritorio para **registrar horas por tarea** y luego imputarlas. Corre en segundo plano con icono en la bandeja del sistema (tray).

---

## Cómo abrirla (modo desarrollo)

**Doble clic en:**
```
imputa.me\Iniciar imputa.me.vbs
```
> No abrir `electron.exe` directamente ni usar el terminal de Claude Code — hay un bug de entorno (`ELECTRON_RUN_AS_NODE=1`) que impide que arranque desde ese contexto (ver sección más abajo). El VBScript lo resuelve eliminando esa variable de verdad (`env.Remove`), no solo vaciándola.

Alternativa desde cmd normal (fuera de Claude Code):
```
imputa.me\start.bat
```
`start.bat` simplemente invoca al `.vbs` y se cierra a sí mismo (`exit`) para no dejar ninguna ventana de consola abierta.

---

## Cómo instalarla (build empaquetado)

Ver sección **"Empaquetado"** más abajo — `npm run dist` genera un instalador y una versión portable en `release/`.

---

## Stack técnico

- **Electron 31** (sin bundler, HTML/CSS/JS vanilla)
- **Node.js** integrado en Electron (`nodeIntegration:true`, `contextIsolation:false`) para IPC y fs directo desde el renderer
- **Sin framework UI** — CSS custom con variables + blur acrílico Windows 11

### Estructura de archivos

```
imputa.me/
├── main.js                     ← Proceso principal Electron (tray, ventanas, IPC, persistencia)
├── src/
│   ├── main.html                ← Panel principal
│   ├── widget.html              ← Widget recordatorio de esquina
│   ├── calendar.html            ← Calendario semanal estilo Teams/Outlook
│   ├── settings.html            ← Ajustes
│   ├── splash.html              ← Pantalla de arranque (logo animado)
│   └── shared.css               ← Estilos compartidos (blur, colores, botones, ventana)
├── assets/
│   ├── icon.png                 ← Icono de la app (fuente, 2000×2000), usado en tray/ventanas/splash
│   └── icon.ico                 ← Generado a partir del png (multi-resolución), para el .exe empaquetado
├── build-hooks/
│   └── afterPack.js             ← Hook de electron-builder: embebe icon.ico en el .exe tras empaquetar
├── Iniciar imputa.me.vbs       ← Lanzador silencioso (sin ventana negra), método recomendado
├── start.bat                    ← Alternativa vía cmd (delega en el .vbs)
├── package.json                 ← Scripts (`start`, `dist`) + config de electron-builder
└── release/                     ← Salida de `npm run dist` (instalador + portable); no versionar
```

> Nota: cada vez que se reconstruye el instalador, el `app.asar` dentro de `release/win-unpacked/` suele quedar bloqueado por el sistema (no se puede sobrescribir ni borrar en la misma sesión — causa desconocida, posible antivirus/indexador). El workaround usado ha sido construir a una carpeta temporal nueva cada vez (`release_tmp`, `release_new`, etc.) y copiar solo los `.exe` finales encima de `release/`. Pueden quedar carpetas `dist/`, `release_tmp/`, `release_new/`... sueltas con un `app.asar` bloqueado dentro — son basura inofensiva, se pueden borrar a mano cuando el bloqueo se libere (p. ej. tras reiniciar), o ignorarlas.

### Persistencia

- Tareas: `%APPDATA%\imputa-me\imputa-tasks.json` — `{ tasks: [{ id, name, color, entries: [{start, end}] }], activeTaskId }`
- Ajustes: `%APPDATA%\imputa-me\imputa-settings.json` — `{ reminderMinutes, widgetAutoHide, colorMode }`
- Ambos se leen con `try/catch` silencioso en `loadData()`; si no existen o están corruptos, se usan los valores por defecto.
- **Cada mutación de estado** (`startTask`, `pauseActive`, `createTask`, `deleteTask`, `editEntry`, `deleteEntry`, `addCalendarEntry`) llama a `saveData()` de forma **síncrona** (`fs.writeFileSync`) inmediatamente después de modificar `state`. No hay debounce ni batching: el archivo en disco siempre refleja el último cambio. Además el modelo de datos usa timestamps absolutos (`start`/`end` en ms), no contadores acumulados, así que una entrada "en curso" (`end:null`) sigue siendo válida y se calcula con `Date.now()` en cada lectura — un apagado brusco del PC como mucho deja la última tarea activa sin marcar su hora de fin exacta (se recalcula igualmente al reabrir), pero **no se pierde ningún dato**. Verificado: no hace falta ningún guardado periódico adicional.

---

## Funcionalidades implementadas

### Splash de arranque (`splash.html`)
- Al abrir la app se muestra primero: el logo (`assets/icon.png`) centrado en una ventana transparente 200×200, con animación de aparición (`pop`, .5s)
- Tras ~650ms se crea y centra la ventana principal (`center:true`); en cuanto se muestra, el splash recibe un mensaje IPC `leave`, hace un "grow" (escala ×2.6 + fade out, .32s) y se cierra ~340ms después — sensación de que el logo se transforma en el panel

### Panel principal (`main.html`)
- Lista de tareas con color personalizable (8 colores predefinidos)
- Botón **▶ SVG** para iniciar / **⏸ SVG** para pausar por tarea (cambia según estado activo)
- Contador de tiempo de hoy por tarea y total del día, actualizado cada segundo — muestra **segundos siempre** (`Xh MMm SSs`), incluso pasada 1 hora, para que se note que está corriendo
- Botones de ventana: **—** minimizar + **×** cerrar (SVG, esquina superior derecha, clase `.win-btn`)
- Campo **"Al iniciar, llevo: X min" / "o desde: HH:MM"** (encima de la lista) — al pulsar ▶ en una tarea existente, resta esos minutos (o calcula los minutos desde la hora indicada) para no perder tiempo ya trabajado
- Sección **Nueva tarea**: nombre + color + **"Empezó hace: X min" / "o desde: HH:MM"** (mismo mecanismo, para tareas que se empiezan a registrar tarde)
- Botón de ajustes con icono de engranaje real (antes era un círculo con rayos que parecía un sol)
- Acceso rápido a **Calendario** (antes "Historial") y Ajustes
- Insignia verde de tarea activa (esquina superior derecha) con `margin-top` para no solaparse con los botones de minimizar/cerrar
- El selector de color de "Nueva tarea" solo se muestra si `settings.colorMode === 'manual'` (ver Ajustes)

### Widget de esquina (`widget.html`)
- Aparece automáticamente cada N minutos mientras hay tarea activa (según ajuste `reminderMinutes`)
- Posición: esquina inferior derecha de la pantalla principal
- Muestra: nombre de tarea + tiempo de hoy (con segundos) + total del día
- Botones SVG: **⏸ Pausar** y **↔ Cambiar** tarea (abre el panel)
- Blur/acrílico Windows 11, esquinas redondeadas, siempre encima (`alwaysOnTop`), sin icono en la barra de tareas

### Calendario (`calendar.html`, antes "Historial")
Vista semanal estilo Teams/Outlook (ventana 960×760):
- **Sidebar**: mini-calendario mensual (resalta la semana visible y el día seleccionado, con navegación por mes y un punto bajo los días con actividad registrada), botón **Hoy**, leyenda de tareas por color (clic para ocultar/mostrar sus bloques en la rejilla) y botón **Exportar CSV**
- **Rejilla principal**: columnas por día (semana actual, navegable con ‹ ›), filas por hora (0–24h, 48px/hora, con scroll vertical). Línea roja con punto indicando la hora actual en la columna de hoy
- **Arrastrar para crear**: clic y arrastre vertical sobre una columna de día (con snap a 15 min) abre un popup para registrar una entrada nueva en ese rango horario — eligiendo una tarea existente o creando una nueva (nombre + color, solo si `colorMode==='manual'`) sobre la marcha
  - Mientras arrastras, una etiqueta flotante (`.drag-time-label`) muestra en vivo el rango `HH:MM – HH:MM` que estás seleccionando, siguiendo al ghost block
  - **Bug corregido**: `renderWeek()` reconstruía toda la rejilla (incluida la columna sobre la que se arrastraba) en cada actualización de estado — que llega cada segundo mientras hay una tarea activa — rompiendo el arrastre si duraba más de ~1s. Ahora `renderWeek()` tiene un guard (`if (dragState) return;`) que omite el redibujado mientras `dragState` esté activo; el siguiente estado (tras soltar) ya redibuja con normalidad. Verificado con arrastres de 3s+ simulados vía Chrome DevTools Protocol.
- **Clic en un bloque existente** → popup para editar la hora de inicio/fin (dejar fin vacío = "en curso") o eliminar la entrada (botón Eliminar)
- Exportar CSV al Escritorio (`imputa-horas.csv`) con fecha, tarea, segundos y horas decimales, agregado por día

### Ajustes (`settings.html`)
- **Frecuencia del aviso**: cada cuántos minutos sale el widget recordatorio (1–120 min, **por defecto 10**)
- **Ocultar el aviso automáticamente a los 10s** (`widgetAutoHide`, **activado por defecto**): el widget de recordatorio se cierra solo a los 10s de aparecer (temporizador en `main.js`, se reinicia en cada aparición, se cancela si se cierra manualmente antes)
- **Elegir colores de las tareas manualmente** (`colorMode: 'manual'|'auto'`, **`auto` por defecto**): con `auto`, cada tarea nueva recibe automáticamente el siguiente color de la paleta de 8 colores (ciclando por `state.tasks.length % 8`, decidido en `main.js` para `createTask` y `addCalendarEntry`) y el selector de color se oculta tanto en el panel principal como en el popup de nueva entrada del calendario

### Tray
- Icono siempre en la bandeja (generado desde `assets/icon.png`, redimensionado a 32×32)
- Tooltip con el total de hoy y la tarea activa
- Menú contextual con lista de tareas (con tiempos, clic para iniciar/pausar), acceso a Panel/Calendario/Ajustes, Pausar y Salir

---

## Diseño visual

- **Fondo**: blur acrílico Windows 11 (`win.setBackgroundMaterial('acrylic')`) + `transparent:true` + `hasShadow:false` en todas las ventanas (`makeWindow()` en main.js)
  - `hasShadow:false` es importante: con `hasShadow:true` la sombra nativa de Windows dibuja un rectángulo cuadrado detrás de la ventana transparente que tapaba el redondeo de esquinas
- **Esquinas**: `roundedCorners:true` (Electron/DWM) + `border-radius: var(--radius)` (16px) en el `body` de cada ventana
- **Translucidez**: `--bg: rgba(18,18,28,0.52)` en `shared.css` (antes 0.72 — se bajó para que se vea más el blur de fondo)
- **Sin borde de sistema**: `frame:false`
- **Paleta**: fondo oscuro translúcido, acento índigo `#6366f1`/`#818cf8`, texto blanco tenue, colores de tarea configurables
- **Botones de ventana** (`.win-btn`, clase compartida): círculo 28px con SVG de icono centrado; el SVG tiene `pointer-events:none` para que todo el círculo sea clicable de forma uniforme (antes solo funcionaba si se clicaba justo encima del trazo del icono, ej. la X de cerrar)
- **Icono de la app**: `assets/icon.png` (logo de cronómetro + calendario), usado como icono de ventana (`icon:` en cada `BrowserWindow`), icono de tray y protagonista del splash de arranque
- **Sin ventana negra**: el `.vbs` lanza con `WindowStyle=0` (oculto) y limpia `ELECTRON_RUN_AS_NODE` de verdad

---

## Bug conocido — ELECTRON_RUN_AS_NODE

Claude Code (y VS Code) ponen `ELECTRON_RUN_AS_NODE=1` en el entorno. Cuando Electron hereda esa variable, se comporta como Node.js puro: sin APIs de ventana, sin `ipcMain`, sin `process.type` → la app crashea con `TypeError: Cannot read properties of undefined (reading 'on')` al intentar usar `ipcMain`.

**Detalle importante**: no basta con poner la variable a cadena vacía (`env("VAR") = ""`) — Electron a veces solo comprueba si la variable *existe* en el entorno, no su valor, así que sigue arrancando en modo Node. El `.vbs` usa `env.Remove("ELECTRON_RUN_AS_NODE")` para eliminarla de verdad del entorno del proceso antes de lanzar `electron.exe`. `start.bat` usa el equivalente en cmd (`set VAR=` sin valor, que sí desasigna de verdad en ese contexto).

**Consecuencia**: no se puede probar la app lanzándola directamente desde el terminal de Claude Code sin este workaround. Para pruebas dentro de ese terminal, limpiar la variable explícitamente antes de lanzar (p. ej. `env -u ELECTRON_RUN_AS_NODE electron.exe .` en bash, o quitarla del `ProcessStartInfo.EnvironmentVariables` en PowerShell).

---

## Empaquetado (`electron-builder`)

`npm run dist` (= `electron-builder --win`) genera en `release/`:
- **`imputa.me Setup 1.0.0.exe`** — instalador NSIS asistido (`oneClick:false`), con checkbox de **crear icono en el escritorio** y de acceso directo en el menú Inicio (`createDesktopShortcut`/`createStartMenuShortcut`), permite elegir carpeta de instalación
- **`imputa.me-portable.exe`** — versión portable, se ejecuta sin instalar y sin tocar el registro

Config completa en `package.json` → campo `"build"`.

**Nota sobre el icono del .exe**: `win.signAndEditExecutable` está en `false` porque electron-builder intenta descargar `winCodeSign` (herramientas de firma de macOS) incluso para builds solo-Windows sin firmar, y esa descarga falla en este equipo porque crear symlinks requiere el "Modo de desarrollador" de Windows (desactivado aquí, es un ajuste a nivel de sistema). Para no perder el icono del `.exe` empaquetado (`release/win-unpacked/imputa.me.exe`), `build-hooks/afterPack.js` lo embebe manualmente después de empaquetar, usando el paquete `rcedit` (independiente, sin la dependencia de `winCodeSign`). El instalador NSIS y el portable sí llevan el icono correcto sin este workaround, porque NSIS compila el icono directamente (usa `win.icon` → `assets/icon.ico`), sin pasar por `rcedit`/`winCodeSign`.

Si en algún momento se activa el Modo de desarrollador de Windows en la máquina de build, se puede quitar `signAndEditExecutable:false` y el hook `afterPack` sin problema (electron-builder lo haría todo automáticamente).

**Limitación observada**: en este equipo (gestionado, AzureAD-joined), el antivirus/protección corporativa mató el proceso del instalador a los pocos segundos de lanzarlo por ser un `.exe` sin firmar — comportamiento normal de un entorno gestionado, no un fallo del build en sí. Se recomienda probar el instalador en una máquina sin esas restricciones, o firmarlo con un certificado si se va a distribuir más ampliamente.

---

## Cosas pendientes / posibles mejoras

### Funcionalidad
- Notificación nativa de Windows al aparecer el widget
- Filtros en el calendario (por tarea, por semana) — la leyenda ya permite ocultar/mostrar tareas por color, pero no persiste esa preferencia entre sesiones (`hiddenTaskIds` es solo en memoria del renderer)
- Modo exportación para imputar (agrupar por proyecto/código)
- El toggle "manual/auto" de colores no permite reordenar ni personalizar la paleta de 8 colores en sí, solo activar/desactivar la selección manual

### Empaquetado / build
- Firmar el `.exe`/instalador con un certificado de código (evitaría el aviso de SmartScreen y el bloqueo visto en este equipo corporativo, donde el antivirus mató el instalador sin firmar a los pocos segundos de lanzarlo)
- Limpiar las carpetas de build obsoletas que van quedando sueltas (`dist/`, `release_tmp/`, `release_v2/`, etc., cada una con un `app.asar` bloqueado) cuando el bloqueo se libere (p. ej. tras reiniciar el equipo)
- Investigar qué proceso bloquea `app.asar` en `release/win-unpacked/` después de cada build (para dejar de necesitar el workaround de construir a una carpeta temporal nueva y copiar solo los `.exe` finales)
- Si se activa el Modo de desarrollador de Windows en la máquina de build, se puede quitar `win.signAndEditExecutable:false` y el hook `build-hooks/afterPack.js` (dejar que electron-builder embeba el icono de forma nativa vía `winCodeSign`/`rcedit`)

### Estado en el momento de escribir esto
No hay ningún bug conocido pendiente de arreglar. Los dos últimos encontrados en esta sesión (esquinas/blur de ventana, y la rejilla del calendario rompiéndose al arrastrar más de ~1s por culpa de los redibujados periódicos) están corregidos y verificados. El instalador y el portable en `release/` están al día con todos los cambios descritos en este documento.
