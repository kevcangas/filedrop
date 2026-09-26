/**
 * Friends & Devices Client Controller
 * Manages user identity, friend requests, and enrolled device list.
 */

class FriendsManager {
  constructor() {
    this.currentUser = null;
    this.currentDevice = null;
    this.friends = [];
    this.pendingIncoming = [];
    this.pendingOutgoing = [];
    this.container = null;
  }

  async init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    await this.fetchMe();
    await this.fetchFriends();
    this.render();
  }

  async fetchMe() {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) {
        this.currentUser = data.user;
        this.currentDevice = data.current_device;
      }
    } catch (e) {
      console.warn("Could not fetch user session", e);
    }
  }

  async fetchFriends() {
    try {
      const res = await fetch("/api/friends/list");
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) {
        this.friends = data.friends || [];
        this.pendingIncoming = data.pending_incoming || [];
        this.pendingOutgoing = data.pending_outgoing || [];
      }
    } catch (e) {
      console.warn("Could not fetch friends list", e);
    }
  }

  render() {
    if (!this.container) return;

    const userBadge = this.currentUser
      ? `<div class="spread" style="align-items:center; background:var(--panel-2); padding:10px 14px; border-radius:8px; border:1px solid var(--border); margin-bottom:14px;">
          <div>
            <strong style="color:var(--text); font-size:14px;">👤 ${this.currentUser.display_name}</strong>
            <span style="color:var(--text-muted); font-size:12px; margin-left:6px;">(@${this.currentUser.username})</span>
            <div style="color:var(--text-muted); font-size:11px; margin-top:2px;">Dispositivo actual: <em>${this.currentDevice ? this.currentDevice.device_name : 'Navegador Web'}</em></div>
          </div>
          <button id="btn-account-logout" style="font-size:11px; padding:4px 8px; border-color:var(--danger); color:var(--danger);">Cerrar Sesión</button>
        </div>`
      : `<p class="empty-hint">Sesión no iniciada como usuario registrado.</p>`;

    const incomingHtml = this.pendingIncoming.length > 0
      ? `<div style="margin-bottom:14px;">
          <p class="subcard-title" style="color:var(--accent);">📩 Solicitudes Recibidas (${this.pendingIncoming.length})</p>
          <div class="stack">
            ${this.pendingIncoming.map(p => `
              <div class="spread" style="background:var(--panel-2); padding:8px 12px; border-radius:6px; align-items:center;">
                <div>
                  <strong>@${p.requester?.username}</strong>
                  <span style="font-size:11px; color:var(--text-muted); margin-left:4px;">(${p.requester?.display_name})</span>
                </div>
                <div class="row" style="gap:6px;">
                  <button class="primary btn-friend-accept" data-id="${p.friendship_id}" style="font-size:11px; padding:4px 8px;">Aceptar</button>
                  <button class="btn-friend-decline" data-id="${p.friendship_id}" style="font-size:11px; padding:4px 8px;">Rechazar</button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>`
      : "";

    const friendsListHtml = this.friends.length > 0
      ? `<div class="stack">
          ${this.friends.map(f => {
            const devCount = f.devices ? f.devices.length : 0;
            return `
              <div class="subcard" style="padding:10px 12px;">
                <div class="spread" style="align-items:center;">
                  <div>
                    <strong style="color:var(--ok);">🟢 @${f.username}</strong>
                    <span style="color:var(--text-muted); font-size:12px; margin-left:4px;">(${f.display_name})</span>
                  </div>
                  <span class="badge-pill">${devCount} disp.</span>
                </div>
                ${f.devices && f.devices.length > 0
                  ? `<div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
                      ${f.devices.map(d => `<span style="background:var(--bg); border:1px solid var(--border); border-radius:4px; font-size:11px; padding:2px 6px; color:var(--text-muted);">${d.device_type === 'pc' ? '💻' : '📱'} ${d.device_name}</span>`).join("")}
                     </div>`
                  : `<p class="hint-small" style="margin-top:4px;">Sin dispositivos activos</p>`
                }
              </div>
            `;
          }).join("")}
        </div>`
      : `<p class="empty-hint" style="padding:8px 0;">Aún no tienes amigos agregados.</p>`;

    this.container.innerHTML = `
      <div class="panel">
        <p class="panel-title">👥 Amigos y Cuentas Vinculadas</p>
        ${userBadge}

        <!-- Enviar solicitud -->
        <div style="margin-bottom:16px;">
          <label style="font-size:12px; font-weight:600; color:var(--text-muted);">AGREGAR AMIGO POR USUARIO</label>
          <div class="row" style="gap:8px; margin-top:6px;">
            <input type="text" id="input-friend-username" placeholder="Nombre de usuario del amigo..." style="flex:1;">
            <button class="primary" id="btn-friend-send-req" style="white-space:nowrap;">➕ Invitar</button>
          </div>
          <p id="friend-feedback" class="hint-small" style="display:none;"></p>
        </div>

        ${incomingHtml}

        <p class="subcard-title">Mis Amigos Aceptados</p>
        ${friendsListHtml}
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    document.getElementById("btn-account-logout")?.addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    });

    document.getElementById("btn-friend-send-req")?.addEventListener("click", async () => {
      const input = document.getElementById("input-friend-username");
      const feedback = document.getElementById("friend-feedback");
      const username = input.value.trim();
      if (!username) return;

      feedback.style.display = "block";
      feedback.style.color = "var(--text-muted)";
      feedback.textContent = "Enviando invitación...";

      try {
        const res = await fetch("/api/friends/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username }),
        });
        const data = await res.json();
        if (data.ok) {
          feedback.style.color = "var(--ok)";
          feedback.textContent = data.message || "Invitación enviada.";
          input.value = "";
          await this.fetchFriends();
          setTimeout(() => this.render(), 1200);
        } else {
          feedback.style.color = "var(--danger)";
          feedback.textContent = data.error || "No se pudo enviar.";
        }
      } catch (e) {
        feedback.style.color = "var(--danger)";
        feedback.textContent = "Error de conexión.";
      }
    });

    this.container.querySelectorAll(".btn-friend-accept").forEach(b => {
      b.addEventListener("click", async (e) => {
        const friendship_id = e.target.dataset.id;
        await fetch("/api/friends/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendship_id, action: "ACCEPT" }),
        });
        await this.fetchFriends();
        this.render();
      });
    });

    this.container.querySelectorAll(".btn-friend-decline").forEach(b => {
      b.addEventListener("click", async (e) => {
        const friendship_id = e.target.dataset.id;
        await fetch("/api/friends/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendship_id, action: "DECLINE" }),
        });
        await this.fetchFriends();
        this.render();
      });
    });
  }
}

window.friendsManager = new FriendsManager();
