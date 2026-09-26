# 🔌 Referencia de API y WebSockets

Esta referencia documenta exhaustivamente los endpoints HTTP (REST) y los eventos de Socket.IO utilizados por **Enlace (Filedrop)** tras la refactorización a arquitectura multi-usuario y base de datos relacional PostgreSQL.

---

## 1. Endpoints HTTP (REST)

> [!NOTE]
> Todos los endpoints protegidos requieren haber iniciado sesión previamente y envían/reciben la cookie de sesión firmada `session` (`HttpOnly`, `SameSite=Lax`).

---

### 1.1 Autenticación y Cuentas (`/api/auth/*`)

#### `POST /api/auth/register`
Registra una nueva cuenta de usuario y asocia su dispositivo cliente inicial.

- **Request Body (JSON)**:
  ```json
  {
    "username": "kevin",
    "email": "kevin@ejemplo.com",
    "password": "Password123!",
    "display_name": "Kevin Cangas",
    "device_name": "MacBook Pro",
    "device_type": "pc",
    "device_fingerprint": "a1b2c3d4-..."
  }
  ```
- **Response `201 Created`**:
  ```json
  {
    "ok": true,
    "message": "User registered and device enrolled successfully.",
    "user": {
      "id": "c1f2e3d4-...",
      "username": "kevin",
      "display_name": "Kevin Cangas"
    },
    "device": {
      "id": "d1e2f3a4-...",
      "device_name": "MacBook Pro",
      "device_type": "pc"
    }
  }
  ```
- **Errores**: `400 Bad Request` (validación de nombre de usuario o fortaleza de contraseña), `409 Conflict` (usuario o email ya existente).

#### `POST /api/auth/login`
Inicia sesión en una cuenta existente y vincula o actualiza el dispositivo actual.

- **Request Body (JSON)**:
  ```json
  {
    "username_or_email": "kevin",
    "password": "Password123!",
    "device_name": "iPhone 15",
    "device_type": "mobile",
    "device_fingerprint": "optional-hardware-hash"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "ok": true,
    "message": "Login successful.",
    "user": {
      "id": "c1f2e3d4-...",
      "username": "kevin",
      "email": "kevin@ejemplo.com",
      "display_name": "Kevin Cangas"
    },
    "device": {
      "id": "e5f6a7b8-...",
      "device_name": "iPhone 15",
      "device_type": "mobile"
    }
  }
  ```
- **Errores**: `400 Bad Request`, `401 Unauthorized` (credenciales inválidas o cuenta desactivada).

#### `POST /api/auth/logout`
Invalida la sesión actual en el navegador y limpia las cookies.

- **Response `200 OK`**:
  ```json
  {
    "ok": true,
    "message": "Logged out successfully."
  }
  ```

#### `GET /api/auth/me`
Devuelve el perfil del usuario autenticado y los metadatos de su dispositivo activo en sesión.

- **Response `200 OK`**:
  ```json
  {
    "ok": true,
    "user": {
      "id": "c1f2e3d4-...",
      "username": "kevin",
      "email": "kevin@ejemplo.com",
      "display_name": "Kevin Cangas"
    },
    "device": {
      "id": "e5f6a7b8-...",
      "device_name": "iPhone 15",
      "device_type": "mobile",
      "is_active": true
    }
  }
  ```
- **Errores**: `401 Unauthorized` si no hay sesión activa.

---

### 1.2 Amistades y Confianza (`/api/friends/*`)

El acceso entre dispositivos de distintos usuarios está gobernado por una lista de control de acceso (ACL) mutua.

#### `POST /api/friends/request`
Envía una invitación de amistad a otro usuario registrado por su `username`.

- **Request Body (JSON)**:
  ```json
  {
    "username": "maria"
  }
  ```
- **Response `201 Created`**:
  ```json
  {
    "ok": true,
    "message": "Friend request sent to 'maria'."
  }
  ```
- **Errores**: `400 Bad Request` (invitación a uno mismo), `404 Not Found` (usuario inexistente), `409 Conflict` (ya existe relación o solicitud pendiente).

#### `POST /api/friends/respond`
Acepta, rechaza o bloquea una solicitud de amistad entrante.

- **Request Body (JSON)**:
  ```json
  {
    "request_id": "f1e2d3c4-...",
    "action": "accept"
  }
  ```
  *(Acciones válidas: `"accept"`, `"decline"`, `"block"`).*
