const DEVICE_ID_KEY = "enlace_host_device_id";
const DEVICE_NAME_KEY = "enlace_host_device_name";

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = "host_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function getDeviceName() {
  const stored = localStorage.getItem(DEVICE_NAME_KEY);
  if (stored && stored !== "Esta computadora") return stored;
  const ua = navigator.userAgent;
  let name = "PC";
  if (/Mac/i.test(ua)) name = "Mac";
  else if (/Windows/i.test(ua)) name = "PC Windows";
  else if (/Linux/i.test(ua)) name = "PC Linux";
  return name;
}

const socket = io();

const GLOBAL_TARGET_ID = "todos";

let selectedDeviceId = null;
let devices = [];

// --- Utilidades UI -----------------------------------------------------------

function toast(text, warn = false) {
  const el = document.createElement("div");
  el.className = "toast" + (warn ? " warn" : "");
  el.textContent = text;
  document.getElementById("toasts").appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function deviceIcon(type, isHost) {
  if (isHost) return "🖥️";
  return type === "pc" ? "💻" : "📱";
}

function renderDevices() {
  const list = document.getElementById("device-list");
  list.innerHTML = "";
  if (devices.length === 0) {
    list.innerHTML = '<p class="empty-hint">Ningún otro dispositivo conectado todavía.</p>';
    selectedDeviceId = null;
    return;
  }
  if (selectedDeviceId !== GLOBAL_TARGET_ID && !devices.find((d) => d.device_id === selectedDeviceId)) {
    selectedDeviceId = devices[0].device_id;
  }

  const globalRow = document.createElement("div");
  globalRow.className = "device-row global" + (selectedDeviceId === GLOBAL_TARGET_ID ? " selected" : "");
  globalRow.setAttribute("role", "button");
  globalRow.setAttribute("tabindex", "0");
  globalRow.setAttribute("aria-pressed", selectedDeviceId === GLOBAL_TARGET_ID ? "true" : "false");
  const n = devices.length;
  globalRow.innerHTML = `
    <span class="pulse live"></span>
    <div>
      <div class="device-name">🌐 Global — todos los conectados</div>
      <div class="device-meta">envía a los ${n} dispositivo${n === 1 ? "" : "s"} de una vez; cada quien acepta o rechaza por su cuenta</div>
    </div>`;
  globalRow.onclick = () => { selectedDeviceId = GLOBAL_TARGET_ID; renderDevices(); };
  globalRow.onkeydown = (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      selectedDeviceId = GLOBAL_TARGET_ID;
      renderDevices();
    }
  };
  list.appendChild(globalRow);

  devices.forEach((d) => {
    const row = document.createElement("div");
    row.className = "device-row" + (d.device_id === selectedDeviceId ? " selected" : "");
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-pressed", d.device_id === selectedDeviceId ? "true" : "false");
    row.innerHTML = `
      <span class="pulse live"></span>
      <div>
        <div class="device-name">
          ${deviceIcon(d.device_type, false)} ${escapeHtml(d.device_name)}
        </div>
        <div class="device-meta">conectado para transferir · ${d.device_id.slice(0, 8)}</div>
      </div>`;
    row.onclick = () => { selectedDeviceId = d.device_id; renderDevices(); };
    row.onkeydown = (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        selectedDeviceId = d.device_id;
        renderDevices();
      }
    };
    list.appendChild(row);
  });
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function addTransferRow(id, name, extraLabel) {
  const container = document.getElementById("transfers");
  const emptyHint = container.querySelector(".empty-hint");
  if (emptyHint) emptyHint.remove();
  const row = document.createElement("div");
  row.className = "transfer";
  row.id = "transfer-" + id;
  row.innerHTML = `
    <div class="transfer-top">
      <span class="transfer-name">${escapeHtml(name)}${extraLabel ? ` <span class="device-meta">(${escapeHtml(extraLabel)})</span>` : ""}</span>
      <span class="transfer-pct" id="pct-${id}">0%</span>
    </div>
    <div class="progress-track"><div class="progress-fill" id="fill-${id}"></div></div>
  `;
  container.appendChild(row);
}

