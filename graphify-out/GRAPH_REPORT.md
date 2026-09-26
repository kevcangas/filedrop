# Graph Report - filedrop  (2026-09-26)

## Corpus Check
- Corpus is ~31,524 words - fits in a single context window. You may not need a graph.

## Summary
- 329 nodes · 685 edges · 18 communities (15 shown, 3 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 65 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Client Transfer & Storage Engine
- Mobile Client Controller
- Server REST Routes & S3 Helpers
- Socket.IO Vendor Library
- Desktop PC Client Controller
- Server Core Library Imports
- JSZip Compression Library
- Live Streaming & Socket Handlers
- Authentication & Rate Limiting
- Session Gatekeeper & Mailbox API
- Notification & Text Sharing
- Host Discovery & UI Rendering
- Ephemeral Mailbox & TTL Daemon
- Device Presence & Registry
- SMTP Email Daemon & Rotation
- Host Launcher Script
- Client Native Notifications
- PWA Service Worker

## God Nodes (most connected - your core abstractions)
1. `e()` - 16 edges
2. `a()` - 16 edges
3. `s()` - 12 edges
4. `t()` - 12 edges
5. `s()` - 12 edges
6. `get_s3_client()` - 11 edges
7. `n()` - 11 edges
8. `j()` - 11 edges
9. `get_caller_user_id()` - 10 edges
10. `get_user_s3_root()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `u()` --indirect_call--> `a()`  [INFERRED]
  static/jszip.min.js → static/socket.io.min.js
- `n()` --indirect_call--> `a()`  [INFERRED]
  static/jszip.min.js → static/socket.io.min.js
- `n()` --indirect_call--> `t()`  [INFERRED]
  static/jszip.min.js → static/socket.io.min.js
- `s()` --indirect_call--> `e()`  [INFERRED]
  static/jszip.min.js → static/socket.io.min.js
- `s()` --indirect_call--> `t()`  [INFERRED]
  static/jszip.min.js → static/socket.io.min.js

## Import Cycles
- None detected.

## Communities (18 total, 3 thin omitted)

### Community 0 - "Client Transfer & Storage Engine"
Cohesion: 0.07
Nodes (34): arrayBufferToBase64(), base64ToUint8Array(), createS3Folder(), deleteS3File(), deleteS3Folder(), drawToJpegDataUrl(), emitAckFor(), fetchS3Files() (+26 more)

### Community 1 - "Mobile Client Controller"
Cohesion: 0.10
Nodes (42): addTransferRow(), applyIncomingClipboard(), btnQuickConfig, connectTo(), deviceIcon(), devices, directS3Btn, directS3Input (+34 more)

### Community 2 - "Server REST Routes & S3 Helpers"
Cohesion: 0.08
Nodes (44): route, clean_display_name(), email_notif_desactivar(), email_notif_estado(), get_caller_user_id(), get_s3_client(), get_s3_public_client(), get_user_s3_root() (+36 more)

### Community 3 - "Socket.IO Vendor Library"
Cohesion: 0.14
Nodes (29): V(), a(), ae(), c(), Ce(), d(), e(), Ee() (+21 more)

### Community 4 - "Desktop PC Client Controller"
Cohesion: 0.13
Nodes (30): addTransferRow(), applyIncomingClipboard(), btnCopyIp, btnTestS3, deviceIcon(), devices, directS3BtnPc, directS3InputPc (+22 more)

### Community 5 - "Server Core Library Imports"
Cohesion: 0.07
Nodes (25): base64, datetime, dotenv, email_mime_text, flask, flask_socketio, functools, hashlib (+17 more)

### Community 6 - "JSZip Compression Library"
Cohesion: 0.26
Nodes (22): A(), c(), d(), i(), n(), f(), G(), h() (+14 more)

### Community 7 - "Live Streaming & Socket Handlers"
Cohesion: 0.25
Nodes (11): on, chunk_ack(), clipboard_update(), file_chunk(), file_response(), Un dispositivo ofrece un archivo a otro (por device_id)., El destino acepta o rechaza el archivo ofrecido., Reenvia un fragmento binario de un dispositivo a otro. (+3 more)

### Community 8 - "Authentication & Rate Limiting"
Cohesion: 0.20
Nodes (10): _clear_failed_logins(), _client_ip(), _configurar_email_notif(), _first_send(), email_notif_configurar(), login(), _login_locked_seconds_left(), Guarda la config de notificaciones y dispara el primer envío de inmediato. (+2 more)

### Community 9 - "Session Gatekeeper & Mailbox API"
Cohesion: 0.22
Nodes (9): before_request, buzon_enviar(), buzon_lista(), is_logged_in(), on_connect(), public_mailbox_entry(), Sube un archivo (o un .zip ya empaquetado desde el navegador) al buzon., register_device() (+1 more)

### Community 10 - "Notification & Text Sharing"
Cohesion: 0.29
Nodes (8): build_access_message(), compartir_correo(), compartir_texto(), Arma el asunto y el cuerpo del correo con las direcciones y la clave., Da el asunto/cuerpo ya armados, para el boton 'Abrir en mi correo' (que usa el…, Envia el correo directamente desde el servidor (solo si se configuro una cuenta…, send_email(), smtp_configured()

### Community 11 - "Host Discovery & UI Rendering"
Cohesion: 0.29
Nodes (7): api_info(), get_local_ip(), get_public_base_url(), pc_interface(), phone_interface(), Devuelve la URL base pública accesible de FileDrop (respetando Traefik o…, Devuelve la IP que se muestra/usa como direccion de la anfitriona. Si se…

### Community 12 - "Ephemeral Mailbox & TTL Daemon"
Cohesion: 0.29
Nodes (7): buzon_borrar(), buzon_descargar(), find_mailbox_entry(), mailbox_cleanup_loop(), purge_expired_mailbox(), remove_mailbox_entry(), save_mailbox_index()

### Community 13 - "Device Presence & Registry"
Cohesion: 0.33
Nodes (6): broadcast_device_list(), device_entry(), devices_payload_excluding(), on_disconnect(), Lista de dispositivos para mandarle a exclude_sid (nunca se incluye a si…, Manda a cada dispositivo la lista de TODOS los demas (sin incluirse a si mismo).

### Community 14 - "SMTP Email Daemon & Rotation"
Cohesion: 0.33
Nodes (6): _email_notif_daemon(), Manda el correo periódico usando la config guardada en estado., Genera una contrasena nueva si ya paso 'interval_hours' desde la ultima…, Hilo daemon que revisa cada minuto si hay que mandar el correo periódico., _rotar_password_si_toca(), _send_notif_email_with_cfg()

## Knowledge Gaps
- **27 isolated node(s):** `iniciar.sh script`, `NotificationsModule`, `socket`, `devices`, `dz` (+22 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 120 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `e()` connect `Socket.IO Vendor Library` to `JSZip Compression Library`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `a()` connect `Socket.IO Vendor Library` to `JSZip Compression Library`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `_send_notif_email_with_cfg()` connect `SMTP Email Daemon & Rotation` to `Authentication & Rate Limiting`, `Notification & Text Sharing`, `Server Core Library Imports`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `e()` (e.g. with `jszip.min.js` and `s()`) actually correct?**
  _`e()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `a()` (e.g. with `jszip.min.js` and `d()`) actually correct?**
  _`a()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `s()` (e.g. with `f()` and `n()`) actually correct?**
  _`s()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `t()` (e.g. with `i()` and `n()`) actually correct?**
  _`t()` has 8 INFERRED edges - model-reasoned connections that need verification._