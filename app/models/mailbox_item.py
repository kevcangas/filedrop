"""
Mailbox entity model for asynchronous offline file transfers with expiration TTL.
"""

from datetime import datetime, timezone
import enum
from typing import Optional
import uuid
from sqlalchemy import BigInteger, Boolean, DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, GUID, TimestampMixin, generate_uuid


class StorageType(str, enum.Enum):
    """Storage backing engine for mailbox files."""
    LOCAL = "LOCAL"
    S3 = "S3"


class MailboxItem(Base, TimestampMixin):
    """Represents a temporary file stored in the mailbox for later download."""

    __tablename__ = "mailbox_items"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=generate_uuid,
    )
    sender_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    sender_device_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(),
        ForeignKey("devices.id", ondelete="SET NULL"),
        nullable=True,
    )
    recipient_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    recipient_device_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(),
        ForeignKey("devices.id", ondelete="SET NULL"),
        nullable=True,
    )
    storage_type: Mapped[StorageType] = mapped_column(
        Enum(StorageType, name="storage_type_enum", native_enum=False),
        default=StorageType.LOCAL,
        nullable=False,
    )
    file_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    file_path: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )
    file_size: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
    )
    mime_type: Mapped[Optional[str]] = mapped_column(
        String(120),
        nullable=True,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
    )
    is_downloaded: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    @property
    def is_expired(self) -> bool:
        """Evaluate if the mailbox item has passed its TTL expiration timestamp."""
        return datetime.now(timezone.utc) > self.expires_at

    def to_dict(self) -> dict:
        """Serialize mailbox item instance to dictionary."""
        return {
            "id": str(self.id),
            "sender_user_id": str(self.sender_user_id) if self.sender_user_id else None,
            "sender_device_id": str(self.sender_device_id) if self.sender_device_id else None,
            "recipient_user_id": str(self.recipient_user_id) if self.recipient_user_id else None,
            "recipient_device_id": str(self.recipient_device_id) if self.recipient_device_id else None,
            "storage_type": self.storage_type.value if hasattr(self.storage_type, "value") else str(self.storage_type),
            "file_name": self.file_name,
            "file_size": self.file_size,
            "mime_type": self.mime_type,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "is_downloaded": self.is_downloaded,
            "is_expired": self.is_expired,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self) -> str:
        return f"<MailboxItem name='{self.file_name}' size={self.file_size} expires='{self.expires_at}'>"
