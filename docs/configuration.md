# ⚙️ Referencia de Configuración

Filedrop / Enlace se configura principalmente mediante variables de entorno especificadas en el archivo `.env` o suministradas al contenedor de Docker.

---

## 1. Variables Principales del Servidor

| Variable | Tipo / Ejemplo | Valor por Defecto | Descripción |
| :--- | :--- | :--- | :--- |
| `ENLACE_PASSWORD` | String (`"clave123"`) | *Vacío (aleatorio)* | Contraseña requerida para acceder al servicio. Si se deja vacía, se genera una contraseña aleatoria en cada inicio. |
| `ENLACE_PORT` | Entero (`41823`) | `41823` | Puerto TCP donde escuchará el servidor web. |
| `ENLACE_HOST_IP` | String (`"192.168.1.50"`) | *Auto-detectada* | IP de la máquina en la red local. Útil si tienes múltiples interfaces de red o ejecutas en Docker. |
| `ENLACE_SECRET_KEY` | String | `"enlace-cambia-esta-clave-secreta"` | Clave criptográfica para la firma de cookies de sesión de Flask. |
| `ENLACE_PUBLIC_URL` | URL (`https://mi-tunel.ngrok.app`) | *Vacío* | URL externa para mostrar en la consola y correos de notificación cuando se usa un túnel o proxy inverso. |
| `ENLACE_PASSWORD_ROTAR_HORAS` | Float (`1.0`) | `1` | Intervalo en horas para rotar la contraseña aleatoria. Pon `0` para desactivar la rotación automática. |
| `ENLACE_SESION_DIAS` | Entero (`10`) | `10` | Días de validez de la sesión autenticada en el navegador antes de requerir contraseña de nuevo. |
| `ENLACE_BUZON_HORAS` | Float (`72.0`) | `72` | Horas de retención de los archivos depositados en el buzón local antes de ser eliminados automáticamente. |
| `ENLACE_NO_BROWSER` | `0` o `1` | `0` | En `1`, evita abrir automáticamente el navegador predeterminado al arrancar el servidor (ideal para servidores headless o Docker). |

---

## 2. Configuración de Almacenamiento S3 (Cloud)

| Variable | Tipo / Ejemplo | Valor por Defecto | Descripción |
| :--- | :--- | :--- | :--- |
| `ENLACE_S3_ENABLED` | `0` o `1` | `0` | Habilita el módulo de almacenamiento en S3 y la pestaña correspondiente en el navegador. |
| `ENLACE_S3_ENDPOINT_URL` | URL | *Vacío (AWS oficial)* | URL del endpoint compatible con S3 (ej. `http://minio:9000` o `https://<id>.r2.cloudflarestorage.com`). |
| `ENLACE_S3_REGION` | String | `us-east-1` | Región geográfica del bucket (ej. `us-east-1`, `eu-west-1`, `auto`). |
| `ENLACE_S3_BUCKET` | String | *Obligatorio si activo* | Nombre del bucket donde se guardarán los archivos. |
| `ENLACE_S3_ACCESS_KEY` | String | *Obligatorio si activo* | Access Key ID de AWS / IAM o del proveedor S3. |
| `ENLACE_S3_SECRET_KEY` | String | *Obligatorio si activo* | Secret Access Key de AWS / IAM o del proveedor S3. |
| `ENLACE_S3_PREFIX` | String | `"enlace/"` | Prefijo o carpeta virtual dentro del bucket donde se organizarán los archivos de Filedrop. |

---

## 3. Notificaciones por Correo (SMTP)

Permite enviar automáticamente las credenciales o enlaces de acceso por correo electrónico.

| Variable | Tipo / Ejemplo | Valor por Defecto | Descripción |
| :--- | :--- | :--- | :--- |
| `ENLACE_SMTP_HOST` | String (`smtp.gmail.com`) | *Vacío* | Servidor de correo saliente SMTP. |
| `ENLACE_SMTP_PORT` | Entero (`587`) | `587` | Puerto del servidor SMTP (587 para TLS/STARTTLS, 465 para SSL). |
| `ENLACE_SMTP_USER` | String (`cuenta@gmail.com`)| *Vacío* | Usuario o correo electrónico de autenticación. |
| `ENLACE_SMTP_PASS` | String (`clave-de-app`) | *Vacío* | Contraseña de la cuenta o contraseña de aplicación. |
| `ENLACE_SMTP_FROM` | String (`Enlace <cuenta@...>`)| *Vacío* | Remitente que aparecerá en el encabezado `From`. |
| `ENLACE_SMTP_TLS` | `0` o `1` | `1` | Habilita el cifrado STARTTLS para la conexión SMTP. |
