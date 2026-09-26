# 📚 Documentación Técnica de Filedrop / Enlace

Bienvenido a la documentación oficial y exhaustiva de **Filedrop / Enlace**. Este directorio contiene manuales, referencias de arquitectura, guías de despliegue y especificaciones de API organizadas modularmente para la arquitectura multi-usuario basada en **PostgreSQL**, **Flask** y **Socket.IO**.

---

## 🧭 Mapa de Documentación

| Documento | Descripción |
| :--- | :--- |
| **[Guía de Inicio Rápido](getting-started.md)** | Instalación paso a paso con Docker Compose, creación de cuentas, registro de dispositivos y conexión con amigos en la red local o remota. |
| **[Arquitectura y Diseño](architecture.md)** | Visión técnica de alto nivel, topología de contenedores, modelo relacional ERD en PostgreSQL 16, flujos de datos (P2P en vivo, Buzón con TTL, S3 multi-inquilino) y matriz de autorización por dispositivo. |
| **[Referencia de Configuración](configuration.md)** | Diccionario completo de variables de entorno (`.env`), parámetros de conexión PostgreSQL, puertos, políticas de sesión, límites de velocidad (rate limiting) y notificaciones SMTP. |
| **[Almacenamiento en la Nube S3](s3-storage.md)** | Guía integral de configuración para AWS S3, Cloudflare R2 y MinIO local: aislamiento multi-inquilino (`users/{user_id}/`), credenciales, permisos IAM mínimos y explorador web. |
| **[Referencia de API y WebSockets](api-reference.md)** | Especificación técnica de todos los endpoints HTTP REST (`/api/auth`, `/api/friends`, `/api/devices`, `/api/logs`, `/api/buzon`, `/api/s3`) y el catálogo de eventos Socket.IO con verificación ACL. |
| **[Guía de Despliegue y Operaciones](deployment.md)** | Despliegue multi-contenedor con Docker Compose, migraciones con Alembic (`flask db upgrade`), respaldos y restauración de base de datos, proxies inversos (Nginx/Caddy) con WebSockets y túneles seguros. |

---

## 💡 Conceptos Clave de Enlace

1. **Cuentas y Dispositivos Vinculados**: Cada usuario gestiona su propia cuenta y puede vincular múltiples dispositivos (celulares, laptops, tablets) reconociéndolos por nombre y huella digital.
2. **Control de Acceso por Amistad (ACL)**:
   - *Dispositivos Propios*: Descubrimiento bidireccional continuo y sincronización inmediata de portapapeles y archivos.
   - *Dispositivos de Amigos*: Visibilidad mutua en tiempo real solo si la solicitud de amistad ha sido aceptada; las transferencias requieren confirmación previa con previsualización.
   - *Dispositivos Desconocidos*: Aislamiento total sin visibilidad ni acceso a salas de WebSockets.
3. **Tres Canales de Transferencia**:
   - **En Vivo (P2P por WebSockets)**: Transferencia directa dispositivo a dispositivo en tiempo real sin almacenamiento permanente en disco.
   - **Buzón Temporal**: Depósito temporal en el servidor con tiempo de vida (TTL) configurable para recolección diferida.
   - **Almacenamiento en la Nube S3**: Espacio de objetos persistente en la nube con aislamiento jerárquico por usuario (`users/{user_id}/`).
4. **Interfaz Unificada y PWA Multiplataforma**: Funciona en cualquier navegador web moderno mediante una sola interfaz adaptativa responsiva (`/`), sin bifurcación de URLs ni duplicación de código. Soporta instalación como Progressive Web App (PWA) en Windows, macOS, Linux, Android e iOS con notificaciones del sistema operativo.
