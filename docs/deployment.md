# 🚢 Guía de Despliegue y Operaciones

Enlace puede funcionar tanto como un proceso local de desarrollo como un servicio permanente y escalable en producción mediante **Docker Compose** o servicios de sistema **systemd**.

---

## 1. Despliegue con Docker Compose (Recomendado para Servidores y NAS)

El entorno multi-contenedor orquesta tanto el servicio de la aplicación Flask/Socket.IO (`enlace`) como la base de datos relacional (`postgres`), con comprobación de estado (*healthcheck*) para asegurar que la base de datos esté lista antes del arranque web.

### Comandos de Operación

```bash
# Iniciar servicios en segundo plano y construir imágenes si es necesario
docker compose up -d

# Visualizar logs combinados en tiempo real
docker compose logs -f

# Ver logs específicos de la aplicación o base de datos
docker compose logs -f enlace
docker compose logs -f postgres

# Detener todos los contenedores sin borrar los volúmenes de datos
docker compose down

# Detener y reiniciar contenedores tras cambios en variables de entorno
docker compose restart
```

### Volúmenes Persistentes

Docker Compose gestiona tres volúmenes clave:
- `enlace_pgdata`: Almacena permanentemente las tablas de usuarios, dispositivos y amistades en `/var/lib/postgresql/data`.
- `enlace_buzon`: Directorio de archivos temporales pendientes de entrega con TTL.
- `enlace_uploads`: Archivos locales temporales y empaquetados zip.

---

## 2. Migraciones de Base de Datos (Alembic)

Las migraciones de esquema están versionadas en el directorio `migrations/`.

### Ejecución dentro del Contenedor
```bash
# Aplicar migraciones pendientes
docker compose exec enlace flask db upgrade

# Ver el estado actual de la revisión
docker compose exec enlace flask db current

# Generar una nueva migración automática si modificaste modelos SQLAlchemy
docker compose exec enlace flask db migrate -m "descripcion_del_cambio"
```

### Ejecución en Entorno Local con Python
```bash
flask db upgrade
# O directamente vía Alembic:
alembic upgrade head
```

---

## 3. Respaldo y Restauración de Base de Datos

### Crear un Respaldo (Backup)
```bash
docker compose exec -T postgres pg_dump -U enlace enlace_db > backup_enlace_$(date +%Y%m%d_%H%M%S).sql
```

### Restaurar un Respaldo (Restore)
```bash
cat backup_enlace_20260926_140000.sql | docker compose exec -T postgres psql -U enlace -d enlace_db
```

---

## 4. Configuración de Proxy Inverso (Nginx / Caddy)

Al desplegar detrás de un Reverse Proxy, es crítico habilitar el paso de encabezados para WebSockets y cookies seguras.

### Ejemplo de Configuración Nginx:
```nginx
server {
    listen 80;
    server_name filedrop.tu-dominio.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name filedrop.tu-dominio.com;

    ssl_certificate /etc/letsencrypt/live/filedrop.tu-dominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/filedrop.tu-dominio.com/privkey.pem;

    client_max_body_size 500M;  # Permitir subidas grandes al buzón y S3

    location / {
        proxy_pass http://127.0.0.1:41823;
        proxy_http_version 1.1;

        # Soporte para WebSockets (Socket.IO)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Encabezados de cliente y host
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts largos para transferencias de archivos sostenidas
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

---

## 5. Servicio Permanente en Linux (`systemd`)

Para ejecutar Enlace directamente en el sistema operativo del host:

1. Asegúrate de tener PostgreSQL instalado y ejecutándose localmente:
   ```bash
   sudo systemctl status postgresql
   ```
2. Edita `enlace.service` para ajustar tu ruta de usuario, entorno virtual y variables de conexión.
3. Cópialo y habilita el servicio:
   ```bash
   sudo cp enlace.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable enlace
   sudo systemctl start enlace
   ```
4. Consultar estado y logs:
   ```bash
   sudo systemctl status enlace
   journalctl -u enlace -f
   ```

---

## 6. Acceso Remoto Seguro (Fuera de la Red Local)

- **Cloudflare Tunnel (`cloudflared`)**:
  ```bash
  cloudflared tunnel --url http://localhost:41823
  ```
  Permite exponer el servicio en un dominio seguro con certificado SSL y DDoS protection sin abrir puertos de entrada en el router.
- **Tailscale / WireGuard**:
  Conecta dispositivos a tu red privada segura (Tailnet). La comunicación ocurre directamente por la IP privada (`100.x.y.z`) con cifrado punto a punto.
