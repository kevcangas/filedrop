/*
 * Cliente para un dispositivo remoto (celular o computadora secundaria) que
 * se conecta por IP a la computadora anfitriona. La misma pagina/JS sirve
 * para /mobile y /desktop; la unica diferencia es el tipo de dispositivo por
 * defecto (window.ENLACE_DEFAULT_TYPE) y el texto de algunas etiquetas.
 */

const DEVICE_ID_KEY = "enlace_device_id";
const DEVICE_NAME_KEY = "enlace_own_device_name";
const SAVED_KEY = "enlace_saved_connections";
const TYPE_KEY = "enlace_device_type";

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// Nombre propio de este dispositivo, el que ven los demás en su lista.
// Se autodetecta la primera vez (guessDeviceName), pero el usuario lo puede
// editar en la pantalla de conexión y a partir de ahí queda guardado.
function getOwnDeviceName() {
  return localStorage.getItem(DEVICE_NAME_KEY) || guessDeviceName();
}

function setOwnDeviceName(name) {
  if (name) localStorage.setItem(DEVICE_NAME_KEY, name);
}

function getDeviceType() {
  return localStorage.getItem(TYPE_KEY) || window.ENLACE_DEFAULT_TYPE || "phone";
}

function setDeviceType(type) {
  localStorage.setItem(TYPE_KEY, type);
}

function getSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY)) || [];
  } catch {
    return [];
  }
}

function setSaved(list) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(list));
}

