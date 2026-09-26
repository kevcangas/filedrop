"""
Device entity model representing connected hardware endpoints bound to a user account.
"""

from datetime import datetime, timezone
import enum
from typing import TYPE_CHECKING, Optional
import uuid
from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, GUID, TimestampMixin, generate_uuid

if TYPE_CHECKING:
    from .user import User


class DeviceType(str, enum.Enum):
    """Enumeration of supported device form factors."""
    PC = "pc"
    MOBILE = "mobile"
    TABLET = "tablet"
    SERVER = "server"


class Device(Base, TimestampMixin):
    """Represents a client device enrolled by a user."""

    __tablename__ = "devices"
    __table_args__ = (
        UniqueConstraint("user_id", "device_fingerprint", name="uq_user_device_fingerprint"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=generate_uuid,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    device_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    device_type: Mapped[DeviceType] = mapped_column(
        Enum(DeviceType, name="device_type_enum", native_enum=False),
        default=DeviceType.PC,
        nullable=False,
    )
    device_fingerprint: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        index=True,
    )
    device_token_hash: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        back_populates="devices",
    )

    def mark_seen(self) -> None:
        """Update last seen timestamp to the current UTC time."""
        self.last_seen_at = datetime.now(timezone.utc)

    def to_dict(self) -> dict:
        """Serialize device instance to dictionary."""
        return {
            "id": str(self.id),
            "user_id": str(self.user_id),
            "device_name": self.device_name,
            "device_type": self.device_type.value if hasattr(self.device_type, "value") else str(self.device_type),
            "device_fingerprint": self.device_fingerprint,
            "last_seen_at": self.last_seen_at.isoformat() if self.last_seen_at else None,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self) -> str:
        return f"<Device name='{self.device_name}' type='{self.device_type}' user_id='{self.user_id}'>"
