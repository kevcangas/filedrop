# 🏛️ Arquitectura del Sistema: Enlace (Filedrop)

**Enlace (Filedrop)** es una plataforma web y PWA para transferencia de archivos de alta velocidad, sincronización segura de portapapeles y almacenamiento en la nube, construida sobre **Flask**, **Flask-SocketIO**, **SQLAlchemy** y **PostgreSQL**.

---

## 1. Visión General de la Topología de Contenedores

```
+-----------------------------------------------------------------------------------+
|                              DISPOSITIVOS CLIENTES                                |
|    (Celulares Android/iOS, Laptops Windows/macOS/Linux - PWA en Navegadores)      |
+-----------------------------------------------------------------------------------+
           │                                            ▲                    ▲
    HTTP / REST (JSON)                             Socket.IO             Presigned S3
 (Auth, Amigos, Buzón, S3)                        (Presencia,            (Descargas
           │                                      Chunks P2P)             Directas)
           ▼                                            ▼                    │
+─────────────────────────────────────────────────────────────────────+      │
|                    CONTENEDOR DE LA APLICACIÓN                      |      │
|                              (enlace)                               |      │
|                                                                     |      │
|   +────────────────────+   +───────────────────+   +────────────+   |      │
|   |  Flask App Factory |   | Presence & Sockets|   | S3 Service |   |      │
|   | (app/api, app/views|   |  (app/sockets)    |   | (boto3 S3) |   |      │
|   +────────────────────+   +───────────────────+   +────────────+   |      │
|              │                        │                   │         |      │
|              ├────────────────────────┴────────┐          │         |      │
|              ▼                                 ▼          │         |      │
|      [ Disco Local ]                    [ Memoria RAM ]   │         |      │
|     (buzon/ con TTL)                   (sid ↔ device_id)  │         |      │
+──────────────│────────────────────────────────────────────│─────────+      │
               │                                            │                │
               ▼                                            ▼                │
+──────────────────────────────+                +──────────────────────+     │
|    CONTENEDOR POSTGRESQL     |                |   BUCKET S3 / CLOUD  |─────┘
|     (enlace_postgres)        |                |  (AWS, MinIO, R2)    |
| (Usuarios, Amigos, Disposit.)|                | users/{user_id}/...  |
+──────────────────────────────+                +──────────────────────+
```

---

## 2. Modelo Relacional de Datos (ERD)

La persistencia de identidades, relaciones de confianza y auditoría reside en PostgreSQL 16:

```
┌─────────────────────────────────┐          1:N          ┌───────────────────────────────────┐
│              users              ├──────────────────────►│              devices              │
├─────────────────────────────────┤                       ├───────────────────────────────────┤
│ id (PK, UUID)                   │                       │ id (PK, UUID)                     │
│ username (VARCHAR(50), UNIQUE)  │                       │ user_id (FK -> users.id, CASCADE) │
│ email (VARCHAR(255), UNIQUE)    │                       │ device_name (VARCHAR(100))        │
│ password_hash (VARCHAR(255))    │                       │ device_type (ENUM: pc, mobile...) │
│ display_name (VARCHAR(100))     │                       │ device_fingerprint (VARCHAR(128)) │
│ is_active (BOOLEAN)             │                       │ last_seen_at (TIMESTAMP WITH TZ)  │
│ created_at / updated_at         │                       │ is_active (BOOLEAN)               │
└────────────────┬────────────────┘                       └───────────────────────────────────┘
                 │
                 │ 1:N (requester_id / addressee_id)
                 ▼
┌────────────────────────────────────────────────────────┐
│                      friendships                       │
├────────────────────────────────────────────────────────┤
│ id (PK, UUID)                                          │
│ requester_id (FK -> users.id, CASCADE)                 │
│ addressee_id (FK -> users.id, CASCADE)                 │
│ status (ENUM: PENDING, ACCEPTED, DECLINED, BLOCKED)    │
│ created_at / updated_at (TIMESTAMP WITH TIME ZONE)     │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│                     mailbox_items                      │
├────────────────────────────────────────────────────────┤
│ id (PK, UUID)                                          │
│ sender_user_id (FK -> users.id, SET NULL)              │
│ recipient_user_id (FK -> users.id, CASCADE)            │
│ storage_type (ENUM: LOCAL, S3)                         │
│ file_name (VARCHAR(255))                               │
│ file_path (VARCHAR(500))                               │
│ file_size (BIGINT)                                     │
│ expires_at (TIMESTAMP WITH TIME ZONE)                  │
│ is_downloaded (BOOLEAN)                                │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│                     transfer_logs                      │
├────────────────────────────────────────────────────────┤
│ id (PK, UUID)                                          │
│ sender_device_id (FK -> devices.id, SET NULL)          │
│ receiver_device_id (FK -> devices.id, SET NULL)        │
│ channel (ENUM: P2P_STREAM, MAILBOX, S3_SHARE)          │
│ file_name (VARCHAR(255))                               │
│ file_size (BIGINT)                                     │
│ status (ENUM: COMPLETED, CANCELLED, FAILED)            │
│ created_at (TIMESTAMP WITH TIME ZONE)                  │
└────────────────────────────────────────────────────────┘
```

