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
mailbox_bp = Blueprint("mailbox_bp", __name__, url_prefix="/api/mailbox")

_mailbox_service = None


def get_mailbox_service():
    global _mailbox_service
    if _mailbox_service is None:
        _mailbox_service = MailboxService(
            mailbox_dir=current_app.config.get("MAILBOX_DIR", "buzon"),
            default_ttl_hours=current_app.config.get("MAILBOX_TTL_HOURS", 72.0),
        )
    return _mailbox_service


def handle_buzon_enviar():
    """Upload a file to the offline mailbox."""
    file_obj = request.files.get("archivo") or request.files.get("file")
    if not file_obj:
        return jsonify({"ok": False, "error": "No file uploaded."}), 400

    from app.models import to_uuid
    recipient_user_id_str = request.form.get("recipient_user_id")
    recipient_device_id_str = request.form.get("recipient_device_id") or request.form.get("target_device_id")
    if recipient_device_id_str in ("todos", "all", "global", ""):
        recipient_device_id_str = None

    sender_user_id = to_uuid(session.get("user_id"))
    sender_device_id = to_uuid(session.get("device_id") or request.form.get("from_device_id"))

    recipient_user_id = to_uuid(recipient_user_id_str)
    recipient_device_id = to_uuid(recipient_device_id_str)

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


def handle_buzon_lista():
    """List mailbox files intended for or sent by current user."""
    from app.models import to_uuid
    user_id_str = session.get("user_id")
    now = datetime.now(timezone.utc)
    user_uuid = to_uuid(user_id_str)

    if user_uuid:
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
    serialized = [i.to_dict() for i in items]
    return jsonify({
        "ok": True,
        "items": serialized,
        "archivos": serialized,
    }), 200


def handle_buzon_descargar(item_id):
    """Download a file stored in the mailbox."""
    from app.models import to_uuid
    item_uuid = to_uuid(item_id)
    if not item_uuid:
        return jsonify({"ok": False, "error": "Invalid item ID."}), 400

    item = db.session.scalar(select(MailboxItem).where(MailboxItem.id == item_uuid))
    if not item or item.is_expired:
        return jsonify({"ok": False, "error": "File not found or expired."}), 404

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


def handle_buzon_borrar(item_id):
    """Manually delete a file from the mailbox."""
    from app.models import to_uuid
    item_uuid = to_uuid(item_id)
    if not item_uuid:
        return jsonify({"ok": False, "error": "Invalid item ID."}), 400

    item = db.session.scalar(select(MailboxItem).where(MailboxItem.id == item_uuid))
    if not item:
        return jsonify({"ok": False, "error": "Item not found."}), 404

    try:
        p = Path(item.file_path)
        if p.exists():
            p.unlink(missing_ok=True)
    except Exception:
        pass

    db.session.delete(item)
    db.session.commit()

    return jsonify({"ok": True, "message": "File deleted."}), 200


# Bind routes to buzon_bp (/api/buzon/...)
buzon_bp.route("/enviar", methods=["POST"])(handle_buzon_enviar)
buzon_bp.route("/lista", methods=["GET"])(limiter.exempt(handle_buzon_lista))
buzon_bp.route("/descargar/<item_id>", methods=["GET"])(handle_buzon_descargar)
buzon_bp.route("/<item_id>/download", methods=["GET"])(handle_buzon_descargar)
buzon_bp.route("/borrar/<item_id>", methods=["POST", "DELETE"])(handle_buzon_borrar)
buzon_bp.route("/<item_id>", methods=["DELETE"])(handle_buzon_borrar)

# Bind routes to mailbox_bp (/api/mailbox/...)
mailbox_bp.route("", methods=["GET"])(limiter.exempt(handle_buzon_lista))
mailbox_bp.route("", methods=["POST"])(handle_buzon_enviar)
mailbox_bp.route("/enviar", methods=["POST"])(handle_buzon_enviar)
mailbox_bp.route("/lista", methods=["GET"])(limiter.exempt(handle_buzon_lista))
mailbox_bp.route("/descargar/<item_id>", methods=["GET"])(handle_buzon_descargar)
mailbox_bp.route("/<item_id>/download", methods=["GET"])(handle_buzon_descargar)
mailbox_bp.route("/borrar/<item_id>", methods=["POST", "DELETE"])(handle_buzon_borrar)
mailbox_bp.route("/<item_id>", methods=["DELETE"])(handle_buzon_borrar)
