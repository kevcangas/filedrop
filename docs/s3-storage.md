# ☁️ Guía de Almacenamiento en S3

Filedrop / Enlace permite integrar almacenamiento de objetos en la nube compatible con S3. Esto ofrece una opción permanente para guardar archivos directamente en la nube y explorarlos, descargarlos o compartirlos en cualquier momento desde la interfaz web, con aislamiento estricto por usuario autenticado.

---

## 1. Proveedores Compatibles

Cualquier proveedor que soporte la API estándar de Amazon S3 puede ser utilizado:
- **Amazon Web Services (AWS S3)**
- **Cloudflare R2** (sin costos de transferencia de salida / egress)
- **MinIO** (alojamiento propio / on-premise en Docker o Kubernetes)
- **Backblaze B2**
- **Wasabi Hot Cloud Storage**
- **DigitalOcean Spaces**

---

## 2. Aislamiento Multi-inquilino (Multi-Tenant Prefixing)

Filedrop utiliza un bucket S3 específico dedicado a la aplicación y organiza el almacenamiento aislando a cada usuario en su propio prefijo raíz criptográfico o por UUID (`users/{user_id}/`). La API verifica la identidad del usuario en cada petición y restringe cualquier intento de transversal de ruta o acceso cruzado:

```
s3://<ENLACE_S3_BUCKET>/
│
└── users/
    ├── c1f2e3d4-b789-4a01-b234-567890abcdef/      <-- Usuario 1 (Kevin)
    │   ├── fotos/
    │   │   ├── 2026/
    │   │   │   └── 4f82e1__vacaciones.jpg
    │   │   └── avatar.png
    │   ├── documentos/
    │   │   └── 9c34d5__contrato.pdf
    │   └── notas_raiz.txt
    │
    ├── a9b8c7d6-e5f4-3a21-0987-654321fedcba/      <-- Usuario 2 (María)
    │   └── respaldos/
    │       └── 1a2b3c__backup.zip
    └── ...
```

- **Aislamiento Estricto**: Ningún usuario puede listar, descargar, renombrar ni eliminar archivos contenidos fuera de su prefijo `users/{user_id}/`.
- **Subdirectorios Ilimitados**: Los usuarios pueden crear, navegar y eliminar carpetas jerárquicas con una barra interactiva de navegación (*breadcrumbs*).
- **Descargas Prefirmadas Seguras**: Al generar un enlace temporal para compartir (`/api/s3/share/*`), el backend firma una URL S3 con vencimiento programable (`expires_in`, por defecto 3600 segundos), garantizando que el bucket permanezca completamente privado.
- **Creación Automática de Bucket**: Con `ENLACE_S3_AUTO_CREATE_BUCKET=1`, la aplicación verifica si el bucket existe al arrancar y lo crea automáticamente si aún no existe.

---

## 3. Ejemplos de Configuración (.env)

### A. Amazon Web Services (AWS S3)
```env
ENLACE_S3_ENABLED=1
ENLACE_S3_ENDPOINT_URL=
ENLACE_S3_REGION=us-east-1
ENLACE_S3_BUCKET=mi-filedrop-bucket
ENLACE_S3_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
ENLACE_S3_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
ENLACE_S3_PREFIX=users/
```

### B. Cloudflare R2
```env
ENLACE_S3_ENABLED=1
ENLACE_S3_ENDPOINT_URL=https://<TU_ACCOUNT_ID>.r2.cloudflarestorage.com
ENLACE_S3_REGION=auto
ENLACE_S3_BUCKET=mi-bucket-r2
ENLACE_S3_ACCESS_KEY=<R2_ACCESS_KEY_ID>
ENLACE_S3_SECRET_KEY=<R2_SECRET_ACCESS_KEY>
ENLACE_S3_PREFIX=users/
```

### C. MinIO Local (Docker)
Si ejecutas MinIO mediante Docker en tu red local:
```env
ENLACE_S3_ENABLED=1
ENLACE_S3_ENDPOINT_URL=http://localhost:9000
ENLACE_S3_REGION=us-east-1
ENLACE_S3_BUCKET=filedrop-local
ENLACE_S3_ACCESS_KEY=minioadmin
ENLACE_S3_SECRET_KEY=minioadmin
ENLACE_S3_PREFIX=users/
```

---

## 4. Política de Permisos IAM Mínimos

Si usas AWS IAM para generar las credenciales de la aplicación, aplica una política con el **principio de mínimo privilegio**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnlaceS3BucketAccess",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::mi-filedrop-bucket"
    },
    {
      "Sid": "EnlaceS3ObjectAccess",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::mi-filedrop-bucket/*"
    }
  ]
}
```

---

## 5. Funcionalidades del Explorador Web S3

1. **Subida Directa**: En el panel de envío principal, al seleccionar la opción *"Almacenar en S3"*, cualquier archivo o carpeta arrastrada se transfiere a la nube con barra de progreso en vivo.
2. **Navegación por Carpetas**: Crea nuevas subcarpetas virtuales y navega a través de la barra interactiva de migas de pan.
3. **Listado y Búsqueda en Vivo**: Visualiza los archivos almacenados, tamaño y fecha, con filtrado en tiempo real por nombre.
4. **Previsualización Multimedia**: Abre imágenes (`.png`, `.jpg`, `.webp`), archivos de audio, video o texto plano directamente en un reproductor modal.
5. **Enlaces Temporales para Compartir**: Genera enlaces prefirmados con expiración configurable para compartir archivos con personas fuera de la red sin comprometer las credenciales maestras.
6. **Borrado Seguro**: Eliminación individual de objetos o borrado recursivo de directorios completos.
