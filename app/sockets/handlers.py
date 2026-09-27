"""
Socket.IO Event Handlers for presence, real-time chunk streaming, and secure clipboard sync.
"""

import uuid
from flask import request, session
from flask_socketio import emit, join_room, leave_room
from sqlalchemy import select

from app.extensions import db, socketio
from app.models import Device, TransferChannel, TransferLog, TransferStatus, User
from app.services import presence_service
from .middleware import verify_friendship_acl, verify_socket_session


def register_socket_handlers(sio):
    """Attach WebSocket event listeners to the SocketIO instance."""

    @sio.on("connect")
    def handle_connect():
        sid = request.sid
        user, device = verify_socket_session(db.session)
        if not user:
            from app.views.web import get_or_create_default_user
            user = get_or_create_default_user()

        print(f"[SocketIO] Connect: sid={sid} user={user.username if user else None}", flush=True)

        if user:
            join_room(f"user_{user.id}")
            if device:
                join_room(f"dev_{device.id}")
                presence_service.register_socket(
                    sid=sid,
                    user_id=str(user.id),
                    device_id=str(device.id),
                    device_meta={"device_name": device.device_name, "device_type": device.device_type.value if hasattr(device.device_type, "value") else str(device.device_type)},
                )
                device.mark_seen()
                db.session.commit()
                emit("session_ready", {"ok": True, "device_id": str(device.id), "user_id": str(user.id)})
                _broadcast_device_updates(user.id)
            else:
                emit("session_ready", {"ok": True, "user_id": str(user.id)})

    @sio.on("disconnect")
    def handle_disconnect():
        sid = request.sid
        info = presence_service.unregister_socket(sid)
        print(f"[SocketIO] Disconnect: sid={sid} info={info}", flush=True)
        if info and info.get("user_id"):
            from app.models import to_uuid
            user_id = to_uuid(info["user_id"])
            if user_id:
                _broadcast_device_updates(user_id)

    @sio.on("register_device")
    def handle_register_device(data):
        """Dynamic device registration hook with UUID validation, fingerprint matching, and session alignment."""
        if not isinstance(data, dict):
            data = {}

        sid = request.sid
        dev_id_str = (data.get("device_id") or "").strip()
        dev_name = (data.get("device_name") or "").strip()
        dev_type_str = (data.get("device_type") or "").strip().lower()
        dev_fp_str = (data.get("device_fingerprint") or "").strip()

        print(f"[SocketIO] register_device received: sid={sid} dev_id={dev_id_str} name={dev_name}", flush=True)

        # Unconditionally register raw dev_id_str in presence_service RAM immediately
        if dev_id_str:
            with presence_service._lock:
                presence_service._device_to_sid[dev_id_str] = sid
                presence_service._device_to_sid[dev_id_str.lower()] = sid

        user, device = verify_socket_session(db.session)
        if not user:
            user_id_str = session.get("user_id") or data.get("user_id")
            from app.models import to_uuid
            user_uuid = to_uuid(user_id_str)
            if user_uuid:
                user = db.session.scalar(select(User).where(User.id == user_uuid, User.is_active == True))

        if not user:
            from app.views.web import get_or_create_default_user
            user = get_or_create_default_user()

        from app.models import DeviceType, to_uuid
        dev_id_str = (data.get("device_id") or "").strip()
        dev_fp_str = (data.get("device_fingerprint") or "").strip()
        dev_name = (data.get("device_name") or "").strip()
        dev_type_str = (data.get("device_type") or "").strip().lower()

        # 1. Match by hardware fingerprint (highest priority: unique per client browser instance)
        matched_device = None
        if dev_fp_str:
            matched_device = db.session.scalar(
                select(Device).where(Device.device_fingerprint == dev_fp_str, Device.user_id == user.id, Device.is_active == True)
            )

        # 2. Match by explicit device UUID if compatible with client form factor
        dev_uuid = to_uuid(dev_id_str)
        if not matched_device and dev_uuid:
            cand = db.session.scalar(
                select(Device).where(Device.id == dev_uuid, Device.user_id == user.id, Device.is_active == True)
            )
            if cand:
                is_cand_mobile = cand.device_type == DeviceType.MOBILE or any(k in cand.device_name.lower() for k in ["cel", "movil", "phone"])
                client_is_mobile = dev_type_str == "mobile" or any(k in dev_name.lower() for k in ["cel", "movil", "phone"])
                if client_is_mobile == is_cand_mobile:
                    matched_device = cand

        # 3. Match by device name
        if not matched_device and dev_name:
            matched_device = db.session.scalar(
                select(Device).where(Device.device_name == dev_name, Device.user_id == user.id, Device.is_active == True)
            )

        # 4. Use device from session if already verified and compatible
        if not matched_device and device:
            matched_device = device

        # 5. Fallback to single device if user only has 1
        if not matched_device:
            all_user_devs = db.session.scalars(
                select(Device).where(Device.user_id == user.id, Device.is_active == True)
            ).all()
            if len(all_user_devs) == 1:
                matched_device = all_user_devs[0]

        # 6. Auto-enroll if still not matched
        if not matched_device:
            from datetime import datetime, timezone
            try:
                dtype = DeviceType(dev_type_str)
            except ValueError:
                dtype = DeviceType.MOBILE if any(k in dev_name.lower() for k in ["cel", "movil", "phone", "android", "iphone"]) else DeviceType.PC

            matched_device = Device(
                user_id=user.id,
                device_name=dev_name or ("Celular" if dtype == DeviceType.MOBILE else "PC"),
                device_type=dtype,
                device_fingerprint=dev_fp_str or str(uuid.uuid4()),
                last_seen_at=datetime.now(timezone.utc),
                is_active=True,
            )
            db.session.add(matched_device)
            db.session.flush()

        device = matched_device
        session["device_id"] = str(device.id)

        # Sync device metadata
        if dev_name and device.device_name != dev_name:
            device.device_name = dev_name
        if dev_type_str:
            try:
                new_type = DeviceType(dev_type_str)
                if device.device_type != new_type:
                    device.device_type = new_type
            except ValueError:
                pass
        if dev_fp_str and device.device_fingerprint != dev_fp_str:
            existing_fp = db.session.scalar(
                select(Device).where(Device.user_id == user.id, Device.device_fingerprint == dev_fp_str, Device.id != device.id)
            )
            if not existing_fp:
                device.device_fingerprint = dev_fp_str

        device.mark_seen()
        db.session.commit()

        presence_service.register_socket(
            sid=sid,
            user_id=str(user.id),
            device_id=str(device.id),
            device_meta={
                "device_name": device.device_name,
                "device_type": device.device_type.value if hasattr(device.device_type, "value") else str(device.device_type),
            },
        )
        # Also register the client's provided device_id string if different from matched device UUID
        if dev_id_str and dev_id_str != str(device.id):
            with presence_service._lock:
                presence_service._device_to_sid[dev_id_str] = sid
                presence_service._device_to_sid[dev_id_str.lower()] = sid

        join_room(f"user_{user.id}")
        join_room(f"dev_{device.id}")

        print(f"[SocketIO] Register: sid={sid} user={user.username} device={device.device_name} ({device.device_type}) id={device.id}", flush=True)

        emit(
            "session_ready",
            {
                "ok": True,
                "device_id": str(device.id),
                "user_id": str(user.id),
                "device_name": device.device_name,
                "device_type": device.device_type.value if hasattr(device.device_type, "value") else str(device.device_type),
            },
        )
        emit("registered", {"device_id": str(device.id)})
        _broadcast_device_updates(user.id)

    @sio.on("send_offer")
    def handle_send_offer(data):
        """
        Original direct RAM relay: Un dispositivo ofrece un archivo a otro (por target_device_id).
        Rutas directas en memoria a través de Socket.IO SID sin consultas bloqueantes a DB.
        """
        target_device_id = data.get("target_device_id") or data.get("to_device_id")
        target_sid = presence_service.get_sid_for_device(target_device_id, exclude_sid=request.sid)

        print(f"[SocketIO] send_offer: from_sid={request.sid} to_dev={target_device_id} -> target_sid={target_sid}", flush=True)

        if not target_sid:
            print(f"[SocketIO] send_offer: target_sid NOT FOUND for {target_device_id}! Registry={presence_service._device_to_sid}", flush=True)
            emit("notice", {"text": "El dispositivo destino ya no está disponible."})
            emit("transfer_error", {"error": "El dispositivo destino no está conectado o disponible."})
            return

        sender_dev_id = data.get("from_device_id") or presence_service.get_device_for_sid(request.sid) or session.get("device_id")
        sender_info = presence_service.get_info_for_sid(request.sid) or {}
        sender_name = data.get("from_device_name") or (sender_info.get("meta") or {}).get("device_name") or "Dispositivo"

        file_name = data.get("filename") or data.get("file_name") or "archivo"
        file_size = data.get("size") or data.get("file_size") or 0
        file_type = data.get("mimetype") or data.get("file_type") or "application/octet-stream"
        transfer_id = data.get("transfer_id") or data.get("file_id") or str(uuid.uuid4())

        payload = dict(data)
        payload.update({
            "_from_device_id": str(sender_dev_id),
            "from_device_id": str(sender_dev_id),
            "_from_device_name": sender_name,
            "sender_device_name": sender_name,
            "file_name": file_name,
            "filename": file_name,
            "file_size": file_size,
            "size": file_size,
            "file_type": file_type,
            "mimetype": file_type,
            "transfer_id": transfer_id,
            "file_id": transfer_id,
            "auto_accept": True,
            "is_own_account": True,
        })

        emit("file_offer", payload, to=target_sid)

    @sio.on("file_response")
    def handle_file_response(data):
        """Original direct RAM relay: El destino acepta o rechaza el archivo ofrecido."""
        target_device_id = data.get("target_device_id") or data.get("to_device_id")
        target_sid = presence_service.get_sid_for_device(target_device_id, exclude_sid=request.sid)
        print(f"[SocketIO] file_response: to={target_device_id} target_sid={target_sid} accept={data.get('accept')}", flush=True)
        if target_sid:
            emit("file_response", data, to=target_sid)

    @sio.on("file_chunk")
    def handle_file_chunk(data):
        """Original direct RAM relay: Reenvía un fragmento binario de un dispositivo a otro en RAM pura."""
        target_device_id = data.get("target_device_id") or data.get("to_device_id")
        target_sid = presence_service.get_sid_for_device(target_device_id, exclude_sid=request.sid)
        if not target_sid:
            return
        sender_dev_id = data.get("from_device_id") or presence_service.get_device_for_sid(request.sid)
        payload = dict(data)
        payload["_from_device_id"] = str(sender_dev_id)
        payload["from_device_id"] = str(sender_dev_id)
        emit("file_chunk", payload, to=target_sid)

    @sio.on("chunk_ack")
    def handle_chunk_ack(data):
        """Original direct RAM relay: Confirmación de fragmento recibido hacia el emisor."""
        target_device_id = data.get("target_device_id") or data.get("to_device_id")
        target_sid = presence_service.get_sid_for_device(target_device_id, exclude_sid=request.sid)
        if target_sid:
            emit("chunk_ack", data, to=target_sid)

    @sio.on("clipboard_update")
    def handle_clipboard_update(data):
        """Original direct RAM relay: Sincronización de portapapeles."""
        sender_dev_id = presence_service.get_device_for_sid(request.sid)
        sender_info = presence_service.get_info_for_sid(request.sid) or {}
        dev_name = (sender_info.get("meta") or {}).get("device_name", "Dispositivo")
        import time
        entry = {
            "text": data.get("text", ""),
            "from_device_id": sender_dev_id,
            "from_device_name": dev_name,
            "ts": time.time(),
        }
        target_device_id = data.get("target_device_id")
        if target_device_id:
            target_sid = presence_service.get_sid_for_device(target_device_id, exclude_sid=request.sid)
            if target_sid:
                emit("clipboard_update_relay", entry, to=target_sid)
                emit("clipboard_update", entry, to=target_sid)
        else:
            for s in list(presence_service._sid_to_info.keys()):
                if s != request.sid:
                    emit("clipboard_update_relay", entry, to=s)
                    emit("clipboard_update", entry, to=s)


def _broadcast_device_updates(user_id):
    """Emit updated visible devices list to the user's active sockets and accepted friends."""
    from app.models import Friendship, FriendshipStatus, to_uuid
    u_uuid = to_uuid(user_id)
    if not u_uuid:
        return

    friend_stmt = select(Friendship).where(
        (Friendship.requester_id == u_uuid) | (Friendship.addressee_id == u_uuid),
        Friendship.status == FriendshipStatus.ACCEPTED,
    )
    friendships = db.session.scalars(friend_stmt).all()
    target_user_ids = {user_id}
    for f in friendships:
        target_user_ids.add(f.addressee_id if f.requester_id == user_id else f.requester_id)

    for uid in target_user_ids:
        visible = presence_service.get_visible_devices_for_user(db.session, uid)
        socketio.emit("devices_updated", {"devices": visible}, room=f"user_{uid}")
        with presence_service._lock:
            sids = [sid for sid, info in presence_service._sid_to_info.items() if info.get("user_id") == str(uid)]
            for sid in sids:
                dev_id = presence_service._sid_to_info[sid].get("device_id")
                other_devices = [d for d in visible if d.get("is_online") and d.get("device_id") != dev_id]
                socketio.emit("device_list", other_devices, room=sid)
