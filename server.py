"""
Enlace - Servidor de transferencia de archivos, portapapeles y notificaciones
entre varios celulares y varias computadoras, en la misma red local o desde
afuera si se expone el servidor a internet (ver README).
-----------------------------------------------------------------------------
Ejecutar en la computadora que hara de "anfitriona" con:  python3 server.py
La terminal imprime las direcciones exactas a usar (el puerto cambia cada
vez que arrancas, salvo que fijes ENLACE_PORT). Luego, con ESE puerto:
  - En esa misma PC, abrir en el navegador:        http://localhost:<puerto>/
  - En un celular (misma red WiFi), abrir:         http://<IP>:<puerto>/mobile
  - En otra computadora (misma red WiFi), abrir:   http://<IP>:<puerto>/desktop

Cualquier dispositivo conectado (la PC anfitriona, otras PCs, o celulares)
aparece en la lista de todos los demas, y se puede elegir a cualquiera de
ellos como destino para enviar un archivo o el portapapeles.

Todo el sitio esta protegido por una contrasena de acceso (ver mas abajo,
ACCESS_PASSWORD). Nadie puede ver ni usar nada de Enlace sin escribirla
primero, ya sea en la misma red o desde afuera.
"""

import json
import os
import signal
import smtplib
import socket
import sys
import threading
import time
import uuid
from email.mime.text import MIMEText
from datetime import timedelta
from functools import wraps
import random
import string
import secrets #mejor que random
import mimetypes
import webbrowser

from flask import (
    Flask,
    Response,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
    send_from_directory,
    session,
    url_for,
)
from flask_socketio import SocketIO, emit

# Cuando esto corre como script normal (python3 server.py), BASE_DIR es la
# carpeta de este archivo, como siempre. Cuando corre empaquetado como
# ejecutable (con PyInstaller, ver "Version compilada, sin codigo visible"
# en el README), BASE_DIR pasa a ser la carpeta donde esta el .exe -para que
# lo que se guarda (uploads/, buzon/, etc.) quede junto al programa, en un
# lugar estable-, y los recursos de solo lectura (templates/, static/) se
# leen de _BUNDLE_DIR, la carpeta temporal donde PyInstaller los descomprime
# en cada arranque.
if getattr(sys, "frozen", False):
    BASE_DIR = os.path.dirname(sys.executable)
    _BUNDLE_DIR = getattr(sys, "_MEIPASS", BASE_DIR)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    _BUNDLE_DIR = BASE_DIR

# Cargar variables de entorno desde el archivo .env si existe
try:
    from dotenv import load_dotenv
    _env_file = os.path.join(BASE_DIR, ".env")
    if os.path.exists(_env_file):
        load_dotenv(dotenv_path=_env_file)
    else:
        load_dotenv()
except ImportError:
    pass

UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
MAILBOX_DIR = os.path.join(BASE_DIR, "buzon")
MAILBOX_INDEX_PATH = os.path.join(MAILBOX_DIR, "_index.json")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(MAILBOX_DIR, exist_ok=True)

#para cada nueva contraseña, es mejor que se cree de forma aletoria
#estaria poder recibirla mediante un mensaje o algo pero eso ya despues para seguridad

#tambien buscar una forma de proteger el mapeo y mejorar el diseño de la pagina web, mas en telefono


#estring de letras 
palabras = string.ascii_letters + string.digits + string.punctuation

#generar palabra aletorias de 15 maximo
alter = "".join(secrets.choice(palabras) for _ in range(15))


# ==============================================================================
# CONTRASENA DE ACCESO
# Nadie puede abrir ninguna pantalla de Enlace (ni conectarse por WebSocket,
# ni en la misma red ni desde afuera) sin escribir esta contrasena primero.
#
# Por defecto se genera SOLA, aleatoria, cada vez que arrancas Enlace (ver
# "NOTA DE SEGURIDAD" mas abajo) -no hace falta escribir ninguna a mano
# aqui-. Si en cambio prefieres una fija (por ejemplo para no tener que
# avisarle a alguien cada vez que cambia), define la variable de entorno
# ENLACE_PASSWORD antes de arrancar; eso tiene prioridad sobre la aleatoria
# y ademas desactiva la rotacion automatica.
# ==============================================================================
ACCESS_PASSWORD = os.environ.get("ENLACE_PASSWORD", alter)

# Si definiste ENLACE_PASSWORD a mano (una contrasena fija que elegiste tu),
# nunca la rotamos sola: seria confuso que cambiara una contrasena que
# pusiste tu mismo a proposito. La rotacion automatica de mas abajo solo
# aplica a la contrasena aleatoria generada arriba ("alter").
_password_fija_a_mano = bool(os.environ.get("ENLACE_PASSWORD", "").strip())

# Cada cuantas horas se genera una contrasena nueva sola, en caso de que no
# haya notificaciones por correo activas (si SI las hay, se usa ese mismo
# intervalo en su lugar -ver _email_notif_daemon()-, para que la contrasena
# nueva siempre llegue junto con el correo que avisa de ella). Ajustable con
# la variable de entorno ENLACE_PASSWORD_ROTAR_HORAS; 0 desactiva la rotacion.
PASSWORD_ROTATE_DEFAULT_HOURS = float(os.environ.get("ENLACE_PASSWORD_ROTAR_HORAS", "1") or 0)

# NOTA DE SEGURIDAD: si no se define ENLACE_PASSWORD, la contrasena de arriba
# (variable "alter") ya se genero con secrets.choice, que es un generador
# aleatorio criptografico (no el modulo "random" normal), asi que no hace
# falta cambiarla a mano para que sea segura. Lo unico que la debilita es
# como se comparte despues: si activas el envio por correo (mas abajo), la
# contrasena viaja en texto plano dentro del correo, asi que en ese caso la
# seguridad real depende de que tan protegida este esa cuenta de correo
# (usar una contrasena de aplicacion, no la normal, y activarlo solo en
# cuentas de confianza).

# Cuanto tiempo se guarda la sesion iniciada en un navegador antes de pedir
# la contrasena de nuevo (en dias).
SESSION_DAYS = int(os.environ.get("ENLACE_SESION_DIAS", "10"))

# Puerto en el que escucha el servidor (por defecto: 41823).
_env_port = os.environ.get("ENLACE_PORT", "41823").strip()
if _env_port and _env_port.isdigit():
    PORT = int(_env_port)
else:
    PORT = 41823

# Si vas a exponer Enlace a internet con un tunel (ngrok, Cloudflare Tunnel,
# etc.) o con redireccion de puertos + IP publica, puedes poner esa direccion
# aqui (o con la variable de entorno ENLACE_PUBLIC_URL) solo para que se
# imprima en la terminal al arrancar, como recordatorio. No hace falta para
# que Enlace funcione.

#el problema que omo ngrok cambia por seccion debo ser capaz de recibir lo ngrok mmm
PUBLIC_URL = os.environ.get("ENLACE_PUBLIC_URL", "").strip()

# Cuanto tiempo se queda un archivo en el "Buzon" (seccion de descarga
# posterior) antes de borrarse solo, en horas.
MAILBOX_TTL_HOURS = float(os.environ.get("ENLACE_BUZON_HORAS", "72"))

# ==============================================================================
# CORREO: mandar la contrasena y las direcciones a alguien de otra red.
#
# Hay dos formas, y NO hace falta configurar nada para usar la primera:
#
# 1. "Abrir en mi correo" (siempre disponible): arma un correo ya redactado
#    y lo abre en tu propia aplicacion de correo (Gmail, Outlook, la que
#    tengas puesta por defecto) para que tu le des "Enviar". Enlace nunca ve
#    ni toca tu contrasena de correo con este metodo.
#
# 2. "Enviar automaticamente" (opcional): el propio servidor manda el correo
#    sin que tengas que abrir nada, pero para eso necesita las credenciales
#    de una cuenta de correo que envie por el (un SMTP). Se configuran con
#    variables de entorno antes de arrancar server.py; si no las defines,
#    Enlace simplemente no ofrece esta opcion y te sugiere la anterior.
#    Ejemplo con Gmail (usando una "contraseña de aplicacion", no la tuya
#    normal: https://myaccount.google.com/apppasswords):
#
#      ENLACE_SMTP_HOST=smtp.gmail.com ENLACE_SMTP_PORT=587 \
#      ENLACE_SMTP_USER=tucuenta@gmail.com ENLACE_SMTP_PASS="clave de app" \
#      python3 server.py
# ==============================================================================
SMTP_HOST = os.environ.get("ENLACE_SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("ENLACE_SMTP_PORT", "587") or 587)
SMTP_USER = os.environ.get("ENLACE_SMTP_USER", "").strip()
SMTP_PASS = os.environ.get("ENLACE_SMTP_PASS", "").strip()
SMTP_FROM = os.environ.get("ENLACE_SMTP_FROM", "").strip() or SMTP_USER
SMTP_USE_TLS = os.environ.get("ENLACE_SMTP_TLS", "1") != "0"


def smtp_configured():
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASS)


