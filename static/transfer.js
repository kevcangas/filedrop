/*
 * Logica compartida de transferencia de archivos y portapapeles por
 * WebSocket (Socket.IO), HTTP (Buzon) y S3. La usa app.js (cliente unificado).
 *
 * Protocolo (eventos), totalmente simetrico entre cualquier par de
 * dispositivos (PC o celular, no importa cual sea cual):
 *  - send_offer          {file_id, target_device_id, filename, size, mimetype,
 *                          preview?, is_bundle?, bundle_count?}
 *  - file_offer          (lo mismo + _from_device_id, _from_device_name)
 *  - file_response       {file_id, target_device_id, accept}
 *  - file_response_relay (relay del anterior)
 *  - file_chunk          {file_id, target_device_id, chunk_index, total_chunks, data}
 *  - file_chunk_relay    (lo mismo + _from_device_id)
 *  - chunk_ack           {file_id, target_device_id, chunk_index}
 *  - chunk_ack_relay     (relay del anterior)
 *  - clipboard_update / clipboard_update_relay {text, target_device_id?}
 *
 * Nota sobre direccionamiento: a cada dispositivo se le llama por su
 * "device_id" (permanente, generado una vez y guardado en su localStorage),
 * nunca por su "sid" de socket (que cambia cada vez que se reconecta). Esto
 * es lo que permite retomar una transferencia despues de que el WiFi se
 * corte un momento.
 */

const CHUNK_SIZE = 64 * 1024; // 64KB por fragmento
const PREVIEW_MAX_DIM = 320;

// Transferencias salientes activas: file_id -> { file, chunkIndex, totalChunks, targetDeviceId, onProgress, onDone }
const outgoing = {};
// Transferencias entrantes activas: file_id -> { chunks, received, total, filename, mimetype, fromDeviceId, onProgress, onComplete }
const incoming = {};

function makeFileId() {
  return "f_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function escapeHtml(s) {
  if (!s) return "";
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

if (typeof window !== "undefined") {
  window.escapeHtml = escapeHtml;
}


/* =========================================================================
 * VISTA PREVIA (imagenes / video) antes de aceptar
 * ====================================================================== */

/**
 * Genera una miniatura pequena (data URL jpeg) de una imagen o video.
 * Devuelve null si el archivo no es previsualizable o algo falla.
 */
function generatePreview(file) {
  return new Promise((resolve) => {
    if (!file || !file.type) return resolve(null);

    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve(drawToJpegDataUrl(img, img.width, img.height));
        URL.revokeObjectURL(url);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } else if (file.type.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "metadata";
      video.src = url;
      const cleanup = () => URL.revokeObjectURL(url);
      video.onloadeddata = () => {
        try {
          video.currentTime = Math.min(1, (video.duration || 1) * 0.1);
        } catch {
          resolve(null);
          cleanup();
        }
      };
      video.onseeked = () => {
        resolve(drawToJpegDataUrl(video, video.videoWidth, video.videoHeight));
        cleanup();
      };
      video.onerror = () => { cleanup(); resolve(null); };
      // Si tarda demasiado (formato no soportado, etc.), no bloqueamos el envio
      setTimeout(() => resolve(null), 4000);
    } else {
      resolve(null);
    }
  });
}

function drawToJpegDataUrl(source, width, height) {
  if (!width || !height) return null;
  const scale = Math.min(1, PREVIEW_MAX_DIM / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

/* =========================================================================
 * EMPAQUETADO EN ZIP (varios archivos o una carpeta -> un solo envio)
 * ====================================================================== */

/**
 * Si se pasa mas de un archivo (o vienen con ruta de carpeta), los junta en
 * un .zip en memoria (sin compresion, solo empaquetado: es mas rapido y no
 * exige tanta RAM del navegador, y ademas la mayoria de fotos/videos ya
 * vienen comprimidos, asi que comprimirlos de nuevo no ahorra espacio).
 *
 * Un solo archivo, por pesado que sea, se manda directo sin empaquetar: la
 * transferencia por fragmentos ya soporta archivos grandes sin problema, y
 * evita cargar el archivo completo en memoria para comprimirlo.
 *
 * Recibe una lista de { file, relativePath } y regresa una Promise que
 * resuelve a { file: File, isBundle: bool, count: number }.
 */
async function packageForSending(items, onProgress) {
  if (items.length === 1) {
    return { file: items[0].file, isBundle: false, count: 1 };
  }
  const zip = new JSZip();
  for (const { file, relativePath } of items) {
    zip.file(relativePath || file.name, file);
  }
  const blob = await zip.generateAsync(
    { type: "blob", compression: "STORE" },
    (meta) => {
      if (typeof onProgress === "function") {
        onProgress(Math.round(meta.percent || 0));
      }
    }
  );
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const zipFile = new File([blob], `envio-${stamp}.zip`, { type: "application/zip" });
  return { file: zipFile, isBundle: true, count: items.length };
}

/** Convierte un FileList/array plano de <input multiple> a la forma {file, relativePath}. */
function filesToItems(fileList) {
  return Array.from(fileList).map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
  }));
}

/**
 * Recorre recursivamente los items soltados en un drag&drop (soporta carpetas
 * en navegadores basados en Chromium/Firefox via la API de entries; si no
 * esta disponible, cae de vuelta a la lista plana de archivos).
 */
function itemsFromDataTransfer(dataTransfer) {
  const items = dataTransfer.items;
  if (!items || !items[0] || typeof items[0].webkitGetAsEntry !== "function") {
    return Promise.resolve(filesToItems(dataTransfer.files));
  }

  const entries = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return Promise.resolve(filesToItems(dataTransfer.files));

  const results = [];
  function readEntry(entry, path) {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file((file) => {
          results.push({ file, relativePath: path + file.name });
          resolve();
        }, () => resolve());
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const readBatch = () => {
          reader.readEntries((batch) => {
            if (batch.length === 0) return resolve();
            Promise.all(batch.map((child) => readEntry(child, path + entry.name + "/"))).then(readBatch);
          }, () => resolve());
        };
        readBatch();
      } else {
        resolve();
      }
    });
  }

  return Promise.all(entries.map((e) => readEntry(e, ""))).then(() => results);
}

/* =========================================================================
 * ENVIO
 * ====================================================================== */

