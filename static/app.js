/**
 * FileDrop - Unified Client Application (static/app.js)
 * Handles Socket.IO presence, P2P binary chunk transfers, shared clipboard,
 * and high-level routing between devices, S3 storage, and the ephemeral mailbox.
 */

(function () {
  "use strict";

  // --- Estado y Configuración Global -------------------------------------------
  const GLOBAL_TARGET_ID = "todos";
  let myDeviceId = (window.__FILEDROP_DEVICE__ && window.__FILEDROP_DEVICE__.id) || "";
  let myUserId = (window.__FILEDROP_USER__ && window.__FILEDROP_USER__.id) || "";
  let myDeviceName = (window.__FILEDROP_DEVICE__ && window.__FILEDROP_DEVICE__.device_name) || "Dispositivo";

  let selectedDeviceId = GLOBAL_TARGET_ID;
  let devices = [];
  let pendingOffer = null;

  // --- Inicialización del Socket -----------------------------------------------
  const socket = io({
    withCredentials: true,
    transports: ["websocket", "polling"],
  });

  // --- Utilidades UI -----------------------------------------------------------
  function escapeHtml(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function toast(text, isWarn = false) {
    const container = document.getElementById("toasts");
    if (!container) return;
    const el = document.createElement("div");
    el.className = "toast" + (isWarn ? " warn" : "");
    el.textContent = text;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 400);
    }, 4500);
  }

  function getDeviceIcon(type) {
    return type === "pc" ? "💻" : "📱";
  }

  // --- Gestión de Pestañas Responsivas -----------------------------------------
  function setupTabs() {
    const tabButtons = document.querySelectorAll(".page-tabs .tab-btn");
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.dataset.tab;
        tabButtons.forEach((b) => b.classList.remove("active", "primary"));
        btn.classList.add("active", "primary");

        document.querySelectorAll(".tab-content-panel").forEach((panel) => {
          panel.style.display = "none";
          panel.classList.remove("active");
        });

        const activePanel = document.getElementById(`tab-content-${targetTab}`);
        if (activePanel) {
          activePanel.style.display = "block";
          activePanel.classList.add("active");
        }

        // Acciones específicas al activar pestañas
        if (targetTab === "s3" && typeof window.loadS3Explorer === "function") {
          window.loadS3Explorer();
        } else if (targetTab === "buzon") {
          refreshBuzon();
        } else if (targetTab === "friends" && typeof window.loadFriendsList === "function") {
          window.loadFriendsList();
        } else if (targetTab === "config") {
          loadConnectionQR();
        }
      });
    });
  }

  // --- Renderizado de Lista de Dispositivos -----------------------------------
  function updateTargetHint() {
    const hint = document.getElementById("active-target-hint");
    if (!hint) return;
    const visibleDevs = devices.filter((d) => d.device_id !== myDeviceId);
    const onlineDevs = visibleDevs.filter((d) => d.is_online);

    if (selectedDeviceId === GLOBAL_TARGET_ID) {
      hint.textContent = `Destino: 🌐 Global (${onlineDevs.length} en línea)`;
      hint.className = "active-target-badge global";
    } else {
      const target = visibleDevs.find((d) => d.device_id === selectedDeviceId);
      if (target) {
        if (target.is_online) {
          hint.textContent = `Destino: ${getDeviceIcon(target.device_type)} ${target.device_name}`;
          hint.className = "active-target-badge specific";
        } else {
          hint.textContent = `Destino (Buzón): ${getDeviceIcon(target.device_type)} ${target.device_name} (desconectado)`;
          hint.className = "active-target-badge none";
        }
      } else {
        hint.textContent = "Destino: Ninguno seleccionado";
        hint.className = "active-target-badge none";
      }
    }
  }

  function formatRelativeTime(isoString) {
    if (!isoString) return "";
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 60) return "hace un momento";
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `hace ${diffMin} min`;
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) return `hace ${diffHours} h`;
      const diffDays = Math.floor(diffHours / 24);
      return `hace ${diffDays} d`;
    } catch {
      return "";
    }
  }

  function renderDevices() {
    const list = document.getElementById("device-list");
    if (!list) return;
    list.innerHTML = "";

    const visibleDevs = devices.filter((d) => d.device_id !== myDeviceId);

    if (visibleDevs.length === 0) {
      list.innerHTML = `
        <div class="empty-hint" style="text-align:center; padding:18px 10px;">
          <p style="margin:0 0 8px; font-weight:600; color:var(--text-secondary);">Ningún otro dispositivo vinculado aún.</p>
          <p style="margin:0; font-size:12px; color:var(--text-muted); line-height:1.5;">
            Inicia sesión en tu celular u otra PC con tu cuenta para que aparezcan aquí automáticamente.
          </p>
        </div>
      `;
      selectedDeviceId = GLOBAL_TARGET_ID;
      updateTargetHint();
      return;
    }

    // Asegurar selección válida
    if (selectedDeviceId !== GLOBAL_TARGET_ID && !visibleDevs.find((d) => d.device_id === selectedDeviceId)) {
      selectedDeviceId = GLOBAL_TARGET_ID;
    }

    const onlineDevs = visibleDevs.filter((d) => d.is_online);

    // Fila 1: Opción Global (enviar a todos)
    const globalRow = document.createElement("div");
    globalRow.className = "device-row global" + (selectedDeviceId === GLOBAL_TARGET_ID ? " selected" : "");
    globalRow.setAttribute("role", "button");
    globalRow.setAttribute("tabindex", "0");
    globalRow.innerHTML = `
      <span class="pulse ${onlineDevs.length > 0 ? "live" : ""}"></span>
      <div style="flex:1;">
        <div class="device-name">🌐 Global — todos los conectados</div>
        <div class="device-meta">
          ${onlineDevs.length > 0 ? `Envía a los ${onlineDevs.length} dispositivo${onlineDevs.length === 1 ? "" : "s"} activos a la vez` : "Sin otros dispositivos activos en línea ahora"}
        </div>
      </div>
    `;
    globalRow.onclick = () => {
      selectedDeviceId = GLOBAL_TARGET_ID;
      renderDevices();
    };
    list.appendChild(globalRow);

    // Filas individuales por dispositivo par (en línea primero)
    const sortedDevs = [...visibleDevs].sort((a, b) => (b.is_online ? 1 : 0) - (a.is_online ? 1 : 0));

    sortedDevs.forEach((d) => {
      const isSelected = d.device_id === selectedDeviceId;
      const row = document.createElement("div");
      row.className = "device-row" + (isSelected ? " selected" : "") + (d.is_online ? "" : " device-offline");
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");

      const badgeLabel = d.is_own_account ? "Esta cuenta" : `@${d.owner_username}`;
      const badgeClass = d.is_own_account ? "badge-own" : "badge-friend";
      const statusText = d.is_online
        ? "🟢 En línea"
        : `⚪ Desconectado ${d.last_seen_at ? "· " + formatRelativeTime(d.last_seen_at) : ""}`;

      row.innerHTML = `
        <span class="pulse ${d.is_online ? "live" : ""}"></span>
        <div style="flex:1;">
          <div class="spread" style="align-items:center;">
            <span class="device-name" style="${d.is_online ? "" : "opacity:0.8;"}">
              ${getDeviceIcon(d.device_type)} ${escapeHtml(d.device_name)}
            </span>
            <span class="device-account-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
          </div>
          <div class="device-meta" style="margin-top:2px;">
            ${statusText} ${!d.is_online ? "· entrega diferida por Buzón" : ""}
          </div>
        </div>
      `;
      row.onclick = () => {
        selectedDeviceId = d.device_id;
        renderDevices();
      };
      list.appendChild(row);
    });

    updateTargetHint();
  }

  // --- Sincronización REST y Presencia de Dispositivos -------------------------
  async function fetchVisibleDevices() {
    try {
      const res = await fetch("/api/devices/visible");
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.devices)) {
        if (data.current_device_id && !myDeviceId) {
          myDeviceId = data.current_device_id;
        }
        devices = data.devices;
        renderDevices();
      }
    } catch (err) {
      console.warn("Could not fetch visible devices via REST", err);
    }
  }

  // --- Handlers de Socket.IO y Presencia ----------------------------------------
  function setupSocketListeners() {
    socket.on("connect", () => {
      const ind = document.getElementById("global-connection-indicator");
      if (ind) {
        ind.className = "status-indicator online";
        ind.innerHTML = '<span class="pulse live"></span> En línea';
      }
      socket.emit("register_device", {
        device_id: myDeviceId,
        device_name: myDeviceName,
        device_type: (window.__FILEDROP_DEVICE__ && window.__FILEDROP_DEVICE__.device_type) || "pc",
      });
      fetchVisibleDevices();
    });

    socket.on("disconnect", () => {
      const ind = document.getElementById("global-connection-indicator");
      if (ind) {
        ind.className = "status-indicator offline";
        ind.innerHTML = '<span class="pulse"></span> Desconectado';
      }
    });

    socket.on("session_ready", (data) => {
      if (data && data.device_id) {
        myDeviceId = data.device_id;
        myUserId = data.user_id;
        if (window.__FILEDROP_DEVICE__) {
          window.__FILEDROP_DEVICE__.id = data.device_id;
        }
      }
      fetchVisibleDevices();
    });

    // Actualización de lista de dispositivos disponibles
    socket.on("devices_updated", (data) => {
      let rawList = [];
      if (Array.isArray(data)) {
        rawList = data;
      } else if (data && Array.isArray(data.devices)) {
        rawList = data.devices;
      }
      devices = rawList;
      renderDevices();
    });

    socket.on("device_list", (data) => {
      if (Array.isArray(data)) {
        devices = data;
        renderDevices();
      }
    });

    // Eventos de Transferencia P2P
    socket.on("send_offer", handleIncomingOffer);
    socket.on("file_response", handleFileResponse);
    socket.on("file_chunk", (chunk) => {
      if (typeof window.handleIncomingChunk === "function") {
        window.handleIncomingChunk(socket, chunk);
      }
    });
    socket.on("chunk_ack", (ack) => {
      if (typeof window.handleAckReceived === "function") {
        window.handleAckReceived(socket, ack);
      }
    });

    // Portapapeles compartido
    socket.on("clipboard_update", (data) => {
      if (!data || !data.text) return;
      const area = document.getElementById("clipboard-text");
      if (area) area.value = data.text;
      const fromEl = document.getElementById("clipboard-from");
      if (fromEl) fromEl.textContent = `De: ${data.sender_name || "Otro dispositivo"}`;
      toast("📋 Portapapeles sincronizado");
    });
  }

  // Enlazar listeners de socket inmediatamente al cargar el script
  setupSocketListeners();
  if (socket.connected) {
    socket.emit("register_device", {
      device_id: myDeviceId,
      device_name: myDeviceName,
      device_type: (window.__FILEDROP_DEVICE__ && window.__FILEDROP_DEVICE__.device_type) || "pc",
    });
    fetchVisibleDevices();
  }

  function setupVisibilityListeners() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (!socket.connected) {
          socket.connect();
        } else {
          socket.emit("register_device", {
            device_id: myDeviceId,
            device_name: myDeviceName,
          });
        }
        fetchVisibleDevices();
      }
    });

    window.addEventListener("focus", () => fetchVisibleDevices());
    window.addEventListener("pageshow", () => fetchVisibleDevices());

    // Actualización de presencia periódica en segundo plano
    setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchVisibleDevices();
      }
    }, 10000);
  }

  // --- Ofertas Entrantes y Modal de Aceptación ---------------------------------
  function handleIncomingOffer(offer) {
    pendingOffer = offer;
    const modal = document.getElementById("offer-modal");
    const desc = document.getElementById("offer-modal-desc");
    const info = document.getElementById("offer-file-info");
    const previewBox = document.getElementById("offer-preview-box");

    desc.textContent = `${offer.sender_device_name || "Un dispositivo"} te ofrece un archivo:`;
    info.innerHTML = `
      <strong>${escapeHtml(offer.file_name)}</strong>
      <span>${formatBytes(offer.file_size)}</span>
    `;

    if (offer.preview && previewBox) {
      previewBox.innerHTML = `<img src="${offer.preview}" alt="Vista previa" style="max-height:160px; max-width:100%; border-radius:6px;">`;
      previewBox.style.display = "block";
    } else if (previewBox) {
      previewBox.style.display = "none";
    }

    modal.style.display = "flex";
  }

  function setupOfferModal() {
    const btnAccept = document.getElementById("btn-offer-accept");
    const btnReject = document.getElementById("btn-offer-reject");
    const modal = document.getElementById("offer-modal");

    btnAccept.onclick = () => {
      if (!pendingOffer) return;
      modal.style.display = "none";
      const offer = pendingOffer;
      pendingOffer = null;

      // Registrar fila de transferencia entrante
      const rowId = addTransferRow(offer.file_name, offer.file_size, "down");
      if (typeof window.prepareIncoming === "function") {
        window.prepareIncoming(offer.transfer_id || offer.file_id, {
          filename: offer.file_name,
          filesize: offer.file_size,
          mimetype: offer.file_type || "application/octet-stream",
          fromDeviceId: offer.from_device_id,
          onProgress: (p) => updateTransferProgress(rowId, p),
          onComplete: () => finishTransferRow(rowId, true),
        });
      }

      socket.emit("file_response", {
        to_device_id: offer.from_device_id,
        transfer_id: offer.transfer_id || offer.file_id,
        accept: true,
      });
    };

    btnReject.onclick = () => {
      if (!pendingOffer) return;
      modal.style.display = "none";
      socket.emit("file_response", {
        to_device_id: pendingOffer.from_device_id,
        transfer_id: pendingOffer.transfer_id || pendingOffer.file_id,
        accept: false,
      });
      pendingOffer = null;
      toast("Transferencia rechazada.");
    };
  }

  function handleFileResponse(resp) {
    if (resp.accept) {
      toast("El destinatario aceptó el archivo. Iniciando envío...");
      if (typeof window.startSendingAfterAccept === "function") {
        window.startSendingAfterAccept(socket, resp.transfer_id || resp.file_id);
      }
    } else {
      toast("El destinatario rechazó la transferencia.", true);
    }
  }

  // --- Filas de Transferencia en DOM -------------------------------------------
  let transferSeq = 0;
  function addTransferRow(filename, filesize, direction = "up") {
    const list = document.getElementById("transfer-list");
    if (!list) return null;
    const emptyHint = list.querySelector(".empty-hint");
    if (emptyHint) emptyHint.remove();

    transferSeq++;
    const rowId = `tx-row-${transferSeq}`;
    const row = document.createElement("div");
    row.id = rowId;
    row.className = "transfer-row";
    row.innerHTML = `
      <div class="spread" style="margin-bottom:4px;">
        <span class="tx-name">${direction === "up" ? "⬆️" : "⬇️"} ${escapeHtml(filename)}</span>
        <span class="tx-meta" id="${rowId}-status">0% · ${formatBytes(filesize)}</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" id="${rowId}-fill" style="width: 0%;"></div>
      </div>
    `;
    list.prepend(row);
    return rowId;
  }

  function updateTransferProgress(rowId, progressFraction) {
    const pct = Math.min(100, Math.round(progressFraction * 100));
    const fill = document.getElementById(`${rowId}-fill`);
    const status = document.getElementById(`${rowId}-status`);
    if (fill) fill.style.width = `${pct}%`;
    if (status) status.textContent = `${pct}%`;
  }

  function finishTransferRow(rowId, success = true) {
    const status = document.getElementById(`${rowId}-status`);
    const fill = document.getElementById(`${rowId}-fill`);
    if (status) status.textContent = success ? "✓ Completado" : "✗ Error";
    if (fill && success) {
      fill.style.width = "100%";
      fill.classList.add("success");
    }
  }

  // --- Despacho de Archivos (Drag & Drop y Botones) ----------------------------
  async function dispatchFiles(filesList) {
    if (!filesList || filesList.length === 0) return;
    const destRadio = document.querySelector('input[name="dest-target"]:checked');
    const destination = destRadio ? destRadio.value : "device";

    if (destination === "s3") {
      await uploadFilesToS3(filesList);
    } else if (destination === "buzon") {
      await uploadFilesToBuzon(filesList);
    } else {
      await sendFilesP2P(filesList);
    }
  }

  async function sendFilesP2P(filesList) {
    if (devices.length === 0) {
      toast("No hay otros dispositivos conectados.", true);
      return;
    }

    const items = typeof window.filesToItems === "function" ? window.filesToItems(filesList) : Array.from(filesList).map((f) => ({ file: f, relativePath: f.name }));
    const bundle = typeof window.packageForSending === "function" ? await window.packageForSending(items) : { file: items[0].file, isBundle: false, count: 1 };
    const targets = selectedDeviceId === GLOBAL_TARGET_ID ? devices.map((d) => d.device_id) : [selectedDeviceId];

    targets.forEach((targetDevId) => {
      const rowId = addTransferRow(bundle.file.name, bundle.file.size, "up");
      if (typeof window.offerFile === "function") {
        window.offerFile(socket, bundle.file, {
          targetDeviceId: targetDevId,
          isBundle: bundle.isBundle,
          bundleCount: bundle.count,
          onProgress: (p) => updateTransferProgress(rowId, p),
          onDone: () => finishTransferRow(rowId, true),
          onRejected: () => finishTransferRow(rowId, false),
        });
      }
    });
  }

  async function uploadFilesToS3(filesList) {
    for (const file of filesList) {
      const rowId = addTransferRow(file.name, file.size, "up");
      try {
        if (typeof window.uploadToS3 === "function") {
          await window.uploadToS3(file, (p) => updateTransferProgress(rowId, p));
          finishTransferRow(rowId, true);
        }
      } catch (err) {
        finishTransferRow(rowId, false);
        toast(`Error al subir ${file.name} a S3`, true);
      }
    }
    toast("Subida a S3 finalizada.");
    if (typeof window.refreshS3FilesList === "function") window.refreshS3FilesList();
  }

  async function uploadFilesToBuzon(filesList) {
    for (const file of filesList) {
      const rowId = addTransferRow(file.name, file.size, "up");
      try {
        if (typeof window.uploadToBuzon === "function") {
          await window.uploadToBuzon(file, (p) => updateTransferProgress(rowId, p));
          finishTransferRow(rowId, true);
        }
      } catch (err) {
        finishTransferRow(rowId, false);
        toast(`Error al depositar en buzón`, true);
      }
    }
    toast("Archivo(s) depositados en el buzón.");
    refreshBuzon();
  }

  // --- Handlers de Drag & Drop y Selectores de Archivos ------------------------
  function setupDropzone() {
    const dz = document.getElementById("dropzone");
    const fileInput = document.getElementById("file-input");
    const folderInput = document.getElementById("folder-input");
    const btnPickFolder = document.getElementById("btn-pick-folder");

    if (!dz) return;

    dz.addEventListener("click", () => fileInput.click());
    if (btnPickFolder) btnPickFolder.addEventListener("click", () => folderInput.click());

    fileInput.addEventListener("change", () => {
      if (fileInput.files.length) dispatchFiles(fileInput.files);
    });

    folderInput.addEventListener("change", () => {
      if (folderInput.files.length) dispatchFiles(folderInput.files);
    });

    ["dragenter", "dragover"].forEach((evt) => {
      dz.addEventListener(evt, (e) => {
        e.preventDefault();
        dz.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach((evt) => {
      dz.addEventListener(evt, (e) => {
        e.preventDefault();
        dz.classList.remove("dragover");
      });
    });

    dz.addEventListener("drop", async (e) => {
      if (e.dataTransfer && e.dataTransfer.files) {
        if (typeof window.itemsFromDataTransfer === "function") {
          const items = await window.itemsFromDataTransfer(e.dataTransfer);
          dispatchFiles(items.map((i) => i.file));
        } else {
          dispatchFiles(e.dataTransfer.files);
        }
      }
    });
  }

  // --- Portapapeles Compartido -------------------------------------------------
  function setupClipboard() {
    const btnSend = document.getElementById("btn-clipboard-send");
    const btnCopy = document.getElementById("btn-clipboard-copy");
    const area = document.getElementById("clipboard-text");

    if (btnSend) {
      btnSend.onclick = () => {
        const text = area.value.trim();
        if (!text) return toast("Escribe o pega texto primero.", true);
        socket.emit("clipboard_update", { text });
        toast("Portapapeles emitido a tus dispositivos.");
      };
    }

    if (btnCopy) {
      btnCopy.onclick = () => {
        const text = area.value;
        if (!text) return toast("No hay texto para copiar.", true);
        navigator.clipboard.writeText(text).then(
          () => toast("Texto copiado al portapapeles local."),
          () => toast("No se pudo copiar automáticamente.", true)
        );
      };
    }
  }

  // --- Buzón de Entrega Rápida ------------------------------------------------
  async function refreshBuzon() {
    const list = document.getElementById("buzon-list");
    if (!list) return;
    try {
      const res = await fetch("/api/mailbox");
      const data = await res.json();
      if (!res.ok || !data.ok) return;

      list.innerHTML = "";
      if (!data.items || data.items.length === 0) {
        list.innerHTML = '<p class="empty-hint">El buzón está vacío.</p>';
        return;
      }

      data.items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "buzon-item";
        row.innerHTML = `
          <div class="spread" style="align-items:center;">
            <div>
              <div class="buzon-name">📄 ${escapeHtml(item.file_name)}</div>
              <div class="buzon-meta">${formatBytes(item.file_size)} · Expira: ${item.expires_at || "24h"}</div>
            </div>
            <div class="row" style="gap:6px;">
              <a href="/api/mailbox/${item.id}/download" class="button primary" style="font-size:12px; padding:4px 8px; text-decoration:none;">⬇️ Descargar</a>
              <button class="btn-danger btn-delete-buzon" data-id="${item.id}" style="font-size:12px; padding:4px 8px;">🗑️</button>
            </div>
          </div>
        `;
        list.appendChild(row);
      });

      list.querySelectorAll(".btn-delete-buzon").forEach((btn) => {
        btn.onclick = async () => {
          await fetch(`/api/mailbox/${btn.dataset.id}`, { method: "DELETE" });
          refreshBuzon();
        };
      });
    } catch {
      // Ignorar errores transitorios
    }
  }

  function setupBuzon() {
    const btnRefresh = document.getElementById("btn-buzon-refresh");
    const btnUpload = document.getElementById("btn-buzon-upload");
    const fileInput = document.getElementById("buzon-file-input");

    if (btnRefresh) btnRefresh.onclick = refreshBuzon;
    if (btnUpload && fileInput) {
      btnUpload.onclick = () => fileInput.click();
      fileInput.onchange = () => {
        if (fileInput.files.length) uploadFilesToBuzon(fileInput.files);
      };
    }
  }

  // --- Ajustes y Código QR de Conexión ----------------------------------------
  async function loadConnectionQR() {
    const img = document.getElementById("qr-image");
    const urlText = document.getElementById("qr-url-text");
    if (!img) return;

    try {
      const res = await fetch("/api/info");
      const info = await res.json();
      const directUrl = info.public_url || window.location.origin;
      if (urlText) urlText.textContent = directUrl;
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(directUrl)}`;
    } catch {
      if (urlText) urlText.textContent = window.location.origin;
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(window.location.origin)}`;
    }

    const btnCopy = document.getElementById("btn-copy-access-url");
    if (btnCopy) {
      btnCopy.onclick = () => {
        const text = urlText.textContent;
        navigator.clipboard.writeText(text).then(() => toast("Enlace copiado al portapapeles."));
      };
    }
  }

  function setupDeviceSettings() {
    const btnSave = document.getElementById("btn-save-device-name");
    const inputName = document.getElementById("input-own-device-name");
    if (btnSave && inputName) {
      btnSave.onclick = async () => {
        const newName = inputName.value.trim();
        if (!newName) return toast("Ingresa un nombre válido.", true);
        try {
          const res = await fetch(`/api/devices/${myDeviceId}/rename`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_name: newName }),
          });
          const data = await res.json();
          if (res.ok && data.ok) {
            myDeviceName = newName;
            toast("Nombre del dispositivo actualizado.");
            socket.emit("register_device", { device_id: myDeviceId, device_name: newName });
          } else {
            toast(data.error || "Error al renombrar.", true);
          }
        } catch {
          toast("Error de conexión al renombrar.", true);
        }
      };
    }
  }

  function setupS3DirectUpload() {
    const btn = document.getElementById("btn-s3-direct-upload");
    const input = document.getElementById("s3-direct-file-input");
    if (btn && input) {
      btn.onclick = () => input.click();
      input.onchange = () => {
        if (input.files.length) uploadFilesToS3(input.files);
      };
    }
  }

  // --- Inicialización al Cargar el DOM -----------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    setupTabs();
    setupVisibilityListeners();
    setupDropzone();
    setupClipboard();
    setupOfferModal();
    setupBuzon();
    setupDeviceSettings();
    setupS3DirectUpload();

    // Resolver ID de dispositivo canónico si la sesión no lo tenía en template
    if (!myDeviceId) {
      fetch("/api/devices/me")
        .then((r) => r.json())
        .then((d) => {
          if (d.ok && d.device) {
            myDeviceId = d.device.id;
            myDeviceName = d.device.device_name;
            fetchVisibleDevices();
          }
        })
        .catch(() => {});
    } else {
      fetchVisibleDevices();
    }

    const btnRefreshDevs = document.getElementById("btn-refresh-devices");
    if (btnRefreshDevs) {
      btnRefreshDevs.onclick = async () => {
        btnRefreshDevs.style.transform = "rotate(360deg)";
        btnRefreshDevs.style.transition = "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)";
        setTimeout(() => {
          btnRefreshDevs.style.transform = "none";
          btnRefreshDevs.style.transition = "none";
        }, 500);

        if (!socket.connected) {
          socket.connect();
        } else {
          socket.emit("register_device", { device_id: myDeviceId, device_name: myDeviceName });
        }
        await fetchVisibleDevices();
        toast("Lista de dispositivos actualizada.");
      };
    }

    // Inicializar explorador S3 si está disponible en transfer.js
    if (typeof window.setupS3ExplorerEvents === "function") {
      window.setupS3ExplorerEvents();
    }
  });
})();