# ==============================================================================
# CONFIGURACIÓN S3 CLOUD STORAGE
# ==============================================================================
S3_ENABLED = os.environ.get("ENLACE_S3_ENABLED", "0").strip().lower() in ("1", "true", "yes")
S3_ENDPOINT_URL = os.environ.get("ENLACE_S3_ENDPOINT_URL", "").strip() or None
if S3_ENDPOINT_URL and not (S3_ENDPOINT_URL.startswith("http://") or S3_ENDPOINT_URL.startswith("https://")):
    S3_ENDPOINT_URL = "http://" + S3_ENDPOINT_URL
if S3_ENDPOINT_URL and ("localhost:9000" in S3_ENDPOINT_URL or "127.0.0.1:9000" in S3_ENDPOINT_URL):
    try:
        socket.gethostbyname("app-minio")
        S3_ENDPOINT_URL = S3_ENDPOINT_URL.replace("localhost:9000", "app-minio:9000").replace("127.0.0.1:9000", "app-minio:9000")
    except Exception:
        pass
S3_REGION = os.environ.get("ENLACE_S3_REGION", "us-east-1").strip() or "us-east-1"
S3_BUCKET = os.environ.get("ENLACE_S3_BUCKET", "filedrop-storage").strip() or "filedrop-storage"
S3_ACCESS_KEY = os.environ.get("ENLACE_S3_ACCESS_KEY", "").strip()
S3_SECRET_KEY = os.environ.get("ENLACE_S3_SECRET_KEY", "").strip()
S3_PREFIX = os.environ.get("ENLACE_S3_PREFIX", "users/").strip()
if S3_PREFIX and not S3_PREFIX.endswith("/"):
    S3_PREFIX += "/"
S3_AUTO_CREATE_BUCKET = os.environ.get("ENLACE_S3_AUTO_CREATE_BUCKET", "1").strip().lower() in ("1", "true", "yes")

_s3_client = None
_s3_lock = threading.Lock()
_s3_bucket_verified = False


# ==============================================================================

# NOTIFICACIONES PERIÓDICAS POR CORREO
# El usuario las activa desde el panel de login o desde el panel de PC.
# Manda la contraseña + las URLs de acceso cada N horas mientras esté activo.
# Si PUBLIC_URL está definida (ngrok, Cloudflare Tunnel…), también se incluye.
# ==============================================================================

def _send_notif_email_with_cfg(cfg: dict):
    """Manda el correo periódico usando la config guardada en estado."""
    to    = cfg["to_addr"]
    host  = cfg["smtp_host"] or SMTP_HOST
    port  = int(cfg["smtp_port"] or SMTP_PORT)
    user  = cfg["smtp_user"] or SMTP_USER
    passwd = cfg["smtp_pass"] or SMTP_PASS
    tls   = cfg.get("smtp_tls", True)

    if not (host and user and passwd and to):
        raise ValueError("Configuración SMTP incompleta (host/user/pass/destino).")

    subject, body = build_access_message()

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"]    = user
    msg["To"]      = to

    with smtplib.SMTP(host, port, timeout=15) as srv:
        srv.ehlo()
        if tls:
            srv.starttls()
            srv.ehlo()
        srv.login(user, passwd)
        srv.sendmail(user, [to], msg.as_string())


def _configurar_email_notif(
    to_addr: str,
    smtp_user: str,
    smtp_pass: str,
    smtp_host: str = "smtp.gmail.com",
    smtp_port: int = 587,
    smtp_tls: bool = True,
    interval_hours: float = 1.0,
    duration_hours: float = 0.0,
):
    """Guarda la config de notificaciones y dispara el primer envío de inmediato."""
    global _last_password_rotation
    with _email_notif_lock:
        state["email_notif"].update({
            "enabled": True,
            "to_addr": to_addr,
            "smtp_host": smtp_host,
            "smtp_port": smtp_port,
            "smtp_user": smtp_user,
            "smtp_pass": smtp_pass,
            "smtp_tls": smtp_tls,
            "interval_hours": max(0.1, interval_hours),
            "duration_hours": max(0.0, duration_hours),
            "started_at": time.time(),
            "last_sent": 0.0,  # → el daemon lo detecta y manda en la próxima revisión
        })
    # El reloj de rotacion de la contrasena arranca desde este mismo
    # instante, para que quede sincronizado con el ciclo de correos que
    # acaba de empezar (misma duracion Y mismo punto de partida).
    with _password_rotation_lock:
        _last_password_rotation = time.time()

    # Primer envío inmediato (en hilo aparte para no bloquear la petición HTTP)
    def _first_send():
        try:
            _send_notif_email_with_cfg(state["email_notif"])
            with _email_notif_lock:
                state["email_notif"]["last_sent"] = time.time()
            print(f"[email-notif] ✓ Primer correo enviado a {to_addr}")
        except Exception as exc:
            print(f"[email-notif] ✗ Error en el primer envío: {exc}")

    threading.Thread(target=_first_send, daemon=True).start()


def _rotar_password_si_toca(interval_hours: float):
    """Genera una contrasena nueva si ya paso 'interval_hours' desde la
    ultima rotacion. Se llama una vez por minuto desde _email_notif_daemon,
    tanto si las notificaciones por correo estan activas (ahi se usa el
    mismo intervalo que ellas, para que la contrasena nueva y el correo que
    la avisa siempre coincidan) como si no (ahi se usa el intervalo por
    defecto, como respaldo de seguridad aunque nadie este recibiendo avisos).
    """
    global ACCESS_PASSWORD, _last_password_rotation

    if _password_fija_a_mano or not interval_hours or interval_hours <= 0:
        return

    interval_secs = interval_hours * 3600
    with _password_rotation_lock:
        if time.time() - _last_password_rotation < interval_secs:
            return
        ACCESS_PASSWORD = "".join(secrets.choice(palabras) for _ in range(15))
        _last_password_rotation = time.time()
    print("=" * 60)
    print(f" [seguridad] Contraseña rotada automáticamente (cada {interval_hours:g}h).")
    print(f"   Nueva clave de acceso: {ACCESS_PASSWORD}")
    print("=" * 60)


def _email_notif_daemon():
    """Hilo daemon que revisa cada minuto si hay que mandar el correo periódico."""
    while True:
        time.sleep(60)
        try:
            with _email_notif_lock:
                cfg = dict(state["email_notif"])  # copia para no bloquear mucho tiempo

            # La contrasena rota con el mismo intervalo que el correo cuando
            # este esta activo; si no, con el intervalo por defecto.
            _rotar_password_si_toca(
                cfg["interval_hours"] if cfg["enabled"] else PASSWORD_ROTATE_DEFAULT_HOURS
            )

            if not cfg["enabled"]:
                continue

            # ── Expiración por duración ──────────────────────────────────────
            if cfg["duration_hours"] > 0:
                elapsed_h = (time.time() - cfg["started_at"]) / 3600
                if elapsed_h >= cfg["duration_hours"]:
                    with _email_notif_lock:
                        state["email_notif"]["enabled"] = False
                    print("[email-notif] Notificaciones desactivadas automáticamente (duración cumplida).")
                    continue

            # ── ¿Toca enviar? ────────────────────────────────────────────────
            interval_secs = cfg["interval_hours"] * 3600
            if time.time() - cfg["last_sent"] >= interval_secs:
                try:
                    _send_notif_email_with_cfg(cfg)
                    with _email_notif_lock:
                        state["email_notif"]["last_sent"] = time.time()
                    print(f"[email-notif] ✓ Correo periódico enviado a {cfg['to_addr']}")
                except Exception as exc:
                    print(f"[email-notif] ✗ Error enviando correo: {exc}")

        except Exception as exc:
            print(f"[email-notif] Error inesperado en el daemon: {exc}")