/**
 * Ofrece un archivo a un dispositivo especifico (por device_id). No empieza
 * a mandar datos hasta que el receptor responda con "aceptar".
 */
function offerFile(socket, file, { targetDeviceId, fromDeviceId, fromDeviceName, preview, isBundle, bundleCount, onProgress, onDone, onRejected }) {
  const fileId = makeFileId();
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  outgoing[fileId] = {
    file,
    chunkIndex: 0,
    totalChunks,
    targetDeviceId,
    onProgress,
    onDone,
    onRejected,
    started: false,
  };

  const offerPayload = {
    file_id: fileId,
    transfer_id: fileId,
    target_device_id: targetDeviceId,
    to_device_id: targetDeviceId,
    from_device_id: fromDeviceId || null,
    _from_device_id: fromDeviceId || null,
    from_device_name: fromDeviceName || null,
    _from_device_name: fromDeviceName || null,
    filename: file.name,
    file_name: file.name,
    size: file.size,
    file_size: file.size,
    mimetype: file.type || "application/octet-stream",
    file_type: file.type || "application/octet-stream",
  };
  if (preview) offerPayload.preview = preview;
  if (isBundle) {
    offerPayload.is_bundle = true;
    offerPayload.bundle_count = bundleCount;
  }

  console.log("[P2P] Emitting send_offer to server:", offerPayload);
  socket.emit("send_offer", offerPayload);
  return fileId;
}

function sendNextChunk(socket, fileId) {
  const tx = outgoing[fileId];
  if (!tx) {
    console.warn("[P2P] sendNextChunk: No outgoing transfer found for fileId:", fileId);
    return;
  }
  if (tx.chunkIndex >= tx.totalChunks) {
    console.log("[P2P] All chunks sent successfully for fileId:", fileId);
    if (tx.onDone) tx.onDone();
    delete outgoing[fileId];
    return;
  }
  const start = tx.chunkIndex * CHUNK_SIZE;
  const end = Math.min(start + CHUNK_SIZE, tx.file.size);
  const slice = tx.file.slice(start, end);

  const reader = new FileReader();
  reader.onload = () => {
    const payload = {
      file_id: fileId,
      transfer_id: fileId,
      target_device_id: tx.targetDeviceId,
      to_device_id: tx.targetDeviceId,
      chunk_index: tx.chunkIndex,
      total_chunks: tx.totalChunks,
      data: arrayBufferToBase64(reader.result),
    };
    console.log(`[P2P] Emitting file_chunk: ${tx.chunkIndex + 1}/${tx.totalChunks} (${fileId})`);
    socket.emit("file_chunk", payload);
    if (tx.onProgress) {
      const loadedBytes = Math.min(tx.file.size, (tx.chunkIndex + 1) * CHUNK_SIZE);
      const pct = Math.round(((tx.chunkIndex + 1) / tx.totalChunks) * 100);
      tx.onProgress(pct, loadedBytes, tx.file.size);
    }
  };
  reader.readAsArrayBuffer(slice);
}

function cancelOutgoingTransfer(fileId) {
  if (outgoing[fileId]) {
    delete outgoing[fileId];
    return true;
  }
  return false;
}

function cancelIncomingTransfer(fileId) {
  if (incoming[fileId]) {
    delete incoming[fileId];
    return true;
  }
  return false;
}

/** Debe llamarse cuando llega file_response con accept:true, para iniciar el envio. */
function startSendingAfterAccept(socket, fileId) {
  console.log("[P2P] startSendingAfterAccept triggered for fileId:", fileId);
  const tx = outgoing[fileId];
  if (tx && !tx.started) {
    tx.started = true;
    sendNextChunk(socket, fileId);
  }
}

function handleAckReceived(socket, data) {
  const fileId = data.file_id || data.transfer_id;
  const tx = outgoing[fileId];
  if (!tx) return;
  const ackIndex = Number(data.chunk_index);
  console.log(`[P2P] handleAckReceived: ack chunk ${ackIndex}, current tx.chunkIndex: ${tx.chunkIndex}`);
  if (ackIndex === Number(tx.chunkIndex)) {
    tx.chunkIndex += 1;
    sendNextChunk(socket, fileId);
  }
}

/* =========================================================================
 * RECEPCION
 * ====================================================================== */

/** Registra una transferencia entrante pendiente de recibir fragmentos. */
function prepareIncoming(fileId, { filename, size, mimetype, totalChunks, fromDeviceId, onProgress, onComplete, onDone }) {
  console.log("[P2P] prepareIncoming registered for fileId:", fileId, "chunks:", totalChunks, "from:", fromDeviceId);
  const completeCb = onComplete || onDone;
  incoming[fileId] = {
    chunks: new Array(totalChunks),
    received: 0,
    total: totalChunks,
    filename,
    mimetype,
    size,
    fromDeviceId: fromDeviceId || null,
    onProgress,
    onComplete: completeCb,
    onDone: completeCb,
  };
}

function handleIncomingChunk(socket, data) {
  const fileId = data.file_id || data.transfer_id;
  const rx = incoming[fileId];
  if (!rx) {
    console.warn("[P2P] handleIncomingChunk: unknown incoming transfer for fileId:", fileId);
    return;
  }

  const chunkIdx = Number(data.chunk_index);
  if (data._from_device_id) rx.fromDeviceId = data._from_device_id;
  if (data.from_device_id) rx.fromDeviceId = data.from_device_id;

  if (!rx.chunks[chunkIdx]) {
    rx.chunks[chunkIdx] = base64ToUint8Array(data.data);
    rx.received += 1;
    console.log(`[P2P] Received chunk ${rx.received}/${rx.total} for fileId: ${fileId}`);
  }
  if (rx.onProgress) {
    const totalBytes = Number(rx.size) || 0;
    const loadedBytes = totalBytes > 0
      ? Math.min(totalBytes, rx.received >= rx.total ? totalBytes : rx.received * CHUNK_SIZE)
      : rx.received;
    rx.onProgress(Math.round((rx.received / rx.total) * 100), loadedBytes, totalBytes);
  }

  emitAckFor(socket, rx, fileId, chunkIdx);

  if (rx.received >= rx.total) {
    console.log(`[P2P] All chunks received for ${fileId}, creating Blob.`);
    const blob = new Blob(rx.chunks, { type: rx.mimetype });
    if (rx.onComplete) rx.onComplete(blob, rx.filename);
    delete incoming[fileId];
  }
}

