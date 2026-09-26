"""
Devices API Blueprint: device management, renaming, revocation, and enrollment.
"""

from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, session
from sqlalchemy import select

from app.models import Device, User, to_uuid

devices_bp = Blueprint("devices_bp", __name__, url_prefix="/api/devices")


def get_db():
    from app.extensions import db
    return db.session


def require_user():
    user_id = to_uuid(session.get("user_id"))
    if not user_id:
        return None
    db_sess = get_db()
    return db_sess.scalar(select(User).where(User.id == user_id, User.is_active == True))


@devices_bp.route("/me", methods=["GET"])
def get_current_device():
    """Retrieve the current active authenticated device and user profile."""
    current_user = require_user()
    if not current_user:
        return jsonify({"ok": False, "error": "Authentication required."}), 401

    current_device_id = session.get("device_id")
    device = None
    db_sess = get_db()
    if current_device_id:
        device = db_sess.scalar(
            select(Device).where(Device.id == to_uuid(current_device_id), Device.user_id == current_user.id, Device.is_active == True)
        )
    if not device:
        device = db_sess.scalar(
            select(Device).where(Device.user_id == current_user.id, Device.is_active == True).order_by(Device.last_seen_at.desc())
        )
        if device:
            session["device_id"] = str(device.id)

    if not device:
        return jsonify({"ok": False, "error": "No active device enrolled for this session."}), 404

    return jsonify({
        "ok": True,
        "device": device.to_dict(),
        "user": current_user.to_dict(),
    }), 200


@devices_bp.route("", methods=["GET"])
def list_devices():
    """List all enrolled devices for the authenticated user."""
    current_user = require_user()
    if not current_user:
        return jsonify({"ok": False, "error": "Authentication required."}), 401

    db_sess = get_db()
    devices = db_sess.scalars(
        select(Device).where(Device.user_id == current_user.id).order_by(Device.last_seen_at.desc())
    ).all()

    current_device_id = session.get("device_id")

    return jsonify({
        "ok": True,
        "current_device_id": current_device_id,
        "devices": [
            {**d.to_dict(), "is_current": str(d.id) == current_device_id}
            for d in devices
        ],
    }), 200


@devices_bp.route("/<device_id>/rename", methods=["PATCH", "POST"])
def rename_device(device_id):
    """Update display name for a specific owned device."""
    current_user = require_user()
    if not current_user:
        return jsonify({"ok": False, "error": "Authentication required."}), 401

    dev_uuid = to_uuid(device_id)
    if not dev_uuid:
        return jsonify({"ok": False, "error": "Invalid device ID."}), 400

    data = request.get_json(silent=True) or {}
    new_name = (data.get("device_name") or "").strip()
    if not new_name:
        return jsonify({"ok": False, "error": "New device name cannot be empty."}), 400

    db_sess = get_db()
    device = db_sess.scalar(
        select(Device).where(Device.id == dev_uuid, Device.user_id == current_user.id)
    )
    if not device:
        return jsonify({"ok": False, "error": "Device not found."}), 404

    device.device_name = new_name
    device.updated_at = datetime.now(timezone.utc)
    db_sess.commit()

    return jsonify({
        "ok": True,
        "message": "Device renamed successfully.",
        "device": device.to_dict(),
    }), 200


@devices_bp.route("/<device_id>/revoke", methods=["DELETE", "POST"])
def revoke_device(device_id):
    """Revoke and deactivate a device from the user account."""
    current_user = require_user()
    if not current_user:
        return jsonify({"ok": False, "error": "Authentication required."}), 401

    dev_uuid = to_uuid(device_id)
    if not dev_uuid:
        return jsonify({"ok": False, "error": "Invalid device ID."}), 400

    db_sess = get_db()
    device = db_sess.scalar(
        select(Device).where(Device.id == dev_uuid, Device.user_id == current_user.id)
    )
    if not device:
        return jsonify({"ok": False, "error": "Device not found."}), 404

    is_current = str(device.id) == session.get("device_id")

    device.is_active = False
    device.updated_at = datetime.now(timezone.utc)
    db_sess.commit()

    if is_current:
        session.clear()

    return jsonify({
        "ok": True,
        "message": "Device revoked.",
        "session_terminated": is_current,
    }), 200