function toast(text, warn = false) {
  const el = document.createElement("div");
  el.className = "toast" + (warn ? " warn" : "");
  el.textContent = text;
  document.getElementById("toasts").appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function deviceIcon(type, isHost) {
  if (isHost) return "🖥️";
  return type === "pc" ? "💻" : "📱";
}

// --- Selector de tipo de dispositivo (pantalla de conexion) -------------------

function renderTypeToggle() {
  const type = getDeviceType();
  document.getElementById("type-phone").classList.toggle("primary", type === "phone");
  document.getElementById("type-pc").classList.toggle("primary", type === "pc");
}

document.getElementById("type-phone").onclick = () => { setDeviceType("phone"); renderTypeToggle(); refreshDeviceNameSuggestion(); };
document.getElementById("type-pc").onclick = () => { setDeviceType("pc"); renderTypeToggle(); refreshDeviceNameSuggestion(); };
renderTypeToggle();

// Si el campo todavía tiene la sugerencia automática (no lo tocó el
// usuario), lo actualizamos al volver a adivinar; si ya lo editó, lo
// dejamos tal cual como escribió.
function refreshDeviceNameSuggestion() {
  const field = document.getElementById("input-device-name");
  const prevGuess = field.dataset.autoGuess || "";
  if (!field.value.trim() || field.value === prevGuess) {
    const guess = guessDeviceName();
    field.value = guess;
    field.dataset.autoGuess = guess;
  }
}
document.getElementById("input-device-name").value = getOwnDeviceName();
document.getElementById("input-device-name").dataset.autoGuess = localStorage.getItem(DEVICE_NAME_KEY) ? "" : getOwnDeviceName();

// --- Renderizar lista de conexiones guardadas --------------------------------

function renderSaved() {
  const saved = getSaved();
  const list = document.getElementById("saved-list");
  list.innerHTML = "";
  if (saved.length === 0) {
    list.innerHTML = '<p class="empty-hint">Todavía no tienes conexiones guardadas.</p>';
    return;
  }
  saved.forEach((conn, idx) => {
    const row = document.createElement("div");
    row.className = "saved-conn";
    row.innerHTML = `
      <div>
        <div class="saved-conn-alias">${escapeHtml(conn.alias)}</div>
        <div class="saved-conn-ip">${escapeHtml(conn.address)}</div>
      </div>
      <div class="row">
        <button data-idx="${idx}" class="btn-forget">Olvidar</button>
        <button data-idx="${idx}" class="primary btn-use">Conectar</button>
      </div>`;
    list.appendChild(row);
  });
  list.querySelectorAll(".btn-use").forEach((btn) => {
    btn.onclick = () => {
      const conn = getSaved()[btn.dataset.idx];
      connectTo(conn.address, conn.alias);
    };
  });
  list.querySelectorAll(".btn-forget").forEach((btn) => {
    btn.onclick = () => {
      const saved2 = getSaved();
      saved2.splice(btn.dataset.idx, 1);
      setSaved(saved2);
      renderSaved();
    };
  });
}

// --- Conexión ------------------------------------------------------------------

let socket = null;
let currentAlias = "";
let currentAddress = "";
let devices = [];
let selectedDeviceId = null;
const GLOBAL_TARGET_ID = "todos";

function connectTo(address, alias) {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  currentAlias = alias || address;
  currentAddress = address;

  const defaultScheme = window.location.protocol === "https:" ? "https://" : "http://";
  const url = address.includes("://") ? address : defaultScheme + address;
  socket = io(url, { transports: ["websocket", "polling"], reconnectionAttempts: 20 });

  const pulse = document.getElementById("conn-pulse");
  if (pulse) pulse.className = "pulse searching";
  const aliasEl = document.getElementById("conn-alias");
  if (aliasEl) aliasEl.textContent = currentAlias;
  const ipEl = document.getElementById("conn-ip");
  if (ipEl) ipEl.textContent = address;

  socket.on("connect", () => {
    socket.emit("register_device", {
      device_id: getDeviceId(),
      device_name: getOwnDeviceName(),
      device_type: getDeviceType(),
      is_host: false,
    });
    const p = document.getElementById("conn-pulse");
    if (p) p.className = "pulse live";
    showScreen("connected");
    refreshBuzon();
    if (typeof loadS3Explorer === "function") {
      loadS3Explorer({ getUserId: getDeviceId, toast: toast });
    }
    if (hasActiveTransfers()) {
      toast("Conexión recuperada, retomando transferencia…");
      resumeActiveTransfers(socket);
    } else {
      toast("Conectado a " + currentAlias);
    }
  });

  socket.on("disconnect", () => {
    const p = document.getElementById("conn-pulse");
    if (p) p.className = "pulse";
    if (hasActiveTransfers()) {
      toast("Se perdió la conexión durante una transferencia. Reintentando…", true);
    } else {
      toast("Se perdió la conexión con " + currentAlias + ". Intentando reconectar…", true);
    }
  });

  socket.on("connect_error", () => {
    const p = document.getElementById("conn-pulse");
    if (p) p.className = "pulse";
    toast("No se pudo conectar a " + address + ". Revisa la IP y que estén en la misma red.", true);
  });

  wireSocketEvents();
}

function guessDeviceName() {
  if (getDeviceType() === "pc") {
    const ua = navigator.userAgent;
    if (/Mac/i.test(ua)) return "Mac";
    if (/Windows/i.test(ua)) return "PC Windows";
    if (/Linux/i.test(ua)) return "PC Linux";
    return "Computadora";
  }
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return "iPhone";
  if (/android/i.test(ua)) return "Android";
  if (/ipad/i.test(ua)) return "iPad";
  return "Celular";
}

function showScreen(name) {
  if (name === "connect") {
    if (typeof setMobileTab === "function") setMobileTab("connect");
  }
}

// --- Formulario de conexión nueva ----------------------------------------------

document.getElementById("btn-connect-new").onclick = () => {
  const address = document.getElementById("input-ip").value.trim();
  const alias = document.getElementById("input-alias").value.trim();
  const deviceName = document.getElementById("input-device-name").value.trim();
  if (!address) {
    toast("Escribe la dirección IP o dominio de la anfitriona.", true);
    return;
  }
  setOwnDeviceName(deviceName || guessDeviceName());
  const finalAlias = alias || address;
  const saved = getSaved();
  if (!saved.find((c) => c.address === address)) {
    saved.push({ address, alias: finalAlias });
    setSaved(saved);
    renderSaved();
  }
  connectTo(address, finalAlias);
  if (typeof setMobileTab === "function") setMobileTab("transfer");
};

document.getElementById("btn-disconnect").onclick = () => {
  if (socket) socket.disconnect();
  devices = [];
  selectedDeviceId = null;
  const p = document.getElementById("conn-pulse");
  if (p) p.className = "pulse";
  const aliasEl = document.getElementById("conn-alias");
  if (aliasEl) aliasEl.textContent = "Desconectado";
  toast("Desconectado.");
  showScreen("connect");
};

// --- Lista de dispositivos disponibles (para elegir a quién enviar) -----------

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
          ${deviceIcon(d.device_type, d.is_host)} ${escapeHtml(d.device_name)}
          ${d.is_host ? '<span class="host-badge">Anfitriona</span>' : ""}
        </div>
        <div class="device-meta">${d.is_host ? "computadora anfitriona (servidor)" : "conectado para transferir"} · ${d.device_id.slice(0, 8)}</div>
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

// --- Envío: este dispositivo -> el dispositivo seleccionado -------------------

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

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

const dz = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const folderInput = document.getElementById("folder-input");

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
        lblS3.title = "S3 desactivado";
        lblS3.style.opacity = "0.6";
      } else if (!status.connected) {
        lblS3.title = "S3 no conectado: " + (status.error || "revisa credenciales");
      } else {
        lblS3.title = `S3 activo (Bucket: ${status.bucket})`;
      }
    }
  });
}

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