function updateTransferProgress(id, pct) {
  const fill = document.getElementById("fill-" + id);
  const pctEl = document.getElementById("pct-" + id);
  if (fill) fill.style.width = pct + "%";
  if (pctEl) pctEl.textContent = pct + "%";
}

function finishTransferRow(id, label) {
  const pctEl = document.getElementById("pct-" + id);
  if (pctEl) pctEl.textContent = label || "Listo";
}

// --- Registro con el servidor -------------------------------------------------

socket.on("connect", () => {
  socket.emit("register_device", { device_id: getDeviceId(), device_name: getDeviceName(), device_type: "pc", is_host: false });
  if (hasActiveTransfers()) {
    toast("Conexión recuperada, retomando transferencias en curso…");
    resumeActiveTransfers(socket);
  }
});

socket.on("device_list", (list) => {
  devices = list;
  renderDevices();
});

socket.on("notice", (data) => toast(data.text));

socket.on("disconnect", () => {
  if (hasActiveTransfers()) {
    toast("Se perdió la conexión durante una transferencia. Reintentando…", true);
  } else {
    toast("Se perdió la conexión con el servidor local. Reintentando…", true);
  }
});

// Variable global para la subcarpeta de S3 activa
let currentS3Folder = "";

function getActiveDestination() {
  const destS3 = document.getElementById("dest-s3");
  if (destS3 && destS3.checked) return "s3";
  const destBuzon = document.getElementById("dest-buzon");
  if (destBuzon && destBuzon.checked) return "buzon";
  return "device";
}

function updateS3DestinationHint() {
  const hintEl = document.getElementById("s3-target-hint");
  const folderEl = document.getElementById("s3-current-target-folder");
  if (hintEl) {
    const isS3 = getActiveDestination() === "s3";
    hintEl.style.display = isS3 ? "flex" : "none";
  }
  if (folderEl) {
    folderEl.textContent = currentS3Folder ? `/${currentS3Folder}` : "(raíz)";
  }
}

function setupDestinationSelector() {
  const radios = document.querySelectorAll('input[name="dest-target"]');
  const chkBuzon = document.getElementById("chk-buzon");
  radios.forEach((r) => {
    r.addEventListener("change", () => {
      const dest = getActiveDestination();
      if (chkBuzon) chkBuzon.checked = (dest === "buzon");
      updateS3DestinationHint();
    });
  });

  fetchS3Status(getDeviceId()).then((status) => {
    const lblS3 = document.getElementById("lbl-dest-s3");
    if (lblS3) {
      if (!status.enabled) {
        lblS3.title = "S3 desactivado (ENLACE_S3_ENABLED=0 en .env)";
        lblS3.style.opacity = "0.6";
      } else if (!status.connected) {
        lblS3.title = "S3 no conectado: " + (status.error || "revisa credenciales");
      } else {
        lblS3.title = `S3 activo (Bucket: ${status.bucket})`;
      }
    }
  });
}

// --- Enviar archivo(s) al dispositivo seleccionado -----------------------------

async function sendItemsToSelected(items) {
  if (items.length === 0) return;

  const destination = getActiveDestination();
  const wantsBuzon = destination === "buzon";
  const wantsS3 = destination === "s3";
  const isGlobal = selectedDeviceId === GLOBAL_TARGET_ID;

  if (!wantsBuzon && !wantsS3 && !isGlobal && !selectedDeviceId) {
    toast("Selecciona primero un dispositivo conectado (o elige Buzón o S3).", true);
    return;
  }
  if (!wantsBuzon && !wantsS3 && isGlobal && devices.length === 0) {
    toast("No hay ningún otro dispositivo conectado ahora mismo.", true);
    return;
  }
  const targetName = isGlobal ? "todos" : (devices.find((d) => d.device_id === selectedDeviceId) || {}).device_name || "";

  const { file, isBundle, count } = await packageForSending(items);

  if (wantsS3) {
    sendItemsToS3(file, isBundle, count, currentS3Folder);
    return;
  }

  if (wantsBuzon) {
    sendItemsToBuzon(file, isBundle, count, targetName);
    return;
  }

  if (isGlobal) {
    sendItemsToAll(file, isBundle, count);
    return;
  }

  const preview = isBundle ? null : await generatePreview(file);

  const id = offerFile(socket, file, {
    targetDeviceId: selectedDeviceId,
    preview,
    isBundle,
    bundleCount: count,
    onProgress: (pct) => updateTransferProgress(id, pct),
    onDone: () => finishTransferRow(id, "Enviado"),
    onRejected: () => finishTransferRow(id, "Rechazado"),
  });
  addTransferRow(id, file.name, isBundle ? `${count} archivos` : targetName);
}