function emitAckFor(socket, rx, fileId, chunkIndex) {
  if (!rx.fromDeviceId) return;
  socket.emit("chunk_ack", {
    file_id: fileId,
    transfer_id: fileId,
    target_device_id: rx.fromDeviceId,
    to_device_id: rx.fromDeviceId,
    chunk_index: Number(chunkIndex),
  });
}

/* =========================================================================
 * REANUDACION AUTOMATICA
 * Se llama cada vez que el socket se (re)conecta. En una reconexion real
 * (tras cortarse el WiFi), retoma justo donde iba cada transferencia activa,
 * en vez de reiniciarla desde cero. Si no hay nada en curso, no hace nada.
 * ====================================================================== */

function resumeActiveTransfers(socket) {
  Object.keys(outgoing).forEach((fileId) => {
    // Volvemos a mandar el fragmento en el que ibamos (el anterior pudo
    // perderse junto con la conexion) y de ahi el flujo normal de acks
    // continua solo.
    sendNextChunk(socket, fileId);
  });

  Object.keys(incoming).forEach((fileId) => {
    const rx = incoming[fileId];
    if (rx.received > 0 && rx.fromDeviceId) {
      // Reconfirmamos el ultimo fragmento recibido, por si el ack original
      // nunca le llego al emisor y se quedo esperando.
      emitAckFor(socket, rx, fileId, rx.received - 1);
    }
  });
}

function hasActiveTransfers() {
  return Object.keys(outgoing).length > 0 || Object.keys(incoming).length > 0;
}

/* =========================================================================
 * UTILIDADES VARIAS
 * ====================================================================== */

function triggerBrowserDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function isPreviewable(mimetype) {
  return mimetype && (mimetype.startsWith("image/") || mimetype.startsWith("video/"));
}

/* =========================================================================
 * PORTAPAPELES COMPARTIDO
 * Usa la Clipboard API del navegador (que lee/escribe el portapapeles real
 * del sistema operativo, no solo de la pagina). Requiere contexto seguro
 * (localhost o HTTPS) y, la primera vez, permiso del usuario.
 * ====================================================================== */

/** Lee el portapapeles del sistema. Devuelve "" si no hay permiso o falla. */
async function readSystemClipboard() {
  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) return "";
    return (await navigator.clipboard.readText()) || "";
  } catch {
    return "";
  }
}

/** Escribe en el portapapeles del sistema. Devuelve true/false segun exito. */
async function writeSystemClipboard(text) {
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* =========================================================================
 * BUZON: subida por HTTP normal (no por WebSocket) para que un archivo se
 * quede guardado en el servidor y se pueda descargar despues, sin que el
 * que lo manda ni el que lo recibe tengan que estar conectados los dos al
 * mismo tiempo. Se borra solo despues de un tiempo (ver server.py).
 * ====================================================================== */

/**
 * Sube un archivo al buzon del servidor. Devuelve el objeto XMLHttpRequest
 * por si se necesita cancelar la subida.
 */
function uploadToBuzon(file, { targetDeviceId, fromDeviceId, fromDeviceName, isBundle, bundleCount, onProgress, onUploadSent, onDone, onError, onAbort }) {
  const xhr = new XMLHttpRequest();
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("target_device_id", targetDeviceId || "todos");
  form.append("from_device_id", fromDeviceId || "");
  form.append("from_device_name", fromDeviceName || "Dispositivo");
  if (isBundle) {
    form.append("is_bundle", "1");
    form.append("bundle_count", String(bundleCount || 1));
  }

  xhr.open("POST", "/api/buzon/enviar");
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable && onProgress) {
      onProgress(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
    }
  };
  xhr.upload.onload = () => {
    if (onUploadSent) onUploadSent();
  };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* respuesta no era JSON */ }
      if (onDone) onDone(data);
    } else if (onError) {
      let errData = null;
      try { errData = JSON.parse(xhr.responseText); } catch { /* no json */ }
      onError(xhr.status, errData ? errData.error : null);
    }
  };
  xhr.onabort = () => { if (onAbort) onAbort(); };
  xhr.onerror = () => { if (onError) onError(0, "Error de red al conectar con el servidor."); };
  xhr.send(form);
  return xhr;
}

