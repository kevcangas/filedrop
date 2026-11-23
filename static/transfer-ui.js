/**
 * FileDrop - Unified Transfer Progress Manager & In-App Dialogs (static/transfer-ui.js)
 * Tracks all uploads and downloads (P2P, S3, Buzón) in a single state store,
 * rendering synchronized progress bars inside both the Transferir tab and the
 * global floating Transfer Dock visible across every tab.
 */

(function () {
  "use strict";

  function escapeHtml(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = String(s);
    return div.innerHTML;
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatSpeed(bps) {
    if (!bps || !isFinite(bps) || bps <= 0) return "";
    return `${formatBytes(bps)}/s`;
  }

  function formatEta(sec) {
    if (sec == null || !isFinite(sec) || sec <= 0) return "";
    if (sec < 60) return `~${Math.max(1, Math.ceil(sec))}s`;
    const m = Math.floor(sec / 60);
    const s = Math.ceil(sec % 60);
    if (m < 60) return `~${m}m ${s}s`;
    const h = Math.floor(m / 60);
    return `~${h}h ${m % 60}m`;
  }

  const ACTIVE_PHASES = new Set(["zipping", "transferring", "processing"]);
  const TERMINAL_PHASES = new Set(["done", "error", "cancelled"]);

  let seq = 0;
  const transfers = [];
  const byId = new Map();
  let dockMinimized = false;
  let dockDismissed = false;
  let rafScheduled = false;
  let listenersBound = false;

  function isActive(tx) {
    return ACTIVE_PHASES.has(tx.phase);
  }

  function isTerminal(tx) {
    return TERMINAL_PHASES.has(tx.phase);
  }

  function channelBadgeClass(channel) {
    const c = (channel || "P2P").toLowerCase();
    if (c === "s3") return "s3";
    if (c === "buzón" || c === "buzon") return "buzon";
    return "p2p";
  }

  function emitTransferEvent(tx) {
    try {
      window.dispatchEvent(
        new CustomEvent("filedrop:transfer", {
          detail: {
            id: tx.id,
            filename: tx.filename,
            totalBytes: tx.totalBytes,
            direction: tx.direction,
            channel: tx.channel,
            phase: tx.phase,
            message: tx.statusText,
          },
        })
      );
    } catch {
      // Ignore if CustomEvent fails in restricted contexts
    }
  }

  function buildRowHtml(tx) {
    const dirIcon = tx.direction === "down" ? "⬇️" : "⬆️";
    const chClass = channelBadgeClass(tx.channel);
    const pctText = computeMainStatusText(tx);
    const subText = computeSubMetaText(tx);
    const fillClasses = computeFillClasses(tx);
    const fillWidth = tx.phase === "processing" && tx.pct === 0 ? 100 : tx.pct;

    return `
      <div class="transfer-row" data-tx-id="${escapeHtml(tx.id)}">
        <div class="spread tx-header-line">
          <div class="row tx-title-group" style="gap:6px; min-width:0; flex:1; flex-wrap:nowrap;">
            <span class="tx-dir-icon">${dirIcon}</span>
            <span class="tx-name" title="${escapeHtml(tx.filename)}">${escapeHtml(tx.filename)}</span>
            <span class="tx-channel-badge ${chClass}">${escapeHtml(tx.channel)}</span>
          </div>
          <div class="row tx-controls-group" style="gap:6px; flex-shrink:0; flex-wrap:nowrap;">
            <span class="tx-meta">${escapeHtml(pctText)}</span>
            ${
              tx.onCancel && isActive(tx)
                ? `<button type="button" class="tx-cancel-btn" data-cancel-id="${escapeHtml(tx.id)}" title="Cancelar transferencia">✕</button>`
                : ""
            }
          </div>
        </div>
        <div class="progress-bar-bg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${tx.pct}">
          <div class="progress-bar-fill ${fillClasses}" style="width: ${fillWidth}%;"></div>
        </div>
        <div class="spread tx-footer-line">
          <span class="tx-submeta">${escapeHtml(subText)}</span>
          ${
            tx.actionLabel && tx.onAction && tx.phase === "done"
              ? `<button type="button" class="tx-action-btn" data-action-id="${escapeHtml(tx.id)}">${escapeHtml(tx.actionLabel)}</button>`
              : ""
          }
        </div>
      </div>
    `;
  }

  function computeMainStatusText(tx) {
    if (tx.phase === "done") return "✓ Completado";
    if (tx.phase === "error") return "✗ Error";
    if (tx.phase === "cancelled") return "Cancelado";
    if (tx.phase === "zipping") return `${tx.pct}%`;
    if (tx.phase === "processing") return tx.statusText ? "Procesando…" : `${tx.pct}%`;
    return `${tx.pct}%`;
  }

  function computeSubMetaText(tx) {
    if (tx.phase === "done") {
      return tx.totalBytes > 0 ? `${formatBytes(tx.totalBytes)}${tx.statusText && tx.statusText !== "Completado" ? " · " + tx.statusText : ""}` : (tx.statusText || "Completado");
    }
    if (tx.phase === "error" || tx.phase === "cancelled") {
      return tx.statusText || (tx.phase === "error" ? "Transferencia fallida" : "Cancelada por el usuario");
    }
    if (tx.phase === "zipping") {
      return tx.statusText || "Empaquetando archivos…";
    }
    if (tx.phase === "processing") {
      return tx.statusText || "Guardando en el destino…";
    }

    const parts = [];
    if (tx.totalBytes > 0) {
      parts.push(`${formatBytes(tx.loadedBytes)} / ${formatBytes(tx.totalBytes)}`);
    }
    const spd = formatSpeed(tx.speedBps);
    if (spd) parts.push(spd);
    const eta = formatEta(tx.etaSec);
    if (eta) parts.push(eta);
    if (parts.length === 0 && tx.statusText) parts.push(tx.statusText);
    return parts.join(" · ");
  }

  function computeFillClasses(tx) {
    if (tx.phase === "done") return "success";
    if (tx.phase === "error") return "error";
    if (tx.phase === "cancelled") return "cancelled";
    if (tx.phase === "processing" || tx.phase === "zipping") return "processing";
    return "";
  }

  function patchContainer(container, emptyHtml) {
    if (!container) return;

    if (transfers.length === 0) {
      if (emptyHtml) {
        container.innerHTML = emptyHtml;
      } else {
        container.innerHTML = "";
      }
      return;
    }

    const emptyHint = container.querySelector(".empty-hint");
    if (emptyHint) emptyHint.remove();

    const currentIds = Array.from(container.children).map((el) => el.getAttribute("data-tx-id"));
    const targetIds = transfers.map((t) => t.id);

    const sameOrder =
      currentIds.length === targetIds.length &&
      currentIds.every((id, idx) => id === targetIds[idx]);

    if (!sameOrder) {
      container.innerHTML = transfers.map((tx) => buildRowHtml(tx)).join("");
      return;
    }

    // Patch existing nodes in-place to avoid layout thrash and keep button clicks responsive
    transfers.forEach((tx, idx) => {
      const row = container.children[idx];
      if (!row) return;

      const metaEl = row.querySelector(".tx-meta");
      if (metaEl) metaEl.textContent = computeMainStatusText(tx);

      const subEl = row.querySelector(".tx-submeta");
      if (subEl) subEl.textContent = computeSubMetaText(tx);

      const bgEl = row.querySelector(".progress-bar-bg");
      if (bgEl) bgEl.setAttribute("aria-valuenow", String(tx.pct));

      const fillEl = row.querySelector(".progress-bar-fill");
      if (fillEl) {
        const fillWidth = tx.phase === "processing" && tx.pct === 0 ? 100 : tx.pct;
        fillEl.style.width = `${fillWidth}%`;
        fillEl.className = `progress-bar-fill ${computeFillClasses(tx)}`.trim();
      }

      const cancelBtn = row.querySelector(".tx-cancel-btn");
      if (cancelBtn && !isActive(tx)) {
        cancelBtn.remove();
      }

      const footer = row.querySelector(".tx-footer-line");
      if (footer) {
        const existingAction = footer.querySelector(".tx-action-btn");
        if (tx.actionLabel && tx.onAction && tx.phase === "done") {
          if (!existingAction) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "tx-action-btn";
            btn.setAttribute("data-action-id", tx.id);
            btn.textContent = tx.actionLabel;
            footer.appendChild(btn);
          }
        } else if (existingAction) {
          existingAction.remove();
        }
      }
    });
  }

  function updateSummaryAndChrome() {
    const activeItems = transfers.filter(isActive);
    const doneCount = transfers.filter((t) => t.phase === "done").length;
    const errorCount = transfers.filter((t) => t.phase === "error").length;
    const terminalCount = transfers.filter(isTerminal).length;

    // Tab badge
    const tabBadge = document.getElementById("badge-active-transfers");
    if (tabBadge) {
      if (activeItems.length > 0) {
        tabBadge.textContent = String(activeItems.length);
        tabBadge.style.display = "inline-flex";
      } else {
        tabBadge.style.display = "none";
      }
    }

    // Clear buttons
    const btnClearTab = document.getElementById("btn-clear-transfers");
    if (btnClearTab) {
      btnClearTab.style.display = terminalCount > 0 ? "inline-flex" : "none";
    }
    const btnClearDock = document.getElementById("btn-dock-clear");
    if (btnClearDock) {
      btnClearDock.style.display = terminalCount > 0 ? "inline-flex" : "none";
    }

    // Dock visibility & summary
    const dock = document.getElementById("transfer-dock");
    if (!dock) return;

    if (transfers.length === 0 || (dockDismissed && activeItems.length === 0)) {
      dock.style.display = "none";
      return;
    }

    dock.style.display = "flex";
    dock.classList.toggle("minimized", dockMinimized);

    const toggleBtn = document.getElementById("btn-dock-toggle");
    if (toggleBtn) {
      toggleBtn.textContent = dockMinimized ? "▴" : "▾";
      toggleBtn.title = dockMinimized ? "Expandir panel" : "Minimizar panel";
    }

    const summaryEl = document.getElementById("transfer-dock-summary");
    if (summaryEl) {
      if (activeItems.length > 0) {
        const ups = activeItems.filter((t) => t.direction === "up").length;
        const downs = activeItems.filter((t) => t.direction === "down").length;
        let label = "Transfiriendo";
        if (ups > 0 && downs === 0) label = ups === 1 ? "Subiendo 1 archivo" : `Subiendo ${ups} archivos`;
        else if (downs > 0 && ups === 0) label = downs === 1 ? "Descargando 1 archivo" : `Descargando ${downs} archivos`;
        else label = `${activeItems.length} transferencias activas`;

        const totalKnown = activeItems.reduce((acc, t) => acc + (t.totalBytes > 0 ? t.totalBytes : 0), 0);
        const loadedKnown = activeItems.reduce((acc, t) => acc + (t.totalBytes > 0 ? t.loadedBytes : 0), 0);
        const avgPct =
          totalKnown > 0
            ? Math.round((loadedKnown / totalKnown) * 100)
            : Math.round(activeItems.reduce((acc, t) => acc + t.pct, 0) / activeItems.length);
        const totalSpeed = activeItems.reduce((acc, t) => acc + (t.speedBps || 0), 0);
        const spdStr = formatSpeed(totalSpeed);

        summaryEl.textContent = `${label} · ${avgPct}%${spdStr ? " · " + spdStr : ""}`;
      } else if (errorCount > 0) {
        summaryEl.textContent = `${doneCount} completada(s) · ${errorCount} error(es)`;
      } else {
        summaryEl.textContent = `✓ ${doneCount} transferencia${doneCount === 1 ? "" : "s"} completada${doneCount === 1 ? "" : "s"}`;
      }
    }
  }

  function renderAll() {
    rafScheduled = false;
    bindStaticListeners();
    const tabList = document.getElementById("transfer-list");
    const dockList = document.getElementById("transfer-dock-list");

    patchContainer(tabList, '<p class="empty-hint">No hay transferencias en curso.</p>');
    patchContainer(dockList, "");
    updateSummaryAndChrome();
  }

  function scheduleRender(immediate = false) {
    if (immediate) {
      renderAll();
      return;
    }
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(renderAll);
  }

  function handleContainerClick(e) {
    const cancelBtn = e.target.closest("[data-cancel-id]");
    if (cancelBtn) {
      const id = cancelBtn.getAttribute("data-cancel-id");
      window.TransferUI.cancelTransfer(id);
      return;
    }
    const actionBtn = e.target.closest("[data-action-id]");
    if (actionBtn) {
      const id = actionBtn.getAttribute("data-action-id");
      const tx = byId.get(id);
      if (tx && typeof tx.onAction === "function") {
        tx.onAction();
      }
    }
  }

  function bindStaticListeners() {
    if (listenersBound) return;
    const tabList = document.getElementById("transfer-list");
    const dockList = document.getElementById("transfer-dock-list");
    if (!tabList && !dockList) return;
    listenersBound = true;

    if (tabList) tabList.addEventListener("click", handleContainerClick);
    if (dockList) dockList.addEventListener("click", handleContainerClick);

    document.getElementById("btn-clear-transfers")?.addEventListener("click", () => {
      window.TransferUI.clearCompleted();
    });
    document.getElementById("btn-dock-clear")?.addEventListener("click", () => {
      window.TransferUI.clearCompleted();
    });
    document.getElementById("btn-dock-toggle")?.addEventListener("click", () => {
      dockMinimized = !dockMinimized;
      updateSummaryAndChrome();
    });
    document.getElementById("btn-dock-close")?.addEventListener("click", () => {
      if (window.TransferUI.getActiveCount() > 0) {
        dockMinimized = true;
      } else {
        dockDismissed = true;
      }
      updateSummaryAndChrome();
    });
  }

  document.addEventListener("DOMContentLoaded", bindStaticListeners);

  window.TransferUI = {
    createTransfer({ filename, totalBytes = 0, direction = "up", channel = "P2P", phase = "transferring", statusText = "", onCancel = null } = {}) {
      seq += 1;
      const id = `tx-${seq}-${Date.now().toString(36)}`;
      const tx = {
        id,
        filename: filename || "archivo",
        totalBytes: Number(totalBytes) || 0,
        loadedBytes: 0,
        pct: 0,
        direction,
        channel,
        phase,
        statusText,
        speedBps: 0,
        etaSec: null,
        startedAt: performance.now(),
        samples: [],
        onCancel: typeof onCancel === "function" ? onCancel : null,
        actionLabel: null,
        onAction: null,
      };
      dockDismissed = false;
      transfers.unshift(tx);
      if (transfers.length > 50) {
        const removed = transfers.pop();
        if (removed) byId.delete(removed.id);
      }
      byId.set(id, tx);
      scheduleRender(true);
      return id;
    },

    setCancelHandler(id, fn) {
      const tx = byId.get(id);
      if (!tx) return;
      tx.onCancel = typeof fn === "function" ? fn : null;
      scheduleRender(true);
    },

    setFilename(id, filename) {
      const tx = byId.get(id);
      if (!tx || !filename) return;
      tx.filename = filename;
      scheduleRender(true);
    },

    setPhase(id, phase, statusText, pctOverride) {
      const tx = byId.get(id);
      if (!tx || isTerminal(tx)) return;
      tx.phase = phase;
      if (statusText !== undefined) tx.statusText = statusText;
      if (typeof pctOverride === "number") {
        tx.pct = Math.max(0, Math.min(100, Math.round(pctOverride)));
      }
      scheduleRender(true);
    },

    updateProgress(id, loadedBytes, totalBytes) {
      const tx = byId.get(id);
      if (!tx || isTerminal(tx)) return;

      if (typeof totalBytes === "number" && totalBytes > 0) {
        tx.totalBytes = totalBytes;
      }

      if (tx.totalBytes > 0) {
        tx.loadedBytes = Math.max(0, Math.min(tx.totalBytes, Number(loadedBytes) || 0));
        tx.pct = Math.min(100, Math.round((tx.loadedBytes / tx.totalBytes) * 100));
      } else {
        tx.pct = Math.max(0, Math.min(100, Math.round(Number(loadedBytes) || 0)));
      }

      if (tx.phase !== "transferring") {
        tx.phase = "transferring";
      }

      const now = performance.now();
      tx.samples.push({ t: now, b: tx.loadedBytes });
      while (tx.samples.length > 2 && now - tx.samples[0].t > 1500) {
        tx.samples.shift();
      }
      if (tx.samples.length >= 2) {
        const oldest = tx.samples[0];
        const dt = (now - oldest.t) / 1000;
        const db = tx.loadedBytes - oldest.b;
        if (dt >= 0.15 && db >= 0) {
          tx.speedBps = db / dt;
          if (tx.totalBytes > 0 && tx.speedBps > 0) {
            tx.etaSec = Math.max(0, (tx.totalBytes - tx.loadedBytes) / tx.speedBps);
          }
        }
      }

      scheduleRender(false);
    },

    completeTransfer(id, { message, actionLabel, onAction } = {}) {
      const tx = byId.get(id);
      if (!tx) return;
      tx.phase = "done";
      tx.pct = 100;
      if (tx.totalBytes > 0) tx.loadedBytes = tx.totalBytes;
      tx.speedBps = 0;
      tx.etaSec = null;
      tx.statusText = message || "Completado";
      tx.actionLabel = actionLabel || null;
      tx.onAction = typeof onAction === "function" ? onAction : null;
      emitTransferEvent(tx);
      scheduleRender(true);
    },

    failTransfer(id, errorMessage) {
      const tx = byId.get(id);
      if (!tx) return;
      tx.phase = "error";
      tx.speedBps = 0;
      tx.etaSec = null;
      tx.statusText = errorMessage || "Error en transferencia";
      emitTransferEvent(tx);
      scheduleRender(true);
    },

    cancelTransfer(id) {
      const tx = byId.get(id);
      if (!tx || isTerminal(tx)) return;
      const handler = tx.onCancel;
      tx.onCancel = null;
      tx.phase = "cancelled";
      tx.speedBps = 0;
      tx.etaSec = null;
      tx.statusText = "Cancelada";
      if (typeof handler === "function") {
        try {
          handler();
        } catch {
          // Ignore cancel hook errors
        }
      }
      emitTransferEvent(tx);
      scheduleRender(true);
    },

    removeTransfer(id) {
      const idx = transfers.findIndex((t) => t.id === id);
      if (idx !== -1) transfers.splice(idx, 1);
      byId.delete(id);
      scheduleRender(true);
    },

    clearCompleted() {
      for (let i = transfers.length - 1; i >= 0; i--) {
        if (isTerminal(transfers[i])) {
          byId.delete(transfers[i].id);
          transfers.splice(i, 1);
        }
      }
      scheduleRender(true);
    },

    getActiveCount() {
      return transfers.filter(isActive).length;
    },
  };

  /* ── Reusable In-App Confirm / Prompt Modal ── */
  window.AppDialog = {
    confirm({ title = "Confirmar", message = "", confirmText = "Confirmar", cancelText = "Cancelar", danger = false } = {}) {
      return openDialog({ mode: "confirm", title, message, confirmText, cancelText, danger });
    },
    prompt({ title = "Ingresar valor", message = "", placeholder = "", defaultValue = "", confirmText = "Aceptar", cancelText = "Cancelar" } = {}) {
      return openDialog({ mode: "prompt", title, message, placeholder, defaultValue, confirmText, cancelText });
    },
  };

  function openDialog(opts) {
    const modal = document.getElementById("app-dialog-modal");
    if (!modal) {
      if (opts.mode === "prompt") {
        return Promise.resolve(window.prompt(opts.message || opts.title, opts.defaultValue || ""));
      }
      return Promise.resolve(window.confirm(opts.message || opts.title));
    }

    const titleEl = document.getElementById("app-dialog-title");
    const msgEl = document.getElementById("app-dialog-message");
    const inputWrap = document.getElementById("app-dialog-input-wrap");
    const inputEl = document.getElementById("app-dialog-input");
    const cancelBtn = document.getElementById("app-dialog-cancel");
    const confirmBtn = document.getElementById("app-dialog-confirm");

    titleEl.textContent = opts.title || "";
    msgEl.textContent = opts.message || "";
    cancelBtn.textContent = opts.cancelText || "Cancelar";
    confirmBtn.textContent = opts.confirmText || "Aceptar";

    confirmBtn.className = opts.danger ? "btn-danger" : "primary";

    if (opts.mode === "prompt") {
      inputWrap.style.display = "block";
      inputEl.value = opts.defaultValue || "";
      inputEl.placeholder = opts.placeholder || "";
    } else {
      inputWrap.style.display = "none";
      inputEl.value = "";
    }

    modal.style.display = "flex";
    setTimeout(() => {
      if (opts.mode === "prompt") inputEl.focus();
      else confirmBtn.focus();
    }, 20);

    return new Promise((resolve) => {
      let settled = false;
      function cleanup(val) {
        if (settled) return;
        settled = true;
        modal.style.display = "none";
        document.removeEventListener("keydown", onKey);
        modal.removeEventListener("click", onBackdrop);
        cancelBtn.removeEventListener("click", onCancel);
        confirmBtn.removeEventListener("click", onConfirm);
        resolve(val);
      }
      function onCancel() {
        cleanup(opts.mode === "prompt" ? null : false);
      }
      function onConfirm() {
        cleanup(opts.mode === "prompt" ? inputEl.value : true);
      }
      function onBackdrop(e) {
        if (e.target === modal) onCancel();
      }
      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter" && opts.mode === "prompt") {
          e.preventDefault();
          onConfirm();
        }
      }
      cancelBtn.addEventListener("click", onCancel);
      confirmBtn.addEventListener("click", onConfirm);
      modal.addEventListener("click", onBackdrop);
      document.addEventListener("keydown", onKey);
    });
  }
})();
