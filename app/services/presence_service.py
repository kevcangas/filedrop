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
            # If device already had an active socket, evict the stale one
            old_sid = self._device_to_sid.get(device_id)
            if old_sid and old_sid != sid:
                self._sid_to_info.pop(old_sid, None)

            self._device_to_sid[device_id] = sid
            self._sid_to_info[sid] = {
                "device_id": device_id,
                "user_id": user_id,
                "connected_at": datetime.now(timezone.utc),
                "meta": device_meta or {},
            }
            if user_id not in self._user_to_devices:
                self._user_to_devices[user_id] = set()
            self._user_to_devices[user_id].add(device_id)

    def unregister_socket(self, sid: str) -> Optional[dict]:
        """Remove a disconnected socket and return its session info."""
        with self._lock:
            info = self._sid_to_info.pop(sid, None)
            if not info:
                return None
            device_id = info["device_id"]
            user_id = info["user_id"]

            if self._device_to_sid.get(device_id) == sid:
                self._device_to_sid.pop(device_id, None)

            if user_id in self._user_to_devices:
                self._user_to_devices[user_id].discard(device_id)
                if not self._user_to_devices[user_id]:
                    self._user_to_devices.pop(user_id, None)

            return info

    def get_sid_for_device(self, device_id: str) -> Optional[str]:
        """Look up active Socket.IO sid for target device."""
        with self._lock:
            return self._device_to_sid.get(str(device_id))

    def is_device_online(self, device_id: str) -> bool:
        """Check if device is currently connected via WebSocket."""
        with self._lock:
            return str(device_id) in self._device_to_sid

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
        Only returns currently active/online devices.
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

        visible_list = []
        with self._lock:
            for device, username, display_name in results:
                dev_id_str = str(device.id)
                is_online = dev_id_str in self._device_to_sid
                visible_list.append({
                    "device_id": dev_id_str,
                    "device_name": device.device_name,
                    "device_type": device.device_type.value if hasattr(device.device_type, "value") else str(device.device_type),
                    "owner_username": username,
                    "owner_display_name": display_name or username,
                    "is_own_account": device.user_id == current_user_id,
                    "is_self": False,  # Deprecated: clients filter by device_id !== my_device_id
                    "is_online": is_online,
                })

        return visible_list


presence_service = PresenceService()
