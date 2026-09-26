"""
Domain models package exposing all relational entities for SQLAlchemy and Alembic.
"""

from .base import Base, GUID, TimestampMixin, generate_uuid, to_uuid
from .user import User
from .device import Device, DeviceType
from .friendship import Friendship, FriendshipStatus
from .mailbox_item import MailboxItem, StorageType
from .transfer_log import TransferLog, TransferChannel, TransferStatus

__all__ = [
    "Base",
    "GUID",
    "TimestampMixin",
    "generate_uuid",
    "to_uuid",
    "User",
    "Device",
    "DeviceType",
    "Friendship",
    "FriendshipStatus",
    "MailboxItem",
    "StorageType",
    "TransferLog",
    "TransferChannel",
    "TransferStatus",
]
