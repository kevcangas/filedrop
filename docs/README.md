# 📚 Documentación Técnica de Filedrop / Enlace

Bienvenido a la documentación oficial y exhaustiva de **Filedrop / Enlace**. Este directorio contiene manuales, referencias de arquitectura, guías de despliegue y especificaciones de API organizadas modularmente.

---

## 🧭 Mapa de Documentación

| Documento | Descripción |
| :--- | :--- |
| **[Guía de Inicio Rápido](getting-started.md)** | Instalación paso a paso, arranque en el equipo anfitrión y conexión desde celulares o PCs en la red local. |
| **[Arquitectura y Diseño](architecture.md)** | Visión técnica de alto nivel, flujos de datos (P2P en vivo, Buzón con TTL, S3 persistente), modelo de seguridad y manejo de estado en memoria. |
| **[Referencia de Configuración](configuration.md)** | Diccionario completo de variables de entorno (`.env`), puertos, políticas de sesión, notificaciones SMTP y opciones de seguridad. |
| **[Almacenamiento en la Nube S3](s3-storage.md)** | Guía integral de configuración para AWS S3, Cloudflare R2 y MinIO local: credenciales, permisos IAM, subidas y explorador web. |
| **[Referencia de API y WebSockets](api-reference.md)** | Especificación técnica de todos los endpoints HTTP REST (`/api/*`) y el catálogo de eventos en tiempo real con Socket.IO. |
| **[Guía de Despliegue y Redes](deployment.md)** | Ejecución con Docker Compose con IP fija, servicio persistente systemd en Linux, configuración de Reverse Proxies y túneles seguros (ngrok, Cloudflare Tunnel, Tailscale). |

---

## 💡 Conceptos Clave de Enlace

1. **Sin Cuentas ni Terceros Obligatorios**: La anfitriona es dueña del servidor. Los dispositivos se autentican mediante contraseña de acceso o token de sesión sin requerir registro de usuarios.
2. **Tres Canales de Transferencia**:
   - **En Vivo (P2P / WebSockets)**: Transferencia de dispositivo a dispositivo en tiempo real sin almacenamiento en disco.
   - **Buzón Temporal**: Depósito temporal en el disco del servidor con tiempo de vida (TTL) configurable para recolección posterior.
   - **Nube S3**: Almacenamiento persistente en buckets de objetos para guardar archivos a largo plazo y gestionarlos desde la web.
3. **Multiplataforma**: Funciona en cualquier navegador moderno sin apps nativas obligatorias, soportando Progressive Web App (PWA) tanto en escritorio como en móviles (Android / iOS).
