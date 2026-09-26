"""
Activity & Transfer Logging API Blueprint: audit records, system events, and telemetry.
"""

from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, session
from sqlalchemy import or_, select

from app.models import Device, TransferLog, User

logs_bp = Blueprint("logs_bp", __name__, url_prefix="/api/logs")


def get_db():
    from app.extensions import db
    return db.session


def require_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    db_sess = get_db()
    return db_sess.scalar(select(User).where(User.id == user_id, User.is_active == True))


@logs_bp.route("/transfers", methods=["GET"])
def get_transfer_logs():
    """Retrieve historical file transfer telemetry involving any of the user's devices."""
    current_user = require_user()
    if not current_user:
        return jsonify({"ok": False, "error": "Authentication required."}), 401

    limit = min(int(request.args.get("limit", 50)), 100)
    db_sess = get_db()

    # Get all device IDs belonging to this user
    user_device_ids = [d.id for d in current_user.devices]
    if not user_device_ids:
        return jsonify({"ok": True, "transfers": []}), 200

    stmt = (
        select(TransferLog)
        .where(
            or_(
                TransferLog.sender_device_id.in_(user_device_ids),
                TransferLog.receiver_device_id.in_(user_device_ids),
            )
        )
        .order_by(TransferLog.created_at.desc())
        .limit(limit)
    )
    logs = db_sess.scalars(stmt).all()

    return jsonify({
        "ok": True,
        "transfers": [log.to_dict() for log in logs],
    }), 200


@logs_bp.route("/activity", methods=["GET"])
def get_activity_stream():
    """Return consolidated activity events (logins, device enrollments, transfer status)."""
    current_user = require_user()
    if not current_user:
        return jsonify({"ok": False, "error": "Authentication required."}), 401

    db_sess = get_db()
    user_device_ids = [d.id for d in current_user.devices]

    events = []

    # Include recent transfer events
    if user_device_ids:
        recent_transfers = db_sess.scalars(
            select(TransferLog)
            .where(
                or_(
                    TransferLog.sender_device_id.in_(user_device_ids),
                    TransferLog.receiver_device_id.in_(user_device_ids),
                )
            )
            .order_by(TransferLog.created_at.desc())
            .limit(20)
        ).all()
        for t in recent_transfers:
            is_sender = t.sender_device_id in user_device_ids
            events.append({
                "id": str(t.id),
                "type": "TRANSFER",
                "level": "INFO" if t.status.value == "COMPLETED" else "ERROR",
                "title": f"Transfer {t.status.value.lower()}",
                "message": f"File '{t.file_name}' ({t.file_size} bytes) via {t.channel.value}",
                "timestamp": t.created_at.isoformat() if t.created_at else None,
                "direction": "outbound" if is_sender else "inbound",
            })

    # Include device events
    for d in current_user.devices:
        events.append({
            "id": f"dev_{d.id}",
            "type": "DEVICE",
            "level": "INFO",
            "title": f"Device registered: {d.device_name}",
            "message": f"Type: {d.device_type.value} · Last active: {d.last_seen_at.isoformat() if d.last_seen_at else 'N/A'}",
            "timestamp": d.created_at.isoformat() if d.created_at else None,
        })

    events.sort(key=lambda x: x.get("timestamp") or "", reverse=True)

    return jsonify({
        "ok": True,
        "activities": events[:50],
    }), 200
