"""
Friendship association entity representing bidirectional access trust between users.
"""

import enum
from typing import TYPE_CHECKING
import uuid
from sqlalchemy import CheckConstraint, Enum, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, GUID, TimestampMixin, generate_uuid

if TYPE_CHECKING:
    from .user import User


class FriendshipStatus(str, enum.Enum):
    """Lifecycle statuses of a friendship relationship."""
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    BLOCKED = "BLOCKED"


class Friendship(Base, TimestampMixin):
    """Represents a friendship invitation and status between two users."""

    __tablename__ = "friendships"
    __table_args__ = (
        UniqueConstraint("requester_id", "addressee_id", name="uq_friendship_pair"),
        CheckConstraint("requester_id != addressee_id", name="ck_no_self_friendship"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=generate_uuid,
    )
    requester_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    addressee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[FriendshipStatus] = mapped_column(
        Enum(FriendshipStatus, name="friendship_status_enum", native_enum=False),
        default=FriendshipStatus.PENDING,
        nullable=False,
        index=True,
    )

    # Relationships
    requester: Mapped["User"] = relationship(
        "User",
        foreign_keys=[requester_id],
        back_populates="sent_friend_requests",
    )
    addressee: Mapped["User"] = relationship(
        "User",
        foreign_keys=[addressee_id],
        back_populates="received_friend_requests",
    )

    def to_dict(self) -> dict:
        """Serialize friendship instance to dictionary."""
        return {
            "id": str(self.id),
            "requester_id": str(self.requester_id),
            "addressee_id": str(self.addressee_id),
            "status": self.status.value if hasattr(self.status, "value") else str(self.status),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self) -> str:
        return f"<Friendship requester='{self.requester_id}' addressee='{self.addressee_id}' status='{self.status}'>"