- **Response `200 OK`**:
  ```json
  {
    "ok": true,
    "message": "Friend request accepted.",
    "status": "ACCEPTED"
  }
  ```
- **Errores**: `400 Bad Request` (acción inválida), `404 Not Found` (solicitud no encontrada o no dirigida a ti).

#### `GET /api/friends/list`
Obtiene las amistades activas (`ACCEPTED`), las solicitudes pendientes recibidas (`incoming`) y las enviadas (`outgoing`).

- **Response `200 OK`**:
  ```json
  {
    "ok": true,
    "friends": [
      {
        "friendship_id": "f1e2d3c4-...",
        "user_id": "b2c3d4e5-...",
        "username": "maria",
        "display_name": "María G."
      }
    ],
    "pending_incoming": [
      {
        "request_id": "a9b8c7d6-...",
        "from_user_id": "d4e5f6a7-...",
        "from_username": "carlos",
        "created_at": "2026-09-26T12:00:00Z"
      }
    ],
    "pending_outgoing": []
  }
  ```

---

### 1.3 Dispositivos Enlazados (`/api/devices/*`)

#### `GET /api/devices`
Lista todos los dispositivos vinculados a la cuenta del usuario actual.

- **Response `200 OK`**:
  ```json
  {
    "ok": true,
    "current_device_id": "e5f6a7b8-...",
    "devices": [
      {
        "id": "e5f6a7b8-...",
        "device_name": "iPhone 15",
        "device_type": "mobile",
        "last_seen_at": "2026-09-26T14:10:00Z",
        "is_active": true,
        "is_current": true
      }
    ]
  }
  ```

#### `PATCH /api/devices/<device_id>/rename`
Modifica el nombre o alias descriptivo de un dispositivo propio.

- **Request Body (JSON)**:
  ```json
  {
    "device_name": "Laptop Oficina"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "ok": true,
    "message": "Device renamed successfully.",
    "device": { "id": "...", "device_name": "Laptop Oficina" }
  }
  ```

#### `DELETE /api/devices/<device_id>`
Revoca el acceso de un dispositivo. Si el dispositivo revocado es el que está en sesión, se cierra la sesión inmediatamente.

- **Response `200 OK`**:
  ```json
  {
    "ok": true,
    "message": "Device access revoked."
  }
  ```

---

### 1.4 Auditoría y Registros (`/api/logs/*`)

#### `GET /api/logs/transfers`
Devuelve el historial reciente de transferencias de archivos que involucran a cualquiera de los dispositivos del usuario.

- **Query Parameters**: `limit` (entero opcional, por defecto `50`, máx `100`).
- **Response `200 OK`**:
  ```json
  {
    "ok": true,
    "transfers": [
      {
        "id": "t1e2d3c4-...",
        "sender_device_id": "...",
        "receiver_device_id": "...",
        "channel": "P2P_STREAM",
        "file_name": "informe.pdf",
        "file_size": 1048576,
        "status": "COMPLETED",
        "created_at": "2026-09-26T13:45:00Z"
      }
    ]
  }
  ```

#### `GET /api/logs/activity`
Devuelve eventos diagnósticos en memoria y actividad reciente del servidor.

- **Query Parameters**: `limit` (opcional, máx `100`).
- **Response `200 OK`**:
  ```json
  {
    "ok": true,
    "logs": [
      {
        "timestamp": "2026-09-26T14:02:11Z",
        "level": "INFO",
        "message": "Device 'iPhone 15' connected via WebSocket."
      }
    ]
  }
  ```

---

### 1.5 Buzón Temporal (`/api/buzon/*`)