def build_access_message():
    """Arma el asunto y el cuerpo del correo con las direcciones y la clave."""
    ip = get_local_ip()
    lines = [
        "Datos para entrar a Enlace ahora mismo:",
        "",
        f"Computadora anfitriona: http://{ip}:{PORT}/",
        f"Celular:                http://{ip}:{PORT}/mobile",
        f"Otra computadora:       http://{ip}:{PORT}/desktop",
    ]
    if PUBLIC_URL:
        lines.append(f"Acceso externo:         {PUBLIC_URL}")
    lines += [
        "",
        f"Contraseña de acceso: {ACCESS_PASSWORD}",
        "",
        "(La direccion y, si no se fijo ENLACE_PORT, tambien el puerto,",
        "cambian cada vez que se vuelve a arrancar Enlace.)",
    ]
    return "Acceso a Enlace", "\n".join(lines)


def send_email(to_addr, subject, body):
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_addr
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
        server.ehlo()
        if SMTP_USE_TLS:
            server.starttls()
            server.ehlo()
        server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(SMTP_FROM, [to_addr], msg.as_string())

app = Flask(
    __name__,
    template_folder=os.path.join(_BUNDLE_DIR, "templates"),
    static_folder=os.path.join(_BUNDLE_DIR, "static"),
)
app.config["SECRET_KEY"] = os.environ.get("ENLACE_SECRET_KEY", "enlace-cambia-esta-clave-secreta")
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=SESSION_DAYS)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024 * 1024  # 2 GB por subida al buzon
# Cookie de sesion un poco mas dura: no accesible por JS y no se manda en
# peticiones que vienen de otros sitios.
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

# Soporte para Nginx / Reverse Proxy (para leer IP real y protocolo X-Forwarded-*)
try:
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
except ImportError:
    pass

socketio = SocketIO(app, cors_allowed_origins="*", max_http_buffer_size=20 * 1024 * 1024)

# --- Estado en memoria del servidor -----------------------------------------
# devices: { sid: {"device_id": str, "device_name": str, "device_type": "pc"|"phone"} }
# device_to_sid: { device_id: sid actual } -> permite reencontrar a un dispositivo
#                 despues de que se reconecte con un sid nuevo (para poder
#                 reanudar transferencias en curso) y para dirigirle mensajes
#                 (envios, portapapeles) por su identidad permanente.
# clipboard: ultimo valor de portapapeles compartido en todo el enlace, para
#            que un dispositivo que se conecta despues lo vea de inmediato.
# mailbox: { target_device_id_o_"todos": [ {id, filename, size, ...}, ... ] }
#          archivos guardados en disco (carpeta buzon/) para descargar despues,
#          aunque el que los mando ya no este conectado.
state = {
    "devices": {},
    "device_to_sid": {},
    "clipboard": None,
    "mailbox": {},
    # --- Notificaciones periódicas por correo ---
    # El usuario las activa desde el panel de login o desde el panel de PC.
    # El hilo daemon _email_notif_daemon lee este dict cada minuto.
    # smtp_pass se guarda en memoria y nunca se devuelve en las respuestas API.
    "email_notif": {
        "enabled": False,
        "to_addr": "",          # correo destino (quien recibe)
        "smtp_host": "",        # servidor SMTP emisor (vacío → usa env ENLACE_SMTP_*)
        "smtp_port": 587,
        "smtp_user": "",        # cuenta emisora
        "smtp_pass": "",        # contraseña de app (nunca se expone por API)
        "smtp_tls": True,
        "interval_hours": 1.0, # cada cuántas horas mandar
        "duration_hours": 0.0, # 0 = indefinido, >0 = desactivar después de N horas
        "started_at": 0.0,
        "last_sent": 0.0,
    },
}

# Lock para acceder a state["email_notif"] desde el hilo daemon y los handlers HTTP
_email_notif_lock = threading.Lock()

# --- Rotacion automatica de la contrasena de acceso --------------------------
_password_rotation_lock = threading.Lock()
_last_password_rotation = time.time()


def get_local_ip():
    """Devuelve la IP que se muestra/usa como direccion de la anfitriona.

    Si se definio ENLACE_HOST_IP (variable de entorno), esa es siempre la
    que se usa, sin intentar detectar nada. Esto es necesario en dos casos:

    - Cuando quieres una IP fija de verdad (por ejemplo porque le reservaste
      esa IP a esta maquina en el router, o porque el contenedor Docker
      tiene una IP fija asignada -ver docker-compose.yml-): asi Enlace
      siempre anuncia esa misma direccion, en vez de una que puede cambiar.
    - Cuando Enlace corre DENTRO de un contenedor Docker: la deteccion
      automatica de mas abajo encontraria la IP interna del contenedor
      (la de la red de Docker), no la IP real de la maquina/host dentro de
      la red local, asi que sin ENLACE_HOST_IP el resto de dispositivos no
      podrian conectarse con esa direccion.
    """
    env_ip = os.environ.get("ENLACE_HOST_IP", "").strip()
    if env_ip:
        return env_ip

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


# --- Autenticacion -------------------------------------------------------------
# Toda la app esta detras de una contrasena. Las unicas rutas abiertas son la
# de login y los archivos estaticos (CSS/JS) que la propia pantalla de login
# necesita para verse bien.

OPEN_EXACT_PATHS = ("/login", "/manifest.json", "/service-worker.js")
OPEN_PREFIXES = ("/static/",)


def is_logged_in():
    return session.get("enlace_auth") is True


# --- Bloqueo por intentos fallidos de contrasena --------------------------------
# Para que alguien no pueda simplemente probar contrasenas una tras otra
# (fuerza bruta). Se cuenta por IP: despues de varios intentos fallidos
# seguidos, esa IP se bloquea un rato antes de poder intentar de nuevo.
LOGIN_MAX_ATTEMPTS = 6
LOGIN_LOCKOUT_SECONDS = 5 * 60  # 5 minutos

_login_attempts = {}  # { ip: {"count": int, "locked_until": epoch_seconds} }
_login_attempts_lock = threading.Lock()


def _client_ip():
    # Si el servidor esta detras de un proxy/tunel que agrega X-Forwarded-For,
    # lo usamos; si no, la IP normal de la conexion.
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "desconocida"


def _login_locked_seconds_left(ip):
    with _login_attempts_lock:
        entry = _login_attempts.get(ip)
        if not entry:
            return 0
        restante = entry.get("locked_until", 0) - time.time()
        return max(0, int(restante))


def _register_failed_login(ip):
    with _login_attempts_lock:
        entry = _login_attempts.setdefault(ip, {"count": 0, "locked_until": 0})
        entry["count"] += 1
        if entry["count"] >= LOGIN_MAX_ATTEMPTS:
            entry["locked_until"] = time.time() + LOGIN_LOCKOUT_SECONDS
            entry["count"] = 0


def _clear_failed_logins(ip):
    with _login_attempts_lock:
        _login_attempts.pop(ip, None)


