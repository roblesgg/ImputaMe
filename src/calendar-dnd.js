/**
 * DnD del calendario: resize con Pointer Events, mover (mismo día / entre días)
 * y portapapeles interno (Ctrl+C / Ctrl+V).
 *
 * Se carga como script clásico antes del bloque principal de calendar.html y
 * se inicializa con createCalendarDnD(api).
 */
(function (global) {
  'use strict';

  const MOVE_THRESHOLD_PX = 5;
  const MIN_DUR_MS = 5 * 60000;

  function createCalendarDnD(api) {
    const {
      getRowH,
      snapHour,
      clamp,
      startOfDay,
      sameDay,
      hourToHHMM,
      timeRangeLabel,
      formatDur,
      neighbourLimits,
      findEntryIndex,
      ipcRenderer,
      getCurrentState,
      getHiddenTaskIds,
      openEditPopup,
      isPopupOpen,
      onInteractionEnd,
      setBusyFlag,
      getDayCols,
    } = api;

    let resizeState = null;
    let moveState = null;
    let entryClipboard = null;
    let selectedKey = null; // `${taskId}|${startMs}`
    let lastPointer = { x: 0, y: 0, dayCol: null, hour: 12 };
    let suppressClickUntil = 0;

    function rowH() { return getRowH(); }

    function isBusy() {
      return !!(resizeState || moveState);
    }

    function setAppDndClass(on) {
      const app = document.querySelector('.cal-app');
      if (app) app.classList.toggle('is-dnd', !!on);
    }

    function notifyBusy() {
      setBusyFlag(isBusy());
      setAppDndClass(isBusy());
    }

    function entryKey(taskId, startMs) {
      return `${taskId}|${startMs}`;
    }

    function markSelected(block, taskId, startMs) {
      document.querySelectorAll('.task-block.selected').forEach((el) => el.classList.remove('selected'));
      selectedKey = entryKey(taskId, startMs);
      if (block) {
        block.classList.add('selected');
        block.tabIndex = 0;
        try { block.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      }
    }

    function clearSelected() {
      selectedKey = null;
      document.querySelectorAll('.task-block.selected').forEach((el) => el.classList.remove('selected'));
    }

    function applySelectedClass(block, taskId, startMs) {
      if (selectedKey && selectedKey === entryKey(taskId, startMs)) {
        block.classList.add('selected');
        block.tabIndex = 0;
      }
    }

    function resolveIndex(taskId, origStartMs, fallbackIdx) {
      const state = getCurrentState();
      const task = state && state.tasks.find((t) => t.id === taskId);
      if (!task) return { task: null, idx: -1 };
      const idx = findEntryIndex(task, origStartMs, fallbackIdx);
      return { task, idx };
    }

    function hourFromClientY(col, clientY) {
      const rect = col.getBoundingClientRect();
      return snapHour(clamp((clientY - rect.top) / rowH(), 0, 24));
    }

    function dayColFromPoint(clientX, clientY) {
      const els = document.elementsFromPoint(clientX, clientY);
      for (let i = 0; i < els.length; i++) {
        const col = els[i].closest && els[i].closest('.day-col');
        if (col && col._date) return col;
      }
      // Fallback: columnas visibles
      const cols = getDayCols ? getDayCols() : document.querySelectorAll('.day-col');
      for (let i = 0; i < cols.length; i++) {
        const r = cols[i].getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return cols[i];
        }
      }
      return null;
    }

    function trackPointer(ev) {
      lastPointer.x = ev.clientX;
      lastPointer.y = ev.clientY;
      const col = dayColFromPoint(ev.clientX, ev.clientY);
      if (col) {
        lastPointer.dayCol = col;
        lastPointer.hour = hourFromClientY(col, ev.clientY);
      }
    }

    // ── Resize ──────────────────────────────────────────────────────────────
    function attachResizeHandle(handleEl, edge, task, idx, entry, block, col) {
      handleEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();

        const origStart = entry.start;
        const dayStart = startOfDay(col._date).getTime();
        const wasOngoing = entry.end == null;
        let newStart = entry.start;
        let newEnd = wasOngoing ? Date.now() : entry.end;
        const limits = neighbourLimits(task, idx, entry, dayStart);

        handleEl.classList.add('resizing');
        try { handleEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }

        resizeState = {
          edge,
          pointerId: e.pointerId,
          taskId: task.id,
          origStart,
          fallbackIdx: idx,
        };
        notifyBusy();

        function applyVisual() {
          const startH = (Math.max(newStart, dayStart) - dayStart) / 3600000;
          const endH = (Math.min(newEnd, dayStart + 86400000) - dayStart) / 3600000;
          block.style.top = (startH * rowH()) + 'px';
          block.style.height = Math.max(6, (endH - startH) * rowH() - 2) + 'px';
          const rangeEl = block.querySelector('.tb-time-range');
          const durEl = block.querySelector('.tb-time-dur');
          const liveEndForLabel = wasOngoing && edge === 'start' ? null : newEnd;
          if (rangeEl) rangeEl.textContent = timeRangeLabel(newStart, liveEndForLabel);
          if (durEl) durEl.textContent = formatDur((liveEndForLabel || Date.now()) - newStart);
        }

        function onMove(ev) {
          if (!resizeState) return;
          if (ev.buttons === 0) { finish(false); return; }
          const hour = hourFromClientY(col, ev.clientY);
          const ms = dayStart + hour * 3600000;
          if (edge === 'start') newStart = Math.max(limits.lower, Math.min(ms, newEnd - MIN_DUR_MS));
          else newEnd = Math.min(limits.upper, Math.max(ms, newStart + MIN_DUR_MS));
          applyVisual();
        }

        function cleanupListeners() {
          handleEl.removeEventListener('pointermove', onMove);
          handleEl.removeEventListener('pointerup', onUp);
          handleEl.removeEventListener('pointercancel', onCancel);
          handleEl.removeEventListener('lostpointercapture', onLost);
          window.removeEventListener('blur', onBlur);
        }

        function finish(commit) {
          if (!resizeState) return;
          const pid = resizeState.pointerId;
          cleanupListeners();
          handleEl.classList.remove('resizing');
          try { if (pid != null) handleEl.releasePointerCapture(pid); } catch (_) { /* ignore */ }

          const snap = resizeState;
          resizeState = null;
          notifyBusy();
          onInteractionEnd && onInteractionEnd('resize');

          if (!commit) return;

          const resolved = resolveIndex(snap.taskId, snap.origStart, snap.fallbackIdx);
          if (!resolved.task || resolved.idx < 0) return;

          const payload = { taskId: snap.taskId, entryIndex: resolved.idx };
          if (edge === 'start') payload.startMs = newStart;
          else payload.endMs = newEnd;
          ipcRenderer.send('action', { type: 'edit-entry', payload });
        }

        function onUp(ev) {
          if (resizeState && ev.pointerId !== resizeState.pointerId) return;
          finish(true);
        }
        function onCancel(ev) {
          if (resizeState && ev.pointerId !== resizeState.pointerId) return;
          finish(false);
        }
        function onLost() { finish(false); }
        function onBlur() { finish(false); }

        handleEl.addEventListener('pointermove', onMove);
        handleEl.addEventListener('pointerup', onUp);
        handleEl.addEventListener('pointercancel', onCancel);
        handleEl.addEventListener('lostpointercapture', onLost);
        window.addEventListener('blur', onBlur);
      });
    }

    // ── Move (mismo día / entre días) ───────────────────────────────────────
    function attachMoveHandlers(block, task, idx, entry, col) {
      block.style.cursor = 'grab';
      block.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.tb-handle')) return;
        if (isPopupOpen && isPopupOpen()) return;

        trackPointer(e);
        markSelected(block, task.id, entry.start);

        const origStart = entry.start;
        const wasOngoing = entry.end == null;
        const origEnd = wasOngoing ? null : entry.end;
        const durationMs = (origEnd || Date.now()) - origStart;
        const pointerId = e.pointerId;
        const startX = e.clientX;
        const startY = e.clientY;
        let armed = false;
        let ghost = null;
        let label = null;
        let targetCol = col;
        let previewStart = origStart;
        let previewEnd = origEnd || (origStart + durationMs);

        function removeGhost() {
          if (ghost && ghost.parentNode) ghost.remove();
          if (label && label.parentNode) label.remove();
          ghost = null;
          label = null;
        }

        function placePreview(tCol, startMs, endMs) {
          targetCol = tCol;
          previewStart = startMs;
          previewEnd = endMs;
          const dayStart = startOfDay(tCol._date).getTime();
          const startH = (Math.max(startMs, dayStart) - dayStart) / 3600000;
          const endH = (Math.min(endMs, dayStart + 86400000) - dayStart) / 3600000;
          if (!ghost) {
            ghost = document.createElement('div');
            ghost.className = 'task-block move-ghost';
            ghost.style.background = task.color;
            ghost.style.color = block.style.color;
            ghost.innerHTML = block.querySelector('.tb-name')
              ? `<div class="tb-name">${block.querySelector('.tb-name').textContent}</div>`
              : '';
            label = document.createElement('div');
            label.className = 'drag-time-label';
          }
          if (ghost.parentNode !== tCol) tCol.appendChild(ghost);
          if (label.parentNode !== tCol) tCol.appendChild(label);
          ghost.style.top = (startH * rowH()) + 'px';
          ghost.style.height = Math.max(6, (endH - startH) * rowH() - 2) + 'px';
          label.style.top = (startH * rowH() - 26) + 'px';
          label.textContent = `${hourToHHMM(startH)} – ${hourToHHMM(endH)}`;
        }

        function computePreview(ev) {
          const tCol = dayColFromPoint(ev.clientX, ev.clientY) || targetCol || col;
          if (!tCol || !tCol._date) return;
          const dayStart = startOfDay(tCol._date).getTime();
          let startH = hourFromClientY(tCol, ev.clientY);
          // Anclar al offset dentro del bloque en el momento de armar el move
          if (moveState && moveState.grabOffsetH != null) {
            startH = snapHour(clamp(startH - moveState.grabOffsetH, 0, 24));
          }
          let startMs = dayStart + startH * 3600000;
          let endMs = startMs + durationMs;
          // Mantener duración; si se sale del día, desplazar hacia atrás
          const dayEnd = dayStart + 86400000;
          if (endMs > dayEnd) {
            endMs = dayEnd;
            startMs = Math.max(dayStart, endMs - durationMs);
          }
          if (startMs < dayStart) {
            startMs = dayStart;
            endMs = Math.min(dayEnd, startMs + durationMs);
          }
          // Vecinos en el día destino (excluyendo la propia entrada)
          const fakeEntry = { start: startMs, end: wasOngoing ? null : endMs };
          // neighbourLimits usa entry.start/end actuales para clasificar vecinos;
          // pasamos la entrada ORIGINAL para excluirla por índice, y luego ajustamos.
          const limits = neighbourLimits(task, idx, entry, dayStart);
          // Si el destino es otro día, los límites lower/upper se basan en myStart/myEnd
          // de la entrada original (otro día) → pueden quedar dayStart/dayEnd. Recalcular
          // con la posición propuesta:
          const limitsAt = neighbourLimitsForMove(task, origStart, startMs, endMs, dayStart);
          if (startMs < limitsAt.lower) {
            startMs = limitsAt.lower;
            endMs = startMs + durationMs;
          }
          if (endMs > limitsAt.upper) {
            endMs = limitsAt.upper;
            startMs = endMs - durationMs;
          }
          if (endMs - startMs < MIN_DUR_MS) {
            // No cabe: pegar al hueco más cercano válido
            if (limitsAt.upper - limitsAt.lower >= MIN_DUR_MS) {
              startMs = limitsAt.lower;
              endMs = startMs + Math.min(durationMs, limitsAt.upper - limitsAt.lower);
            }
          }
          placePreview(tCol, startMs, wasOngoing ? startMs + durationMs : endMs);
          void fakeEntry;
          void limits;
        }

        function neighbourLimitsForMove(taskRef, excludeStartMs, myStart, myEnd, dayStart) {
          const dayEnd = dayStart + 86400000;
          const hidden = getHiddenTaskIds ? getHiddenTaskIds() : new Set();
          const state = getCurrentState();
          let lower = dayStart;
          let upper = dayEnd;
          (state && state.tasks || []).forEach((t) => {
            if (hidden.has(t.id)) return;
            t.entries.forEach((en) => {
              if (t.id === taskRef.id && en.start === excludeStartMs) return;
              const s = en.start;
              const e = en.end || Date.now();
              if (e <= dayStart || s >= dayEnd) return;
              if (e <= myStart) lower = Math.max(lower, e);
              if (s >= myEnd) upper = Math.min(upper, s);
              // Solapes parciales: empujar fuera del intervalo ocupado
              if (s < myEnd && e > myStart) {
                // Vecino solapado: acotar al lado más cercano
                const mid = (myStart + myEnd) / 2;
                if (mid < (s + e) / 2) upper = Math.min(upper, s);
                else lower = Math.max(lower, e);
              }
            });
          });
          return { lower, upper };
        }

        function arm(ev) {
          if (armed) return;
          armed = true;
          const dayStart0 = startOfDay(col._date).getTime();
          const grabHour = hourFromClientY(col, startY);
          const blockStartH = (Math.max(origStart, dayStart0) - dayStart0) / 3600000;
          moveState = {
            pointerId,
            taskId: task.id,
            origStart,
            fallbackIdx: idx,
            wasOngoing,
            durationMs,
            grabOffsetH: grabHour - blockStartH,
          };
          notifyBusy();
          block.classList.add('moving');
          try { block.setPointerCapture(pointerId); } catch (_) { /* ignore */ }
          computePreview(ev);
        }

        function onMove(ev) {
          trackPointer(ev);
          if (!armed) {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (dx * dx + dy * dy >= MOVE_THRESHOLD_PX * MOVE_THRESHOLD_PX) arm(ev);
            else return;
          }
          if (ev.buttons === 0) { finish(false); return; }
          computePreview(ev);
        }

        function cleanup() {
          block.removeEventListener('pointermove', onMove);
          block.removeEventListener('pointerup', onUp);
          block.removeEventListener('pointercancel', onCancel);
          block.removeEventListener('lostpointercapture', onLost);
          window.removeEventListener('blur', onBlur);
        }

        function finish(commit) {
          cleanup();
          try { block.releasePointerCapture(pointerId); } catch (_) { /* ignore */ }
          block.classList.remove('moving');
          removeGhost();

          const wasArmed = armed;
          moveState = null;
          notifyBusy();

          if (!wasArmed) {
            // Clic simple → popup (si no venimos de un resize reciente)
            if (Date.now() < suppressClickUntil) return;
            openEditPopup(task, idx, entry);
            return;
          }

          onInteractionEnd && onInteractionEnd('move');
          suppressClickUntil = Date.now() + 300;

          if (!commit || !targetCol) return;

          let finalStart = previewStart;
          let finalEnd = wasOngoing ? null : previewEnd;

          // Revalidar vecinos en commit
          const dayStart = startOfDay(targetCol._date).getTime();
          const endForLimits = finalEnd || (finalStart + durationMs);
          const limitsAt = neighbourLimitsForMove(task, origStart, finalStart, endForLimits, dayStart);
          if (finalStart < limitsAt.lower) {
            finalStart = limitsAt.lower;
            if (!wasOngoing) finalEnd = finalStart + durationMs;
          }
          if ((finalEnd || finalStart + durationMs) > limitsAt.upper) {
            if (!wasOngoing) {
              finalEnd = limitsAt.upper;
              finalStart = finalEnd - durationMs;
            } else {
              finalStart = Math.min(finalStart, limitsAt.upper - MIN_DUR_MS);
            }
          }
          if (finalStart < dayStart) finalStart = dayStart;
          if (!wasOngoing && finalEnd > dayStart + 86400000) finalEnd = dayStart + 86400000;
          if (!wasOngoing && finalEnd - finalStart < MIN_DUR_MS) return;

          // Sin cambios relevantes
          if (finalStart === origStart && (wasOngoing || finalEnd === origEnd)) return;

          const resolved = resolveIndex(task.id, origStart, idx);
          if (!resolved.task || resolved.idx < 0) return;

          const payload = {
            taskId: task.id,
            entryIndex: resolved.idx,
            startMs: finalStart,
          };
          if (!wasOngoing) payload.endMs = finalEnd;
          else payload.endMs = null;
          ipcRenderer.send('action', { type: 'edit-entry', payload });
        }

        function onUp(ev) {
          if (ev.pointerId !== pointerId) return;
          finish(true);
        }
        function onCancel(ev) {
          if (ev.pointerId !== pointerId) return;
          finish(false);
        }
        function onLost() {
          if (moveState) finish(false);
          else cleanup();
        }
        function onBlur() { finish(false); }

        block.addEventListener('pointermove', onMove);
        block.addEventListener('pointerup', onUp);
        block.addEventListener('pointercancel', onCancel);
        block.addEventListener('lostpointercapture', onLost);
        window.addEventListener('blur', onBlur);
      });
    }

    // ── Clipboard ───────────────────────────────────────────────────────────
    function stashFromBlock(task, entry) {
      if (!entry || entry.end == null && false) { /* permitir copiar en curso */ }
      const dur = (entry.end || Date.now()) - entry.start;
      entryClipboard = {
        taskId: task.id,
        durationMs: Math.max(MIN_DUR_MS, dur),
        note: entry.note || '',
        subId: entry.subId || null,
        nameAtTime: entry.nameAtTime || task.name,
        subNameAtTime: entry.subNameAtTime || null,
        color: task.color,
      };
      try {
        const summary = `imputa.me: ${entryClipboard.nameAtTime}` +
          (entryClipboard.subNameAtTime ? ` · ${entryClipboard.subNameAtTime}` : '') +
          ` (${Math.round(entryClipboard.durationMs / 60000)} min)`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(summary).catch(() => {});
        }
      } catch (_) { /* ignore */ }
      return entryClipboard;
    }

    function pasteAt(dayCol, hour) {
      if (!entryClipboard || !dayCol || !dayCol._date) return false;
      const dayStart = startOfDay(dayCol._date).getTime();
      let startH = snapHour(clamp(hour, 0, 24));
      let startMs = dayStart + startH * 3600000;
      let endMs = startMs + entryClipboard.durationMs;
      const dayEnd = dayStart + 86400000;
      if (endMs > dayEnd) {
        endMs = dayEnd;
        startMs = Math.max(dayStart, endMs - entryClipboard.durationMs);
      }
      ipcRenderer.send('action', {
        type: 'add-calendar-entry',
        payload: {
          taskId: entryClipboard.taskId,
          startMs,
          endMs,
          note: entryClipboard.note || undefined,
          subId: entryClipboard.subId || undefined,
        },
      });
      return true;
    }

    function installClipboard() {
      document.addEventListener('pointermove', trackPointer, { passive: true });

      document.addEventListener('keydown', (e) => {
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) {
          return;
        }
        if (isPopupOpen && isPopupOpen()) return;

        const mod = e.ctrlKey || e.metaKey;
        if (!mod) return;

        const key = (e.key || '').toLowerCase();
        if (key === 'c') {
          const sel = document.querySelector('.task-block.selected');
          if (!sel) return;
          const taskId = sel.dataset.taskId;
          const startMs = Number(sel.dataset.startMs);
          const state = getCurrentState();
          const task = state && state.tasks.find((t) => t.id === taskId);
          if (!task) return;
          const entry = task.entries.find((en) => en.start === startMs);
          if (!entry) return;
          stashFromBlock(task, entry);
          e.preventDefault();
        } else if (key === 'v') {
          if (!entryClipboard) return;
          const col = lastPointer.dayCol || dayColFromPoint(lastPointer.x, lastPointer.y);
          if (!col) return;
          pasteAt(col, lastPointer.hour);
          e.preventDefault();
        }
      });
    }

    function duplicateSelected() {
      const sel = document.querySelector('.task-block.selected');
      if (!sel) return false;
      const taskId = sel.dataset.taskId;
      const startMs = Number(sel.dataset.startMs);
      const state = getCurrentState();
      const task = state && state.tasks.find((t) => t.id === taskId);
      if (!task) return false;
      const entry = task.entries.find((en) => en.start === startMs);
      if (!entry) return false;
      stashFromBlock(task, entry);
      const col = sel.closest('.day-col');
      if (!col) return false;
      // Pegar 15 min más abajo si cabe
      const dayStart = startOfDay(col._date).getTime();
      const hour = ((entry.end || (entry.start + entryClipboard.durationMs)) - dayStart) / 3600000;
      return pasteAt(col, snapHour(clamp(hour, 0, 23.75)));
    }

    return {
      isBusy,
      getResizeState: () => resizeState,
      getMoveState: () => moveState,
      attachResizeHandle,
      attachMoveHandlers,
      installClipboard,
      markSelected,
      clearSelected,
      applySelectedClass,
      stashFromBlock,
      duplicateSelected,
      getClipboard: () => entryClipboard,
      forceClearBusy() {
        resizeState = null;
        moveState = null;
        notifyBusy();
      },
    };
  }

  global.createCalendarDnD = createCalendarDnD;
})(typeof window !== 'undefined' ? window : globalThis);
