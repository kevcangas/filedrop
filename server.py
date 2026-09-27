"""
Enlace (Filedrop) - Servidor de Transferencia Directa y Gestión Multi-Usuario
Entrypoint del servidor web Flask-SocketIO.
"""

from gevent import monkey
monkey.patch_all()

import os
import socket
import sys
import threading
import time
import webbrowser

from app import create_app
from app.extensions import db, socketio
from app.services import MailboxService

app = create_app()


def get_local_ip() -> str:
    """Detect primary LAN IP address of host machine."""
    env_ip = os.environ.get("ENLACE_HOST_IP", "").strip()
    if env_ip:
        return env_ip
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def print_banner(port: int, local_ip: str) -> None:
    """Print ASCII connection guide on terminal startup."""
    print("=" * 66)
    print(" ENLACE / FILEDROP - Servidor Multi-Usuario & Transferencia P2P")
    print("=" * 66)
    print(f" * Panel Local (esta PC):    http://localhost:{port}/")
    print(f" * Dispositivos en red WiFi: http://{local_ip}:{port}/")
    print(f" * Vista Móvil:              http://{local_ip}:{port}/mobile")
    pub = os.environ.get("ENLACE_PUBLIC_URL", "").strip()
    if pub:
        print(f" * Dirección Pública:        {pub}")
    print("=" * 66)


def auto_open_browser(port: int) -> None:
    """Open default web browser when launched locally on desktop."""
    if os.environ.get("ENLACE_NO_BROWSER", "0") in ("1", "true", "True"):
        return
    def _open():
        time.sleep(1.2)
        try:
            webbrowser.open(f"http://localhost:{port}/")
        except Exception:
            pass
    threading.Thread(target=_open, daemon=True).start()


if __name__ == "__main__":
    port = app.config.get("PORT", 41823)
    local_ip = get_local_ip()

    with app.app_context():
        try:
            from flask_migrate import upgrade
            upgrade()
        except Exception:
            try:
                db.create_all()
            except Exception as ex:
                print(f"Aviso de Base de Datos: {ex}")

        # Start Mailbox TTL garbage collector
        mailbox_svc = MailboxService(
            mailbox_dir=app.config["MAILBOX_DIR"],
            default_ttl_hours=app.config["MAILBOX_TTL_HOURS"],
        )
        mailbox_svc.start_cleanup_loop(app)

    print_banner(port, local_ip)
    auto_open_browser(port)

    # Launch server
    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        debug=False,
        allow_unsafe_werkzeug=True,
    )