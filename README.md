# Enlace — plataforma multi-usuario de transferencia de archivos, portapapeles y almacenamiento

Plataforma auto-hospedada de transferencia de archivos de alta velocidad, sincronización de portapapeles y almacenamiento en la nube entre **celulares, tablets y computadoras**, tanto en la red local (WiFi) como a través de internet, respaldada por **PostgreSQL**, **Flask**, **Flask-SocketIO** y **SQLAlchemy**.

---

## ✨ Características Principales

- **Arquitectura Multi-Usuario con Cuentas y Dispositivos**:
  - Registro e inicio de sesión seguros con hashing de contraseñas de última generación (`bcrypt` / `argon2`).
  - Cada cuenta puede vincular y nombrar múltiples dispositivos (laptop, celular, tablet) identificados por huella digital.
  - Panel de gestión para renombrar dispositivos y revocar accesos en cualquier momento.
- **Control de Acceso por Red de Amigos (ACL de Confianza)**:
  - Búsqueda y envío de invitaciones de amistad por nombre de usuario.
  - **Aislamiento Total**: Los dispositivos solo son visibles y pueden comunicarse entre sí si pertenecen al **mismo usuario** o a **amigos aprobados** (`ACCEPTED`).
  - Previsualización interactiva de imágenes y videos antes de aceptar cualquier transferencia entrante.
- **Tres Canales de Transferencia**:
  1. **En Vivo (Streaming P2P por WebSockets)**: Transferencia directa por trozos binarios con reanudación automática si se corta la conexión WiFi y sin consumo de disco en el servidor.
  2. **Buzón Temporal (Mailbox)**: Envío de archivos o carpetas empaquetadas en `.zip` al servidor para que el destinatario los descargue cuando se conecte, con purga automática por tiempo de expiración (TTL configurable, 72h por defecto).
  3. **Almacenamiento en la Nube S3**: Integración con AWS S3, Cloudflare R2 o MinIO local con aislamiento estricto por usuario (`users/{user_id}/`), explorador de carpetas, previsualización multimedia y enlaces prefirmados temporales para compartir.
- **Sincronización en Vivo de Portapapeles**:
  - Envía y recibe texto copiado instantáneamente entre tus propios equipos o con amigos autorizados mediante la API nativa de portapapeles.
- **Consola de Auditoría y Actividad en Vivo**:
  - Panel lateral interactivo con historial de transferencias, estado de conexión de dispositivos y alertas de seguridad en tiempo real.
- **PWA Multiplataforma**:
  - Instalable como Progressive Web App (PWA) tanto en escritorio (Windows, macOS, Linux) como en móviles (Android, iOS) con notificaciones del sistema operativo.
- **Base de Datos Relacional y Migraciones**:
  - Esquema estructurado en PostgreSQL 16 gestionado con migraciones versionadas en **Alembic** (`flask db upgrade`).

---

## 🚀 Cómo Correrlo

### 1. Configurar Variables de Entorno (`.env`)

Copia la plantilla de configuración:

```bash
cp .env.example .env
```

El archivo `.env` viene preconfigurado para desarrollo local con Docker Compose. Si deseas usar S3 o ajustar puertos, edita las variables correspondientes.

### 2. Arranque con Docker Compose (Recomendado)

Inicia tanto el servidor web como el contenedor de PostgreSQL con un solo comando:

```bash
# Iniciar servicios en segundo plano
docker compose up -d

# Visualizar logs en vivo
docker compose logs -f enlace
```

Abre tu navegador en `http://localhost:41823/`.

### 3. Arranque Manual con Python y PostgreSQL Local

```bash
# 1. Crear entorno virtual
python3 -m venv venv
source venv/bin/activate    # En Windows: .\venv\Scripts\activate

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Aplicar migraciones a la base de datos
flask db upgrade

# 4. Iniciar servidor
python3 server.py
```

---

## 📱 Conectar Dispositivos y Red de Amigos

### 1. Registro Inicial
1. Abre `http://localhost:41823/` en tu navegador.
2. Ve a la pestaña **"Crear Cuenta"**, escribe tus datos y dale un nombre a tu dispositivo (ej: *"MacBook Personal"*).

### 2. Conectar tu Celular
1. Conéctate a la misma red WiFi que la computadora anfitriona.
2. Abre en el navegador del celular `http://<IP_ANFITRIONA>:41823/mobile`.
3. Inicia sesión con **la misma cuenta** e ingresa el nombre del móvil (ej: *"iPhone de Kevin"*).
4. Tus dispositivos se sincronizarán inmediatamente bajo la categoría **"Mis Dispositivos"**.

### 3. Conectar con Amigos
1. Abre el panel de **Amigos** en la barra superior.
2. Ingresa el nombre de usuario de tu amigo y envía la solicitud.
3. Una vez aceptada la solicitud, los dispositivos de tu amigo aparecerán en tu lista en tiempo real para transferir archivos o compartir el portapapeles.

---

## 🌐 Modos de Conexión: Red Local o Acceso Remoto

- **Modo Local (WiFi)**: El servidor opera exclusivamente en tu red privada. Ningún dato sale a internet.
- **Acceso Remoto Seguro (Túneles o VPN)**:
  - **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:41823`
  - **Tailscale**: Acceso directo mediante la IP privada de tu Tailnet (`100.x.y.z`).
  - **ngrok**: `ngrok http 41823`

---

## ☁️ Almacenamiento en S3 (AWS, MinIO, Cloudflare R2)

Para habilitar el almacenamiento en la nube, configura en tu `.env`:

```env
ENLACE_S3_ENABLED=1
ENLACE_S3_ENDPOINT_URL=               # Opcional (ej: https://<id>.r2.cloudflarestorage.com o http://minio:9000)
ENLACE_S3_REGION=us-east-1
ENLACE_S3_BUCKET=mi-filedrop-bucket
ENLACE_S3_ACCESS_KEY=TU_ACCESS_KEY
ENLACE_S3_SECRET_KEY=TU_SECRET_KEY
ENLACE_S3_PREFIX=users/
ENLACE_S3_AUTO_CREATE_BUCKET=1
```

Cada usuario dispondrá de un espacio estrictamente aislado bajo su propio UUID (`users/{user_id}/`).

---

## 📚 Documentación Técnica Detallada

Para más detalles, consulta la documentación modular en la carpeta [`docs/`](docs/README.md):

- 🏛️ [Arquitectura del Sistema y ERD](docs/architecture.md)
- 🚀 [Guía de Inicio Rápido y Onboarding](docs/getting-started.md)
- ⚙️ [Referencia de Configuración y Variables de Entorno](docs/configuration.md)
- 🔌 [Referencia de API REST y Catálogo de Eventos WebSockets](docs/api-reference.md)
- 🚢 [Guía de Despliegue, Migraciones y Respaldos](docs/deployment.md)
- ☁️ [Guía de Almacenamiento S3 y Permisos IAM](docs/s3-storage.md)

---

## 🧪 Pruebas Automatizadas

El proyecto cuenta con un conjunto integral de pruebas unitarias y de integración:

```bash
# Ejecutar suite de pruebas con pytest
pytest
```
