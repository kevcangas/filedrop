"""
Authentication API Blueprint: registration, login, logout, session state, and device enrollment.
"""

from datetime import datetime, timezone
import uuid
from flask import Blueprint, current_app, jsonify, request, session
from sqlalchemy import or_, select

from app.models import Device, DeviceType, User, to_uuid
from .utils import validate_password_strength, validate_username

auth_bp = Blueprint("auth_bp", __name__, url_prefix="/api/auth")


def get_db():
    """Retrieve SQLAlchemy session from application context."""
    from app.extensions import db
    return db.session


@auth_bp.route("/register", methods=["POST"])
def register():
    """Register a new user account and enroll their initial client device."""
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip().lower()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    display_name = (data.get("display_name") or username).strip()
    device_name = (data.get("device_name") or "Primary Device").strip()
    device_type_str = (data.get("device_type") or "pc").strip().lower()
    device_fingerprint = (data.get("device_fingerprint") or str(uuid.uuid4())).strip()

    # Input validations
    u_ok, u_err = validate_username(username)
    if not u_ok:
        return jsonify({"ok": False, "error": u_err}), 400

    if not email or "@" not in email:
        return jsonify({"ok": False, "error": "A valid email address is required."}), 400

    p_ok, p_err = validate_password_strength(password)
    if not p_ok:
        return jsonify({"ok": False, "error": p_err}), 400

    db_sess = get_db()

    # Check uniqueness
    existing = db_sess.scalar(
        select(User).where(or_(User.username == username, User.email == email))
    )
    if existing:
        if existing.username == username:
            return jsonify({"ok": False, "error": "Username is already taken."}), 409
        return jsonify({"ok": False, "error": "Email address is already registered."}), 409

    # Create User
    new_user = User(
        username=username,
        email=email,
        display_name=display_name,
        is_active=True,
    )
    new_user.set_password(password)
    db_sess.add(new_user)
    db_sess.flush()  # populate new_user.id

    # Parse DeviceType
    try:
        device_type = DeviceType(device_type_str)
    except ValueError:
        device_type = DeviceType.PC

    # Enroll Initial Device
    new_device = Device(
        user_id=new_user.id,
        device_name=device_name,
        device_type=device_type,
        device_fingerprint=device_fingerprint,
        last_seen_at=datetime.now(timezone.utc),
        is_active=True,
    )
    db_sess.add(new_device)
    db_sess.commit()

    # Establish Session
    session.clear()
    session["user_id"] = str(new_user.id)
    session["device_id"] = str(new_device.id)
    session["username"] = new_user.username
    session.permanent = True

    return jsonify({
        "ok": True,
        "message": "Registration successful.",
        "user": new_user.to_dict(),
        "device": new_device.to_dict(),
    }), 201


@auth_bp.route("/login", methods=["POST"])
def login():
    """Authenticate user with credentials and bind or enroll the client device."""
    data = request.get_json(silent=True) or {}
    identifier = (data.get("identifier") or data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    device_name = (data.get("device_name") or "Web Client").strip()
    device_type_str = (data.get("device_type") or "pc").strip().lower()
    device_fingerprint = (data.get("device_fingerprint") or "").strip()

    if not identifier or not password:
        return jsonify({"ok": False, "error": "Username/email and password are required."}), 400

    db_sess = get_db()
    user = db_sess.scalar(
        select(User).where(or_(User.username == identifier, User.email == identifier))
    )

    if not user or not user.is_active or not user.check_password(password):
        return jsonify({"ok": False, "error": "Invalid username or password."}), 401

    # Locate or enroll device
    device = None
    if device_fingerprint:
        device = db_sess.scalar(
            select(Device).where(
                Device.user_id == user.id,
                Device.device_fingerprint == device_fingerprint,
            )
        )

    if not device:
        try:
            device_type = DeviceType(device_type_str)
        except ValueError:
            device_type = DeviceType.PC

        device = Device(
            user_id=user.id,
            device_name=device_name,
            device_type=device_type,
            device_fingerprint=device_fingerprint or str(uuid.uuid4()),
            last_seen_at=datetime.now(timezone.utc),
            is_active=True,
        )
        db_sess.add(device)
    else:
        device.mark_seen()
        if device_name and device.device_name != device_name:
            device.device_name = device_name

    db_sess.commit()

    # Session binding
    session.clear()
    session["user_id"] = str(user.id)
    session["device_id"] = str(device.id)
    session["username"] = user.username
    session.permanent = True

    return jsonify({
        "ok": True,
        "message": "Login successful.",
        "user": user.to_dict(),
        "device": device.to_dict(),
    }), 200


@auth_bp.route("/logout", methods=["POST", "GET"])
def logout():
    """Terminate the current authenticated user session."""
    session.clear()
    return jsonify({"ok": True, "message": "Logged out successfully."}), 200


@auth_bp.route("/me", methods=["GET"])
def me():
    """Fetch profile and active device state for the authenticated session."""
    user_id = to_uuid(session.get("user_id"))
    device_id = to_uuid(session.get("device_id"))

    if not user_id:
        return jsonify({"ok": False, "authenticated": False}), 401

    db_sess = get_db()
    user = db_sess.scalar(select(User).where(User.id == user_id, User.is_active == True))
    if not user:
        session.clear()
        return jsonify({"ok": False, "authenticated": False}), 401

    current_device = None
    if device_id:
        current_device = db_sess.scalar(
            select(Device).where(Device.id == device_id, Device.user_id == user.id)
        )
        if current_device:
            current_device.mark_seen()
            db_sess.commit()

    return jsonify({
        "ok": True,
        "authenticated": True,
        "user": user.to_dict(include_devices=True),
        "current_device": current_device.to_dict() if current_device else None,
    }), 200