// Envío global "en vivo": la misma logica de siempre (offerFile), pero una
// vez por cada dispositivo conectado. Cada uno recibe su propia oferta y
// decide aceptar o rechazar por separado; en la lista de transferencias de
// quien envía aparece una fila por destinatario, para ver el progreso de
// cada quien por separado.
async function sendItemsToAll(file, isBundle, count) {
  const preview = isBundle ? null : await generatePreview(file);
  const targets = devices.slice();
  toast(`Enviando a los ${targets.length} dispositivo${targets.length === 1 ? "" : "s"} conectado${targets.length === 1 ? "" : "s"}…`);
  targets.forEach((d) => {
    const id = offerFile(socket, file, {
      targetDeviceId: d.device_id,
      preview,
      isBundle,
      bundleCount: count,
      onProgress: (pct) => updateTransferProgress(id, pct),
      onDone: () => finishTransferRow(id, "Enviado"),
      onRejected: () => finishTransferRow(id, "Rechazado"),
    });
    addTransferRow(id, file.name, isBundle ? `${count} archivos → ${d.device_name}` : `Global → ${d.device_name}`);
  });
}

function sendItemsToBuzon(file, isBundle, count, targetName) {
  const id = "buzon_" + Date.now();
  addTransferRow(id, file.name, isBundle ? `${count} archivos → buzón` : (targetName ? `${targetName} → buzón` : "buzón"));
  uploadToBuzon(file, {
    targetDeviceId: selectedDeviceId,
    fromDeviceId: getDeviceId(),
    fromDeviceName: getDeviceName(),
    isBundle,
    bundleCount: count,
    onProgress: (pct) => updateTransferProgress(id, pct),
    onDone: () => {
      finishTransferRow(id, "Guardado en buzón");
      toast("Guardado en el buzón. Se podrá descargar cuando quieran.");
    },
    onError: () => {
      finishTransferRow(id, "Error");
      toast("No se pudo guardar en el buzón.", true);
    },
  });
}

function sendItemsToS3(file, isBundle, count, folder) {
  const id = "s3_" + Date.now();
  const folderLabel = folder ? `/${folder}` : "";
  addTransferRow(id, file.name, isBundle ? `${count} archivos → S3${folderLabel}` : `S3${folderLabel}`);
  uploadToS3(file, {
    folder: folder || "",
    userId: getDeviceId(),
    isBundle,
    bundleCount: count,
    onProgress: (pct) => updateTransferProgress(id, pct),
    onDone: () => {
      finishTransferRow(id, "Guardado en S3");
      toast("Guardado con éxito en tu almacenamiento S3.");
      if (typeof refreshS3FilesList === "function") refreshS3FilesList();
    },
    onError: (status, errMsg) => {
      finishTransferRow(id, "Error S3");
      toast(errMsg ? `Error S3: ${errMsg}` : "No se pudo guardar en S3.", true);
    },
  });
}


// --- Buzón (para descargar después) --------------------------------------------

function renderBuzon(items) {
  const list = document.getElementById("buzon-list");
  list.innerHTML = "";
  if (!items || items.length === 0) {
    list.innerHTML = '<p class="empty-hint">Nada en el buzón todavía.</p>';
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "buzon-item";
    const label = item.is_bundle ? `${item.filename} (${item.bundle_count} archivos)` : item.filename;
    row.innerHTML = `
      <div>
        <div class="buzon-item-name">${escapeHtml(label)}</div>
        <div class="buzon-item-meta">${formatBytes(item.size)} · de ${escapeHtml(item.from_device_name || "?")} · ${formatExpiry(item.expires_at)}</div>
      </div>
      <div class="row">
        <button data-id="${item.id}" class="btn-buzon-borrar danger">Borrar</button>
        <a href="/api/buzon/descargar/${item.id}" class="btn primary" style="text-decoration:none;">Descargar</a>
      </div>`;
    list.appendChild(row);
  });
  list.querySelectorAll(".btn-buzon-borrar").forEach((btn) => {
    btn.onclick = async () => {
      await deleteBuzonItem(btn.dataset.id);
      refreshBuzon();
    };
  });
}

