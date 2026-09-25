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

// --- S3 Cloud Storage Functions -----------------------------------------------

/**
 * Sube un archivo directamente a S3 dentro del prefijo y subcarpeta del usuario.
 * Devuelve el objeto XMLHttpRequest por si se necesita cancelar la subida.
 */
function uploadToS3(file, { folder, userId, isBundle, bundleCount, onProgress, onDone, onError }) {
  const xhr = new XMLHttpRequest();
  const form = new FormData();
  form.append("file", file, file.name);
  if (folder) form.append("folder", folder);
  if (userId) form.append("user_id", userId);
  if (isBundle) {
    form.append("is_bundle", "1");
    form.append("bundle_count", String(bundleCount || 1));
  }

  xhr.open("POST", "/api/s3/upload");
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
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
  xhr.onerror = () => { if (onError) onError(0, "Error de red al conectar con el servidor."); };
  xhr.send(form);
  return xhr;
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
  try {
    const res = await fetch("/api/s3/folders/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: folderPath, user_id: userId }),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Elimina una subcarpeta virtual y su contenido en S3. */
async function deleteS3Folder(folderPath, userId) {
  try {
    const res = await fetch("/api/s3/folders/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: folderPath, user_id: userId }),
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
  const getUserId = options.getUserId || (typeof getDeviceId === "function" ? getDeviceId : () => "default_user");

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

  if (!s3CurrentStatus.connected) {
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

  // 3. Cargar archivos y subcarpetas
  filesListEl.innerHTML = '<p class="empty-hint">Cargando archivos...</p>';
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
      updateActiveTargetFolder();
      loadS3Explorer(options);
    }
  };
  container.appendChild(rootCrumb);

  if (!s3CurrentFolder) return;

  const parts = s3CurrentFolder.replace(/\/$/, "").split("/");
  let accumulated = "";

  parts.forEach((part, idx) => {
    accumulated += part + "/";
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
  const folderEl = document.getElementById("s3-current-target-folder");
  if (folderEl) {
    folderEl.textContent = s3CurrentFolder ? `/${s3CurrentFolder}` : "(raíz)";
  }
}

function renderS3Content(filterQuery = "", options = {}) {
  const foldersContainer = document.getElementById("s3-folders-container");
  const foldersListEl = document.getElementById("s3-folders-list");
  const filesListEl = document.getElementById("s3-files-list");
  const getUserId = options.getUserId || (typeof getDeviceId === "function" ? getDeviceId : () => "default_user");
  const userId = getUserId();
  const showToast = options.toast || (typeof toast === "function" ? toast : console.log);

  const q = (filterQuery || "").trim().toLowerCase();

  // Carpetas
  const filteredFolders = s3CachedFolders.filter(f => !q || f.name.toLowerCase().includes(q));
  if (foldersContainer && foldersListEl) {
    if (filteredFolders.length > 0) {
      foldersContainer.style.display = "";
      foldersListEl.innerHTML = "";
      filteredFolders.forEach(folder => {
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
          if (e.target.classList.contains("btn-delete-folder")) return;
          s3CurrentFolder = folder.path;
          updateActiveTargetFolder();
          loadS3Explorer(options);
        };
        const delBtn = card.querySelector(".btn-delete-folder");
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm(`¿Eliminar la carpeta "${folder.name}" y todos los archivos dentro de ella en S3?`)) return;
          const res = await deleteS3Folder(folder.path, userId);
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

  // Archivos
  const filteredFiles = s3CachedFiles.filter(f => !q || f.name.toLowerCase().includes(q));
  if (filesListEl) {
    filesListEl.innerHTML = "";
    if (filteredFiles.length === 0) {
      if (filteredFolders.length === 0) {
        filesListEl.innerHTML = '<p class="empty-hint">Esta carpeta está vacía. Suelta o sube archivos eligiendo "Almacenar en S3".</p>';
      }
      return;
    }

    filteredFiles.forEach(file => {
      const row = document.createElement("div");
      row.className = "s3-file-row";
      const icon = getFileCategoryIcon(file.name, file.mimetype);
      const dateStr = file.last_modified ? new Date(file.last_modified).toLocaleDateString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
      }) : "";

      row.innerHTML = `
        <div class="s3-file-main">
          <div class="s3-file-icon">${icon}</div>
          <div class="s3-file-details">
            <div class="s3-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
            <div class="s3-file-meta">${formatBytes(file.size)} ${dateStr ? '· ' + dateStr : ''}</div>
          </div>
        </div>
        <div class="s3-actions">
          <button class="s3-action-btn btn-s3-preview" title="Vista previa">👁️ Ver</button>
          <a href="/api/s3/download/${encodeURIComponent(file.key)}?stream=1" download="${escapeHtml(file.name)}" class="s3-action-btn button" style="text-decoration:none; display:inline-flex; align-items:center;" title="Descargar">📥</a>
          <button class="s3-action-btn btn-s3-share" title="Copiar enlace prefirmado">🔗</button>
          <button class="danger s3-action-btn btn-s3-del" title="Eliminar de S3">🗑️</button>
        </div>
      `;

      row.querySelector(".btn-s3-preview").onclick = () => openS3Preview(file, userId);

      row.querySelector(".btn-s3-share").onclick = async () => {
        const shareData = await getS3ShareUrl(file.key, 3600, userId);
        if (shareData.ok && shareData.url) {
          try {
            await navigator.clipboard.writeText(shareData.url);
            showToast("Enlace temporal copiado al portapapeles (expira en 1 hora).");
          } catch {
            prompt("Copia este enlace temporal para compartir:", shareData.url);
          }
        } else {
          showToast(shareData.error || "No se pudo generar el enlace.", true);
        }
      };

      row.querySelector(".btn-s3-del").onclick = async () => {
        if (!confirm(`¿Eliminar "${file.name}" permanentemente de S3?`)) return;
        const delRes = await deleteS3File(file.key, userId);
        if (delRes.ok) {
          showToast(`Archivo "${file.name}" eliminado de S3.`);
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

  titleEl.textContent = file.name;
  metaEl.textContent = `${formatBytes(file.size)} · ${file.mimetype || "desconocido"}`;
  bodyEl.innerHTML = '<p class="empty-hint">Cargando vista previa...</p>';
  modal.style.display = "flex";

  dlBtn.onclick = () => {
    window.location.href = `/api/s3/download/${encodeURIComponent(file.key)}?stream=1`;
  };

  shareBtn.onclick = async () => {
    const shareData = await getS3ShareUrl(file.key, 3600, userId);
    if (shareData.ok && shareData.url) {
      try {
        await navigator.clipboard.writeText(shareData.url);
        showToast("Enlace temporal copiado al portapapeles.");
      } catch {
        prompt("Copia este enlace:", shareData.url);
      }
    }
  };

  closeBtn.onclick = () => { modal.style.display = "none"; };
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

  const mime = (file.mimetype || "").toLowerCase();
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const streamUrl = `/api/s3/download/${encodeURIComponent(file.key)}?stream=1`;

  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) {
    const img = document.createElement("img");
    img.src = streamUrl;
    img.alt = file.name;
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
  const getUserId = options.getUserId || (typeof getDeviceId === "function" ? getDeviceId : () => "default_user");
  const showToast = options.toast || (typeof toast === "function" ? toast : console.log);

  const searchInput = document.getElementById("s3-search-input");
  const btnRefresh = document.getElementById("btn-s3-refresh");
  const btnNewFolder = document.getElementById("btn-s3-new-folder");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      renderS3Content(e.target.value, options);
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
      const name = prompt("Nombre de la nueva carpeta:");
      if (!name || !name.trim()) return;
      const cleanName = name.trim().replace(/[\/\\]/g, "");
      const fullPath = (s3CurrentFolder ? s3CurrentFolder : "") + cleanName;
      const res = await createS3Folder(fullPath, getUserId());
      if (res.ok) {
        showToast(`Carpeta "${cleanName}" creada.`);
        loadS3Explorer(options);
      } else {
        showToast(res.error || "No se pudo crear la carpeta.", true);
      }
    });
  }
}

function refreshS3FilesList(options = {}) {
  if (typeof loadS3Explorer === "function") {
    loadS3Explorer(options);
  }
}


