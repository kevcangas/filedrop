# 📱 Filedrop — Diagnóstico y Resolución: Descubrimiento de Dispositivos y Almacenamiento S3

Este documento detalla las causas raíz identificadas y las soluciones implementadas en **Enlace / Filedrop** para resolver:
1. El descubrimiento en tiempo real y la sincronización de múltiples dispositivos de una misma cuenta o amigos.
2. La habilitación de subidas de archivos a **S3 / MinIO** con `ENLACE_S3_ENABLED=1`, gestión de carpetas virtuales y eliminación de errores de ejecución (`escapeHtml`).

---

## 1. Descubrimiento Multi-Dispositivo (Presencia en Tiempo Real)

### 🔍 Causas Raíz Identificadas
1. **Registro Tardío de Eventos Socket.IO**:
   - En [static/app.js](file:///c:/Users/kevin/Desktop/proyectos/filedrop/static/app.js), `io()` se instanciaba de forma inmediata al cargar el script, pero `setupSocketListeners()` se ejecutaba dentro del evento `DOMContentLoaded`.
   - Cuando el WebSocket conectaba de inmediato (o por caché rápida), los eventos iniciales emitidos por el servidor (`connect`, `session_ready`, `devices_updated`, `device_list`) llegaban antes de que el navegador registrara los listeners, descartándolos silenciosamente.
2. **Falta de Fallback REST y Dependencia 100% de Push**:
   - La interfaz dependía exclusivamente de recibir un evento WebSocket para poblar la lista de terminales. Si un paquete se perdía o el dispositivo se conectaba mientras la pestaña estaba en segundo plano, la lista quedaba vacía (`"Ningún otro dispositivo en línea todavía"`).
3. **Inactividad en Dispositivos Móviles (Screen Lock / Background)**:
   - Los navegadores móviles (iOS Safari, Android Chrome) congelan la ejecución de JavaScript y suspenden los WebSockets tras 20-30 segundos de inactividad o bloqueo de pantalla. Al reactivarse el dispositivo, no existían detectores de visibilidad (`visibilitychange`, `focus`, `pageshow`) para reanudar la presencia automáticamente.
4. **Filtrado Exclusivo de Dispositivos Conectados**:
   - La interfaz filtraba rígidamente `d.is_online`, ocultando cualquier dispositivo no conectado en ese milisegundo exacto, impidiendo el uso del **Buzón efímero** para envíos diferidos.
5. **Sesiones Heredadas con Clave Maestra**:
   - En inicios de sesión con la contraseña única del servidor (`ENLACE_PASSWORD`), `session["user_id"]` y `session["device_id"]` quedaban nulos, provocando que el middleware de sockets (`verify_socket_session`) tratara al cliente como anónimo y omitiera su registro en `presence_service`.

### 🛠️ Soluciones Implementadas
- **Enlace Inmediato de Sockets**:
  - `setupSocketListeners()` ahora se ejecuta inmediatamente tras instanciar `socket = io(...)`. Si `socket.connected` ya está en `true`, emite `register_device` en el acto.
- **Nuevo Endpoint REST `GET /api/devices/visible`**:
  - Creado en [app/api/devices.py](file:///c:/Users/kevin/Desktop/proyectos/filedrop/app/api/devices.py) y consumido por `fetchVisibleDevices()` en [static/app.js](file:///c:/Users/kevin/Desktop/proyectos/filedrop/static/app.js). Consulta en PostgreSQL y `presence_service` todos los dispositivos propios y amigos con su estado `is_online` y `last_seen_at`.
- **Reactivación Automática ante Ciclo de Vida Móvil**:
  - Se añadieron listeners para `visibilitychange`, `window.focus` y `window.pageshow` con un intervalo de telemetría de 10 segundos para reanudar la conexión y refrescar la lista tan pronto como el usuario desbloquea el móvil o regresa a la pestaña.
- **Renderizado Cohesivo (Online + Offline con Buzón)**:
  - Dispositivos en línea muestran indicador verde palpitante (`🟢 En línea`).
  - Dispositivos desconectados muestran indicador atenuado (`⚪ Desconectado · visto hace X min · entrega diferida por Buzón`).
- **Botón de Refresco Interactivo**:
  - El botón `🔄` rota con animación CSS, reemite el registro por socket y ejecuta una sincronización HTTP completa.
- **Auto-vinculación en Sesiones Heredadas**:
  - [app/views/web.py](file:///c:/Users/kevin/Desktop/proyectos/filedrop/app/views/web.py) y [app/sockets/middleware.py](file:///c:/Users/kevin/Desktop/proyectos/filedrop/app/sockets/middleware.py) auto-resuelven o inicializan una cuenta de administración y dispositivo canónico con UUID para accesos por contraseña local.

---

## 2. Almacenamiento y Subidas S3 / MinIO

### 🔍 Causas Raíz Identificadas
1. **Acceso Incompatible a la Configuración de Flask**:
   - En [app/services/s3_service.py](file:///c:/Users/kevin/Desktop/proyectos/filedrop/app/services/s3_service.py), `S3Service` recibía `current_app.config` (un diccionario tipo `dict`) y consultaba sus valores con `getattr(self.config, "S3_ENABLED", False)` y `self.config.S3_BUCKET`.
   - En Python, `getattr()` sobre un `dict` no busca claves del diccionario. En consecuencia, `is_enabled()` retornaba siempre `False` y cualquier intento de subida arrojaba el error `400 "S3 storage is disabled."` o `AttributeError`.
2. **Discordancia en el Contrato de Subida (`uploadToS3`)**:
   - En [static/app.js](file:///c:/Users/kevin/Desktop/proyectos/filedrop/static/app.js), se invocaba `await window.uploadToS3(file, (p) => updateTransferProgress(rowId, p))`.
   - Sin embargo, `uploadToS3` en [static/transfer.js](file:///c:/Users/kevin/Desktop/proyectos/filedrop/static/transfer.js) esperaba un objeto destructurado `{ folder, userId, onProgress, onDone, onError }` y retornaba un objeto `XMLHttpRequest` (no una `Promise`). Esto causaba que la llamada fallara o no esperara la respuesta del servidor.
3. **`ReferenceError: escapeHtml is not defined`**:
   - `loadS3Explorer` en [static/transfer.js](file:///c:/Users/kevin/Desktop/proyectos/filedrop/static/transfer.js) llamaba a `escapeHtml()` al renderizar el estado del bucket, pero la función sólo estaba declarada dentro del IIFE privado de `app.js`.
4. **Falta de Parámetro `connected` en `/api/s3/status`**:
   - `transfer.js` evaluaba `!s3CurrentStatus.connected`. La API respondía con `configured: true` pero no incluía la clave `connected: true`, haciendo que la UI asumiera erróneamente que la conexión había fallado.
5. **Rutas Faltantes de Gestión de Carpetas S3**:
   - La interfaz invocaba `POST /api/s3/folders/create` y `POST /api/s3/folders/delete`, pero estas rutas no existían en el backend, respondiendo con `404 Not Found`.

### 🛠️ Soluciones Implementadas
- **Lectura Agnóstica de Configuración en `S3Service`**:
  - Implementado helper `_get_config(key, default)` que soporta indistintamente diccionarios de Flask `Config`, diccionarios estándar y clases con atributos.
  - Soporte robusto de valores booleanos para `ENLACE_S3_ENABLED` (acepta booleanos o cadenas `"1"`, `"true"`, `"yes"`).
- **Auto-creación y Verificación de Bucket**:
  - Incorporado método `ensure_bucket_exists()` que verifica la presencia del bucket en AWS/MinIO y lo crea automáticamente si `ENLACE_S3_AUTO_CREATE_BUCKET=1`.
- **Endpoints Completos en `app/api/s3.py`**:
  - `GET /api/s3/status`: Responde con `enabled`, `configured`, `connected`, `bucket` y `user_prefix`.
  - `GET /api/s3/files`: Lista objetos delimitados por carpeta retornando `{ ok: true, folders: [...], files: [...] }`.
  - `POST /api/s3/folders/create`: Crea marcadores de subcarpetas virtuales.
  - `POST /api/s3/folders/delete`: Elimina recursivamente una carpeta y todos los objetos bajo su prefijo.
  - `GET /api/s3/share/<path:key>`: Genera URLs prefirmadas temporales de descarga.
- **Envoltorio en Promesa para `uploadFilesToS3` y `uploadFilesToBuzon`**:
  - En [static/app.js](file:///c:/Users/kevin/Desktop/proyectos/filedrop/static/app.js), las subidas a S3 y al Buzón ahora envuelven la llamada en una `Promise` que gestiona `onProgress`, `onDone` y `onError` adecuadamente.
- **Exportación Global y Utilidad `escapeHtml`**:
  - Definida e inyectada `escapeHtml` en [static/transfer.js](file:///c:/Users/kevin/Desktop/proyectos/filedrop/static/transfer.js) y expuestas explícitamente las funciones de S3 y Buzón en el objeto global `window`.
- **Actualización de Caché del Service Worker**:
  - Service Worker incrementado a la versión de caché `enlace-shell-v9` para garantizar que los navegadores y PWAs instaladas descarguen los scripts actualizados.

---

## 3. Verificación y Resultados

1. **Pruebas Automatizadas**:
   - `pytest`: **19 pruebas superadas** con 100% de éxito (incluyendo pruebas de sockets multi-dispositivo y endpoints de S3 con mock de `boto3`).
2. **Conectividad con MinIO en Homelab**:
   - Verificado acceso directo desde el contenedor hacia `http://app-minio:9000`.
   - Verificada la existencia y permisos del bucket `filedrop-storage`.
3. **Repositorio Git**:
   - Cambios commiteados y empujados a `origin/main` en los commits `0874813`, `78f3fba`, `d4518da`, `6533f39` y `2ef71a2`.
