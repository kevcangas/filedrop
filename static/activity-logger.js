/**
 * Activity & Diagnostic Logger Client Module
 * Provides real-time event streaming, filtering, and audit history.
 */

class ActivityLogger {
  constructor() {
    this.logs = [];
    this.currentFilter = "ALL";
    this.container = null;
  }

  init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    this.renderShell();
    this.fetchInitialLogs();
    this.bindSocketEvents();
  }

  renderShell() {
    this.container.innerHTML = `
      <div class="panel" style="margin-top: 14px;">
        <div class="spread" style="align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <div class="row" style="gap: 8px; align-items: center;">
            <p class="panel-title" style="margin-bottom: 0;">📋 Registro de Actividad y Telemetría</p>
            <span class="badge-pill" id="log-count-badge">0 eventos</span>
          </div>
          <div class="row" style="gap: 6px;">
            <button id="btn-log-clear" style="font-size: 11px; padding: 4px 8px;">🗑️ Limpiar</button>
            <button id="btn-log-refresh" style="font-size: 11px; padding: 4px 8px;">🔄 Actualizar</button>
          </div>
        </div>

        <div class="row" style="gap: 6px; margin-bottom: 12px; flex-wrap: wrap;">
          <button class="primary log-filter-btn" data-filter="ALL" style="font-size: 11px; padding: 4px 10px;">Todos</button>
          <button class="log-filter-btn" data-filter="TRANSFER" style="font-size: 11px; padding: 4px 10px;">Transferencias</button>
          <button class="log-filter-btn" data-filter="SECURITY" style="font-size: 11px; padding: 4px 10px;">Seguridad</button>
          <button class="log-filter-btn" data-filter="ERROR" style="font-size: 11px; padding: 4px 10px;">Errores</button>
        </div>

        <div id="log-stream" style="max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; font-family: var(--mono); font-size: 12px;">
          <p class="empty-hint" style="padding: 12px 0;">Sin eventos registrados aún.</p>
        </div>
      </div>
    `;

    document.getElementById("btn-log-clear")?.addEventListener("click", () => {
      this.logs = [];
      this.renderLogs();
    });

    document.getElementById("btn-log-refresh")?.addEventListener("click", () => {
      this.fetchInitialLogs();
    });

    this.container.querySelectorAll(".log-filter-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        this.container.querySelectorAll(".log-filter-btn").forEach((b) => b.classList.remove("primary"));
        e.target.classList.add("primary");
        this.currentFilter = e.target.dataset.filter;
        this.renderLogs();
      });
    });
  }

  async fetchInitialLogs() {
    try {
      const res = await fetch("/api/logs/activity");
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok && Array.isArray(data.activities)) {
        this.logs = data.activities;
        this.renderLogs();
      }
    } catch (err) {
      console.warn("Could not fetch remote activity logs", err);
    }
  }

  bindSocketEvents() {
    if (typeof socket === "undefined" || !socket) return;

    socket.on("system_log", (event) => {
      this.addLog(event.level || "INFO", event.title, event.message, event.type || "SYSTEM");
    });

    socket.on("connect", () => {
      this.addLog("INFO", "Conexión en vivo", "Socket conectado al servidor.", "NETWORK");
    });

    socket.on("disconnect", () => {
      this.addLog("WARN", "Desconexión", "Socket desconectado del servidor.", "NETWORK");
    });
  }

  addLog(level, title, message, type = "SYSTEM") {
    const entry = {
      id: "log_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4),
      level: level.toUpperCase(),
      type: type.toUpperCase(),
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
      if (this.currentFilter === "SECURITY") return log.type === "SECURITY" || log.type === "AUTH";
      if (this.currentFilter === "ERROR") return log.level === "ERROR";
      return true;
    });

    if (countBadge) countBadge.textContent = `${filtered.length} eventos`;

    if (filtered.length === 0) {
      stream.innerHTML = '<p class="empty-hint" style="padding: 12px 0;">No hay eventos que coincidan con este filtro.</p>';
      return;
    }

    stream.innerHTML = filtered
      .map((l) => {
        let badgeColor = "var(--text-muted)";
        if (l.level === "ERROR") badgeColor = "var(--danger)";
        else if (l.level === "WARN") badgeColor = "var(--accent)";
        else if (l.type === "TRANSFER") badgeColor = "var(--accent-2)";
        else if (l.level === "INFO") badgeColor = "var(--ok)";

        const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : "";

        return `
          <div style="background: var(--panel-2); border-left: 3px solid ${badgeColor}; padding: 6px 10px; border-radius: 4px; display: flex; justify-content: space-between; align-items: baseline; gap: 8px;">
            <div>
              <span style="color: ${badgeColor}; font-weight: 700; margin-right: 6px;">[${l.type || l.level}]</span>
              <span style="color: var(--text); font-weight: 600;">${l.title}</span>
              <span style="color: var(--text-muted); margin-left: 6px;">${l.message}</span>
            </div>
            <span style="color: var(--text-muted); font-size: 10px; white-space: nowrap;">${timeStr}</span>
          </div>
        `;
      })
      .join("");
  }
}

window.activityLogger = new ActivityLogger();
