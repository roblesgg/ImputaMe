# Notas de tarea: sesión vs nota fija (memo)

ImputaMe tiene **dos modos de nota**, que no se mezclan:

## 1. Nota de sesión — `entry.note` (máx. 500)

- Vive en la **entrada/fichaje** concreto (el rato que estás imputando ahora).
- UI: `activeNoteInput` en el Panel, popup del calendario, reiniciar-con-nota.
- Sirve para “qué estoy haciendo en este rato”.
- No sustituye ni se rellena con el memo de la tarea.

## 2. Nota fija de la tarea — `task.memo` (máx. 200)

- Vive en la **tarea** y **sobrevive entre sesiones**.
- UI Panel: fila editable `#taskMemoRow` / `#taskMemoInput` (icono de marcador), encima de la nota de sesión.
- También editable en **Tareas** (popup de editar / al arrancar una guardada), y se muestra como pista de solo lectura en el popup del **Calendario** (`Nota fija: …`).
- Casos de uso: id de Dynamics/ERP, recordatorio fijo, código interno.

### Sync / Supabase (importante)

`task.memo` es **solo local**. `sync.js` **no** lo incluye en el upsert de `tareas` (sigue siendo `{ id, user_id, nombre, color }`) ni en el de fichajes.

- Al **crear** una tarea local desde un pull remoto → `memo: ''`.
- Al **fusionar** name/color desde remoto → **nunca** se borra ni sobrescribe `local.memo`.

IPC: `set-task-memo` → `setTaskMemo(taskId, memo)` (también acepta `memo` vía `update-task-meta`).


## 3. Tipo de tarea — `task.taskType` (`'ongoing' | 'oneShot'`)

- **Recurrente** (`ongoing`): tareas que se retoman días/semanas. Se llamaba "En curso", pero
  chocaba con "la tarea que está corriendo ahora": parecía que todas estuvieran en marcha.
- **Puntual** (`oneShot`): un shot concreto.
- Default al migrar: `ongoing`.
- UI: badges + filtros en Panel y Tareas; se elige al crear/editar.
- Local (como el memo): sync no lo sube; al pull de tarea nueva → `taskType: 'ongoing'`.