/** Trae la lista de lo que espera en el buzon para este dispositivo. */
async function fetchBuzonList(deviceId) {
  try {
    const res = await fetch("/api/buzon/lista?device_id=" + encodeURIComponent(deviceId));
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function deleteBuzonItem(itemId) {
  try {
    const res = await fetch("/api/buzon/borrar/" + encodeURIComponent(itemId), { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Texto corto tipo "expira en 3 h" a partir del timestamp unix de expiracion. */
function formatExpiry(expiresAtSeconds) {
  const msLeft = expiresAtSeconds * 1000 - Date.now();
  if (msLeft <= 0) return "a punto de vencer";
  const hours = msLeft / 3600000;
  if (hours < 1) return `expira en ${Math.max(1, Math.round(msLeft / 60000))} min`;
  if (hours < 48) return `expira en ${Math.round(hours)} h`;
  return `expira en ${Math.round(hours / 24)} días`;
}

// --- S3 Cloud Storage Functions -----------------------------------------------

/**
 * Sube un archivo directamente a S3 dentro del prefijo y subcarpeta del usuario.
 * Devuelve el objeto XMLHttpRequest por si se necesita cancelar la subida.
 */
function uploadToS3(file, { folder, userId, isBundle, bundleCount, onProgress, onUploadSent, onDone, onError, onAbort } = {}) {
  const xhr = new XMLHttpRequest();
  const form = new FormData();
  form.append("file", file, file.name);
  const targetFolder = (typeof folder === "string" ? folder : (typeof s3CurrentFolder !== "undefined" ? s3CurrentFolder : "")).trim();
  if (targetFolder) form.append("folder", targetFolder);
  const targetUserId = userId || (typeof myUserId !== "undefined" && myUserId ? myUserId : (typeof window !== "undefined" && window.myUserId ? window.myUserId : ""));
  if (targetUserId) form.append("user_id", targetUserId);
  if (isBundle) {
    form.append("is_bundle", "1");
    form.append("bundle_count", String(bundleCount || 1));
  }

  xhr.open("POST", "/api/s3/upload");
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable && onProgress) {
      onProgress(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
    }
  };
  xhr.upload.onload = () => {
    if (onUploadSent) onUploadSent();
  };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* no json */ }
      if (onDone) onDone(data);
    } else {
      let errData = null;
      try { errData = JSON.parse(xhr.responseText); } catch { /* no json */ }
      if (onError) onError(xhr.status, errData ? errData.error : null);
    }
  };
  xhr.onabort = () => { if (onAbort) onAbort(); };
  xhr.onerror = () => { if (onError) onError(0, "Error de red al conectar con el servidor."); };
  xhr.send(form);
  return xhr;
}

const MAX_MEMORY_DOWNLOAD_BYTES = 300 * 1024 * 1024; // 300 MB RAM guard

function triggerDirectUrlDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Descarga un archivo HTTP (S3 o Buzón) mostrando progreso en tiempo real en TransferUI.
 * Si el archivo supera maxMemoryBytes (300 MB) o el navegador no soporta streams,
 * cae automáticamente a descarga nativa del navegador para proteger la RAM.
 */
async function downloadFileWithProgress({
  url,
  filename = "archivo",
  expectedSize = 0,
  channel = "S3",
  maxMemoryBytes = MAX_MEMORY_DOWNLOAD_BYTES,
  toast: toastFn,
  onComplete,
} = {}) {
  const notify = toastFn || (typeof window.showToast === "function" ? window.showToast : () => {});
  const ui = typeof window !== "undefined" ? window.TransferUI : null;

  if (expectedSize && Number(expectedSize) > maxMemoryBytes) {
    notify("Archivo grande (>300 MB): descargando directamente desde el navegador…", "info");
    triggerDirectUrlDownload(url, filename);
    return;
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let userCancelled = false;
  let txId = null;

  if (ui) {
    txId = ui.createTransfer({
      filename,
      totalBytes: Number(expectedSize) || 0,
      direction: "down",
      channel,
      phase: "transferring",
      statusText: "Iniciando descarga…",
      onCancel: () => {
        userCancelled = true;
        if (controller) controller.abort();
      },
    });
  }

  try {
    const res = await fetch(url, {
      credentials: "same-origin",
      signal: controller ? controller.signal : undefined,
    });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j && j.error) errMsg = j.error;
      } catch { /* ignore */ }
      throw new Error(errMsg);
    }

    const clHeader = res.headers.get("Content-Length");
    const total = clHeader ? parseInt(clHeader, 10) : (Number(expectedSize) || 0);
    const contentType = res.headers.get("Content-Type") || "application/octet-stream";

    if (total > maxMemoryBytes) {
      if (controller) controller.abort();
      if (ui && txId) ui.removeTransfer(txId);
      notify("Archivo grande (>300 MB): descargando directamente desde el navegador…", "info");
      triggerDirectUrlDownload(url, filename);
      return;
    }

    if (!res.body || typeof res.body.getReader !== "function") {
      if (ui && txId) ui.setPhase(txId, "processing", "Descargando archivo…");
      const blob = await res.blob();
      triggerBrowserDownload(blob, filename);
      if (ui && txId) ui.completeTransfer(txId);
      notify(`📥 "${filename}" descargado.`, "success");
      if (typeof onComplete === "function") onComplete();
      return;
    }

    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        if (received > maxMemoryBytes) {
          if (controller) controller.abort();
          if (ui && txId) ui.removeTransfer(txId);
          notify("Descarga >300 MB: cambiando a descarga nativa del navegador…", "info");
          triggerDirectUrlDownload(url, filename);
          return;
        }
        if (ui && txId) {
          if (total > 0) {
            ui.updateProgress(txId, received, total);
          } else {
            ui.setPhase(txId, "processing", `Descargando… ${formatBytes(received)}`);
          }
        }
      }
    }

    const blob = new Blob(chunks, { type: contentType });
    triggerBrowserDownload(blob, filename);
    if (ui && txId) {
      ui.completeTransfer(txId, { message: "Descargado" });
    }
    notify(`📥 "${filename}" descargado.`, "success");
    if (typeof onComplete === "function") onComplete();
  } catch (err) {
    if (userCancelled || (err && err.name === "AbortError")) {
      return;
    }
    if (ui && txId) {
      ui.failTransfer(txId, err.message || "Error al descargar");
    }
    notify(`Error al descargar "${filename}": ${err.message || "falló la conexión"}`, "error");
  }
}

/** Consulta el estado del servicio S3. */
async function fetchS3Status(userId) {
  try {
    const url = userId ? `/api/s3/status?user_id=${encodeURIComponent(userId)}` : "/api/s3/status";
    const res = await fetch(url);
    if (!res.ok) return { ok: false, enabled: false, connected: false };
    return await res.json();
  } catch {
    return { ok: false, enabled: false, connected: false };
  }
}

/** Trae la lista de carpetas y archivos dentro del prefijo/carpeta del usuario en S3. */
async function fetchS3Files(folder, userId) {
  try {
    let url = "/api/s3/files?";
    const params = [];
    if (folder) params.push("folder=" + encodeURIComponent(folder));
    if (userId) params.push("user_id=" + encodeURIComponent(userId));
    url += params.join("&");
    const res = await fetch(url);
    if (!res.ok) return { ok: false, folders: [], files: [] };
    return await res.json();
  } catch {
    return { ok: false, folders: [], files: [] };
  }
}