@app.before_request
def require_login():
    path = request.path
    if path in OPEN_EXACT_PATHS or path.startswith(OPEN_PREFIXES):
        return None
    if is_logged_in():
        return None
    if path.startswith("/api/"):
        return jsonify({"error": "No autorizado. Inicia sesion primero."}), 401
    return redirect(url_for("login", next=path))


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    ip = _client_ip()
    # Mismo criterio que la ruta "/": solo la maquina que corre el servidor
    # (entra por localhost) cuenta como anfitriona. Un invitado no deberia
    # ver ni poder activar el panel de "avisos por correo" -eso es cosa de
    # quien administra el servidor, no de quien solo se conecta a transferir.
    es_anfitriona = ip in ("127.0.0.1", "::1")
    if request.method == "POST":
        espera = _login_locked_seconds_left(ip)
        if espera > 0:
            minutos = espera // 60
            segundos = espera % 60
            error = (
                f"Demasiados intentos fallidos desde esta red. "
                f"Espera {minutos}m {segundos}s antes de volver a intentar."
            )
        else:
            submitted = request.form.get("password", "")
            if submitted and submitted == ACCESS_PASSWORD:
                _clear_failed_logins(ip)
                session["enlace_auth"] = True
                session.permanent = True

                # ── Notificaciones por correo (opcionales, solo anfitriona) ──
                if es_anfitriona and request.form.get("email_activo"):
                    to_addr   = request.form.get("email_destino", "").strip()
                    s_user    = request.form.get("smtp_user", "").strip() or SMTP_USER
                    s_pass    = request.form.get("smtp_pass", "").strip() or SMTP_PASS
                    s_host    = request.form.get("smtp_host", "").strip() or SMTP_HOST or "smtp.gmail.com"
                    s_port    = int(request.form.get("smtp_port", "587") or 587)
                    interval  = float(request.form.get("intervalo", "1") or 1)
                    duration  = float(request.form.get("duracion", "0") or 0)
                    if to_addr and "@" in to_addr and s_user and s_pass:
                        _configurar_email_notif(
                            to_addr=to_addr,
                            smtp_user=s_user,
                            smtp_pass=s_pass,
                            smtp_host=s_host,
                            smtp_port=s_port,
                            interval_hours=interval,
                            duration_hours=duration,
                        )
                # ───────────────────────────────────────────────────────────────

                next_path = request.form.get("next") or "/"
                if not next_path.startswith("/"):
                    next_path = "/"
                return redirect(next_path)
            _register_failed_login(ip)
            error = "Contrasena incorrecta. Intenta de nuevo."
    next_path = request.args.get("next", "/")
    return render_template("login.html", error=error, next_path=next_path, es_anfitriona=es_anfitriona)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# --- Rutas HTTP --------------------------------------------------------------

@app.route("/")
@app.route("/desktop")
@app.route("/pc")
@app.route("/host")
def pc_interface():
    ua = request.headers.get("User-Agent", "").lower()
    is_mobile = any(m in ua for m in ("iphone", "android", "ipad", "mobile"))
    if is_mobile:
        return redirect(url_for("phone_interface"))
    return render_template("pc.html", local_ip=get_local_ip(), port=PORT)


@app.route("/mobile")
def phone_interface():
    return render_template("remote.html", local_ip=get_local_ip(), port=PORT, default_type="phone")


@app.route("/api/info")
def api_info():
    return jsonify({
        "local_ip": get_local_ip(),
        "port": PORT,
        "mailbox_ttl_hours": MAILBOX_TTL_HOURS,
        "public_url": PUBLIC_URL,          # vacío si no hay túnel activo
    })


