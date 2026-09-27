"""
Device and User Presence Service.
Maintains in-memory real-time registry of connected WebSocket sockets and maps them to database entities.
"""

from datetime import datetime, timezone
import threading
from typing import Dict, List, Optional, Set
import uuid

from sqlalchemy import select
from app.models import Device, Friendship, FriendshipStatus, User


class PresenceService:
    """Thread-safe presence and routing registry for Socket.IO clients."""

    def __init__(self):
        self._lock = threading.RLock()
        # Maps device_id (UUID str) -> socket_id (str)
        self._device_to_sid: Dict[str, str] = {}
        # Maps socket_id (str) -> dict(device_id, user_id, connected_at)
        self._sid_to_info: Dict[str, dict] = {}
        # Maps user_id (UUID str) -> Set of active device_id strings
        self._user_to_devices: Dict[str, Set[str]] = {}

    def register_socket(self, sid: str, user_id: str, device_id: str, device_meta: Optional[dict] = None) -> None:
        """Register a connected socket session."""
        with self._lock:
            dev_str = str(device_id).strip()
            dev_norm = dev_str.lower()
            u_str = str(user_id).strip()
            u_norm = u_str.lower()

            # If device already had an active socket, evict the stale one
            old_sid = self._device_to_sid.get(dev_str) or self._device_to_sid.get(dev_norm)
            if old_sid and old_sid != sid:
                self._sid_to_info.pop(old_sid, None)

            self._device_to_sid[dev_str] = sid
            self._device_to_sid[dev_norm] = sid
            self._sid_to_info[sid] = {
                "device_id": dev_str,
                "user_id": u_str,
                "connected_at": datetime.now(timezone.utc),
                "meta": device_meta or {},
            }
            if u_norm not in self._user_to_devices:
                self._user_to_devices[u_norm] = set()
            self._user_to_devices[u_norm].add(dev_str)

    def unregister_socket(self, sid: str) -> Optional[dict]:
        """Remove a disconnected socket and return its session info."""
        with self._lock:
            info = self._sid_to_info.pop(sid, None)
            if not info:
                return None
            device_id = str(info["device_id"]).strip()
            dev_norm = device_id.lower()
            user_id = str(info["user_id"]).strip()
            u_norm = user_id.lower()

            if self._device_to_sid.get(device_id) == sid:
                self._device_to_sid.pop(device_id, None)
            if self._device_to_sid.get(dev_norm) == sid:
                self._device_to_sid.pop(dev_norm, None)

            if u_norm in self._user_to_devices:
                self._user_to_devices[u_norm].discard(device_id)
                self._user_to_devices[u_norm].discard(dev_norm)
                if not self._user_to_devices[u_norm]:
                    self._user_to_devices.pop(u_norm, None)

            return info

    def get_sid_for_device(self, device_id: str, user_id: Optional[str] = None, exclude_sid: Optional[str] = None) -> Optional[str]:
        """Look up active Socket.IO sid for target device, with user-level and single-peer fallbacks."""
        with self._lock:
            dev_str = str(device_id).strip() if device_id else ""
            dev_norm = dev_str.lower()
            if dev_str:
                sid = self._device_to_sid.get(dev_str) or self._device_to_sid.get(dev_norm)
                if sid and (not exclude_sid or sid != exclude_sid):
                    return sid

                for did, s in self._device_to_sid.items():
                    if str(did).strip().lower() == dev_norm:
                        if not exclude_sid or s != exclude_sid:
                            return s

            # Fallback 1: if user_id is provided, find any active socket for this user
            if user_id:
                uid_norm = str(user_id).strip().lower()
                for s, info in self._sid_to_info.items():
                    if str(info.get("user_id")).strip().lower() == uid_norm:
                        if not exclude_sid or s != exclude_sid:
                            return s

            # Fallback 2 (Safeguard): If only ONE other socket is currently connected to the server,
            # route to it so P2P transfers between 2 active devices never drop due to ID discrepancy.
            all_other_sids = set(self._sid_to_info.keys()) | set(self._device_to_sid.values())
            other_active_sids = [s for s in all_other_sids if not exclude_sid or s != exclude_sid]
            if len(other_active_sids) == 1:
                return other_active_sids[0]

            return None

    def is_device_online(self, device_id: str, db_session=None) -> bool:
        """Check if device is currently connected via WebSocket or recently seen."""
        with self._lock:
            d_str = str(device_id).strip()
            if d_str in self._device_to_sid or d_str.lower() in self._device_to_sid:
                return True
        if db_session:
            from app.models import Device, to_uuid
            u = to_uuid(device_id)
            if u:
                dev = db_session.scalar(select(Device).where(Device.id == u))
                if dev and dev.last_seen_at:
                    now_utc = datetime.now(timezone.utc)
                    dt = dev.last_seen_at.replace(tzinfo=timezone.utc) if dev.last_seen_at.tzinfo is None else dev.last_seen_at
                    return (now_utc - dt).total_seconds() < 45
        return False

    def get_info_for_sid(self, sid: str) -> Optional[dict]:
        """Look up session info dict for a given socket."""
        with self._lock:
            return self._sid_to_info.get(sid)

    def get_user_for_sid(self, sid: str) -> Optional[str]:
        """Look up user_id for a given socket."""
        with self._lock:
            info = self._sid_to_info.get(sid)
            return info["user_id"] if info else None

    def get_device_for_sid(self, sid: str) -> Optional[str]:
        """Look up device_id for a given socket."""
        with self._lock:
            info = self._sid_to_info.get(sid)
            return info["device_id"] if info else None

    def get_visible_devices_for_user(self, db_session, current_user_id: uuid.UUID) -> List[dict]:
        """
        Query all devices visible to current_user:
        1. All devices belonging to current_user.
        2. All devices belonging to users with an ACCEPTED friendship.
        Returns presence status using hybrid detection (active WebSocket OR active REST polling in last 45s).
        """
        # Find accepted friend user IDs
        friend_stmt = select(Friendship).where(
            (Friendship.requester_id == current_user_id) | (Friendship.addressee_id == current_user_id),
            Friendship.status == FriendshipStatus.ACCEPTED,
        )
        friendships = db_session.scalars(friend_stmt).all()
        allowed_user_ids = {current_user_id}
        for f in friendships:
            friend_id = f.addressee_id if f.requester_id == current_user_id else f.requester_id
            allowed_user_ids.add(friend_id)

        # Query devices belonging to these users
        dev_stmt = select(Device, User.username, User.display_name).join(User).where(
            Device.user_id.in_(allowed_user_ids),
            Device.is_active == True,
        )
        results = db_session.execute(dev_stmt).all()

        now_utc = datetime.now(timezone.utc)
        visible_list = []
        with self._lock:
            for device, username, display_name in results:
                dev_id_str = str(device.id)
                has_active_socket = dev_id_str in self._device_to_sid
                recently_active = False
                if device.last_seen_at:
                    dt = device.last_seen_at.replace(tzinfo=timezone.utc) if device.last_seen_at.tzinfo is None else device.last_seen_at
                    recently_active = (now_utc - dt).total_seconds() < 45

                is_online = has_active_socket or recently_active

                visible_list.append({
                    "device_id": dev_id_str,
                    "device_name": device.device_name,
                    "device_type": device.device_type.value if hasattr(device.device_type, "value") else str(device.device_type),
                    "owner_username": username,
                    "owner_display_name": display_name or username,
                    "is_own_account": device.user_id == current_user_id,
                    "is_self": False,  # Deprecated: clients filter by device_id !== my_device_id
                    "is_online": is_online,
                    "last_seen_at": device.last_seen_at.isoformat() if device.last_seen_at else None,
                })

        return visible_list


presence_service = PresenceService()
