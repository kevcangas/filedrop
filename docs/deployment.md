# 🚢 Guía de Despliegue y Redes

Enlace puede funcionar tanto como un proceso local temporal como un servicio permanente accesible 24/7 en una red doméstica o privada.

---

## 1. Despliegue con Docker Compose (Recomendado para Servidores)

El archivo `docker-compose.yml` preconfigurado asigna una IP fija interna en una subred de Docker bridge y monta los volúmenes persistentes para el buzón y las cargas.

```bash
# Iniciar contenedor en segundo plano
docker compose up -d

# Visualizar logs en tiempo real
docker compose logs -f enlace

# Detener contenedor
docker compose down
```

### Configuración en `docker-compose.yml`:
```yaml
services:
  enlace:
    build: .
    container_name: enlace
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "41823:41823"
    volumes:
      - enlace_uploads:/app/uploads
      - enlace_buzon:/app/buzon
```

---

## 2. Servicio Permanente en Linux (`systemd`)

Para ejecutar Enlace como un servicio nativo del sistema operativo que inicie automáticamente con el equipo:

1. Edita el archivo `enlace.service` para ajustar tu ruta de usuario y directorio del proyecto.
2. Cópialo al directorio de servicios de systemd:
   ```bash
   sudo cp enlace.service /etc/systemd/system/
   ```
3. Recarga systemd y habilita el servicio:
   ```bash
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

## 3. Acceso Remoto Seguro (Fuera de la Red Local)

Para acceder a Filedrop desde redes móviles o fuera de tu hogar sin abrir puertos en el router:

### A. Cloudflare Tunnel (cloudflared)
Ideal para asignar un subdominio HTTPS fijo y seguro sin exponer tu IP pública:
```bash
cloudflared tunnel --url http://localhost:41823
```
Configura la variable `ENLACE_PUBLIC_URL=https://filedrop.tudominio.com` en tu `.env`.

### B. Tailscale / WireGuard VPN
Si usas Tailscale, cada dispositivo tiene una IP privada segura (`100.x.y.z`). Simplemente inicia Enlace y los dispositivos conectados a tu Tailnet podrán acceder directamente a través de esa IP sin necesidad de túneles públicos.

### C. ngrok
Para pruebas rápidas y temporales:
```bash
ngrok http 41823
```
Comparte la URL temporal HTTPS generada con los dispositivos que desees conectar.