/** Crea una subcarpeta virtual en S3. */
async function createS3Folder(folderPath, userId) {
  const clean = (folderPath || "").toString().trim();
  if (!clean) return { ok: false, error: "El nombre de la carpeta es requerido." };
  try {
    const res = await fetch("/api/s3/folders/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: clean, user_id: userId }),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Elimina una subcarpeta virtual y su contenido en S3. */
async function deleteS3Folder(folderPath, userId) {
  const clean = (folderPath || "").toString().trim();
  if (!clean) return { ok: false, error: "La ruta de la carpeta es requerida." };
  try {
    const res = await fetch("/api/s3/folders/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: clean, user_id: userId }),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Elimina un archivo en S3. */
async function deleteS3File(key, userId) {
  try {
    const res = await fetch("/api/s3/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, user_id: userId }),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Obtiene una URL prefirmada para compartir. */
async function getS3ShareUrl(key, expiresIn, userId) {
  try {
    const url = `/api/s3/share/${encodeURIComponent(key)}?expires_in=${expiresIn || 3600}&user_id=${encodeURIComponent(userId || "")}`;
    const res = await fetch(url);
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   S3 CLOUD EXPLORER CONTROLLER
   ══════════════════════════════════════════════════════════════════════════ */

function getFileCategoryIcon(filename, mimetype) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const mime = mimetype || "";

  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return "🖼️";
  if (mime.startsWith("video/") || ["mp4", "mkv", "webm", "avi", "mov"].includes(ext)) return "🎬";
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "flac", "m4a", "aac"].includes(ext)) return "🎵";
  if (["zip", "tar", "gz", "7z", "rar", "bz2"].includes(ext)) return "📦";
  if (["pdf"].includes(ext)) return "📕";
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return "📘";
  if (["xls", "xlsx", "ods", "csv"].includes(ext)) return "📊";
  if (["ppt", "pptx", "odp"].includes(ext)) return "📙";
  if (["txt", "md", "json", "js", "html", "css", "py", "sh", "yaml", "yml", "xml"].includes(ext)) return "📝";
  return "📄";
}

let s3CurrentFolder = "";
let s3CachedFiles = [];
let s3CachedFolders = [];
let s3CurrentStatus = null;

async function loadS3Explorer(options = {}) {
  const getUserId = options.getUserId || (() => {
    if (typeof myUserId !== "undefined" && myUserId) return myUserId;
    if (typeof window !== "undefined" && window.myUserId) return window.myUserId;
    if (typeof getDeviceId === "function") return getDeviceId();
    return "default_user";
  });

  const userId = getUserId();
  const breadcrumbsEl = document.getElementById("s3-breadcrumbs");
  const foldersContainer = document.getElementById("s3-folders-container");
  const filesListEl = document.getElementById("s3-files-list");
  const searchInput = document.getElementById("s3-search-input");
  const prefixBadge = document.getElementById("s3-user-prefix-badge");
  const statsMeta = document.getElementById("s3-stats-meta");

  if (!filesListEl) return;

  // 1. Consultar estado S3
  if (!s3CurrentStatus) {
    s3CurrentStatus = await fetchS3Status(userId);
  }

  if (prefixBadge && s3CurrentStatus && s3CurrentStatus.user_prefix) {
    prefixBadge.textContent = s3CurrentStatus.user_prefix;
  }

  if (!s3CurrentStatus || !s3CurrentStatus.enabled) {
    filesListEl.innerHTML = `
      <div style="padding:20px; text-align:center;">
        <p style="font-size:14px; color:var(--text-muted); margin:0 0 8px 0;">El módulo S3 está desactivado en la configuración del servidor.</p>
        <p class="empty-hint" style="margin:0;">Define <code>ENLACE_S3_ENABLED=1</code> en tu archivo <code>.env</code> para habilitar el almacenamiento en la nube.</p>
      </div>`;
    if (foldersContainer) foldersContainer.style.display = "none";
    return;
  }

  if (!s3CurrentStatus.connected && !s3CurrentStatus.configured) {
    filesListEl.innerHTML = `
      <div style="padding:20px; text-align:center;">
        <p style="font-size:14px; color:var(--danger); margin:0 0 8px 0;">⚠️ No se pudo conectar al bucket S3.</p>
        <p class="empty-hint" style="margin:0;">${escapeHtml(s3CurrentStatus.error || "Revisa tus credenciales en el archivo .env")}</p>
      </div>`;
    if (foldersContainer) foldersContainer.style.display = "none";
    return;
  }

  // 2. Renderizar migas de pan (Breadcrumbs)
  renderS3Breadcrumbs(breadcrumbsEl, options);

  // 3. Cargar archivos y subcarpetas (Skeleton Loader)
  filesListEl.innerHTML = `
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
  `;
  const res = await fetchS3Files(s3CurrentFolder, userId);

  if (!res.ok) {
    filesListEl.innerHTML = `<p class="empty-hint" style="color:var(--danger);">Error al cargar archivos: ${escapeHtml(res.error || "desconocido")}</p>`;
    return;
  }

  s3CachedFolders = res.folders || [];
  s3CachedFiles = res.files || [];

  if (statsMeta) {
    statsMeta.textContent = `${res.total_files || s3CachedFiles.length} archivos · ${formatBytes(res.total_size || 0)}`;
  }

  renderS3Content(searchInput ? searchInput.value : "", options);
}

function renderS3Breadcrumbs(container, options = {}) {
  if (!container) return;
  container.innerHTML = "";

  const rootCrumb = document.createElement("span");
  rootCrumb.className = "s3-crumb" + (s3CurrentFolder === "" ? " active" : "");
  rootCrumb.innerHTML = "🏠 Inicio";
  rootCrumb.onclick = () => {
    if (s3CurrentFolder !== "") {
      s3CurrentFolder = "";
      if (typeof window !== "undefined") window.s3CurrentFolder = "";
      updateActiveTargetFolder();
      loadS3Explorer(options);
    }
  };
  container.appendChild(rootCrumb);

  if (!s3CurrentFolder) return;

  const parts = s3CurrentFolder.replace(/\/+$/, "").split("/").filter(Boolean);
  let accumulated = "";

  parts.forEach((part, idx) => {
    accumulated += (accumulated ? "/" : "") + part;
    const currentAcc = accumulated;

    const sep = document.createElement("span");
    sep.className = "s3-crumb-sep";
    sep.textContent = "/";
    container.appendChild(sep);

    const isLast = idx === parts.length - 1;
    const crumb = document.createElement("span");
    crumb.className = "s3-crumb" + (isLast ? " active" : "");
    crumb.textContent = part;
    if (!isLast) {
      crumb.onclick = () => {
        s3CurrentFolder = currentAcc;
        if (typeof window !== "undefined") window.s3CurrentFolder = s3CurrentFolder;
        updateActiveTargetFolder();
        loadS3Explorer(options);
      };
    }
    container.appendChild(crumb);
  });
}

function updateActiveTargetFolder() {
  if (typeof currentS3Folder !== "undefined") {
    currentS3Folder = s3CurrentFolder;
  }
  if (typeof window !== "undefined") {
    window.s3CurrentFolder = s3CurrentFolder;
    if (typeof window.updateTargetHint === "function") {
      window.updateTargetHint();
    }
  }
  const folderEl = document.getElementById("s3-current-target-folder");
  if (folderEl) {
    folderEl.textContent = s3CurrentFolder ? `/${s3CurrentFolder}` : "(raíz)";
  }
}

async function confirmDialog(opts) {
  if (typeof window !== "undefined" && window.AppDialog && typeof window.AppDialog.confirm === "function") {
    return window.AppDialog.confirm(opts);
  }
  return window.confirm(opts.message || opts.title || "¿Continuar?");
}

async function promptDialog(opts) {
  if (typeof window !== "undefined" && window.AppDialog && typeof window.AppDialog.prompt === "function") {
    return window.AppDialog.prompt(opts);
  }
  return window.prompt(opts.message || opts.title || "", opts.defaultValue || "");
}

async function openS3ShareModal(file, userId, showToast) {
  const modal = document.getElementById("s3-share-modal");
  const urlInput = document.getElementById("input-share-url");
  const expirySelect = document.getElementById("share-expiry-select");
  const expiryMeta = document.getElementById("share-expiry-meta");
  const copyBtn = document.getElementById("btn-copy-share-url");
  const closeBtn = document.getElementById("btn-close-share-modal");

  if (!modal || !urlInput) {
    const shareData = await getS3ShareUrl(file.key, 3600, userId);
    if (shareData.ok && shareData.url) {
      try {
        await navigator.clipboard.writeText(shareData.url);
        showToast("Enlace temporal copiado al portapapeles (expira en 1 hora).");
      } catch {
        await promptDialog({ title: "Compartir enlace", message: "Copia este enlace temporal:", defaultValue: shareData.url });
      }
    } else {
      showToast(shareData.error || "No se pudo generar el enlace.", true);
    }
    return;
  }

  const refreshShareLink = async () => {
    const ttl = expirySelect ? Number(expirySelect.value || 86400) : 86400;
    urlInput.value = "Generando enlace…";
    const shareData = await getS3ShareUrl(file.key, ttl, userId);
    if (shareData.ok && shareData.url) {
      urlInput.value = shareData.url;
      if (expiryMeta) {
        const label = ttl === 3600 ? "1 hora" : ttl === 604800 ? "7 días" : "24 horas";
        expiryMeta.textContent = `Válido durante ${label} · Archivo: ${file.name || file.filename || "archivo"}`;
      }
    } else {
      urlInput.value = "";
      showToast(shareData.error || "No se pudo generar el enlace.", true);
    }
  };

  if (expirySelect) {
    expirySelect.onchange = refreshShareLink;
  }
  if (copyBtn) {
    copyBtn.onclick = async () => {
      if (!urlInput.value) return;
      try {
        await navigator.clipboard.writeText(urlInput.value);
        showToast("Enlace temporal copiado al portapapeles.", "success");
      } catch {
        urlInput.select();
        document.execCommand("copy");
        showToast("Enlace copiado.", "success");
      }
    };
  }
  if (closeBtn) {
    closeBtn.onclick = () => { modal.style.display = "none"; };
  }
  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = "none";
  };

  modal.style.display = "flex";
  await refreshShareLink();
}

function renderS3Content(filterQuery = "", options = {}) {
  const foldersContainer = document.getElementById("s3-folders-container");
  const foldersListEl = document.getElementById("s3-folders-list");
  const filesListEl = document.getElementById("s3-files-list");
  const getUserId = options.getUserId || (() => {
    if (typeof myUserId !== "undefined" && myUserId) return myUserId;
    if (typeof window !== "undefined" && window.myUserId) return window.myUserId;
    if (typeof getDeviceId === "function") return getDeviceId();
    return "default_user";
  });
  const userId = getUserId();
  const showToast = options.toast || (typeof toast === "function" ? toast : console.log);

  const q = (filterQuery || "").trim().toLowerCase();

  // Carpetas normalizadas (soporta array de strings o array de objetos)
  const normalizedFolders = (s3CachedFolders || []).map((f) => {
    if (typeof f === "string") {
      const name = f.replace(/\/+$/, "");
      const path = s3CurrentFolder ? `${s3CurrentFolder.replace(/\/+$/, "")}/${name}` : name;
      return { name, path };
    }
    const name = f.name || f.path || "";
    const path = f.path || (s3CurrentFolder ? `${s3CurrentFolder.replace(/\/+$/, "")}/${name}` : name);
    return { ...f, name, path };
  });

  const filteredFolders = normalizedFolders.filter((f) => !q || (f.name && f.name.toLowerCase().includes(q)));
  if (foldersContainer && foldersListEl) {
    if (filteredFolders.length > 0) {
      foldersContainer.style.display = "";
      foldersListEl.innerHTML = "";
      filteredFolders.forEach((folder) => {
        const card = document.createElement("div");
        card.className = "s3-folder-card";
        card.innerHTML = `
          <div class="s3-folder-card-info">
            <span style="font-size:18px;">📁</span>
            <span class="s3-folder-card-name">${escapeHtml(folder.name)}</span>
          </div>
          <button class="danger s3-action-btn btn-delete-folder" title="Eliminar carpeta" style="padding:2px 6px;">✕</button>
        `;
        card.onclick = (e) => {
          if (e.target.closest(".btn-delete-folder")) return;
          s3CurrentFolder = folder.path;
          if (typeof window !== "undefined") window.s3CurrentFolder = s3CurrentFolder;
          updateActiveTargetFolder();
          loadS3Explorer(options);
        };
        const delBtn = card.querySelector(".btn-delete-folder");
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          const targetPath = (folder.path || folder.name || "").trim();
          if (!targetPath) {
            showToast("Ruta de carpeta no válida.", true);
            return;
          }
          if (!(await confirmDialog({
            title: "Eliminar carpeta S3",
            message: `¿Eliminar la carpeta "${folder.name}" y todos los archivos dentro de ella en S3?`,
            confirmText: "Eliminar",
            danger: true,
          }))) return;
          const res = await deleteS3Folder(targetPath, userId);
          if (res.ok) {
            showToast(`Carpeta "${folder.name}" eliminada.`);
            loadS3Explorer(options);
          } else {
            showToast(res.error || "No se pudo eliminar la carpeta.", true);
          }
        };
        foldersListEl.appendChild(card);
      });
    } else {
      foldersContainer.style.display = "none";
    }
  }

  // Archivos normalizados
  const normalizedFiles = (s3CachedFiles || []).map((f) => {
    const name = f.name || f.filename || (f.key ? f.key.split("/").pop() : "archivo");
    return {
      ...f,
      name: name,
      filename: f.filename || name,
    };
  });

  const sortSelect = document.getElementById("s3-sort-select");
  const sortMode = sortSelect ? sortSelect.value : "name-asc";
  const filteredFiles = normalizedFiles
    .filter((f) => !q || (f.name && f.name.toLowerCase().includes(q)))
    .sort((a, b) => {
      if (sortMode === "name-desc") return (b.name || "").localeCompare(a.name || "");
      if (sortMode === "size-desc") return (Number(b.size) || 0) - (Number(a.size) || 0);
      if (sortMode === "date-desc") {
        return new Date(b.last_modified || 0).getTime() - new Date(a.last_modified || 0).getTime();
      }
      return (a.name || "").localeCompare(b.name || "");
    });

  if (filesListEl) {
    filesListEl.innerHTML = "";
    if (filteredFiles.length === 0) {
      if (filteredFolders.length === 0) {
        filesListEl.innerHTML = '<p class="empty-hint">Esta carpeta está vacía. Arrastra archivos aquí o pulsa "Subir a S3".</p>';
      }
      return;
    }

    filteredFiles.forEach((file) => {
      const row = document.createElement("div");
      row.className = "s3-file-row";
      const fileName = file.name || file.filename || "archivo";
      const icon = getFileCategoryIcon(fileName, file.mimetype || file.content_type);
      const dateStr = file.last_modified ? new Date(file.last_modified).toLocaleDateString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
      }) : "";

      row.innerHTML = `
        <div class="s3-file-main">
          <div class="s3-file-icon">${icon}</div>
          <div class="s3-file-details">
            <div class="s3-file-name" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</div>
            <div class="s3-file-meta">${formatBytes(file.size)} ${dateStr ? '· ' + dateStr : ''}</div>
          </div>
        </div>
        <div class="s3-actions">
          <button type="button" class="s3-action-btn btn-s3-preview" title="Vista previa">👁️ Ver</button>
          <button type="button" class="s3-action-btn btn-s3-download" title="Descargar con barra de progreso">📥</button>
          <button type="button" class="s3-action-btn btn-s3-share" title="Compartir enlace temporal">🔗</button>
          <button type="button" class="danger s3-action-btn btn-s3-del" title="Eliminar de S3">🗑️</button>
        </div>
      `;

      row.querySelector(".btn-s3-preview").onclick = () => openS3Preview(file, userId);

      row.querySelector(".btn-s3-download").onclick = () => {
        downloadFileWithProgress({
          url: `/api/s3/download/${encodeURIComponent(file.key)}?stream=1&download=1`,
          filename: fileName,
          expectedSize: Number(file.size) || 0,
          channel: "S3",
          toast: showToast,
        });
      };

      row.querySelector(".btn-s3-share").onclick = () => openS3ShareModal(file, userId, showToast);

      row.querySelector(".btn-s3-del").onclick = async () => {
        if (!(await confirmDialog({
          title: "Eliminar archivo S3",
          message: `¿Eliminar "${fileName}" permanentemente de S3?`,
          confirmText: "Eliminar",
          danger: true,
        }))) return;
        const delRes = await deleteS3File(file.key, userId);
        if (delRes.ok) {
          showToast(`Archivo "${fileName}" eliminado de S3.`);
          loadS3Explorer(options);
        } else {
          showToast(delRes.error || "No se pudo eliminar el archivo.", true);
        }
      };

      filesListEl.appendChild(row);
    });
  }
}

async function openS3Preview(file, userId) {
  const modal = document.getElementById("s3-preview-modal");
  const titleEl = document.getElementById("s3-preview-title");
  const bodyEl = document.getElementById("s3-preview-body");
  const metaEl = document.getElementById("s3-preview-meta");
  const dlBtn = document.getElementById("s3-preview-download");
  const shareBtn = document.getElementById("s3-preview-copy-link");
  const closeBtn = document.getElementById("s3-preview-close");
  const showToast = typeof toast === "function" ? toast : console.log;

  if (!modal) return;

  const fileName = file.name || file.filename || "archivo";
  titleEl.textContent = fileName;
  metaEl.textContent = `${formatBytes(file.size)} · ${file.mimetype || file.content_type || "desconocido"}`;
  bodyEl.innerHTML = '<p class="empty-hint">Cargando vista previa...</p>';
  modal.style.display = "flex";

  dlBtn.onclick = () => {
    downloadFileWithProgress({
      url: `/api/s3/download/${encodeURIComponent(file.key)}?stream=1&download=1`,
      filename: fileName,
      expectedSize: Number(file.size) || 0,
      channel: "S3",
      toast: showToast,
    });
  };

  shareBtn.onclick = () => openS3ShareModal(file, userId, showToast);

  closeBtn.onclick = () => { modal.style.display = "none"; };
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

  const mime = (file.mimetype || file.content_type || "").toLowerCase();
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const streamUrl = `/api/s3/download/${encodeURIComponent(file.key)}?stream=1`;

  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) {
    const img = document.createElement("img");
    img.src = streamUrl;
    img.alt = fileName;
    img.onload = () => { bodyEl.innerHTML = ""; bodyEl.appendChild(img); };
    img.onerror = () => { bodyEl.innerHTML = '<p class="empty-hint">No se pudo cargar la imagen.</p>'; };
  } else if (mime.startsWith("video/") || ["mp4", "webm"].includes(ext)) {
    bodyEl.innerHTML = `<video controls autoplay style="max-width:100%; max-height:55vh;"><source src="${streamUrl}" type="${mime}">Tu navegador no soporta video.</video>`;
  } else if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "aac"].includes(ext)) {
    bodyEl.innerHTML = `<audio controls autoplay style="width:100%;"><source src="${streamUrl}" type="${mime}">Tu navegador no soporta audio.</audio>`;
  } else if (["txt", "json", "md", "csv", "log", "py", "js", "html", "css", "yaml", "yml"].includes(ext) || mime.startsWith("text/")) {
    try {
      const res = await fetch(streamUrl);
      if (res.ok) {
        const text = await res.text();
        const pre = document.createElement("pre");
        pre.textContent = text.slice(0, 100000);
        bodyEl.innerHTML = "";
        bodyEl.appendChild(pre);
      } else {
        bodyEl.innerHTML = '<p class="empty-hint">No se pudo leer el contenido del texto.</p>';
      }
    } catch {
      bodyEl.innerHTML = '<p class="empty-hint">Error al cargar vista previa.</p>';
    }
  } else {
    bodyEl.innerHTML = `
      <div style="text-align:center; padding:20px;">
        <span style="font-size:48px;">📄</span>
        <p style="margin:10px 0 0; font-size:13px; color:var(--text-muted);">Vista previa no disponible para este formato.</p>
      </div>`;
  }
}

function setupS3ExplorerEvents(options = {}) {
  const getUserId = options.getUserId || (() => {
    if (typeof myUserId !== "undefined" && myUserId) return myUserId;
    if (typeof window !== "undefined" && window.myUserId) return window.myUserId;
    if (typeof getDeviceId === "function") return getDeviceId();
    return "default_user";
  });
  const showToast = options.toast || (typeof toast === "function" ? toast : console.log);

  const searchInput = document.getElementById("s3-search-input");
  const btnSearchClear = document.getElementById("btn-s3-search-clear");
  const sortSelect = document.getElementById("s3-sort-select");
  const btnRefresh = document.getElementById("btn-s3-refresh");
  const btnNewFolder = document.getElementById("btn-s3-new-folder");
  const btnFolderUpload = document.getElementById("btn-s3-folder-upload");
  const folderInput = document.getElementById("s3-folder-input");
  const s3DropArea = document.getElementById("s3-drop-area");

  const syncClearVisibility = () => {
    if (btnSearchClear && searchInput) {
      btnSearchClear.style.display = searchInput.value ? "inline-flex" : "none";
    }
  };

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      syncClearVisibility();
      renderS3Content(e.target.value, options);
    });
  }

  if (btnSearchClear && searchInput) {
    btnSearchClear.addEventListener("click", () => {
      searchInput.value = "";
      syncClearVisibility();
      renderS3Content("", options);
      searchInput.focus();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      renderS3Content(searchInput ? searchInput.value : "", options);
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener("click", () => {
      s3CurrentStatus = null;
      loadS3Explorer(options);
    });
  }

  if (btnNewFolder) {
    btnNewFolder.addEventListener("click", async () => {
      const name = await promptDialog({
        title: "Nueva carpeta en S3",
        message: "Ingresa el nombre de la carpeta:",
        placeholder: "Ej: Documentos, Fotos 2026",
        confirmText: "Crear carpeta",
      });
      if (!name || !name.trim()) return;
      const cleanName = name.trim().replace(/[\/\\]/g, "");
      if (!cleanName) return;
      const fullPath = s3CurrentFolder ? `${s3CurrentFolder.replace(/\/+$/, "")}/${cleanName}` : cleanName;
      const res = await createS3Folder(fullPath, getUserId());
      if (res.ok) {
        showToast(`Carpeta "${cleanName}" creada.`);
        loadS3Explorer(options);
      } else {
        showToast(res.error || "No se pudo crear la carpeta.", true);
      }
    });
  }

  if (btnFolderUpload && folderInput) {
    btnFolderUpload.addEventListener("click", () => folderInput.click());
    folderInput.addEventListener("change", () => {
      if (folderInput.files.length && typeof window.uploadFilesToS3 === "function") {
        const picked = Array.from(folderInput.files);
        folderInput.value = "";
        window.uploadFilesToS3(picked);
      }
    });
  }

  if (s3DropArea) {
    let dragDepth = 0;
    s3DropArea.addEventListener("dragenter", (e) => {
      e.preventDefault();
      dragDepth += 1;
      s3DropArea.classList.add("drop-active");
    });
    s3DropArea.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    s3DropArea.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) s3DropArea.classList.remove("drop-active");
    });
    s3DropArea.addEventListener("drop", async (e) => {
      e.preventDefault();
      dragDepth = 0;
      s3DropArea.classList.remove("drop-active");
      if (!e.dataTransfer || typeof window.uploadFilesToS3 !== "function") return;
      const items = await itemsFromDataTransfer(e.dataTransfer);
      const files = items.map((i) => i.file).filter(Boolean);
      if (files.length > 0) {
        window.uploadFilesToS3(files);
      }
    });
  }
}

