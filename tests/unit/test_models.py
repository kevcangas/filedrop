"""
Unit tests for domain models: User, Device, Friendship, MailboxItem.
"""

from datetime import datetime, timedelta, timezone
import pytest
from app.models import (
    Device,
    DeviceType,
    Friendship,
    FriendshipStatus,
    MailboxItem,
    StorageType,
    User,
)


def test_user_password_hashing(db_session):
    """Verify password hashing and timing-attack safe verification."""
    user = User(username="carlos", email="carlos@example.com")
    user.set_password("MySecretPass123")

    assert user.password_hash != "MySecretPass123"
    assert user.check_password("MySecretPass123") is True
    assert user.check_password("WrongPassword") is False


def test_device_creation_and_attributes(db_session, sample_user):
    """Verify device model persistence and serialization."""
    device = Device(
        user_id=sample_user.id,
        device_name="Workstation Linux",
        device_type=DeviceType.PC,
        device_fingerprint="fp_linux_station",
    )
    db_session.add(device)
    db_session.commit()

    assert device.id is not None
    data = device.to_dict()
    assert data["device_name"] == "Workstation Linux"
    assert data["device_type"] == "pc"


def test_friendship_status_lifecycle(db_session, sample_user, sample_friend):
    """Verify friendship creation and status progression."""
    friendship = Friendship(
        requester_id=sample_user.id,
        addressee_id=sample_friend.id,
        status=FriendshipStatus.PENDING,
    )
    db_session.add(friendship)
    db_session.commit()

    assert friendship.status == FriendshipStatus.PENDING

    # Transition to ACCEPTED
    friendship.status = FriendshipStatus.ACCEPTED
    db_session.commit()

    fetched = db_session.get(Friendship, friendship.id)
    assert fetched.status == FriendshipStatus.ACCEPTED


def test_mailbox_item_expiration(db_session, sample_user):
    """Verify TTL computation and expiration property on mailbox items."""
    expired_item = MailboxItem(
        sender_user_id=sample_user.id,
        file_name="old_photo.jpg",
        file_path="/tmp/old_photo.jpg",
        file_size=1024,
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    future_item = MailboxItem(
        sender_user_id=sample_user.id,
        file_name="new_report.pdf",
        file_path="/tmp/new_report.pdf",
        file_size=2048,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )

    assert expired_item.is_expired is True
    assert future_item.is_expired is False
