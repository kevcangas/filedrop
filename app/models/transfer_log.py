"""
TransferLog entity model for observability, audit trails, and transfer metrics.
"""

from datetime import datetime, timezone
import enum
from typing import Optional
import uuid
from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, GUID, generate_uuid


class TransferChannel(str, enum.Enum):
    """Transport protocol channel utilized for transfer."""
    P2P_STREAM = "P2P_STREAM"
    MAILBOX = "MAILBOX"
    S3_SHARE = "S3_SHARE"


class TransferStatus(str, enum.Enum):
    """Outcome status of the transfer operation."""
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"


class TransferLog(Base):
    """Audit log entry capturing transfer metadata and execution telemetry."""

    __tablename__ = "transfer_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=generate_uuid,
    )
    sender_device_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(),
        ForeignKey("devices.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    receiver_device_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID(),
        ForeignKey("devices.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    channel: Mapped[TransferChannel] = mapped_column(
        Enum(TransferChannel, name="transfer_channel_enum", native_enum=False),
        nullable=False,
    )
    file_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    file_size: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
    )
    status: Mapped[TransferStatus] = mapped_column(
        Enum(TransferStatus, name="transfer_status_enum", native_enum=False),
        default=TransferStatus.COMPLETED,
        nullable=False,
        index=True,
    )
    error_message: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    def to_dict(self) -> dict:
        """Serialize transfer log record to dictionary."""
        return {
            "id": str(self.id),
            "sender_device_id": str(self.sender_device_id) if self.sender_device_id else None,
            "receiver_device_id": str(self.receiver_device_id) if self.receiver_device_id else None,
            "channel": self.channel.value if hasattr(self.channel, "value") else str(self.channel),
            "file_name": self.file_name,
            "file_size": self.file_size,
            "status": self.status.value if hasattr(self.status, "value") else str(self.status),
            "error_message": self.error_message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self) -> str:
        return f"<TransferLog file='{self.file_name}' status='{self.status}' channel='{self.channel}'>"