async function refreshBuzon() {
  const items = await fetchBuzonList(getDeviceId());
  renderBuzon(items);
}

document.getElementById("btn-buzon-refresh").onclick = () => refreshBuzon();

socket.on("buzon_lista_inicial", (items) => renderBuzon(items));

socket.on("buzon_nuevo", (item) => {
  toast(`Nuevo en el buzón: "${item.filename}" de ${item.from_device_name || "alguien"}.`);
  NotificationsModule.notify("Nuevo en el buzón", { body: item.filename, tag: "enlace-buzon" });
  refreshBuzon();
});

refreshBuzon();

socket.on("file_response_relay", (data) => {
  if (data.accept) {
    startSendingAfterAccept(socket, data.file_id);
  } else {
    finishTransferRow(data.file_id, "Rechazado");
    toast("Rechazaron el archivo.", true);
  }
});

socket.on("chunk_ack_relay", (data) => {
  handleAckReceived(socket, data);
});

// --- Recibir archivo entrante ---------------------------------------------------

let pendingOffer = null;

socket.on("file_offer", (data) => {
  pendingOffer = data;
  const fromName = data._from_device_name || "Otro dispositivo";
  const desc = data.is_bundle
    ? `${fromName} quiere enviarte un paquete con ${data.bundle_count} archivos (${formatBytes(data.size)}, comprimido en .zip).`
    : `${fromName} quiere enviarte "${data.filename}" (${formatBytes(data.size)}).`;
  document.getElementById("offer-text").textContent = desc;
  const img = document.getElementById("offer-preview");
  if (data.preview) {
    img.src = data.preview;
    img.style.display = "block";
  } else {
    img.style.display = "none";
  }
  document.getElementById("offer-modal").style.display = "flex";
  NotificationsModule.notify("Archivo entrante", { body: desc, tag: "enlace-file-offer" });
});

document.getElementById("offer-accept").onclick = () => {
  if (!pendingOffer) return;
  const data = pendingOffer;
  document.getElementById("offer-modal").style.display = "none";
  socket.emit("file_response", { file_id: data.file_id, target_device_id: data._from_device_id, accept: true });

  const id = data.file_id;
  addTransferRow(id, data.filename, data.is_bundle ? `${data.bundle_count} archivos` : (data._from_device_name || null));
  prepareIncoming(id, {
    filename: data.filename,
    size: data.size,
    mimetype: data.mimetype,
    totalChunks: Math.ceil(data.size / (64 * 1024)),
    fromDeviceId: data._from_device_id,
    onProgress: (pct) => updateTransferProgress(id, pct),
    onComplete: (blob, filename) => {
      finishTransferRow(id, "Recibido");
      triggerBrowserDownload(blob, filename);
      toast(`"${filename}" recibido y descargado.`);
      NotificationsModule.notify("Archivo recibido", { body: `"${filename}" se descargó correctamente.`, tag: "enlace-file-done" });
    },
  });
  pendingOffer = null;
};

document.getElementById("offer-reject").onclick = () => {
  if (!pendingOffer) return;
  socket.emit("file_response", { file_id: pendingOffer.file_id, target_device_id: pendingOffer._from_device_id, accept: false });
  document.getElementById("offer-modal").style.display = "none";
  pendingOffer = null;
};

socket.on("file_chunk_relay", (data) => {
  handleIncomingChunk(socket, data);
});

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// --- Drag & drop, selección de archivos y de carpeta ---------------------------

const dz = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const folderInput = document.getElementById("folder-input");

dz.addEventListener("click", () => fileInput.click());
document.getElementById("btn-pick-folder").addEventListener("click", (e) => {
  e.stopPropagation();
  folderInput.click();
});
setupDestinationSelector();


fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) sendItemsToSelected(filesToItems(e.target.files));
  fileInput.value = "";
});
folderInput.addEventListener("change", (e) => {
  if (e.target.files.length) sendItemsToSelected(filesToItems(e.target.files));
  folderInput.value = "";
});

["dragenter", "dragover"].forEach((evt) => {
  dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.add("drag-over"); });
});
["dragleave", "drop"].forEach((evt) => {
  dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.remove("drag-over"); });
});
dz.addEventListener("drop", async (e) => {
  const items = await itemsFromDataTransfer(e.dataTransfer);
  sendItemsToSelected(items);
});

// --- Copiar IP (si existe el botón en la plantilla) -------------------------------

const btnCopyIp = document.getElementById("copy-ip");
if (btnCopyIp) {
  btnCopyIp.onclick = () => {
    const el = document.getElementById("ip-value");
    if (el) navigator.clipboard.writeText(el.textContent).then(() => toast("Dirección copiada."));
  };
}

// --- Portapapeles compartido ------------------------------------------------------

function applyIncomingClipboard(data) {
  document.getElementById("clipboard-text").value = data.text || "";
  document.getElementById("clipboard-from").textContent = data.from_device_name ? `de ${data.from_device_name}` : "";
  toast("Nuevo portapapeles compartido" + (data.from_device_name ? ` (${data.from_device_name})` : "") + ".");
  NotificationsModule.notify("Portapapeles compartido", {
    body: (data.text || "").length > 120 ? data.text.slice(0, 117) + "…" : (data.text || ""),
    tag: "enlace-clipboard",
  });
}

socket.on("clipboard_update_relay", (data) => applyIncomingClipboard(data));

document.getElementById("btn-clipboard-send").onclick = async () => {
  let text = document.getElementById("clipboard-text").value;
  if (!text) {
    text = await readSystemClipboard();
    document.getElementById("clipboard-text").value = text;
  }
  if (!text) {
    toast("No hay nada que enviar (escribe algo o copia algo primero).", true);
    return;
  }
  const targetId = devices.length && selectedDeviceId !== GLOBAL_TARGET_ID ? selectedDeviceId : null;
  socket.emit("clipboard_update", targetId ? { text, target_device_id: targetId } : { text });
  toast(targetId ? "Portapapeles enviado al dispositivo seleccionado." : "Portapapeles enviado a todos los conectados.");
};

document.getElementById("btn-clipboard-copy").onclick = async () => {
  const text = document.getElementById("clipboard-text").value;
  if (!text) return;
  const ok = await writeSystemClipboard(text);
  toast(ok ? "Copiado a tu portapapeles." : "Tu navegador no permitió copiar automáticamente; selecciona el texto y cópialo a mano.", !ok);
};

// --- Notificaciones nativas ---------------------------------------------------

function refreshNotifStatus() {
  const btn = document.getElementById("btn-notif-enable");
  const status = document.getElementById("notif-status");
  if (!NotificationsModule.isSupported()) {
    btn.style.display = "none";
    status.textContent = "Este navegador no soporta notificaciones nativas.";
    return;
  }
  const perm = NotificationsModule.permission();
  if (perm === "granted") {
    btn.textContent = "Activadas ✓";
    btn.disabled = true;
    status.textContent = "Vas a recibir notificaciones del sistema cuando llegue algo y no estés viendo esta pestaña.";
  } else if (perm === "denied") {
    btn.disabled = true;
    btn.textContent = "Bloqueadas";
    status.textContent = "Las bloqueaste desde el navegador. Actívalas desde los ajustes de sitio de tu navegador para esta página.";
  } else {
    btn.textContent = "Activar";
    btn.disabled = false;
    status.textContent = "Avísame con una notificación del sistema cuando llegue un archivo o algo al portapapeles, aunque no esté viendo esta pestaña.";
  }
}

document.getElementById("btn-notif-enable").onclick = async () => {
  await NotificationsModule.requestPermission();
  refreshNotifStatus();
};

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}

refreshNotifStatus();

// --- Compartir acceso por correo ----------------------------------------------