@app.route("/manifest.json")
def manifest():
    device_type = request.args.get("type", "phone")
    is_pc = device_type == "pc"
    return jsonify({
        "name": "Enlace" + (" · computadora" if is_pc else " · celular"),
        "short_name": "Enlace",
        "description": "Transferencia de archivos, portapapeles y notificaciones entre celulares y computadoras",
        "start_url": "/desktop" if is_pc else "/mobile",
        "scope": "/",
        "display": "standalone",
        "background_color": "#10161c",
        "theme_color": "#10161c",
        "orientation": "any" if is_pc else "portrait",
        "icons": [
            {"src": "/static/icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/static/icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
        ],
    })


@app.route("/api/compartir/texto")
def compartir_texto():
    """Da el asunto/cuerpo ya armados, para el boton 'Abrir en mi correo'
    (que usa el propio correo del usuario, sin pasar por este servidor) y
    para saber si tambien esta disponible el envio automatico."""
    subject, body = build_access_message()
    return jsonify({"subject": subject, "body": body, "smtp_configurado": smtp_configured()})


@app.route("/api/compartir/correo", methods=["POST"])
def compartir_correo():
    """Envia el correo directamente desde el servidor (solo si se configuro
    una cuenta SMTP emisora con las variables ENLACE_SMTP_*)."""
    if not smtp_configured():
        return jsonify({
            "error": "smtp_no_configurado",
            "message": (
                "El envío automático no está configurado en este servidor "
                "(faltan las variables ENLACE_SMTP_HOST/USER/PASS). Usa "
                "'Abrir en mi correo' para mandarlo desde tu propia cuenta, "
                "sin configurar nada."
            ),
        }), 400

    data = request.get_json(silent=True) or {}
    to_addr = (data.get("to") or "").strip()
    if not to_addr or "@" not in to_addr:
        return jsonify({"error": "correo_invalido", "message": "Escribe un correo destino válido."}), 400

    subject, body = build_access_message()
    try:
        send_email(to_addr, subject, body)
    except Exception as exc:
        return jsonify({"error": "envio_fallo", "message": f"No se pudo enviar: {exc}"}), 502

    return jsonify({"ok": True})


# ==============================================================================
# RUTAS DE NOTIFICACIONES PERIÓDICAS POR CORREO
# ==============================================================================

@app.route("/api/email_notif/configurar", methods=["POST"])
def email_notif_configurar():
    """Guarda la config y (re)activa las notificaciones periódicas."""
    data = request.get_json(silent=True) or {}

    to_addr      = (data.get("to_addr") or "").strip()
    smtp_user    = (data.get("smtp_user") or "").strip() or SMTP_USER
    smtp_pass    = (data.get("smtp_pass") or "").strip() or SMTP_PASS
    smtp_host    = (data.get("smtp_host") or "").strip() or SMTP_HOST or "smtp.gmail.com"
    smtp_port    = int(data.get("smtp_port") or SMTP_PORT or 587)
    smtp_tls     = bool(data.get("smtp_tls", True))
    interval_h   = float(data.get("interval_hours") or 1)
    duration_h   = float(data.get("duration_hours") or 0)

    if not to_addr or "@" not in to_addr:
        return jsonify({"error": "Correo destino inválido."}), 400
    if not (smtp_host and smtp_user and smtp_pass):
        return jsonify({"error": "Faltan credenciales SMTP (host, usuario y contraseña de app)."}), 400

    _configurar_email_notif(
        to_addr=to_addr,
        smtp_user=smtp_user,
        smtp_pass=smtp_pass,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        smtp_tls=smtp_tls,
        interval_hours=interval_h,
        duration_hours=duration_h,
    )
    return jsonify({"ok": True})


@app.route("/api/email_notif/estado")
def email_notif_estado():
    """Devuelve el estado actual (sin la contraseña SMTP)."""
    with _email_notif_lock:
        cfg = dict(state["email_notif"])
    cfg.pop("smtp_pass", None)  # nunca exponer la contraseña
    return jsonify(cfg)


@app.route("/api/email_notif/desactivar", methods=["POST"])
def email_notif_desactivar():
    """Desactiva las notificaciones periódicas."""
    with _email_notif_lock:
        state["email_notif"]["enabled"] = False
    return jsonify({"ok": True})


# ==============================================================================
# ACTUALIZACIÓN EN CALIENTE DE LA URL PÚBLICA (ngrok / Cloudflare Tunnel / etc.)
# El panel de PC puede llamar a esta ruta para cambiar PUBLIC_URL sin
# reiniciar el servidor; la nueva URL se incluirá en los próximos correos.
# ==============================================================================

@app.route("/api/ngrok/actualizar", methods=["POST"])
def ngrok_actualizar():
    """Actualiza la URL pública en memoria (sin reiniciar el servidor)."""
    global PUBLIC_URL
    data = request.get_json(silent=True) or {}
    PUBLIC_URL = (data.get("url") or "").strip()
    print(f"[ngrok] URL pública → {PUBLIC_URL or '(ninguna)'}")
    return jsonify({"ok": True, "url": PUBLIC_URL})


@app.route("/service-worker.js")
def service_worker():
    # Se sirve desde la raiz para que el scope cubra toda la app (requisito de PWA)
    return send_from_directory(os.path.join(BASE_DIR, "static"), "service-worker.js")


# --- Utilidad: lista de dispositivos para mandar a los demas -----------------

def device_entry(sid):
    info = state["devices"][sid]
    return {
        "sid": sid,
        "device_id": info["device_id"],
        "device_name": info["device_name"],
        "device_type": info.get("device_type", "phone"),
        "is_host": info.get("is_host", False),
    }


def devices_payload_excluding(exclude_sid):
    """Lista de dispositivos para mandarle a exclude_sid (nunca se incluye a
    si mismo). Ademas, si por alguna razon hay mas de una conexion marcada
    como anfitriona al mismo tiempo (dos pestañas abiertas en la misma PC,
    o una pestaña vieja que tardo un instante en desconectarse), solo se
    deja pasar la mas reciente: asi nunca se ven "dos anfitrionas" en la
    lista, aunque tecnicamente haya dos sockets abiertos un momento.
    """
    entries = [device_entry(sid) for sid in state["devices"] if sid != exclude_sid]
    last_host_sid = None
    for sid, info in state["devices"].items():
        if info.get("is_host"):
            last_host_sid = sid
    return [e for e in entries if not e["is_host"] or e["sid"] == last_host_sid]


def broadcast_device_list():
    """Manda a cada dispositivo la lista de TODOS los demas (sin incluirse a si mismo)."""
    for sid in list(state["devices"].keys()):
        emit("device_list", devices_payload_excluding(sid), to=sid)


def sid_for_device(device_id):
    sid = state["device_to_sid"].get(device_id)
    if sid and sid in state["devices"]:
        return sid
    return None


# --- Buzon: archivos guardados en disco para descargar despues ---------------
# A diferencia del envio en vivo (que va fragmento a fragmento por WebSocket y
# necesita que ambos dispositivos esten conectados al mismo tiempo), el buzon
# se sube una sola vez por HTTP normal y se queda guardado en la carpeta
# buzon/ hasta que lo descarguen o hasta que pase su tiempo limite.

def public_mailbox_entry(entry):
    return {k: v for k, v in entry.items() if k != "stored_name"}


def save_mailbox_index():
    try:
        with open(MAILBOX_INDEX_PATH, "w", encoding="utf-8") as fh:
            json.dump(state["mailbox"], fh)
    except OSError:
        pass


def load_mailbox_index():
    if os.path.exists(MAILBOX_INDEX_PATH):
        try:
            with open(MAILBOX_INDEX_PATH, "r", encoding="utf-8") as fh:
                state["mailbox"] = json.load(fh)
        except (OSError, json.JSONDecodeError):
            state["mailbox"] = {}


def find_mailbox_entry(item_id):
    for bucket_id, items in state["mailbox"].items():
        for entry in items:
            if entry["id"] == item_id:
                return entry, bucket_id
    return None, None


def remove_mailbox_entry(bucket_id, item_id):
    items = state["mailbox"].get(bucket_id, [])
    for entry in list(items):
        if entry["id"] == item_id:
            items.remove(entry)
            path = os.path.join(MAILBOX_DIR, entry["stored_name"])
            if os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass
    save_mailbox_index()


def purge_expired_mailbox():
    now = time.time()
    changed = False
    for bucket_id in list(state["mailbox"].keys()):
        items = state["mailbox"][bucket_id]
        keep = []
        for entry in items:
            if entry["expires_at"] <= now:
                path = os.path.join(MAILBOX_DIR, entry["stored_name"])
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass
                changed = True
            else:
                keep.append(entry)
        state["mailbox"][bucket_id] = keep
    if changed:
        save_mailbox_index()


def mailbox_cleanup_loop():
    while True:
        time.sleep(600)  # revisa cada 10 minutos
        purge_expired_mailbox()


@app.route("/api/buzon/enviar", methods=["POST"])
def buzon_enviar():
    """Sube un archivo (o un .zip ya empaquetado desde el navegador) al buzon."""
    if "file" not in request.files:
        return jsonify({"error": "Falta el archivo."}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "Archivo vacio."}), 400

    target_device_id = request.form.get("target_device_id") or "todos"
    from_device_id = request.form.get("from_device_id", "")
    from_device_name = request.form.get("from_device_name", "Dispositivo")
    is_bundle = request.form.get("is_bundle") == "1"
    try:
        bundle_count = int(request.form.get("bundle_count", "1") or 1)
    except ValueError:
        bundle_count = 1

    item_id = uuid.uuid4().hex
    safe_name = os.path.basename(f.filename)
    stored_name = f"{item_id}__{safe_name}"
    stored_path = os.path.join(MAILBOX_DIR, stored_name)
    f.save(stored_path)
    size = os.path.getsize(stored_path)

    entry = {
        "id": item_id,
        "filename": safe_name,
        "size": size,
        "mimetype": f.mimetype or "application/octet-stream",
        "from_device_id": from_device_id,
        "from_device_name": from_device_name,
        "target_device_id": target_device_id,
        "is_bundle": is_bundle,
        "bundle_count": bundle_count,
        "ts": time.time(),
        "expires_at": time.time() + MAILBOX_TTL_HOURS * 3600,
        "stored_name": stored_name,
    }
    state["mailbox"].setdefault(target_device_id, []).append(entry)
    save_mailbox_index()

    # Si el destino esta conectado ahora mismo, le avisamos en vivo para que
    # actualice su lista sin tener que refrescar.
    public = public_mailbox_entry(entry)
    if target_device_id == "todos":
        for sid in state["devices"]:
            socketio.emit("buzon_nuevo", public, to=sid)
    else:
        target_sid = sid_for_device(target_device_id)
        if target_sid:
            socketio.emit("buzon_nuevo", public, to=target_sid)

    return jsonify({"ok": True, "entry": public})


@app.route("/api/buzon/lista")
def buzon_lista():
    device_id = request.args.get("device_id", "")
    items = list(state["mailbox"].get(device_id, [])) + list(state["mailbox"].get("todos", []))
    items.sort(key=lambda e: e["ts"], reverse=True)
    return jsonify([public_mailbox_entry(e) for e in items])


@app.route("/api/buzon/descargar/<item_id>")
def buzon_descargar(item_id):
    entry, _bucket_id = find_mailbox_entry(item_id)
    if not entry:
        abort(404)
    path = os.path.join(MAILBOX_DIR, entry["stored_name"])
    if not os.path.exists(path):
        abort(404)
    return send_file(path, as_attachment=True, download_name=entry["filename"])


@app.route("/api/buzon/borrar/<item_id>", methods=["POST"])
def buzon_borrar(item_id):
    entry, bucket_id = find_mailbox_entry(item_id)
    if not entry:
        return jsonify({"ok": False}), 404
    remove_mailbox_entry(bucket_id, item_id)
    return jsonify({"ok": True})


# ==============================================================================
# S3 CLOUD STORAGE MODULE & ENDPOINTS
# ==============================================================================

def get_s3_client():
    """Devuelve la instancia de boto3 S3 client o (None, error_msg)."""
    global _s3_client, _s3_bucket_verified
    if not S3_ENABLED:
        return None, "S3 storage is disabled (ENLACE_S3_ENABLED=0)."

    with _s3_lock:
        if _s3_client is not None and _s3_bucket_verified:
            return _s3_client, None

        try:
            import boto3
            from botocore.config import Config
            from botocore.exceptions import ClientError
        except ImportError:
            return None, "boto3 library is not installed in the Python environment."

        client_kwargs = {
            "service_name": "s3",
            "region_name": S3_REGION,
            "config": Config(signature_version="s3v4", s3={"addressing_style": "auto"}),
        }
        if S3_ENDPOINT_URL:
            client_kwargs["endpoint_url"] = S3_ENDPOINT_URL
        if S3_ACCESS_KEY and S3_SECRET_KEY:
            client_kwargs["aws_access_key_id"] = S3_ACCESS_KEY
            client_kwargs["aws_secret_access_key"] = S3_SECRET_KEY

        try:
            client = boto3.client(**client_kwargs)
            if not _s3_bucket_verified:
                try:
                    client.head_bucket(Bucket=S3_BUCKET)
                except ClientError as e:
                    code = str(e.response.get("Error", {}).get("Code", ""))
                    if code in ("404", "NoSuchBucket") and S3_AUTO_CREATE_BUCKET:
                        print(f"[S3] Bucket '{S3_BUCKET}' does not exist. Creating it automatically...")
                        create_kwargs = {"Bucket": S3_BUCKET}
                        if S3_REGION != "us-east-1" and not S3_ENDPOINT_URL:
                            create_kwargs["CreateBucketConfiguration"] = {"LocationConstraint": S3_REGION}
                        client.create_bucket(**create_kwargs)
                        print(f"[S3] Bucket '{S3_BUCKET}' created successfully.")
                    else:
                        raise e
                _s3_bucket_verified = True

            _s3_client = client
            return _s3_client, None
        except Exception as e:
            return None, f"Failed to connect to S3: {str(e)}"


