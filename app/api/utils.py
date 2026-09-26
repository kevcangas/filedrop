"""
Authentication and security utility helpers for API blueprints.
"""

from functools import wraps
import re
from typing import Callable, Optional, Tuple
from flask import g, jsonify, request, session
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User, Device
from app.models.base import to_uuid


def get_current_user_and_device(db_session: Session) -> Tuple[Optional[User], Optional[Device]]:
    """Resolve authenticated user and device from current Flask session."""
    user_id = to_uuid(session.get("user_id"))
    device_id = to_uuid(session.get("device_id"))

    if not user_id:
        return None, None

    user = db_session.scalar(select(User).where(User.id == user_id, User.is_active == True))
    device = None
    if user and device_id:
        device = db_session.scalar(
            select(Device).where(Device.id == device_id, Device.user_id == user.id, Device.is_active == True)
        )

    return user, device


def validate_password_strength(password: str) -> Tuple[bool, Optional[str]]:
    """Enforce security policy: minimum 8 characters, with letters and numbers."""
    if not password or len(password) < 8:
        return False, "Password must be at least 8 characters long."
    if not re.search(r"[A-Za-z]", password):
        return False, "Password must contain at least one letter."
    if not re.search(r"[0-9]", password):
        return False, "Password must contain at least one digit."
    return True, None


def validate_username(username: str) -> Tuple[bool, Optional[str]]:
    """Validate username format (alphanumeric, dashes, underscores, 3-30 chars)."""
    if not username or not (3 <= len(username) <= 30):
        return False, "Username must be between 3 and 30 characters."
    if not re.match(r"^[a-zA-Z0-9_-]+$", username):
        return False, "Username may only contain letters, numbers, hyphens, and underscores."
    return True, None