| Método | Ruta | Parámetros | Descripción |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/buzon/enviar` | `file`, `target_device_id`, `from_device_id`, `from_device_name`, `is_bundle` | Sube un archivo o paquete zip al buzón con TTL en servidor. |
| `GET` | `/api/buzon/lista` | `device_id` (query) | Lista archivos disponibles para el dispositivo o globales (`"todos"`). |
| `GET` | `/api/buzon/descargar/<item_id>` | `item_id` en URL | Descarga el archivo del buzón como adjunto binario. |
| `POST` | `/api/buzon/borrar/<item_id>` | `item_id` en URL | Elimina el archivo del buzón antes del vencimiento por TTL. |

---

### 1.6 Almacenamiento S3 (`/api/s3/*`)

| Método | Ruta | Payload / Query | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/s3/status` | Ninguno | Estado del bucket S3 (`enabled`, `connected`, `bucket`, `user_prefix`). |
| `POST` | `/api/s3/upload` | Form-data: `file`, `folder` (opcional), `is_bundle` | Sube archivo a `users/{user_id}/` o a subcarpeta. |
| `GET` | `/api/s3/files` | Query: `folder`, `delimiter` | Lista carpetas y objetos dentro del prefijo aislado del usuario. |
| `POST` | `/api/s3/folders/create` | JSON: `{ "path": "subcarpeta/nombre" }` | Crea subcarpeta virtual en el prefijo del usuario. |
| `POST` | `/api/s3/folders/delete` | JSON: `{ "path": "subcarpeta/nombre" }` | Elimina recursivamente una carpeta y su contenido. |
| `GET` | `/api/s3/download/<path:key>` | Clave S3 en URL | Descarga el objeto o redirige (302) a URL prefirmada GET. |
| `GET` | `/api/s3/share/<path:key>` | Query: `expires_in` (segundos) | Genera URL prefirmada temporal para compartir externamente. |
| `POST` | `/api/s3/delete` | JSON: `{ "key": "..." }` | Borra un objeto de S3 dentro del prefijo del usuario. |

---

## 2. Eventos en Tiempo Real (Socket.IO)

Los WebSockets gestionan presencia instantánea, sincronización de portapapeles y transferencias P2P por trozos binarios con verificación estricta de amistad / propiedad de dispositivo.

### Autenticación en Handshake y Control de Acceso (ACL)
- Al conectarse (`connect`), el middleware valida la cookie de sesión Flask. Si no está autenticado, la conexión es rechazada (`ConnectionRefusedError`).
- Las conexiones se unen a una sala privada de usuario: `user_<user_id>` y a una sala de dispositivo: `device_<device_id>`.
- Cada operación (`send_offer`, `clipboard_update`, `file_chunk`) verifica que el emisor y receptor pertenezcan a la **misma cuenta** o posean una amistad con estado **`ACCEPTED`**. Si no es así, el servidor emite `transfer_error` y descarta el paquete.

### Eventos Cliente ➔ Servidor

| Evento | Carga (Payload) | Descripción |
| :--- | :--- | :--- |
| `register_device` | `{ device_id, device_name, device_type }` | Confirma el registro del dispositivo activo y refresca su `last_seen_at`. |
| `send_offer` | `{ target_id, file_id, file_name, file_size, preview }` | Propone una transferencia en vivo al dispositivo destino (amigo o propio). |
| `file_response` | `{ file_id, target_id, accepted: true/false }` | Responde afirmativa o negativamente a una oferta de archivo entrante. |
| `file_chunk` | `{ file_id, chunk_index, total_chunks, data }` | Envío de trozo binario (ArrayBuffer / Base64) con control de flujo. |
| `chunk_ack` | `{ file_id, chunk_index }` | Acuse de recibo de trozo recibido para cálculo de velocidad y backpressure. |
| `clipboard_update` | `{ text, from_name }` | Difunde texto copiado a los dispositivos propios o amigos conectados. |

### Eventos Servidor ➔ Cliente

| Evento | Carga (Payload) | Descripción |
| :--- | :--- | :--- |
| `session_ready` | `{ user_id, device_id }` | Confirma conexión autenticada lista. |
| `devices_update` | `[ { id, name, type, is_own, owner_name } ]` | Lista en vivo de dispositivos autorizados conectados. |
| `file_offer` | `{ from_id, from_name, file_id, file_name, file_size, preview }` | Notificación modal de archivo entrante con previsualización. |
| `file_response` | `{ file_id, accepted }` | Informa al emisor si su oferta fue aceptada para iniciar la transmisión. |
| `file_chunk` | `{ file_id, chunk_index, total_chunks, data }` | Entrega un trozo del archivo al receptor. |
| `transfer_error` | `{ message }` | Notifica error de autorización (ej. destinatario no es amigo) o fallo en transferencia. |
| `clipboard_update` | `{ text, from_name }` | Sincroniza el portapapeles compartido en vivo. |
| `buzon_nuevo` | `{ item_id, file_name, from_name }` | Alerta para refrescar la lista de archivos en el buzón. |