def get_caller_user_id():
    """Identifica al usuario o dispositivo llamante para aislar su prefijo en S3."""
    user_id = ""
    if request.is_json and request.json:
        user_id = request.json.get("user_id") or request.json.get("device_id") or ""
    if not user_id:
        user_id = request.values.get("user_id") or request.values.get("device_id") or ""
    if not user_id:
        user_id = request.headers.get("X-User-Id") or request.headers.get("X-Device-Id") or ""
    if not user_id:
        user_id = session.get("device_id") or "default_user"
    clean_id = "".join(c for c in str(user_id) if c.isalnum() or c in ("-", "_")).strip()
    return clean_id or "default_user"


def get_user_s3_root(user_id):
    """Devuelve el prefijo raíz exclusivo para este usuario (ej: users/device123/)."""
    safe_user = "".join(c for c in str(user_id) if c.isalnum() or c in ("-", "_")).strip() or "default_user"
    return f"{S3_PREFIX}{safe_user}/"


def sanitize_folder_path(folder_str):
    """Limpia y normaliza la ruta de subcarpetas (evita '../', '//', etc.)."""
    if not folder_str:
        return ""
    normalized = str(folder_str).replace("\\", "/")
    segments = [s.strip() for s in normalized.split("/") if s.strip() and s.strip() not in (".", "..")]
    if not segments:
        return ""
    clean_segments = ["".join(c for c in s if c.isalnum() or c in ("-", "_", " ", ".")).strip() for s in segments]
    clean_segments = [s for s in clean_segments if s]
    if not clean_segments:
        return ""
    return "/".join(clean_segments) + "/"


def clean_display_name(key):
    """Extrae el nombre original del archivo eliminando el prefijo interno <id>__."""
    basename = key.split("/")[-1]
    if "__" in basename:
        parts = basename.split("__", 1)
        if len(parts[0]) in (8, 16, 32):
            return parts[1]
    return basename


@app.route("/api/s3/status", methods=["GET"])
def s3_status():
    """Devuelve el estado de conexión del módulo S3 y la información del bucket."""
    user_id = get_caller_user_id()
    user_root = get_user_s3_root(user_id)

    if not S3_ENABLED:
        return jsonify({
            "ok": True,
            "enabled": False,
            "connected": False,
            "bucket": S3_BUCKET,
            "region": S3_REGION,
            "user_id": user_id,
            "user_prefix": user_root,
            "error": "S3 storage is disabled (ENLACE_S3_ENABLED=0).",
        })

    client, err = get_s3_client()
    return jsonify({
        "ok": True,
        "enabled": S3_ENABLED,
        "connected": client is not None,
        "bucket": S3_BUCKET,
        "region": S3_REGION,
        "user_id": user_id,
        "user_prefix": user_root,
        "error": err,
    })


@app.route("/api/s3/upload", methods=["POST"])
def s3_upload():
    """Sube un archivo directamente a S3 dentro del prefijo y subcarpeta del usuario."""
    client, err = get_s3_client()
    if not client:
        return jsonify({"ok": False, "error": err}), 400

    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file provided in form-data."}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"ok": False, "error": "Empty filename."}), 400

    user_id = get_caller_user_id()
    folder_raw = request.form.get("folder") or request.form.get("subprefix") or ""
    folder_clean = sanitize_folder_path(folder_raw)

    safe_name = os.path.basename(f.filename)
    item_id = uuid.uuid4().hex[:8]
    stored_name = f"{item_id}__{safe_name}"

    user_root = get_user_s3_root(user_id)
    s3_key = f"{user_root}{folder_clean}{stored_name}"

    content_type = f.mimetype or mimetypes.guess_type(safe_name)[0] or "application/octet-stream"

    try:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(0)
    except Exception:
        size = 0

    extra_args = {
        "ContentType": content_type,
        "Metadata": {
            "original-name": safe_name,
            "uploader-id": user_id,
            "timestamp": str(int(time.time())),
        },
    }

    try:
        client.upload_fileobj(f, S3_BUCKET, s3_key, ExtraArgs=extra_args)
        return jsonify({
            "ok": True,
            "key": s3_key,
            "name": safe_name,
            "size": size,
            "folder": folder_clean,
            "user_id": user_id,
            "mimetype": content_type,
        })
    except Exception as e:
        return jsonify({"ok": False, "error": f"Upload to S3 failed: {str(e)}"}), 500


@app.route("/api/s3/files", methods=["GET"])
def s3_files():
    """Lista las subcarpetas inmediatas y los archivos dentro del prefijo del usuario."""
    client, err = get_s3_client()
    if not client:
        return jsonify({"ok": False, "error": err}), 400

    user_id = get_caller_user_id()
    user_root = get_user_s3_root(user_id)

    folder_raw = request.args.get("folder") or request.args.get("subprefix") or ""
    folder_clean = sanitize_folder_path(folder_raw)
    current_prefix = f"{user_root}{folder_clean}"

    delimiter = request.args.get("delimiter", "/")

    try:
        paginator = client.get_paginator("list_objects_v2")
        iterator = paginator.paginate(
            Bucket=S3_BUCKET,
            Prefix=current_prefix,
            Delimiter=delimiter if delimiter else "/",
        )

        folders = []
        files = []

        for page in iterator:
            for cp in page.get("CommonPrefixes", []):
                cp_prefix = cp.get("Prefix", "")
                if cp_prefix.startswith(current_prefix):
                    rel = cp_prefix[len(current_prefix):].rstrip("/")
                    if rel and "/" not in rel:
                        folders.append({
                            "name": rel,
                            "path": f"{folder_clean}{rel}/",
                            "full_prefix": cp_prefix,
                        })

            for obj in page.get("Contents", []):
                k = obj.get("Key", "")
                if k == current_prefix or k.endswith("/"):
                    continue

                size = obj.get("Size", 0)
                last_mod = obj.get("LastModified")
                last_mod_str = last_mod.isoformat() if hasattr(last_mod, "isoformat") else str(last_mod)
                last_mod_ts = last_mod.timestamp() if hasattr(last_mod, "timestamp") else time.time()

                disp_name = clean_display_name(k)
                mimetype = mimetypes.guess_type(disp_name)[0] or "application/octet-stream"

                files.append({
                    "key": k,
                    "name": disp_name,
                    "size": size,
                    "last_modified": last_mod_str,
                    "timestamp": last_mod_ts,
                    "mimetype": mimetype,
                    "folder": folder_clean,
                })

        folders.sort(key=lambda x: x["name"].lower())
        files.sort(key=lambda x: x["timestamp"], reverse=True)

        return jsonify({
            "ok": True,
            "bucket": S3_BUCKET,
            "user_id": user_id,
            "user_prefix": user_root,
            "current_folder": folder_clean,
            "folders": folders,
            "files": files,
            "total_files": len(files),
            "total_size": sum(f["size"] for f in files),
        })
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to list S3 objects: {str(e)}"}), 500


@app.route("/api/s3/folders/create", methods=["POST"])
def s3_folders_create():
    """Crea un marcador de carpeta virtual dentro del espacio del usuario."""
    client, err = get_s3_client()
    if not client:
        return jsonify({"ok": False, "error": err}), 400

    data = request.get_json(silent=True) or request.form
    raw_path = data.get("path") or ""
    clean_path = sanitize_folder_path(raw_path)
    if not clean_path:
        return jsonify({"ok": False, "error": "Invalid or empty folder path."}), 400

    user_id = get_caller_user_id()
    user_root = get_user_s3_root(user_id)
    folder_key = f"{user_root}{clean_path}"

    try:
        client.put_object(
            Bucket=S3_BUCKET,
            Key=folder_key,
            Body=b"",
            ContentType="application/x-directory",
        )
        return jsonify({"ok": True, "path": clean_path, "key": folder_key})
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to create folder: {str(e)}"}), 500


