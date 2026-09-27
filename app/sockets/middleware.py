"""
Socket.IO Authentication & Friendship ACL Middleware.
Validates session claims and enforces friendship authorization boundaries before routing events.
"""

from typing import Optional, Tuple
import uuid
from flask import request, session
from sqlalchemy import or_, select

from app.models import Device, Friendship, FriendshipStatus, User, to_uuid


def verify_socket_session(db_session) -> Tuple[Optional[User], Optional[Device]]:
    """Authenticate incoming WebSocket request using the Flask HTTP session."""
    user_id = session.get("user_id") or session.get("_user_id")
    device_id = session.get("device_id") or request.cookies.get("enlace_device_id")

    if not user_id and session.get("logged_in"):
        from app.views.web import get_or_create_default_user
        default_user = get_or_create_default_user()
        user_id = str(default_user.id)
        session["user_id"] = user_id

    user_uuid = to_uuid(user_id)
    if not user_uuid:
        return None, None

    user = db_session.scalar(select(User).where(User.id == user_uuid, User.is_active == True))
    if not user:
        return None, None

    device = None
    dev_uuid = to_uuid(device_id)
    if dev_uuid:
        device = db_session.scalar(
            select(Device).where(Device.id == dev_uuid, Device.user_id == user.id, Device.is_active == True)
        )

    if not device:
        # Match device by form factor for this user
        from app.models import DeviceType
        user_agent = request.headers.get("User-Agent", "").lower()
        is_mobile = any(m in user_agent for m in ["android", "iphone", "ipad", "mobile"])
        target_type = DeviceType.MOBILE if is_mobile else DeviceType.PC
        device = db_session.scalar(
            select(Device).where(
                Device.user_id == user.id,
                Device.is_active == True,
                or_(
                    Device.device_type == target_type,
                    Device.device_name.ilike("%cel%" if is_mobile else "%pc%"),
                    Device.device_name.ilike("%movil%" if is_mobile else "%laptop%"),
                    Device.device_name.ilike("%phone%" if is_mobile else "%escritorio%"),
                ),
            ).order_by(Device.last_seen_at.desc())
        )
        if device:
            session["device_id"] = str(device.id)

    return user, device


def verify_friendship_acl(db_session, sender_user_id, recipient_user_id) -> bool:
    """
    Evaluate if two users are allowed to communicate:
    1. If sender and recipient are the same user (own devices), communication is permitted.
    2. If an ACCEPTED friendship exists between the two users, communication is permitted.
    3. Otherwise, communication is strictly blocked.
    """
    from app.models import to_uuid
    s_uuid = to_uuid(sender_user_id)
    r_uuid = to_uuid(recipient_user_id)
    if not s_uuid or not r_uuid:
        return False
    if s_uuid == r_uuid:
        return True

    stmt = select(Friendship).where(
        or_(
            (Friendship.requester_id == s_uuid) & (Friendship.addressee_id == r_uuid),
            (Friendship.requester_id == r_uuid) & (Friendship.addressee_id == s_uuid),
        ),
        Friendship.status == FriendshipStatus.ACCEPTED,
    )
    friendship = db_session.scalar(stmt)
    return friendship is not None
