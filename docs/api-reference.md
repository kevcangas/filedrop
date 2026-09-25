# 🔌 Referencia de API y WebSockets

Esta referencia documenta los endpoints HTTP (REST) y los eventos de Socket.IO utilizados por Filedrop / Enlace.

---

## 1. Endpoints HTTP (REST)

> [!NOTE]
> Todos los endpoints protegidos requieren haber iniciado sesión previamente (cookie de sesión `session`).

### Autenticación y Sistema

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `GET / POST` | `/login` | Procesa el formulario de login y establece la cookie de sesión. |
| `GET` | `/logout` | Invalida la sesión actual y redirige a la pantalla de login. |
| `GET` | `/api/info` | Devuelve información del host (IP, puerto, URL pública, estado). |

### Buzón Temporal (Mailbox)

| Método | Ruta | Parámetros | Descripción |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/buzon/enviar` | `file`, `target_device_id`, `from_device_id`, `from_device_name`, `is_bundle` | Sube un archivo o `.zip` al buzón local en el servidor. |
| `GET` | `/api/buzon/lista` | `device_id` (query param) | Devuelve los archivos disponibles para el dispositivo indicado o globales (`"todos"`). |
| `GET` | `/api/buzon/descargar/<item_id>` | `item_id` en URL | Descarga el archivo del buzón como adjunto. |
| `POST` | `/api/buzon/borrar/<item_id>` | `item_id` en URL | Elimina inmediatamente un archivo del buzón local. |

### S3 Cloud Storage API

| Method | Route | Parameters / Payload | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/s3/status` | None | Returns S3 module status (`enabled`, `connected`, `bucket`, `user_prefix`). |
| `POST` | `/api/s3/upload` | Form-data: `file`, `folder` (optional), `is_bundle` | Uploads file to user's root prefix or sub-folder in S3. |
| `GET` | `/api/s3/files` | Query: `folder` (optional), `delimiter` (optional) | Lists immediate folders (`folders`) and files (`files`) within the user's path. |
| `POST` | `/api/s3/folders/create` | JSON: `{ "path": "subfolder/name" }` | Creates a new sub-folder / prefix within user's space. |
| `POST` | `/api/s3/folders/delete` | JSON: `{ "path": "subfolder/name" }` | Recursively deletes a sub-folder and its objects in user's space. |
| `GET` | `/api/s3/download/<path:key>` | S3 key in URL | Downloads object directly or redirects with 302 to presigned GET URL. |
| `GET` | `/api/s3/share/<path:key>` | Query: `expires_in` (seconds) | Returns a temporary presigned shareable download URL. |
| `POST` | `/api/s3/delete` | JSON: `{ "key": "..." }` | Deletes an object from S3 inside the user's prefix. |

---

## 2. Eventos Socket.IO (En Vivo)

Los WebSockets se utilizan para la presencia en tiempo real de dispositivos, transferencias directas P2P por trozos binarios y sincronización de portapapeles.

### Eventos Cliente ➔ Servidor
- `register_device`: Registra el dispositivo actual enviando `{ device_id, device_name, device_type }`.
- `send_offer`: Propone una transferencia en vivo a otro dispositivo `{ target_id, file_id, file_name, file_size, preview }`.
- `file_response`: Respuesta a una oferta recibida `{ file_id, target_id, accepted: true/false }`.
- `file_chunk`: Envío de un trozo binario del archivo `{ file_id, chunk_index, total_chunks, data }`.
- `chunk_ack`: Acuse de recibo de un trozo para controlar el flujo de transmisión y el cálculo de velocidad.
- `clipboard_update`: Notifica al servidor un nuevo texto para el portapapeles compartido `{ text, from_name }`.

### Eventos Servidor ➔ Cliente
- `devices_update`: Lista actualizada de dispositivos conectados actualmente.
- `file_offer`: Notifica al dispositivo receptor que hay un archivo entrante.
- `file_response`: Informa al emisor si su oferta fue aceptada o rechazada.
- `file_chunk`: Entrega un trozo de archivo al receptor.
- `clipboard_update`: Difunde el nuevo contenido del portapapeles a todos los dispositivos conectados.
- `buzon_nuevo`: Notifica que ha llegado un nuevo archivo al buzón para refrescar la lista en vivo.
