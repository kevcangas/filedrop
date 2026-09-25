# ☁️ Guía de Almacenamiento en S3

Filedrop / Enlace permite integrar almacenamiento de objetos en la nube compatible con S3. Esto ofrece una opción permanente para guardar archivos directamente en la nube y explorarlos, descargarlos o compartirlos en cualquier momento desde la interfaz web.

---

## 1. Proveedores Compatibles

Cualquier proveedor que soporte la API de Amazon S3 puede ser utilizado:
- **Amazon Web Services (AWS S3)**
- **Cloudflare R2** (sin costos de transferencia de salida / egress)
- **MinIO** (alojamiento propio / on-premise)
- **Backblaze B2**
- **Wasabi Hot Cloud Storage**
- **DigitalOcean Spaces**

---

## 2. Estructura de Bucket Dedicado, Aislamiento y Sub-carpetas por Usuario

Filedrop utiliza un bucket S3 específico dedicado a la aplicación y organiza el almacenamiento aislando a cada usuario o dispositivo en su propio prefijo raíz, permitiendo además la creación de sub-prefijos (carpetas virtuales) para ordenar sus archivos:

```
s3://<ENLACE_S3_BUCKET>/
│
└── users/
    ├── user_a7b9c1d2/
    │   ├── fotos/
    │   │   ├── 2026/
    │   │   │   └── 4f82e1__vacaciones.jpg
    │   │   └── avatar.png
    │   ├── documentos/
    │   │   └── 9c34d5__contrato.pdf
    │   └── notas_raiz.txt
    │
    ├── user_e3f5a8b7/
    │   └── respaldos/
    │       └── 1a2b3c__backup.zip
    └── ...
```

- **Aislamiento**: Cada dispositivo/usuario sólo puede listar, descargar y gestionar los archivos y carpetas contenidos en su propio prefijo raíz (`users/<user_id>/`).
- **Sub-prefijos (Carpetas) Ilimitados**: Los usuarios pueden crear, navegar y eliminar subcarpetas de manera jerárquica con una barra interactiva de navegación (*breadcrumbs*).
- **Creación automática de Bucket**: Si se activa `ENLACE_S3_AUTO_CREATE_BUCKET=1`, la aplicación verifica si el bucket existe al arrancar y lo crea automáticamente si aún no existe.

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
ENLACE_S3_PREFIX=archivos/
```

### B. Cloudflare R2
```env
ENLACE_S3_ENABLED=1
ENLACE_S3_ENDPOINT_URL=https://<TU_ACCOUNT_ID>.r2.cloudflarestorage.com
ENLACE_S3_REGION=auto
ENLACE_S3_BUCKET=mi-bucket-r2
ENLACE_S3_ACCESS_KEY=<R2_ACCESS_KEY_ID>
ENLACE_S3_SECRET_KEY=<R2_SECRET_ACCESS_KEY>
ENLACE_S3_PREFIX=filedrop/
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
ENLACE_S3_PREFIX=
```

---

## 3. Política de Permisos IAM Mínimos

Si usas AWS IAM para generar las credenciales, aplica una política con el **principio de mínimo privilegio**:

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

## 4. Funcionalidades del Explorador Web S3

Una vez configurado y reiniciado el servidor, la interfaz web habilitará la pestaña **☁️ Almacenamiento S3**:

1. **Subida Directa**: En el panel de envío principal, al marcar *"Almacenar en S3"*, cualquier archivo o carpeta arrastrada se enviará a la nube con barra de progreso en vivo.
2. **Listado y Búsqueda**: Visualiza todos los archivos guardados, su peso y fecha, con filtrado en tiempo real por nombre.
3. **Previsualización**: Abre archivos de imagen (`.png`, `.jpg`, `.webp`), audio, video o texto plano directamente en un visor modal.
4. **Descargas Seguras**: Descarga archivos directamente o genera enlaces prefirmados temporales para compartir externamente sin exponer tus credenciales.
5. **Borrado Seguro**: Eliminación con confirmación directa del bucket S3.
