/**
 * Friends & Devices Client Controller (static/friends.js)
 * Wires the Amigos tab in app.html: friend listing, invitations, accept/decline,
 * and live pending request badge counter.
 */

(function () {
  "use strict";

  function esc(text) {
    if (typeof window.escapeHtml === "function") return window.escapeHtml(text);
    const d = document.createElement("div");
    d.textContent = text == null ? "" : String(text);
    return d.innerHTML;
  }

  class FriendsManager {
    constructor() {
      this.friends = [];
      this.pendingIncoming = [];
      this.pendingOutgoing = [];
      this.eventsBound = false;
    }

    async init() {
      this.bindStaticEvents();
      await this.refresh();
    }

    bindStaticEvents() {
      if (this.eventsBound) return;
      const btnSend = document.getElementById("btn-send-friend-request");
      const inputUser = document.getElementById("input-friend-username");
      if (!btnSend && !inputUser) return;
      this.eventsBound = true;

      const sendRequest = async () => {
        if (!inputUser) return;
        const username = inputUser.value.trim();
        if (!username) {
          this.notify("Ingresa un nombre de usuario.", true);
          return;
        }
        btnSend.disabled = true;
        const prevText = btnSend.textContent;
        btnSend.textContent = "Enviando…";
        try {
          const res = await fetch("/api/friends/request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username }),
          });
          const data = await res.json();
          if (res.ok && data.ok) {
            this.notify(data.message || `Solicitud enviada a @${username}.`, false);
            inputUser.value = "";
            await this.refresh();
          } else {
            this.notify(data.error || "No se pudo enviar la solicitud.", true);
          }
        } catch {
          this.notify("Error de conexión al enviar solicitud.", true);
        } finally {
          btnSend.disabled = false;
          btnSend.textContent = prevText;
        }
      };

      if (btnSend) btnSend.addEventListener("click", sendRequest);
      if (inputUser) {
        inputUser.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            sendRequest();
          }
        });
      }
    }

    notify(msg, isWarn = false) {
      if (typeof window.showToast === "function") {
        window.showToast(msg, isWarn ? "warn" : "success");
      }
    }

    async refresh() {
      await this.fetchFriends();
      this.render();
      this.updateBadge();
    }

    async fetchFriends() {
      try {
        const res = await fetch("/api/friends/list");
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.ok) {
          this.friends = data.friends || [];
          this.pendingIncoming = data.pending_incoming || [];
          this.pendingOutgoing = data.pending_outgoing || [];
        }
      } catch (e) {
        console.warn("Could not fetch friends list", e);
      }
    }

    updateBadge() {
      const badge = document.getElementById("badge-friends-pending");
      if (!badge) return;
      const count = this.pendingIncoming.length;
      if (count > 0) {
        badge.textContent = String(count);
        badge.style.display = "inline-flex";
      } else {
        badge.style.display = "none";
      }
    }

    render() {
      const friendsEl = document.getElementById("friends-list");
      const pendingEl = document.getElementById("pending-friends-list");

      if (friendsEl) {
        if (this.friends.length === 0) {
          friendsEl.innerHTML = '<p class="empty-hint">Aún no tienes amigos agregados. Envía una solicitud por usuario.</p>';
        } else {
          friendsEl.innerHTML = this.friends
            .map((f) => {
              const devs = f.devices || [];
              const devHtml =
                devs.length > 0
                  ? `<div class="row" style="gap:6px; margin-top:8px;">
                      ${devs
                        .map((d) => {
                          const icon = d.device_type === "pc" ? "💻" : d.device_type === "tablet" ? "📟" : "📱";
                          return `<span class="device-chip">${icon} ${esc(d.device_name)}</span>`;
                        })
                        .join("")}
                    </div>`
                  : `<p class="device-meta" style="margin-top:6px;">Sin dispositivos registrados</p>`;

              return `
                <div class="friend-card">
                  <div class="spread" style="align-items:center;">
                    <div>
                      <strong style="color:var(--accent-green);">@${esc(f.username)}</strong>
                      <span class="device-meta" style="margin-left:6px;">${esc(f.display_name || "")}</span>
                    </div>
                    <span class="badge-pill">${devs.length} disp.</span>
                  </div>
                  ${devHtml}
                </div>
              `;
            })
            .join("");
        }
      }

      if (pendingEl) {
        if (this.pendingIncoming.length === 0 && this.pendingOutgoing.length === 0) {
          pendingEl.innerHTML = '<p class="empty-hint">No tienes solicitudes pendientes.</p>';
        } else {
          const incomingHtml = this.pendingIncoming
            .map((p) => {
              const req = p.requester || {};
              return `
                <div class="friend-pending-row">
                  <div style="min-width:0;">
                    <strong>@${esc(req.username || "usuario")}</strong>
                    <div class="device-meta">${esc(req.display_name || "Solicitud entrante")}</div>
                  </div>
                  <div class="row" style="gap:6px;">
                    <button type="button" class="primary btn-friend-accept" data-id="${esc(p.friendship_id)}" style="padding:6px 10px; min-height:34px; font-size:12px;">Aceptar</button>
                    <button type="button" class="btn-danger btn-friend-decline" data-id="${esc(p.friendship_id)}" style="padding:6px 10px; min-height:34px; font-size:12px;">Rechazar</button>
                  </div>
                </div>
              `;
            })
            .join("");

          const outgoingHtml = this.pendingOutgoing
            .map((p) => {
              const addr = p.addressee || {};
              return `
                <div class="friend-pending-row">
                  <div style="min-width:0;">
                    <strong>@${esc(addr.username || "usuario")}</strong>
                    <div class="device-meta">Esperando respuesta…</div>
                  </div>
                  <span class="badge-pill">Enviada</span>
                </div>
              `;
            })
            .join("");

          pendingEl.innerHTML = incomingHtml + outgoingHtml;

          pendingEl.querySelectorAll(".btn-friend-accept").forEach((btn) => {
            btn.addEventListener("click", () => this.respondRequest(btn.dataset.id, "ACCEPT"));
          });
          pendingEl.querySelectorAll(".btn-friend-decline").forEach((btn) => {
            btn.addEventListener("click", () => this.respondRequest(btn.dataset.id, "DECLINE"));
          });
        }
      }
    }

    async respondRequest(friendshipId, action) {
      try {
        const res = await fetch("/api/friends/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendship_id: friendshipId, action }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          this.notify(action === "ACCEPT" ? "Amigo aceptado. Sus dispositivos ahora son visibles." : "Solicitud rechazada.");
          await this.refresh();
          if (action === "ACCEPT" && typeof window.refreshVisibleDevices === "function") {
            window.refreshVisibleDevices();
          }
        } else {
          this.notify(data.error || "No se pudo procesar la respuesta.", true);
        }
      } catch {
        this.notify("Error de conexión al responder solicitud.", true);
      }
    }
  }

  window.friendsManager = new FriendsManager();
  window.loadFriendsList = () => window.friendsManager.refresh();
})();
