"""
S3 Storage REST API Blueprint for multi-tenant cloud storage operations.
"""

from flask import Blueprint, current_app, jsonify, redirect, request, session
from app.services import S3Service

s3_bp = Blueprint("s3_bp", __name__, url_prefix="/api/s3")

_s3_service = None


def get_s3_service():
    global _s3_service
    if _s3_service is None:
        _s3_service = S3Service(config=current_app.config)
    return _s3_service


def get_effective_user_id() -> str:
    """Resolve authenticated user ID or fall back to device session ID."""
    return session.get("user_id") or session.get("device_id") or "default_user"


@s3_bp.route("/status", methods=["GET"])
def s3_status():
    """Return S3 connection status and bucket availability."""
    svc = get_s3_service()
    enabled = svc.is_enabled()
    configured = False
    error = None

    if enabled:
        try:
            client = svc.get_client()
            if client:
                configured = True
        except Exception as ex:
            error = str(ex)

    return jsonify({
        "ok": True,
        "enabled": enabled,
        "configured": configured,
        "bucket": svc.bucket_name,
        "user_prefix": svc.get_user_prefix(get_effective_user_id()),
        "error": error,
    }), 200


@s3_bp.route("/upload", methods=["POST"])
def s3_upload():
    """Upload a file to S3 under the current user's namespace."""
    svc = get_s3_service()
    if not svc.is_enabled():
        return jsonify({"ok": False, "error": "S3 storage is disabled."}), 400

    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file uploaded."}), 400

    file_obj = request.files["file"]
    subfolder = request.form.get("folder", "").strip()
    user_id = request.form.get("user_id") or get_effective_user_id()
    device_id = session.get("device_id", "web")

    try:
        result = svc.upload_file(
            user_id=user_id,
            device_id=device_id,
            file_obj=file_obj,
            filename=file_obj.filename,
            subfolder=subfolder,
        )
        return jsonify({"ok": True, "file": result}), 201
    except Exception as ex:
        return jsonify({"ok": False, "error": str(ex)}), 500


@s3_bp.route("/files", methods=["GET"])
def s3_files():
    """List S3 objects and folders stored under the authenticated user's prefix."""
    svc = get_s3_service()
    if not svc.is_enabled():
        return jsonify({"ok": False, "folders": [], "files": [], "error": "S3 is disabled."}), 200

    subfolder = request.args.get("folder", "").strip()
    user_id = request.args.get("user_id") or get_effective_user_id()

    try:
        data = svc.list_objects(user_id=user_id, subfolder=subfolder)
        return jsonify({
            "ok": True,
            "folders": data.get("folders", []),
            "files": data.get("files", []),
        }), 200
    except Exception as ex:
        return jsonify({"ok": False, "folders": [], "files": [], "error": str(ex)}), 500


@s3_bp.route("/folders/create", methods=["POST"])
def s3_create_folder():
    """Create a virtual folder marker in S3."""
    svc = get_s3_service()
    if not svc.is_enabled():
        return jsonify({"ok": False, "error": "S3 storage is disabled."}), 400

    data = request.get_json(silent=True) or {}
    folder_path = (data.get("path") or data.get("folder") or "").strip()
    if not folder_path:
        return jsonify({"ok": False, "error": "Folder path is required."}), 400

    user_id = data.get("user_id") or get_effective_user_id()
    try:
        svc.create_folder(user_id=user_id, folder_path=folder_path)
        return jsonify({"ok": True, "message": "Folder created."}), 201
    except Exception as ex:
        return jsonify({"ok": False, "error": str(ex)}), 500


@s3_bp.route("/folders/delete", methods=["POST"])
def s3_delete_folder():
    """Delete a virtual folder and all its contents in S3."""
    svc = get_s3_service()
    if not svc.is_enabled():
        return jsonify({"ok": False, "error": "S3 storage is disabled."}), 400

    data = request.get_json(silent=True) or {}
    folder_path = (data.get("path") or data.get("folder") or "").strip()
    if not folder_path:
        return jsonify({"ok": False, "error": "Folder path is required."}), 400

    user_id = data.get("user_id") or get_effective_user_id()
    try:
        svc.delete_folder(user_id=user_id, folder_path=folder_path)
        return jsonify({"ok": True, "message": "Folder deleted."}), 200
    except Exception as ex:
        return jsonify({"ok": False, "error": str(ex)}), 500


@s3_bp.route("/download/<path:key>", methods=["GET"])
def s3_download(key):
    """Generate and redirect to presigned S3 download URL."""
    svc = get_s3_service()
    if not svc.is_enabled():
        return jsonify({"ok": False, "error": "S3 is disabled."}), 400

    user_id = request.args.get("user_id") or get_effective_user_id()
    try:
        url = svc.generate_presigned_url(user_id=user_id, s3_key=key, expiry_seconds=3600)
        return redirect(url)
    except PermissionError as pe:
        return jsonify({"ok": False, "error": str(pe)}), 403
    except Exception as ex:
        return jsonify({"ok": False, "error": str(ex)}), 500


@s3_bp.route("/share/<path:key>", methods=["GET"])
def s3_share_url(key):
    """Generate a presigned URL to share a file."""
    svc = get_s3_service()
    if not svc.is_enabled():
        return jsonify({"ok": False, "error": "S3 storage is disabled."}), 400

    expires_in = int(request.args.get("expires_in", 86400))
    user_id = request.args.get("user_id") or get_effective_user_id()
    try:
        url = svc.generate_presigned_url(user_id=user_id, s3_key=key, expiry_seconds=expires_in)
        return jsonify({"ok": True, "url": url}), 200
    except PermissionError as pe:
        return jsonify({"ok": False, "error": str(pe)}), 403
    except Exception as ex:
        return jsonify({"ok": False, "error": str(ex)}), 500


@s3_bp.route("/delete", methods=["POST"])
def s3_delete():
    """Delete an object from S3."""
    svc = get_s3_service()
    if not svc.is_enabled():
        return jsonify({"ok": False, "error": "S3 is disabled."}), 400

    data = request.get_json(silent=True) or {}
    key = data.get("key")
    if not key:
        return jsonify({"ok": False, "error": "Missing key."}), 400

    user_id = data.get("user_id") or get_effective_user_id()
    try:
        svc.delete_file(user_id=user_id, s3_key=key)
        return jsonify({"ok": True, "message": "File deleted."}), 200
    except PermissionError as pe:
        return jsonify({"ok": False, "error": str(pe)}), 403
    except Exception as ex:
        return jsonify({"ok": False, "error": str(ex)}), 500
