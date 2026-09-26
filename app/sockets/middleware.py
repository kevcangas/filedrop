"""
Socket.IO Authentication & Friendship ACL Middleware.
Validates session claims and enforces friendship authorization boundaries before routing events.
"""

from typing import Optional, Tuple
import uuid
from flask import request, session
from sqlalchemy import or_, select

from app.models import Device, Friendship, FriendshipStatus, User


def verify_socket_session(db_session) -> Tuple[Optional[User], Optional[Device]]:
    """Authenticate incoming WebSocket request using the Flask HTTP session."""
    user_id = session.get("user_id")
    device_id = session.get("device_id")

    if not user_id:
        return None, None

    user = db_session.scalar(select(User).where(User.id == user_id, User.is_active == True))
    device = None
    if user and device_id:
        device = db_session.scalar(
            select(Device).where(Device.id == device_id, Device.user_id == user.id, Device.is_active == True)
        )
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
