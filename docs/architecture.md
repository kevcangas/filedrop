# 🏛️ Arquitectura del Sistema

Filedrop / Enlace es una plataforma web ligera construida con **Flask** y **Flask-SocketIO** para la transferencia de archivos, compartición de portapapeles y notificaciones entre dispositivos conectados a una misma red local o mediante túneles seguros.

---

## 1. Visión General de Componentes

```
+-----------------------------------------------------------------------------------+
|                              DISPOSITIVOS CLIENTES                                |
|   (Celulares Android/iOS, Laptops Windows/macOS/Linux - PWA en Navegadores Web)   |
+-----------------------------------------------------------------------------------+
           │                                            ▲                    ▲
    HTTP / REST                                    Socket.IO             Presigned S3
  (Login, Subidas,                                (Presencia,            (Descargas
   Explorador S3)                                 Chunks P2P)             Directas)
           │                                            │                    │
           ▼                                            ▼                    │
+---------------------------------------------------------------------+      │
|                           SERVIDOR ENLACE                           |      │
|                             (server.py)                             |      │
|                                                                     |      │
|   +---------------------+   +-------------------+   +-----------+   |      │
|   |   Flask Web Server  |   | Socket.IO Manager |   | S3 Module |   |      │
|   +---------------------+   +-------------------+   +-----------+   |      │
|              │                        │                   │         |      │
|              ▼                        ▼                   ▼         |      │
|       [ Disco Local ]          [ Memoria RAM ]      [ boto3 S3 ]    |      │
|      (buzon/ con TTL)         (state["devices"])          │         |      │
+-----------------------------------------------------------│---------+      │
                                                            │                │
                                                            ▼                │
                                                +──────────────────────+     │
                                                |   BUCKET S3 / CLOUD  |─────┘
                                                |  (AWS, MinIO, R2)    |
                                                +──────────────────────+
```

---

## 2. Los Tres Canales de Transferencia

### Canal 1: Transferencia en Vivo (P2P / WebSockets)
- **Caso de uso**: Enviar fotos, videos o archivos cuando ambos dispositivos están en la pantalla al mismo tiempo.
- **Mecanismo**:
  1. El emisor envía un evento `send_offer` con el nombre, tamaño y tipo de archivo.
  2. El receptor recibe la oferta y puede aceptarla o rechazarla.
  3. Al aceptar, el archivo se transmite en trozos (*chunks*) binarios directamente a través de WebSocket (`file_chunk`) con acuses de recibo (`chunk_ack`).
  4. Los datos fluyen por la memoria RAM del servidor sin tocar el disco duro.

### Canal 2: Buzón del Servidor (Temporal con TTL)
- **Caso de uso**: Guardar un archivo cuando el receptor no está conectado en ese momento o para descargarlo más tarde.
- **Mecanismo**:
  1. El archivo se envía mediante `POST /api/buzon/enviar` (soporta empaquetado automático en `.zip` para carpetas o múltiples archivos).
  2. Se almacena localmente en la carpeta `buzon/` del servidor con un prefijo UUID único (`<uuid>__<nombre>`).
  3. Un hilo daemon en segundo plano (`mailbox_cleanup_loop`) revisa periódicamente y elimina de forma automática los archivos cuyo tiempo de vida supere `ENLACE_BUZON_HORAS` (por defecto 72 horas).

### Canal 3: Almacenamiento en la Nube S3 (Persistente)
- **Caso de uso**: Archivos que se desean almacenar de forma definitiva o permanente, accesibles desde cualquier navegador sin límites de caducidad local.
- **Mecanismo**:
  1. El archivo se sube vía `POST /api/s3/upload` (con carpeta/sub-prefijo opcional).
  2. El servidor lo transmite al bucket configurado dentro del prefijo del usuario con metadatos asociados.
  3. Los archivos se gestionan desde la pestaña `☁️ Almacenamiento S3` del cliente web, permitiendo visualización, navegación por carpetas, generación de enlaces temporales de descarga segura y eliminación.

---

## 3. Modelo de Seguridad y Autenticación

1. **Protección de Acceso Unificada**:
   - Todo el servicio (HTML, APIs REST y WebSockets) requiere autenticación.
   - El inicio de sesión genera una cookie de sesión cifrada por Flask:
     - `SESSION_COOKIE_HTTPONLY = True` (inmune a lectura desde JavaScript).
     - `SESSION_COOKIE_SAMESITE = "Lax"` (protección contra ataques CSRF).
   - Los WebSockets validan la existencia de la sesión en el *handshake* inicial; cualquier conexión no autenticada es rechazada de inmediato.
2. **Rotación Automática de Contraseña**:
   - Si no se especifica una contraseña fija (`ENLACE_PASSWORD`), el servidor genera una clave aleatoria segura y opcionalmente la rota cada N horas (`ENLACE_PASSWORD_ROTAR_HORAS`).
3. **Credenciales Sanitizadas**:
   - Las claves de acceso de S3 y contraseñas SMTP residen únicamente en variables de entorno o memoria del servidor; ninguna API devuelve estas credenciales al navegador.
