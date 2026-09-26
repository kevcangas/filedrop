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
    user_id = session.get("user_id")
    device_id = session.get("device_id")

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
        # Only fall back if the user has exactly 1 enrolled device to prevent identity hijacking
        all_devs = db_session.scalars(
            select(Device).where(Device.user_id == user.id, Device.is_active == True)
        ).all()
        if len(all_devs) == 1:
            device = all_devs[0]
            session["device_id"] = str(device.id)

    return user, device


def verify_friendship_acl(db_session, sender_user_id: uuid.UUID, recipient_user_id: uuid.UUID) -> bool:
    """
    Evaluate if two users are allowed to communicate:
    1. If sender and recipient are the same user (own devices), communication is permitted.
    2. If an ACCEPTED friendship exists between the two users, communication is permitted.
    3. Otherwise, communication is strictly blocked.
    """
    if sender_user_id == recipient_user_id:
        return True

    stmt = select(Friendship).where(
        or_(
            (Friendship.requester_id == sender_user_id) & (Friendship.addressee_id == recipient_user_id),
            (Friendship.requester_id == recipient_user_id) & (Friendship.addressee_id == sender_user_id),
        ),
        Friendship.status == FriendshipStatus.ACCEPTED,
    )
    friendship = db_session.scalar(stmt)
    return friendship is not None
