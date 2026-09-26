"""
Mailbox REST API Blueprint for asynchronous file uploads and downloads.
"""

from datetime import datetime, timezone
from pathlib import Path
import uuid
from flask import Blueprint, current_app, jsonify, request, send_file, session
from sqlalchemy import or_, select

from app.extensions import db, limiter
from app.models import MailboxItem, User
from app.services import MailboxService

buzon_bp = Blueprint("buzon_bp", __name__, url_prefix="/api/buzon")

_mailbox_service = None


def get_mailbox_service():
    global _mailbox_service
    if _mailbox_service is None:
        _mailbox_service = MailboxService(
            mailbox_dir=current_app.config.get("MAILBOX_DIR", "buzon"),
            default_ttl_hours=current_app.config.get("MAILBOX_TTL_HOURS", 72.0),
        )
    return _mailbox_service


@buzon_bp.route("/enviar", methods=["POST"])
def buzon_enviar():
    """Upload a file to the offline mailbox."""
    if "archivo" not in request.files:
        return jsonify({"ok": False, "error": "No file uploaded."}), 400

    file_obj = request.files["archivo"]
    recipient_user_id_str = request.form.get("recipient_user_id")
    recipient_device_id_str = request.form.get("recipient_device_id")

    sender_user_id = uuid.UUID(session["user_id"]) if session.get("user_id") else None
    sender_device_id = uuid.UUID(session["device_id"]) if session.get("device_id") else None

    recipient_user_id = uuid.UUID(recipient_user_id_str) if recipient_user_id_str else None
    recipient_device_id = uuid.UUID(recipient_device_id_str) if recipient_device_id_str else None

    svc = get_mailbox_service()
    item = svc.save_file(
        file_obj=file_obj,
        sender_user_id=sender_user_id,
        sender_device_id=sender_device_id,
        recipient_user_id=recipient_user_id,
        recipient_device_id=recipient_device_id,
    )

    db.session.add(item)
    db.session.commit()

    return jsonify({
        "ok": True,
        "message": "File stored in mailbox.",
        "item": item.to_dict(),
    }), 201


@buzon_bp.route("/lista", methods=["GET"])
@limiter.exempt
def buzon_lista():
    """List mailbox files intended for or sent by current user."""
    user_id_str = session.get("user_id")
    now = datetime.now(timezone.utc)

    if user_id_str:
        user_uuid = uuid.UUID(user_id_str)
        stmt = (
            select(MailboxItem)
            .where(
                or_(
                    MailboxItem.recipient_user_id == user_uuid,
                    MailboxItem.sender_user_id == user_uuid,
                    MailboxItem.recipient_user_id.is_(None),  # global items
                ),
                MailboxItem.expires_at > now,
            )
            .order_by(MailboxItem.created_at.desc())
        )
    else:
        # Anonymous / global fallback
        stmt = (
            select(MailboxItem)
            .where(MailboxItem.recipient_user_id.is_(None), MailboxItem.expires_at > now)
            .order_by(MailboxItem.created_at.desc())
        )

    items = db.session.scalars(stmt).all()
    return jsonify({
        "ok": True,
        "archivos": [i.to_dict() for i in items],
    }), 200


@buzon_bp.route("/descargar/<item_id>", methods=["GET"])
def buzon_descargar(item_id):
    """Download a file stored in the mailbox."""
    try:
        item_uuid = uuid.UUID(item_id)
    except ValueError:
        return jsonify({"ok": False, "error": "Invalid item ID."}), 400

    item = db.session.scalar(select(MailboxItem).where(MailboxItem.id == item_uuid))
    if not item or item.is_expired:
        return jsonify({"ok": False, "error": "File not found or expired."}), 404

    # Authorization check
    user_id_str = session.get("user_id")
    if item.recipient_user_id:
        if not user_id_str or (uuid.UUID(user_id_str) != item.recipient_user_id and uuid.UUID(user_id_str) != item.sender_user_id):
            return jsonify({"ok": False, "error": "Unauthorized to access this file."}), 403

    p = Path(item.file_path)
    if not p.exists():
        return jsonify({"ok": False, "error": "File missing on server disk."}), 404

    item.is_downloaded = True
    db.session.commit()

    return send_file(
        str(p),
        as_attachment=True,
        download_name=item.file_name,
        mimetype=item.mime_type or "application/octet-stream",
    )


@buzon_bp.route("/borrar/<item_id>", methods=["POST"])
def buzon_borrar(item_id):
    """Manually delete a file from the mailbox."""
    try:
        item_uuid = uuid.UUID(item_id)
    except ValueError:
        return jsonify({"ok": False, "error": "Invalid item ID."}), 400

    item = db.session.scalar(select(MailboxItem).where(MailboxItem.id == item_uuid))
    if not item:
        return jsonify({"ok": False, "error": "Item not found."}), 404

    user_id_str = session.get("user_id")
    if user_id_str and item.sender_user_id and uuid.UUID(user_id_str) != item.sender_user_id:
        return jsonify({"ok": False, "error": "Only the uploader can delete this item."}), 403

    try:
        p = Path(item.file_path)
        if p.exists():
            p.unlink(missing_ok=True)
    except Exception:
        pass

    db.session.delete(item)
    db.session.commit()

    return jsonify({"ok": True, "message": "File deleted."}), 200
