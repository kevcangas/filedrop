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
        user, device = verify_socket_session(db.session)
        sid = request.sid

        if user and device:
            print(f"[SocketIO] Connect: sid={sid} user={user.username} device={device.device_name} ({device.device_type}) id={device.id}", flush=True)
            # Join user room and device room
            join_room(f"user_{user.id}")
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
            print(f"[SocketIO] Connect (anonymous): sid={sid} user={user.username if user else None}", flush=True)
            # Fallback connection for legacy / anonymous clients
            emit("session_anonymous", {"ok": True, "sid": sid})

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

        user, device = verify_socket_session(db.session)
        sid = request.sid

        if not user:
            user_id_str = session.get("user_id") or (data.get("user_id") if isinstance(data, dict) else None)
            from app.models import to_uuid
            user_uuid = to_uuid(user_id_str)
            if user_uuid:
                user = db.session.scalar(select(User).where(User.id == user_uuid, User.is_active == True))

        if not user:
            emit("session_error", {"error": "Authentication required."})
            return

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
        _broadcast_device_updates(user.id)

    @sio.on("send_offer")
    def handle_send_offer(data):
        """
        Offer a file transfer to target device.
        Routes to active socket SID, device room, and user room for guaranteed delivery.
        """
        sender_device_id_str = data.get("from_device_id") or presence_service.get_device_for_sid(request.sid) or session.get("device_id")
        target_device_id_str = data.get("target_device_id") or data.get("to_device_id")

        if not sender_device_id_str or not target_device_id_str:
            emit("transfer_error", {"error": "Destinatario o emisor no especificado."})
            return

        from app.models import to_uuid
        sender_uuid = to_uuid(sender_device_id_str)
        target_uuid = to_uuid(target_device_id_str)

        sender_device = db.session.scalar(select(Device).where(Device.id == sender_uuid)) if sender_uuid else None
        target_device = db.session.scalar(select(Device).where(Device.id == target_uuid)) if target_uuid else None

        sender_user_id = str(sender_device.user_id) if sender_device else (presence_service.get_user_for_sid(request.sid) or session.get("user_id"))
        target_user_id = str(target_device.user_id) if target_device else sender_user_id

        # Enforce ACL if both devices are tracked in DB
        if sender_device and target_device:
            if not verify_friendship_acl(db.session, sender_device.user_id, target_device.user_id):
                emit("transfer_error", {"error": "Acceso denegado: no estás conectado con el propietario de este dispositivo."})
                return
            is_own = sender_device.user_id == target_device.user_id
            sender_name = sender_device.device_name
        else:
            is_own = bool(sender_user_id and target_user_id and str(sender_user_id) == str(target_user_id))
            sender_name = data.get("from_device_name") or "Dispositivo"

        target_sid = presence_service.get_sid_for_device(
            device_id=target_device_id_str,
            user_id=target_user_id,
            exclude_sid=request.sid,
        )
        print(f"[SocketIO] send_offer: from={sender_device_id_str} to={target_device_id_str} target_user={target_user_id} sid={target_sid} is_own={is_own}", flush=True)

        file_name = data.get("filename") or data.get("file_name") or "archivo"
        file_size = data.get("size") or data.get("file_size") or 0
        file_type = data.get("mimetype") or data.get("file_type") or "application/octet-stream"
        transfer_id = data.get("transfer_id") or data.get("file_id") or str(uuid.uuid4())

        payload = dict(data)
        payload.update({
            "from_device_id": str(sender_device_id_str),
            "_from_device_id": str(sender_device_id_str),
            "sender_device_name": sender_name,
            "_from_device_name": sender_name,
            "file_name": file_name,
            "filename": file_name,
            "file_size": file_size,
            "size": file_size,
            "file_type": file_type,
            "mimetype": file_type,
            "transfer_id": transfer_id,
            "file_id": transfer_id,
            "is_own_account": is_own,
            "auto_accept": is_own,
        })

        # Deliver to target SID, target device room, and target user room
        if target_sid:
            sio.emit("send_offer", payload, room=target_sid)
            sio.emit("file_offer", payload, room=target_sid)
        if target_device_id_str:
            dev_room = f"dev_{target_device_id_str}"
            sio.emit("send_offer", payload, room=dev_room)
            sio.emit("file_offer", payload, room=dev_room)
        if target_user_id:
            sio.emit("send_offer", payload, room=f"user_{target_user_id}", skip_sid=request.sid)
            sio.emit("file_offer", payload, room=f"user_{target_user_id}", skip_sid=request.sid)

    @sio.on("file_response")
    def handle_file_response(data):
        """Forward recipient's accept/decline response to sender."""
        target_device_id = data.get("target_device_id") or data.get("to_device_id")
        sender_user_id = presence_service.get_user_for_sid(request.sid) or session.get("user_id")

        target_sid = presence_service.get_sid_for_device(
            device_id=target_device_id,
            user_id=sender_user_id,
            exclude_sid=request.sid,
        )
        print(f"[SocketIO] file_response: to={target_device_id} sid={target_sid} accept={data.get('accept')}", flush=True)

        if target_sid:
            sio.emit("file_response", data, room=target_sid)
            sio.emit("file_response_relay", data, room=target_sid)
        if target_device_id:
            sio.emit("file_response", data, room=f"dev_{target_device_id}")
            sio.emit("file_response_relay", data, room=f"dev_{target_device_id}")
        if sender_user_id:
            sio.emit("file_response", data, room=f"user_{sender_user_id}", skip_sid=request.sid)
            sio.emit("file_response_relay", data, room=f"user_{sender_user_id}", skip_sid=request.sid)

    @sio.on("file_chunk")
    def handle_file_chunk(data):
        """Route binary chunk directly to recipient's socket in memory."""
        target_device_id = data.get("target_device_id") or data.get("to_device_id")
        sender_user_id = presence_service.get_user_for_sid(request.sid) or session.get("user_id")

        target_sid = presence_service.get_sid_for_device(
            device_id=target_device_id,
            user_id=sender_user_id,
            exclude_sid=request.sid,
        )
        sender_dev_id = presence_service.get_device_for_sid(request.sid) or data.get("from_device_id")

        payload = dict(data)
        payload["_from_device_id"] = sender_dev_id
        payload["from_device_id"] = sender_dev_id

        if target_sid:
            sio.emit("file_chunk", payload, room=target_sid)
            sio.emit("file_chunk_relay", payload, room=target_sid)
        if target_device_id:
            sio.emit("file_chunk", payload, room=f"dev_{target_device_id}")
            sio.emit("file_chunk_relay", payload, room=f"dev_{target_device_id}")
        if sender_user_id:
            sio.emit("file_chunk", payload, room=f"user_{sender_user_id}", skip_sid=request.sid)
            sio.emit("file_chunk_relay", payload, room=f"user_{sender_user_id}", skip_sid=request.sid)

    @sio.on("chunk_ack")
    def handle_chunk_ack(data):
        """Route chunk receipt acknowledgement to sender."""
        target_device_id = data.get("target_device_id") or data.get("to_device_id")
        sender_user_id = presence_service.get_user_for_sid(request.sid) or session.get("user_id")

        target_sid = presence_service.get_sid_for_device(
            device_id=target_device_id,
            user_id=sender_user_id,
            exclude_sid=request.sid,
        )

        if target_sid:
            sio.emit("chunk_ack", data, room=target_sid)
            sio.emit("chunk_ack_relay", data, room=target_sid)
        if target_device_id:
            sio.emit("chunk_ack", data, room=f"dev_{target_device_id}")
            sio.emit("chunk_ack_relay", data, room=f"dev_{target_device_id}")
        if sender_user_id:
            sio.emit("chunk_ack", data, room=f"user_{sender_user_id}", skip_sid=request.sid)
            sio.emit("chunk_ack_relay", data, room=f"user_{sender_user_id}", skip_sid=request.sid)

    @sio.on("clipboard_update")
    def handle_clipboard_update(data):
        """
        Sync clipboard strictly to:
        1. All other active devices belonging to the SAME user.
        2. Optionally accepted friends if explicit sharing is specified.
        """
        sender_device_id = presence_service.get_device_for_sid(request.sid)
        from app.models import to_uuid
        dev_u = to_uuid(sender_device_id)
        if not dev_u:
            return

        device = db.session.scalar(select(Device).where(Device.id == dev_u))
        if not device:
            return

        # Broadcast only to the user's private room, excluding this device
        user_room = f"user_{device.user_id}"
        sio.emit(
            "clipboard_update",
            {
                "text": data.get("text"),
                "sender_device_id": sender_device_id,
                "sender_name": device.device_name,
            },
            room=user_room,
            skip_sid=request.sid,
        )


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