async function sendItemsToSelected(items) {
  if (items.length === 0) return;

  const destination = getActiveDestination();
  const wantsBuzon = destination === "buzon";
  const wantsS3 = destination === "s3";
  const isGlobal = selectedDeviceId === GLOBAL_TARGET_ID;

  if (!wantsBuzon && !wantsS3 && !isGlobal && (!socket || !selectedDeviceId)) {
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
// decide aceptar o rechazar por separado.
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
    fromDeviceName: getOwnDeviceName(),
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

// --- Recepción y relays ---------------------------------------------------------

let pendingOffer = null;

function wireSocketEvents() {
  socket.on("device_list", (list) => {
    devices = list;
    renderDevices();
  });

  socket.on("notice", (data) => toast(data.text));

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

  socket.on("file_chunk_relay", (data) => {
    handleIncomingChunk(socket, data);
  });

  socket.on("clipboard_update_relay", (data) => {
    applyIncomingClipboard(data);
  });

  socket.on("buzon_lista_inicial", (items) => renderBuzon(items));

  socket.on("buzon_nuevo", (item) => {
    toast(`Nuevo en el buzón: "${item.filename}" de ${item.from_device_name || "alguien"}.`);
    NotificationsModule.notify("Nuevo en el buzón", { body: item.filename, tag: "enlace-buzon" });
    refreshBuzon();
  });
}

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

// --- Portapapeles compartido ----------------------------------------------------

let lastClipboardText = "";

function applyIncomingClipboard(data) {
  lastClipboardText = data.text || "";
  document.getElementById("clipboard-text").value = lastClipboardText;
  document.getElementById("clipboard-from").textContent = data.from_device_name ? `de ${data.from_device_name}` : "";
  toast("Nuevo portapapeles compartido" + (data.from_device_name ? ` (${data.from_device_name})` : "") + ".");
  NotificationsModule.notify("Portapapeles compartido", {
    body: lastClipboardText.length > 120 ? lastClipboardText.slice(0, 117) + "…" : lastClipboardText,
    tag: "enlace-clipboard",
  });
}

document.getElementById("btn-clipboard-send").onclick = async () => {
  if (!socket || !socket.connected) return;
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

// --- Notificaciones nativas ------------------------------------------------------

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

// --- Registro del service worker (para instalar como app) ----------------------

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}

// --- Pestañas Móvil (S3, Transferir, Buzón, Conexión) -----------------------

function setMobileTab(tab) {
  const tabs = ["s3", "transfer", "buzon", "connect"];
  tabs.forEach((t) => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const content = document.getElementById(`tab-${t}-content`);
    if (btn) btn.classList.toggle("primary", t === tab);
    if (content) content.style.display = (t === tab ? "flex" : "none");
  });
  localStorage.setItem("enlace_mobile_tab", tab);
  if (tab === "s3" && typeof loadS3Explorer === "function") {
    loadS3Explorer({ getUserId: getDeviceId, toast: toast });
  } else if (tab === "buzon") {
    refreshBuzon();
  }
}

const tabBtnS3 = document.getElementById("tab-btn-s3");
const tabBtnTransfer = document.getElementById("tab-btn-transfer");
const tabBtnBuzon = document.getElementById("tab-btn-buzon");
const tabBtnConnect = document.getElementById("tab-btn-connect");
const btnQuickConfig = document.getElementById("btn-quick-config");

if (tabBtnS3) tabBtnS3.onclick = () => setMobileTab("s3");
if (tabBtnTransfer) tabBtnTransfer.onclick = () => setMobileTab("transfer");
if (tabBtnBuzon) tabBtnBuzon.onclick = () => setMobileTab("buzon");
if (tabBtnConnect) tabBtnConnect.onclick = () => setMobileTab("connect");
if (btnQuickConfig) btnQuickConfig.onclick = () => setMobileTab("connect");

// --- Botón de Subida Directa a S3 -------------------------------------------
const directS3Btn = document.getElementById("btn-s3-direct-upload");
const directS3Input = document.getElementById("s3-direct-file-input");
if (directS3Btn && directS3Input) {
  directS3Btn.onclick = () => directS3Input.click();
  directS3Input.onchange = async (e) => {
    if (e.target.files && e.target.files.length) {
      const items = filesToItems(e.target.files);
      const { file, isBundle, count } = await packageForSending(items);
      sendItemsToS3(file, isBundle, count, currentS3Folder || "");
      e.target.value = "";
    }
  };
}

renderSaved();
refreshNotifStatus();

if (typeof setupS3ExplorerEvents === "function") {
  setupS3ExplorerEvents({
    getUserId: getDeviceId,
    toast: toast
  });
}

// Cargar pestaña inicial (S3 por defecto para acceso directo)
const savedMobileTab = localStorage.getItem("enlace_mobile_tab") || "s3";
setMobileTab(savedMobileTab);

// Auto-conectar de inmediato a la anfitriona
(function autoConnectHost() {
  const host = window.location.host;
  const input = document.getElementById("input-ip");
  if (input && !input.value && host) {
    input.value = host;
  }
  if (host && !socket) {
    connectTo(host, "Anfitriona");
  }
})();