@app.route("/api/s3/folders/delete", methods=["POST"])
def s3_folders_delete():
    """Elimina una subcarpeta y todos los objetos contenidos bajo ella."""
    client, err = get_s3_client()
    if not client:
        return jsonify({"ok": False, "error": err}), 400

    data = request.get_json(silent=True) or request.form
    raw_path = data.get("path") or ""
    clean_path = sanitize_folder_path(raw_path)
    if not clean_path:
        return jsonify({"ok": False, "error": "Invalid or empty folder path."}), 400

    user_id = get_caller_user_id()
    user_root = get_user_s3_root(user_id)
    target_prefix = f"{user_root}{clean_path}"

    try:
        paginator = client.get_paginator("list_objects_v2")
        deleted_count = 0
        for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=target_prefix):
            objects_to_delete = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
            if objects_to_delete:
                client.delete_objects(
                    Bucket=S3_BUCKET,
                    Delete={"Objects": objects_to_delete, "Quiet": True},
                )
                deleted_count += len(objects_to_delete)

        return jsonify({"ok": True, "path": clean_path, "deleted_count": deleted_count})
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to delete folder: {str(e)}"}), 500


@app.route("/api/s3/download/<path:key>", methods=["GET"])
def s3_download(key):
    """Descarga un objeto validando que pertenezca al usuario (stream o redirección presigned)."""
    client, err = get_s3_client()
    if not client:
        abort(404)

    user_id = get_caller_user_id()
    user_root = get_user_s3_root(user_id)

    if not key.startswith(user_root):
        abort(403)

    filename = clean_display_name(key)
    disposition = f'attachment; filename="{filename}"'

    if request.args.get("stream") == "1":
        try:
            s3_obj = client.get_object(Bucket=S3_BUCKET, Key=key)
            mimetype = s3_obj.get("ContentType") or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            response = Response(s3_obj["Body"].iter_chunks(chunk_size=128 * 1024), mimetype=mimetype)
            response.headers["Content-Disposition"] = disposition
            if "ContentLength" in s3_obj:
                response.headers["Content-Length"] = str(s3_obj["ContentLength"])
            return response
        except Exception:
            abort(404)

    try:
        presigned_url = client.generate_presigned_url(
            ClientMethod="get_object",
            Params={
                "Bucket": S3_BUCKET,
                "Key": key,
                "ResponseContentDisposition": disposition,
            },
            ExpiresIn=300,
        )
        return redirect(presigned_url)
    except Exception:
        try:
            s3_obj = client.get_object(Bucket=S3_BUCKET, Key=key)
            mimetype = s3_obj.get("ContentType") or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            response = Response(s3_obj["Body"].iter_chunks(chunk_size=128 * 1024), mimetype=mimetype)
            response.headers["Content-Disposition"] = disposition
            return response
        except Exception:
            abort(404)


@app.route("/api/s3/share/<path:key>", methods=["GET"])
def s3_share(key):
    """Genera una URL prefirmada temporal para compartir el archivo externamente."""
    client, err = get_s3_client()
    if not client:
        return jsonify({"ok": False, "error": err}), 400

    user_id = get_caller_user_id()
    user_root = get_user_s3_root(user_id)

    if not key.startswith(user_root):
        return jsonify({"ok": False, "error": "Access denied."}), 403

    try:
        expires_in = int(request.args.get("expires_in", "3600") or 3600)
        expires_in = max(60, min(expires_in, 7 * 86400))
    except ValueError:
        expires_in = 3600

    filename = clean_display_name(key)
    try:
        presigned_url = client.generate_presigned_url(
            ClientMethod="get_object",
            Params={
                "Bucket": S3_BUCKET,
                "Key": key,
                "ResponseContentDisposition": f'inline; filename="{filename}"',
            },
            ExpiresIn=expires_in,
        )
        return jsonify({
            "ok": True,
            "url": presigned_url,
            "expires_in": expires_in,
            "filename": filename,
        })
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to generate share URL: {str(e)}"}), 500


@app.route("/api/s3/delete", methods=["POST"])
def s3_delete():
    """Elimina un objeto individual de S3 dentro del prefijo del usuario."""
    client, err = get_s3_client()
    if not client:
        return jsonify({"ok": False, "error": err}), 400

    data = request.get_json(silent=True) or request.form
    key = data.get("key") or ""
    if not key:
        return jsonify({"ok": False, "error": "Missing key parameter."}), 400

    user_id = get_caller_user_id()
    user_root = get_user_s3_root(user_id)

    if not key.startswith(user_root):
        return jsonify({"ok": False, "error": "Access denied."}), 403

    try:
        client.delete_object(Bucket=S3_BUCKET, Key=key)
        return jsonify({"ok": True, "key": key})
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to delete S3 object: {str(e)}"}), 500



# --- Eventos Socket.IO: conexion y registro de dispositivos ------------------
# La conexion por WebSocket tambien exige haber iniciado sesion antes (misma
# cookie de sesion que las paginas HTML), asi nadie puede saltarse el login
# hablando directo con el socket.

@socketio.on("connect")
def on_connect():
    if not is_logged_in():
        print("[conexion] socket rechazado: sin sesion iniciada")
        return False
    print(f"[conexion] nuevo socket: {request.sid}")
    return None


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    info = state["devices"].pop(sid, None)
    if info:
        # Solo borramos el mapeo device_id -> sid si sigue apuntando a este sid
        # (evita pisar un reingreso mas nuevo del mismo device_id).
        if state["device_to_sid"].get(info["device_id"]) == sid:
            state["device_to_sid"].pop(info["device_id"], None)
        print(f"[conexion] dispositivo desconectado: {info['device_name']}")
        broadcast_device_list()
        for other_sid in state["devices"]:
            emit("notice", {"text": f"{info['device_name']} se desconecto"}, to=other_sid)


@socketio.on("register_device")
def register_device(data):
    if not is_logged_in():
        return
    device_id = data.get("device_id") or str(uuid.uuid4())
    device_name = data.get("device_name") or "Dispositivo"
    device_type = data.get("device_type") if data.get("device_type") in ("pc", "phone") else "phone"
    # is_host: true solo lo manda la propia pagina de la computadora anfitriona
    # (pc.js, servida desde "/"). Sirve para que los demas dispositivos puedan
    # distinguir en la lista cual es la maquina que esta corriendo el programa
    # y cuales son otros dispositivos que solo se anexaron para transferir.
    is_host = bool(data.get("is_host"))

    # Si este device_id ya tenia una conexion registrada de antes (por
    # ejemplo: cerraste sesion y volviste a entrar, recargaste la pagina, o
    # se cayo el WiFi un momento y el navegador reconecto solo), esa
    # conexion vieja puede tardar hasta el timeout de Socket.IO en marcarse
    # como desconectada del lado del servidor. Sin este chequeo, mientras
    # tanto el mismo dispositivo aparece dos veces en "Dispositivos
    # conectados" con el mismo nombre. Como ya sabemos con certeza que es
    # el mismo device_id reconectando, quitamos la entrada vieja de una vez.
    old_sid = state["device_to_sid"].get(device_id)
    if old_sid and old_sid != request.sid:
        state["devices"].pop(old_sid, None)

    state["devices"][request.sid] = {
        "device_id": device_id,
        "device_name": device_name,
        "device_type": device_type,
        "is_host": is_host,
    }
    state["device_to_sid"][device_id] = request.sid

    emit("registered", {"device_id": device_id})
    print(f"[registro] dispositivo conectado: {device_name} ({device_type}, {device_id})")

    broadcast_device_list()
    for other_sid in state["devices"]:
        if other_sid != request.sid:
            emit("notice", {"text": f"{device_name} se conecto"}, to=other_sid)

    # Si ya habia algo en el portapapeles compartido, se lo mandamos al que
    # se acaba de conectar para que arranque sincronizado con los demas.
    if state["clipboard"]:
        emit("clipboard_update_relay", state["clipboard"], to=request.sid)

    # Le mandamos lo que tenga esperando en el buzon (dirigido a el o a "todos").
    pending = list(state["mailbox"].get(device_id, [])) + list(state["mailbox"].get("todos", []))
    if pending:
        emit("buzon_lista_inicial", [public_mailbox_entry(e) for e in pending], to=request.sid)


