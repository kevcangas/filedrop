# ⚙️ Referencia de Configuración

Filedrop / Enlace se configura mediante variables de entorno especificadas en el archivo `.env` o suministradas al contenedor de Docker.

---

## 1. Base de Datos Relacional (PostgreSQL)

Desde la versión multi-usuario, Enlace utiliza **PostgreSQL 16** para almacenar cuentas, dispositivos enlazados, solicitudes de amistad y registros de auditoría.

| Variable | Tipo / Ejemplo | Valor por Defecto | Descripción |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | URI (`postgresql://enlace:clave@localhost:5432/enlace_db`) | `postgresql://enlace:enlace_secret@localhost:5432/enlace_db` | Cadena de conexión completa para SQLAlchemy. En Docker Compose se configura automáticamente apuntando al servicio `db`. |
| `POSTGRES_DB` | String (`enlace_db`) | `enlace_db` | Nombre de la base de datos creada por el contenedor de PostgreSQL. |
| `POSTGRES_USER` | String (`enlace`) | `enlace` | Nombre de usuario administrador de la base de datos PostgreSQL. |
| `POSTGRES_PASSWORD` | String (`enlace_secret`) | `enlace_secret` | Contraseña para el usuario de PostgreSQL. **Debe cambiarse en producción**. |
| `POSTGRES_PORT` | Entero (`5432`) | `5432` | Puerto TCP del servicio de base de datos. |

---

## 2. Variables Principales del Servidor Web

| Variable | Tipo / Ejemplo | Valor por Defecto | Descripción |
| :--- | :--- | :--- | :--- |
| `ENLACE_PORT` | Entero (`41823`) | `41823` | Puerto TCP donde escuchará el servidor web. |
| `ENLACE_HOST_IP` | String (`"192.168.1.50"`) | *Auto-detectada* | IP de la máquina en la red local. Útil si tienes múltiples interfaces de red o ejecutas en Docker. |
| `ENLACE_SECRET_KEY` | String | `"enlace-cambia-esta-clave-secreta"` | Clave criptográfica para la firma de cookies de sesión seguras (`session`) de Flask. |
| `ENLACE_PUBLIC_URL` | URL (`https://mi-tunel.ngrok.app`) | *Vacío* | URL externa para mostrar en la consola y notificaciones cuando se usa un túnel o proxy inverso. |
| `ENLACE_SESION_DIAS` | Entero (`30`) | `30` | Días de validez de la sesión autenticada en el navegador antes de requerir login de nuevo. |
| `ENLACE_BUZON_HORAS` | Float (`72.0`) | `72` | Horas de retención de los archivos depositados en el buzón local antes de su purga automática por TTL. |
| `ENLACE_NO_BROWSER` | `0` o `1` | `0` | En `1`, evita abrir automáticamente el navegador al arrancar el servidor (para entornos headless o Docker). |
| `ENLACE_PASSWORD` | String (`"clave123"`) | *Vacío* | *(Modo Legado / Clave Maestra)* Si se define, permite acceso de emergencia o fallback para entornos sin base de datos activa. |

---

## 3. Seguridad y Límites de Velocidad (Rate Limiting)

Para proteger los endpoints de autenticación contra ataques de fuerza bruta y saturación:

| Variable | Tipo / Ejemplo | Valor por Defecto | Descripción |
| :--- | :--- | :--- | :--- |
| `RATELIMIT_DEFAULT` | String (`"200 per day; 50 per hour"`) | `"200 per day; 50 per hour"` | Límite general de peticiones por dirección IP en endpoints estándar. |
| `RATELIMIT_STORAGE_URI` | URI (`"memory://"`) | `"memory://"` | Almacenamiento del estado de rate limit (ej. `memory://` o `redis://localhost:6379/0`). |

---

## 4. Configuración de Almacenamiento S3 (Cloud)

Permite almacenamiento permanente de objetos con aislamiento estricto por usuario (`users/{user_id}/`).

| Variable | Tipo / Ejemplo | Valor por Defecto | Descripción |
| :--- | :--- | :--- | :--- |
| `ENLACE_S3_ENABLED` | `0` o `1` | `0` | Habilita el módulo de almacenamiento en S3 y la pestaña correspondiente en la UI. |
| `ENLACE_S3_ENDPOINT_URL` | URL | *Vacío (AWS oficial)* | URL del endpoint compatible con S3 (ej. `http://minio:9000` o `https://<id>.r2.cloudflarestorage.com`). |
| `ENLACE_S3_REGION` | String | `us-east-1` | Región geográfica del bucket (ej. `us-east-1`, `eu-west-1`, `auto`). |
| `ENLACE_S3_BUCKET` | String | *Obligatorio si activo* | Nombre del bucket donde se guardarán los archivos. |
| `ENLACE_S3_ACCESS_KEY` | String | *Obligatorio si activo* | Access Key ID de AWS / IAM o del proveedor S3. |
| `ENLACE_S3_SECRET_KEY` | String | *Obligatorio si activo* | Secret Access Key de AWS / IAM o del proveedor S3. |
| `ENLACE_S3_PREFIX` | String | `"users/"` | Prefijo raíz dentro del bucket donde se aíslan los directorios de usuario. |
| `ENLACE_S3_AUTO_CREATE_BUCKET` | `0` o `1` | `1` | Si está en `1`, verifica si el bucket existe al iniciar y lo crea si falta. |

---

## 5. Notificaciones por Correo (SMTP)

Permite enviar automáticamente credenciales, enlaces de invitación o avisos de acceso por correo saliente.

| Variable | Tipo / Ejemplo | Valor por Defecto | Descripción |
| :--- | :--- | :--- | :--- |
| `ENLACE_SMTP_HOST` | String (`smtp.gmail.com`) | *Vacío* | Servidor de correo saliente SMTP. |
| `ENLACE_SMTP_PORT` | Entero (`587`) | `587` | Puerto del servidor SMTP (587 para TLS/STARTTLS, 465 para SSL). |
| `ENLACE_SMTP_USER` | String (`cuenta@gmail.com`)| *Vacío* | Usuario o correo electrónico de autenticación SMTP. |
| `ENLACE_SMTP_PASS` | String (`clave-de-app`) | *Vacío* | Contraseña de la cuenta o contraseña de aplicación. |
| `ENLACE_SMTP_FROM` | String (`Enlace <cuenta@...>`)| *Vacío* | Remitente que aparecerá en el encabezado `From`. |
| `ENLACE_SMTP_TLS` | `0` o `1` | `1` | Habilita el cifrado STARTTLS para la conexión SMTP. |
