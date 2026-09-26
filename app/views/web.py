"""
Web Views Blueprint for HTML template rendering, manifest serving, and session redirection.
"""

import os
from pathlib import Path
from flask import (
    Blueprint,
    current_app,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)

web_bp = Blueprint("web_bp", __name__)


def is_authenticated() -> bool:
    """Check if the current request carries an authenticated session."""
    return bool(session.get("user_id") or session.get("logged_in"))


@web_bp.before_app_request
def enforce_auth():
    """Intercept all web routes and redirect unauthenticated visitors to login."""
    path = request.path

    # Open whitelist paths
    open_exact = (
        "/login",
        "/logout",
        "/manifest.json",
        "/service-worker.js",
        "/favicon.ico",
        "/api/info",
    )
    if path in open_exact:
        return None

    # Open prefixes
    open_prefixes = (
        "/static/",
        "/api/auth/",
        "/s3/share/",
        "/api/s3/share/",
        "/api/info",
    )
    if any(path.startswith(prefix) for prefix in open_prefixes):
        return None

    if not is_authenticated():
        # If API request, return 401 JSON
        if path.startswith("/api/"):
            return jsonify({"ok": False, "error": "Authentication required."}), 401
        return redirect(url_for("web_bp.login_page", next=request.full_path))

    return None


def get_or_create_default_user():
    """Resolve or initialize default account for password-based or single-user access."""
    import uuid
    from app.models import User
    from app.extensions import db
    from sqlalchemy import select

    user = db.session.scalar(select(User).where(User.username == "admin"))
    if not user:
        user = db.session.scalar(select(User).order_by(User.created_at.asc()))
    if not user:
        user = User(
            username="admin",
            email="admin@homelab.internal",
            display_name="Administrador",
            is_active=True,
            is_admin=True,
        )
        user.set_password("admin123")
        db.session.add(user)
        db.session.commit()
    return user


@web_bp.route("/login", methods=["GET", "POST"])
def login_page():
    """Render modern multi-user login portal or process legacy password fallback."""
    if request.method == "POST":
        import uuid
        from datetime import datetime, timezone
        from app.models import Device, DeviceType
        from app.extensions import db
        from sqlalchemy import select

        password = request.form.get("password", "")
        next_path = request.form.get("next") or "/"
        configured_password = current_app.config.get("ENLACE_PASSWORD", "")

        is_valid_legacy = (configured_password and password == configured_password) or (not configured_password and not password)

        if is_valid_legacy:
            default_user = get_or_create_default_user()
            user_agent = request.headers.get("User-Agent", "").lower()
            is_mobile = any(m in user_agent for m in ["android", "iphone", "ipad", "mobile"])
            dev_type = DeviceType.MOBILE if is_mobile else DeviceType.PC
            dev_name = "Móvil Principal" if is_mobile else "PC Principal"

            # Auto-enroll device for this legacy session
            device = db.session.scalar(
                select(Device).where(
                    Device.user_id == default_user.id,
                    Device.device_name == dev_name,
                    Device.is_active == True,
                )
            )
            if not device:
                device = Device(
                    user_id=default_user.id,
                    device_name=dev_name,
                    device_type=dev_type,
                    device_fingerprint=str(uuid.uuid4()),
                    last_seen_at=datetime.now(timezone.utc),
                    is_active=True,
                )
                db.session.add(device)
                db.session.commit()

            session.clear()
            session["logged_in"] = True
            session["user_id"] = str(default_user.id)
            session["device_id"] = str(device.id)
            session["username"] = default_user.username
            session.permanent = True
            return redirect(next_path)

        return render_template("login.html", error="Contraseña incorrecta.", next_path=next_path)

    if is_authenticated():
        return redirect("/")

    return render_template("login.html", next_path=request.args.get("next", "/"))


@web_bp.route("/logout")
def logout():
    """Clear session and redirect to login portal."""
    session.clear()
    return redirect("/login")


def get_current_user_and_device():
    """Retrieve currently authenticated user and active device from session with automatic fallback."""
    import uuid
    from datetime import datetime, timezone
    from app.models import User, Device, DeviceType, to_uuid
    from app.extensions import db
    from sqlalchemy import select

    user_id = session.get("user_id")
    device_id = session.get("device_id")

    if not user_id and session.get("logged_in"):
        default_user = get_or_create_default_user()
        user_id = str(default_user.id)
        session["user_id"] = user_id

    user = None
    device = None
    if user_id:
        user = db.session.scalar(select(User).where(User.id == to_uuid(user_id), User.is_active == True))

    if user and device_id:
        device = db.session.scalar(
            select(Device).where(Device.id == to_uuid(device_id), Device.user_id == user.id, Device.is_active == True)
        )

    if user and not device:
        # Fallback to most recently seen active device
        device = db.session.scalar(
            select(Device).where(Device.user_id == user.id, Device.is_active == True).order_by(Device.last_seen_at.desc())
        )
        # If user has no devices at all, create an initial one
        if not device:
            user_agent = request.headers.get("User-Agent", "").lower()
            is_mobile = any(m in user_agent for m in ["android", "iphone", "ipad", "mobile"])
            dev_type = DeviceType.MOBILE if is_mobile else DeviceType.PC
            dev_name = "Móvil" if is_mobile else "PC Principal"
            device = Device(
                user_id=user.id,
                device_name=dev_name,
                device_type=dev_type,
                device_fingerprint=str(uuid.uuid4()),
                last_seen_at=datetime.now(timezone.utc),
                is_active=True,
            )
            db.session.add(device)
            db.session.commit()

        if device:
            session["device_id"] = str(device.id)

    return user, device


@web_bp.route("/api/info")
def server_info():
    """Expose server connection details for pairing and QR code generation."""
    import os
    port = current_app.config.get("PORT", 41823)
    pub_url = os.environ.get("ENLACE_PUBLIC_URL", "").strip()
    local_ip = os.environ.get("ENLACE_HOST_IP", "").strip() or "127.0.0.1"
    return jsonify({
        "ok": True,
        "port": port,
        "local_ip": local_ip,
        "public_url": pub_url or f"http://{local_ip}:{port}",
        "version": "2.0.0",
    })


@web_bp.route("/")
@web_bp.route("/desktop")
@web_bp.route("/pc")
@web_bp.route("/host")
@web_bp.route("/mobile")
def app_view():
    """Render unified responsive FileDrop application for desktop and mobile clients."""
    user, device = get_current_user_and_device()
    user_data = user.to_dict() if user else {"username": "invitado", "display_name": "Invitado"}
    device_data = device.to_dict() if device else {"id": "", "device_name": "Dispositivo", "device_type": "pc"}
    return render_template(
        "app.html",
        current_user=user_data,
        current_device=device_data,
    )


@web_bp.route("/manifest.json")
def manifest():
    """Serve PWA manifest."""
    return jsonify({
        "name": "Filedrop (Enlace)",
        "short_name": "Filedrop",
        "description": "Transferencia de archivos de alta velocidad, portapapeles y almacenamiento en la nube S3",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "background_color": "#0b1118",
        "theme_color": "#0c1420",
        "orientation": "any",
        "icons": [
            {"src": "/static/icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/static/icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
        ],
    })


@web_bp.route("/service-worker.js")
def service_worker():
    """Serve PWA service worker with root scope."""
    return send_from_directory(
        os.path.join(current_app.root_path, "..", "static"),
        "service-worker.js",
        mimetype="application/javascript",
    )
