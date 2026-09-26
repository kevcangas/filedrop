"""
Pytest configuration and shared test fixtures.
"""

import pytest
from app import create_app
from app.config import TestingConfig
from app.extensions import db as _db
from app.models import Device, DeviceType, User


@pytest.fixture(scope="session")
def app():
    """Create and configure a Flask application for testing."""
    app = create_app(TestingConfig)
    return app


@pytest.fixture(scope="function")
def client(app):
    """Provide a test client for simulating HTTP requests."""
    return app.test_client()


@pytest.fixture(scope="function")
def db_session(app):
    """Provide a clean database session per test with rollback."""
    with app.app_context():
        _db.create_all()
        yield _db.session
        _db.session.rollback()
        _db.drop_all()


@pytest.fixture
def sample_user(db_session):
    """Create a verified sample user with an enrolled device."""
    user = User(
        username="kevin",
        email="kevin@example.com",
        display_name="Kevin Cangas",
        is_active=True,
    )
    user.set_password("SecurePassword123")
    db_session.add(user)
    db_session.flush()

    device = Device(
        user_id=user.id,
        device_name="MacBook Pro",
        device_type=DeviceType.PC,
        device_fingerprint="fp_test_macbook",
        is_active=True,
    )
    db_session.add(device)
    db_session.commit()
    return user


@pytest.fixture
def sample_friend(db_session):
    """Create a second sample user for friendship testing."""
    friend = User(
        username="alice",
        email="alice@example.com",
        display_name="Alice Smith",
        is_active=True,
    )
    friend.set_password("AliceSecure123")
    db_session.add(friend)
    db_session.flush()

    device = Device(
        user_id=friend.id,
        device_name="Pixel 9",
        device_type=DeviceType.MOBILE,
        device_fingerprint="fp_test_pixel",
        is_active=True,
    )
    db_session.add(device)
    db_session.commit()
    return friend