async function fetchShareText() {
  try {
    const res = await fetch("/api/compartir/texto");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

document.getElementById("btn-correo-abrir").onclick = async () => {
  const info = await fetchShareText();
  if (!info) {
    toast("No se pudo preparar el mensaje.", true);
    return;
  }
  const to = document.getElementById("input-correo-destino").value.trim();
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(info.subject)}&body=${encodeURIComponent(info.body)}`;
  window.location.href = mailto;
};

document.getElementById("btn-correo-enviar").onclick = async () => {
  const to = document.getElementById("input-correo-destino").value.trim();
  if (!to || !to.includes("@")) {
    toast("Escribe un correo destino válido.", true);
    return;
  }
  try {
    const res = await fetch("/api/compartir/correo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      toast("Correo enviado a " + to + ".");
    } else {
      toast(data.message || "No se pudo enviar automáticamente. Usa 'Abrir en mi correo'.", true);
    }
  } catch {
    toast("No se pudo enviar automáticamente. Usa 'Abrir en mi correo'.", true);
  }
};

// --- Almacenamiento S3: Estado en Configuración y Eventos del Explorador ---------

async function refreshS3ConfigStatus() {
  const badge = document.getElementById("s3-config-badge");
  const details = document.getElementById("s3-config-details");
  if (!badge || !details) return;

  badge.textContent = "Verificando…";
  badge.className = "badge-pill";
  badge.style.color = "";

  const status = await fetchS3Status(getDeviceId());
  if (!status.enabled) {
    badge.textContent = "○ Desactivado";
    badge.className = "badge-pill";
    details.innerHTML = `
      <p class="empty-hint" style="padding:0; margin-top:8px;">
        El almacenamiento S3 está desactivado en la configuración del servidor (<code>ENLACE_S3_ENABLED=0</code>).
      </p>
    `;
    return;
  }

  if (status.connected) {
    badge.textContent = "● Conectado";
    badge.className = "badge-pill";
    badge.style.color = "var(--green)";
    details.innerHTML = `
      <div style="margin-top:8px; font-size:13px; line-height:1.7;">
        <div><strong>Bucket:</strong> <code style="font-family:var(--mono);">${escapeHtml(status.bucket || "—")}</code></div>
        <div><strong>Región:</strong> <code style="font-family:var(--mono);">${escapeHtml(status.region || "us-east-1")}</code></div>
        <div><strong>Endpoint:</strong> <code style="font-family:var(--mono);">${escapeHtml(status.endpoint_url || "AWS S3 Estándar")}</code></div>
        <div><strong>Prefijo privado:</strong> <code style="font-family:var(--mono);">${escapeHtml(status.user_prefix || "users/" + getDeviceId() + "/")}</code></div>
      </div>
    `;
  } else {
    badge.textContent = "⚠️ Error de conexión";
    badge.className = "badge-pill";
    badge.style.color = "var(--red)";
    details.innerHTML = `
      <div style="margin-top:8px; font-size:13px;">
        <span style="color:var(--red); font-weight:600;">No se pudo verificar el bucket:</span>
        <p style="margin:4px 0 0 0; font-family:var(--mono); font-size:12px; color:var(--text-muted);">${escapeHtml(status.error || "Error de credenciales o de red")}</p>
      </div>
    `;
  }
}

const btnTestS3 = document.getElementById("btn-s3-test-conn");
if (btnTestS3) {
  btnTestS3.onclick = () => {
    toast("Comprobando conexión con S3…");
    refreshS3ConfigStatus();
  };
}

if (typeof setupS3ExplorerEvents === "function") {
  setupS3ExplorerEvents({
    getUserId: getDeviceId,
    toast: toast
  });
}

const directS3BtnPc = document.getElementById("btn-s3-direct-upload");
const directS3InputPc = document.getElementById("s3-direct-file-input");
if (directS3BtnPc && directS3InputPc) {
  directS3BtnPc.onclick = () => directS3InputPc.click();
  directS3InputPc.onchange = async (e) => {
    if (e.target.files && e.target.files.length) {
      const items = filesToItems(e.target.files);
      const { file, isBundle, count } = await packageForSending(items);
      sendItemsToS3(file, isBundle, count, currentS3Folder || "");
      e.target.value = "";
    }
  };
}

