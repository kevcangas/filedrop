/**
 * Activity & Diagnostic Logger Client Module (static/activity-logger.js)
 * Provides real-time event streaming, filtering, export, and audit history.
 */

(function () {
  "use strict";

  function esc(text) {
    if (typeof window.escapeHtml === "function") return window.escapeHtml(text);
    const d = document.createElement("div");
    d.textContent = text == null ? "" : String(text);
    return d.innerHTML;
  }

  class ActivityLogger {
    constructor() {
      this.logs = [];
      this.currentFilter = "ALL";
      this.container = null;
      this.socketBound = false;
      this.windowEventsBound = false;
    }

    init(containerId, socketInstance) {
      this.container = document.getElementById(containerId);
      if (!this.container) return;
      this.renderShell();
      this.bindHeaderActions();
      this.fetchInitialLogs();
      this.bindSocketEvents(socketInstance);
      this.bindTransferEvents();
    }

    renderShell() {
      this.container.innerHTML = `
        <div class="spread" style="align-items:center; margin-bottom:10px; gap:8px; flex-wrap:wrap;">
          <div class="row" style="gap:6px; flex-wrap:wrap;">
            <button type="button" class="primary log-filter-btn" data-filter="ALL">Todos</button>
            <button type="button" class="log-filter-btn" data-filter="TRANSFER">Transferencias</button>
            <button type="button" class="log-filter-btn" data-filter="DEVICE">Dispositivos</button>
            <button type="button" class="log-filter-btn" data-filter="NETWORK">Red</button>
            <button type="button" class="log-filter-btn" data-filter="ERROR">Errores</button>
          </div>
          <span class="badge-pill" id="log-count-badge">0 eventos</span>
        </div>
        <div id="log-stream" class="log-stream-list">
          <p class="empty-hint" style="padding:12px 0;">Cargando registro de actividad…</p>
        </div>
      `;

      this.container.querySelectorAll(".log-filter-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          this.container.querySelectorAll(".log-filter-btn").forEach((b) => b.classList.remove("primary"));
          e.currentTarget.classList.add("primary");
          this.currentFilter = e.currentTarget.dataset.filter;
          this.renderLogs();
        });
      });
    }

    bindHeaderActions() {
      const btnClear = document.getElementById("btn-clear-logs");
      if (btnClear && !btnClear.dataset.bound) {
        btnClear.dataset.bound = "1";
        btnClear.addEventListener("click", () => {
          this.logs = [];
          this.renderLogs();
        });
      }

      const btnExport = document.getElementById("btn-export-logs");
      if (btnExport && !btnExport.dataset.bound) {
        btnExport.dataset.bound = "1";
        btnExport.addEventListener("click", () => {
          const payload = JSON.stringify(this.logs, null, 2);
          const blob = new Blob([payload], { type: "application/json" });
          const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
          if (typeof window.triggerBrowserDownload === "function") {
            window.triggerBrowserDownload(blob, `filedrop-logs-${stamp}.json`);
          } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `filedrop-logs-${stamp}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 3000);
          }
        });
      }
    }

    async fetchInitialLogs() {
      try {
        const res = await fetch("/api/logs/activity");
        if (!res.ok) {
          this.renderLogs();
          return;
        }
        const data = await res.json();
        if (data && data.ok && Array.isArray(data.activities)) {
          // Merge remote logs without losing live session events
          const existingIds = new Set(this.logs.map((l) => l.id));
          data.activities.forEach((item) => {
            if (!existingIds.has(item.id)) {
              this.logs.push(item);
            }
          });
          this.logs.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
          if (this.logs.length > 200) this.logs.length = 200;
          this.renderLogs();
        }
      } catch (err) {
        console.warn("Could not fetch remote activity logs", err);
        this.renderLogs();
      }
    }

    bindSocketEvents(socketInstance) {
      if (this.socketBound || !socketInstance) return;
      this.socketBound = true;

      socketInstance.on("system_log", (event) => {
        this.addLog(event.level || "INFO", event.title, event.message, event.type || "SYSTEM");
      });
      socketInstance.on("connect", () => {
        this.addLog("INFO", "Conexión en vivo", "Socket conectado al servidor.", "NETWORK");
      });
      socketInstance.on("disconnect", () => {
        this.addLog("WARN", "Desconexión", "Socket desconectado del servidor.", "NETWORK");
      });
    }

    bindTransferEvents() {
      if (this.windowEventsBound) return;
      this.windowEventsBound = true;

      window.addEventListener("filedrop:transfer", (e) => {
        const d = e.detail || {};
        const dirWord = d.direction === "down" ? "Descarga" : "Subida";
        const level = d.phase === "error" ? "ERROR" : d.phase === "cancelled" ? "WARN" : "INFO";
        const statusWord = d.phase === "done" ? "completada" : d.phase === "error" ? "fallida" : "cancelada";
        const sizeLabel = typeof window.formatBytes === "function" && d.totalBytes > 0 ? ` (${window.formatBytes(d.totalBytes)})` : "";
        this.addLog(
          level,
          `${dirWord} ${statusWord} · ${d.channel || "P2P"}`,
          `${d.filename || "archivo"}${sizeLabel}${d.message && d.phase === "error" ? " — " + d.message : ""}`,
          "TRANSFER"
        );
      });
    }

    addLog(level, title, message, type = "SYSTEM") {
      const entry = {
        id: "log_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        level: String(level || "INFO").toUpperCase(),
        type: String(type || "SYSTEM").toUpperCase(),
        title: title || "Evento del sistema",
        message: message || "",
        timestamp: new Date().toISOString(),
      };
      this.logs.unshift(entry);
      if (this.logs.length > 200) this.logs.pop();
      this.renderLogs();
    }

    renderLogs() {
      const stream = document.getElementById("log-stream");
      const countBadge = document.getElementById("log-count-badge");
      if (!stream) return;

      const filtered = this.logs.filter((log) => {
        if (this.currentFilter === "ALL") return true;
        if (this.currentFilter === "TRANSFER") return log.type === "TRANSFER";
        if (this.currentFilter === "DEVICE") return log.type === "DEVICE";
        if (this.currentFilter === "NETWORK") return log.type === "NETWORK";
        if (this.currentFilter === "ERROR") return log.level === "ERROR" || log.level === "WARN";
        return true;
      });

      if (countBadge) countBadge.textContent = `${filtered.length} eventos`;

      if (filtered.length === 0) {
        stream.innerHTML = '<p class="empty-hint" style="padding:12px 0;">No hay eventos que coincidan con este filtro.</p>';
        return;
      }

      stream.innerHTML = filtered
        .map((l) => {
          let badgeColor = "var(--text-muted)";
          if (l.level === "ERROR") badgeColor = "var(--accent-red)";
          else if (l.level === "WARN") badgeColor = "var(--accent-amber)";
          else if (l.type === "TRANSFER") badgeColor = "var(--accent-cyan)";
          else if (l.level === "INFO") badgeColor = "var(--accent-green)";

          const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : "";

          return `
            <div class="log-entry-row" style="border-left-color:${badgeColor};">
              <div style="min-width:0;">
                <span style="color:${badgeColor}; font-weight:700; margin-right:6px;">[${esc(l.type || l.level)}]</span>
                <span style="color:var(--text-primary); font-weight:600;">${esc(l.title)}</span>
                <span style="color:var(--text-muted); margin-left:6px;">${esc(l.message)}</span>
              </div>
              <span class="log-entry-time">${esc(timeStr)}</span>
            </div>
          `;
        })
        .join("");
    }
  }

  window.activityLogger = new ActivityLogger();
  window.loadActivityLogs = () => window.activityLogger.fetchInitialLogs();
})();