function refreshS3FilesList(options = {}) {
  if (typeof loadS3Explorer === "function") {
    loadS3Explorer(options);
  }
}

// Exportar explícitamente a window para compatibilidad global
if (typeof window !== "undefined") {
  window.offerFile = offerFile;
  window.sendNextChunk = sendNextChunk;
  window.startSendingAfterAccept = startSendingAfterAccept;
  window.handleAckReceived = handleAckReceived;
  window.prepareIncoming = prepareIncoming;
  window.handleIncomingChunk = handleIncomingChunk;
  window.cancelOutgoingTransfer = cancelOutgoingTransfer;
  window.cancelIncomingTransfer = cancelIncomingTransfer;
  window.triggerBrowserDownload = triggerBrowserDownload;
  window.triggerDownload = triggerBrowserDownload;
  window.downloadFileWithProgress = downloadFileWithProgress;
  window.filesToItems = filesToItems;
  window.packageForSending = packageForSending;
  window.resumeActiveTransfers = resumeActiveTransfers;
  window.hasActiveTransfers = hasActiveTransfers;
  window.readSystemClipboard = readSystemClipboard;
  window.writeSystemClipboard = writeSystemClipboard;
  window.uploadToS3 = uploadToS3;
  window.uploadToBuzon = uploadToBuzon;
  window.loadS3Explorer = loadS3Explorer;
  window.setupS3ExplorerEvents = setupS3ExplorerEvents;
  window.refreshS3FilesList = refreshS3FilesList;
  window.fetchS3Files = fetchS3Files;
  window.createS3Folder = createS3Folder;
  window.deleteS3Folder = deleteS3Folder;
  window.deleteS3File = deleteS3File;
  window.itemsFromDataTransfer = itemsFromDataTransfer;
  window.formatBytes = formatBytes;
  window.formatExpiry = formatExpiry;
  window.getS3CurrentFolder = () => s3CurrentFolder;
  window.setS3CurrentFolder = (f) => { s3CurrentFolder = f; };
  Object.defineProperty(window, "s3CurrentFolder", {
    get: () => s3CurrentFolder,
    set: (v) => { s3CurrentFolder = v; },
    configurable: true,
  });
}



