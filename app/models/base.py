"""
SQLAlchemy database initialization and declarative base configuration.
"""

from datetime import datetime, timezone
import uuid
from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator, CHAR
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class GUID(TypeDecorator):
    """Platform-independent GUID/UUID type.
    Uses PostgreSQL native UUID type, and CHAR(36) on SQLite.
    Accepts both string UUIDs and uuid.UUID objects seamlessly.
    """
    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        if isinstance(value, uuid.UUID):
            return str(value) if dialect.name != "postgresql" else value
        if isinstance(value, str):
            try:
                parsed = uuid.UUID(value)
                return parsed if dialect.name == "postgresql" else str(parsed)
            except ValueError:
                return value
        return value

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        if not isinstance(value, uuid.UUID):
            try:
                return uuid.UUID(str(value))
            except (ValueError, TypeError):
                return value
        return value


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy declarative models."""
    pass


class TimestampMixin:
    """Mixin for models requiring created_at and updated_at tracking."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


def generate_uuid() -> uuid.UUID:
    """Generate a v4 UUID for entity primary keys."""
    return uuid.uuid4()


def to_uuid(value) -> uuid.UUID | None:
    """Convert input string or UUID to uuid.UUID safely."""
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        return None