---

## 3. Matriz de Control de Acceso y Límites de Confianza (ACL)

El enrutamiento de presencia, ofertas de transferencia, portapapeles y mensajes se rige por la siguiente matriz:

| Relación entre Dispositivos | Descubrimiento en Lista | Oferta de Transferencia Directa | Sincronización de Portapapeles | Buzón Privado |
| :--- | :--- | :--- | :--- | :--- |
| **Dispositivos Propios** (mismo `user_id`) | **Instantáneo** | Permitido (auto-aceptación opcional) | **Automática Bidireccional** | Envío Directo |
| **Amigos Aceptados** (`status == ACCEPTED`) | **Visible** | Requiere consentimiento interactivo | Envío explícito | Envío Directo |
| **Solicitud Pendiente** (`PENDING`) | **Oculto** | **Bloqueado (403)** | **Bloqueado** | Bloqueado |
| **Bloqueado / No Conectado** (`BLOCKED`) | **Oculto** | **Bloqueado (403)** | **Bloqueado** | Bloqueado |

---

## 4. Particionamiento de Salas WebSocket (Socket.IO)

Para garantizar aislamiento sin sobrecargar la base de datos con consultas por cada fragmento (*chunk*):

1. **Sala de Usuario (`user_{user_id}`)**:
   - Se une automáticamente al autenticarse.
   - Recibe notificaciones de cuenta (nuevas solicitudes de amistad, eventos de seguridad, alertas).
2. **Sala de Dispositivo (`dev_{device_id}`)**:
   - Se une cuando el dispositivo físico conecta su socket.
   - Canal punto a punto directo para eventos de transferencia: `send_offer`, `file_response`, `file_chunk`, `chunk_ack`.
3. **Registro de Presencia Híbrido (`PresenceService`)**:
   - Las conexiones activas residen en memoria RAM (`_device_to_sid`) para conmutación sub-milisegundo.
   - Los latidos periódicos (*heartbeats*) actualizan `last_seen_at` en PostgreSQL de manera asíncrona y espaciada (máximo una vez cada 60s por dispositivo).

---

## 5. Canales de Transferencia y Aislamiento Multi-Inquilino

### Canal 1: Streaming Binario en Vivo (P2P sobre WebSockets)
- Diseñado para transferencias inmediatas entre pantallas activas.
- El servidor actúa como conmutador de memoria RAM en tiempo real sin escribir en disco.
- **Validación ACL**: El servidor verifica la relación de amistad antes de admitir cualquier evento `send_offer`.

### Canal 2: Buzón de Servidor Asíncrono (`buzon/` con TTL)
- Almacenamiento temporal para descarga posterior.
- **Aislamiento en Disco**: Cada archivo se almacena bajo `buzon/{recipient_user_id}/{item_id}__{sanitized_filename}`.
- **Control de Acceso**: La API solo expone archivos donde `recipient_user_id == current_user.id` o `sender_user_id == current_user.id`.
- **Limpieza Automática**: Un hilo daemon en segundo plano (`MailboxService.start_cleanup_loop`) purga los registros expirados y elimina los archivos físicos en disco.

### Canal 3: Almacenamiento en la Nube S3 Multi-Inquilino
- Almacenamiento definitivo compatible con AWS S3, Cloudflare R2 y MinIO.
- **Prefijo Aislado por Usuario**:
  ```
  users/{user_id}/devices/{device_id}/{uuid}_{filename}
  ```
- Todas las URLs prefirmadas de descarga y subida se validan criptográficamente garantizando que ningún usuario acceda a objetos fuera de su prefijo.
