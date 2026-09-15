/*
 * Logica compartida de transferencia de archivos y portapapeles por
 * WebSocket (Socket.IO). La usan pc.js y remote.js.
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
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
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
async function packageForSending(items) {
  if (items.length === 1) {
    return { file: items[0].file, isBundle: false, count: 1 };
  }
  const zip = new JSZip();
  for (const { file, relativePath } of items) {
    zip.file(relativePath || file.name, file);
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
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
function offerFile(socket, file, { targetDeviceId, preview, isBundle, bundleCount, onProgress, onDone, onRejected }) {
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
  };

  const offerPayload = {
    file_id: fileId,
    target_device_id: targetDeviceId,
    filename: file.name,
    size: file.size,
    mimetype: file.type || "application/octet-stream",
  };
  if (preview) offerPayload.preview = preview;
  if (isBundle) {
    offerPayload.is_bundle = true;
    offerPayload.bundle_count = bundleCount;
  }

  socket.emit("send_offer", offerPayload);
  return fileId;
}

function sendNextChunk(socket, fileId) {
  const tx = outgoing[fileId];
  if (!tx) return;
  if (tx.chunkIndex >= tx.totalChunks) {
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
      target_device_id: tx.targetDeviceId,
      chunk_index: tx.chunkIndex,
      total_chunks: tx.totalChunks,
      data: arrayBufferToBase64(reader.result),
    };
    socket.emit("file_chunk", payload);
    if (tx.onProgress) {
      tx.onProgress(Math.round(((tx.chunkIndex + 1) / tx.totalChunks) * 100));
    }
    // Esperamos el ack antes de mandar el siguiente fragmento (control de flujo simple)
  };
  reader.readAsArrayBuffer(slice);
}

/** Debe llamarse cuando llega file_response_relay con accept:true, para iniciar el envio. */
function startSendingAfterAccept(socket, fileId) {
  sendNextChunk(socket, fileId);
}

function handleAckReceived(socket, data) {
  const tx = outgoing[data.file_id];
  if (!tx) return;
  if (data.chunk_index === tx.chunkIndex) {
    tx.chunkIndex += 1;
    sendNextChunk(socket, data.file_id);
  }
  // Si el chunk_index no coincide (p. ej. llego un ack duplicado tras una
  // reconexion), simplemente lo ignoramos: sendNextChunk ya se habra
  // encargado de seguir desde donde iba.
}

/* =========================================================================
 * RECEPCION
 * ====================================================================== */

/** Registra una transferencia entrante pendiente de recibir fragmentos. */
function prepareIncoming(fileId, { filename, size, mimetype, totalChunks, fromDeviceId, onProgress, onComplete }) {
  incoming[fileId] = {
    chunks: new Array(totalChunks),
    received: 0,
    total: totalChunks,
    filename,
    mimetype,
    size,
    fromDeviceId: fromDeviceId || null,
    onProgress,
    onComplete,
  };
}

function handleIncomingChunk(socket, data) {
  const rx = incoming[data.file_id];
  if (!rx) return;

  // Guardamos de donde vino, para poder re-confirmar tras una reconexion
  if (data._from_device_id) rx.fromDeviceId = data._from_device_id;

  if (!rx.chunks[data.chunk_index]) {
    rx.chunks[data.chunk_index] = base64ToUint8Array(data.data);
    rx.received += 1;
  }
  if (rx.onProgress) rx.onProgress(Math.round((rx.received / rx.total) * 100));

  emitAckFor(socket, rx, data.file_id, data.chunk_index);

  if (rx.received >= rx.total) {
    const blob = new Blob(rx.chunks, { type: rx.mimetype });
    if (rx.onComplete) rx.onComplete(blob, rx.filename);
    delete incoming[data.file_id];
  }
}

function emitAckFor(socket, rx, fileId, chunkIndex) {
  // La confirmacion vuelve al dispositivo que nos mando el archivo.
  if (!rx.fromDeviceId) return;
  socket.emit("chunk_ack", { file_id: fileId, target_device_id: rx.fromDeviceId, chunk_index: chunkIndex });
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
function uploadToBuzon(file, { targetDeviceId, fromDeviceId, fromDeviceName, isBundle, bundleCount, onProgress, onDone, onError }) {
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
    if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
  };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* respuesta no era JSON */ }
      if (onDone) onDone(data);
    } else if (onError) {
      onError(xhr.status);
    }
  };
  xhr.onerror = () => { if (onError) onError(0); };
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