# --- Transferencia de archivos entre cualquier par de dispositivos -----------
# Protocolo simetrico: quien manda siempre indica target_device_id; el
# servidor solo reenvia al sid correspondiente, sin importar si es una PC o
# un celular en ninguno de los dos extremos.

@socketio.on("send_offer")
def send_offer(data):
    """Un dispositivo ofrece un archivo a otro (por device_id)."""
    target_sid = sid_for_device(data.get("target_device_id"))
    if not target_sid:
        emit("notice", {"text": "El dispositivo destino ya no esta disponible."})
        return
    info = state["devices"].get(request.sid, {})
    payload = dict(data)
    payload["_from_device_id"] = info.get("device_id")
    payload["_from_device_name"] = info.get("device_name")
    emit("file_offer", payload, to=target_sid)


@socketio.on("file_response")
def file_response(data):
    """El destino acepta o rechaza el archivo ofrecido."""
    target_sid = sid_for_device(data.get("target_device_id"))
    if target_sid:
        emit("file_response_relay", data, to=target_sid)


@socketio.on("file_chunk")
def file_chunk(data):
    """Reenvia un fragmento binario de un dispositivo a otro."""
    target_sid = sid_for_device(data.get("target_device_id"))
    if not target_sid:
        return
    payload = dict(data)
    payload["_from_device_id"] = state["devices"].get(request.sid, {}).get("device_id")
    emit("file_chunk_relay", payload, to=target_sid)


@socketio.on("chunk_ack")
def chunk_ack(data):
    """Confirmacion de fragmento recibido (para progreso y reanudacion)."""
    target_sid = sid_for_device(data.get("target_device_id"))
    if target_sid:
        emit("chunk_ack_relay", data, to=target_sid)


# --- Sincronizacion de portapapeles -------------------------------------------
# Si viene con target_device_id, se manda solo a ese dispositivo; si no, se
# reparte a todos los demas conectados (sincronizacion general tipo "enlace").

@socketio.on("clipboard_update")
def clipboard_update(data):
    info = state["devices"].get(request.sid, {})
    entry = {
        "text": data.get("text", ""),
        "from_device_id": info.get("device_id"),
        "from_device_name": info.get("device_name", "Dispositivo"),
        "ts": time.time(),
    }
    state["clipboard"] = entry

    target_device_id = data.get("target_device_id")
    if target_device_id:
        target_sid = sid_for_device(target_device_id)
        if target_sid:
            emit("clipboard_update_relay", entry, to=target_sid)
    else:
        for sid in state["devices"]:
            if sid != request.sid:
                emit("clipboard_update_relay", entry, to=sid)


def _handle_termination_signal(signum, frame):
    # SIGTERM (por ejemplo, si algo mata el proceso con "kill" sin -9, o un
    # administrador de servicios lo detiene) no interrumpe Python por si
    # solo como si fuera Ctrl+C. Lo convertimos en un KeyboardInterrupt para
    # que pase por el mismo camino de cierre ordenado de aqui abajo, en vez
    # de que el proceso muera de golpe sin liberar nada.
    raise KeyboardInterrupt()


if __name__ == "__main__":

    # (Antes aqui salia un "AVISO: estas usando la contrasena por defecto"
    # cada vez que arrancaba, aunque la contrasena generada sola con
    # secrets.choice ya es aleatoria y segura -no es una contrasena fija
    # tipo "1234" que haga falta cambiar-. Ese aviso confundia mas de lo que
    # ayudaba, asi que se quito. El consejo que si importa -sobre ngrok, para
    # cuando alguien quiera exponer esto fuera de su red- sigue mas abajo,
    # junto con el resto de la info de arranque.)

    load_mailbox_index()
    purge_expired_mailbox()
    threading.Thread(target=mailbox_cleanup_loop, daemon=True).start()
    threading.Thread(target=_email_notif_daemon, daemon=True).start()

    # Para que un "kill" (SIGTERM) tambien dispare el cierre ordenado de mas
    # abajo, en vez de matar el proceso de golpe dejando el puerto en un
    # estado raro. Ctrl+C (SIGINT) ya funciona sin esto: Python lo convierte
    # solo en KeyboardInterrupt.
    try:
        signal.signal(signal.SIGTERM, _handle_termination_signal)
    except (AttributeError, ValueError, OSError):
        # No disponible en algunas plataformas (Windows tiene soporte
        # limitado de SIGTERM) o si no corre en el hilo principal; no es
        # grave, Ctrl+C sigue funcionando igual.
        pass

    ip = get_local_ip()
    print("=" * 60)
    print(" Enlace corriendo")
    print(f"   Esta computadora (anfitriona): http://localhost:{PORT}/")
    print(f"   Celular (misma WiFi):          http://{ip}:{PORT}/mobile")
    print(f"   Otra computadora (misma WiFi): http://{ip}:{PORT}/desktop")
    if os.environ.get("ENLACE_HOST_IP", "").strip():
        print(f"   (IP fija definida a mano con ENLACE_HOST_IP={ip})")
    if PUBLIC_URL:
        print(f"   Acceso externo (via tunel):    {PUBLIC_URL}")
    print(f"   Clave de acceso:               {ACCESS_PASSWORD}")
    if _password_fija_a_mano:
        print("   (contraseña fija: definiste ENLACE_PASSWORD, así que nunca rota sola)")
    elif PASSWORD_ROTATE_DEFAULT_HOURS > 0:
        print(f"   (la contraseña rota sola cada {PASSWORD_ROTATE_DEFAULT_HOURS:g}h; si activas avisos")
        print("    periódicos por correo, en vez de eso rota junto con ese intervalo)")
    print(f"   Puerto del servidor:           {PORT}")
    print("   Para cerrar: Ctrl+C en esta terminal (el puerto queda libre de inmediato).")
    if not PUBLIC_URL:
        print("-" * 60)
        print("   Consejo: esto por si solo SOLO funciona dentro de tu misma red WiFi.")
        print("   Si alguien se va a conectar desde otra red (otra ciudad, datos")
        print("   moviles, etc.), usa un tunel como ngrok -no hace falta tocar tu")
        print("   router-. Instrucciones en el README, seccion")
        print("   'Modo con acceso externo (otra red / datos moviles)'.")
    print("=" * 60)

    # Abre el navegador solo, apuntando a esta misma computadora, un instante
    # despues de que el servidor ya este escuchando (para que no aparezca
    # "no se puede acceder a este sitio" por llegar demasiado pronto). Se
    # puede desactivar con ENLACE_NO_BROWSER=1, por ejemplo si esto corre en
    # una computadora sin pantalla (un servidor "headless").
    if os.environ.get("ENLACE_NO_BROWSER", "0") != "1":
        def _abrir_navegador():
            try:
                webbrowser.open(f"http://localhost:{PORT}/")
            except Exception:
                # Si no hay navegador disponible (p. ej. corriendo por SSH en
                # una maquina sin escritorio), simplemente no pasa nada; el
                # servidor sigue funcionando igual, solo hay que abrir la
                # direccion a mano en otro dispositivo.
                pass
        threading.Timer(1.5, _abrir_navegador).start()

    try:
        socketio.run(app, host="0.0.0.0", port=PORT, debug=False, allow_unsafe_werkzeug=True)
    except KeyboardInterrupt:
        pass
    finally:
        # El socket del servidor se crea con SO_REUSEADDR (asi viene por
        # defecto en el servidor HTTP que usa Flask/Werkzeug), asi que en
        # cuanto este proceso termina, el puerto queda libre para volver a
        # usarse de inmediato -no se queda "atorado"-, aunque el sistema
        # operativo tarde un poco en olvidar la conexion vieja (normal en
        # TCP, no es un error de Enlace).
        print()
        print("=" * 60)
        print(f" Enlace cerrado. El puerto {PORT} quedo liberado.")
        print("=" * 60)
        sys.exit(0)