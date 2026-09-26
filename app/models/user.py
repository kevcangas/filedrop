"""
User entity model for identity and authentication management.
"""

from typing import TYPE_CHECKING, List, Optional
import uuid
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, GUID, TimestampMixin, generate_uuid

if TYPE_CHECKING:
    from .device import Device
    from .friendship import Friendship


class User(Base, TimestampMixin):
    """Represents a registered platform account."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=generate_uuid,
    )
    username: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        index=True,
        nullable=False,
    )
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
    )
    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    display_name: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    is_admin: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    # Relationships
    devices: Mapped[List["Device"]] = relationship(
        "Device",
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="desc(Device.last_seen_at)",
    )

    sent_friend_requests: Mapped[List["Friendship"]] = relationship(
        "Friendship",
        foreign_keys="Friendship.requester_id",
        back_populates="requester",
        cascade="all, delete-orphan",
    )

    received_friend_requests: Mapped[List["Friendship"]] = relationship(
        "Friendship",
        foreign_keys="Friendship.addressee_id",
        back_populates="addressee",
        cascade="all, delete-orphan",
    )

    def set_password(self, password: str) -> None:
        """Hash and persist the user password using strong PBKDF2/Argon2."""
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        """Verify candidate password against persisted password hash."""
        return check_password_hash(self.password_hash, password)

    def to_dict(self, include_devices: bool = False) -> dict:
        """Serialize user instance to standard dictionary representation."""
        data = {
            "id": str(self.id),
            "username": self.username,
            "email": self.email,
            "display_name": self.display_name or self.username,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if include_devices and self.devices:
            data["devices"] = [d.to_dict() for d in self.devices]
        return data

    def __repr__(self) -> str:
        return f"<User username='{self.username}' id='{self.id}'>"
