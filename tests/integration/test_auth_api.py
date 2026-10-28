"""
Integration tests for Authentication API endpoints (/api/auth/*).
"""

import json
import pytest


def test_register_success(client, db_session):
    """Test registering a new account and receiving session claims."""
    payload = {
        "username": "newuser",
        "email": "newuser@example.com",
        "password": "Password123",
        "device_name": "Testing Laptop",
        "device_type": "pc",
        "device_fingerprint": "fp_test_newuser",
    }
    response = client.post(
        "/api/auth/register",
        data=json.dumps(payload),
        content_type="application/json",
    )
    assert response.status_code == 201
    data = response.get_json()
    assert data["ok"] is True
    assert data["user"]["username"] == "newuser"
    assert data["device"]["device_name"] == "Testing Laptop"


def test_register_duplicate_username(client, sample_user):
    """Test rejecting duplicate username registration with 409 conflict."""
    payload = {
        "username": sample_user.username,
        "email": "different@example.com",
        "password": "Password123",
    }
    response = client.post(
        "/api/auth/register",
        data=json.dumps(payload),
        content_type="application/json",
    )
    assert response.status_code == 409
    data = response.get_json()
    assert data["ok"] is False


def test_login_success_and_me(client, sample_user):
    """Test logging in with credentials and querying /api/auth/me."""
    payload = {
        "identifier": sample_user.username,
        "password": "SecurePassword123",
        "device_name": "Living Room PC",
        "device_fingerprint": "fp_test_macbook",
    }
    login_res = client.post(
        "/api/auth/login",
        data=json.dumps(payload),
        content_type="application/json",
    )
    assert login_res.status_code == 200
    login_data = login_res.get_json()
    assert login_data["ok"] is True

    # Check authenticated session
    me_res = client.get("/api/auth/me")
    assert me_res.status_code == 200
    me_data = me_res.get_json()
    assert me_data["authenticated"] is True
    assert me_data["user"]["username"] == sample_user.username


def test_login_invalid_password(client, sample_user):
    """Test rejection on bad password with 401 Unauthorized."""
    payload = {
        "identifier": sample_user.username,
        "password": "WrongPasswordHere",
    }
    response = client.post(
        "/api/auth/login",
        data=json.dumps(payload),
        content_type="application/json",
    )
    assert response.status_code == 401
    data = response.get_json()
    assert data["ok"] is False


def test_login_device_selection_workflow(client, sample_user, db_session):
    """Test full two-step login: authenticate credentials -> select existing device."""
    from app.models import Device, DeviceType

    # Create two devices for sample_user
    dev1 = Device(
        user_id=sample_user.id,
        device_name="Work PC",
        device_type=DeviceType.PC,
        device_fingerprint="fp_work_pc",
        is_active=True,
    )
    dev2 = Device(
        user_id=sample_user.id,
        device_name="Home Laptop",
        device_type=DeviceType.PC,
        device_fingerprint="fp_home_laptop",
        is_active=True,
    )
    db_session.add_all([dev1, dev2])
    db_session.commit()

    # Step 1: Login credentials
    login_res = client.post(
        "/api/auth/login",
        data=json.dumps({
            "identifier": sample_user.username,
            "password": "SecurePassword123",
            "device_fingerprint": "fp_work_pc",
        }),
        content_type="application/json",
    )
    assert login_res.status_code == 200
    login_data = login_res.get_json()
    assert login_data["ok"] is True
    assert login_data["require_device_selection"] is True
    assert "temp_token" in login_data
    assert len(login_data["devices"]) >= 2
    assert login_data["recognized_device_id"] == str(dev1.id)

    # Step 2: Select Home Laptop explicitly
    select_res = client.post(
        "/api/auth/select-device",
        data=json.dumps({
            "temp_token": login_data["temp_token"],
            "device_id": str(dev2.id),
            "remember_device": True,
            "device_fingerprint": "fp_work_pc",  # reassigning fingerprint to Home Laptop
        }),
        content_type="application/json",
    )
    assert select_res.status_code == 200
    select_data = select_res.get_json()
    assert select_data["ok"] is True
    assert select_data["device"]["id"] == str(dev2.id)

    # Verify session reflects dev2
    me_res = client.get("/api/auth/me")
    assert me_res.status_code == 200
    me_data = me_res.get_json()
    assert me_data["current_device"]["id"] == str(dev2.id)


def test_login_select_device_new(client, sample_user):
    """Test selecting and creating a new device during login."""
    login_res = client.post(
        "/api/auth/login",
        data=json.dumps({
            "identifier": sample_user.username,
            "password": "SecurePassword123",
        }),
        content_type="application/json",
    )
    assert login_res.status_code == 200
    temp_token = login_res.get_json()["temp_token"]

    select_res = client.post(
        "/api/auth/select-device",
        data=json.dumps({
            "temp_token": temp_token,
            "new_device": {
                "device_name": "Living Room Tablet",
                "device_type": "tablet",
            },
            "device_fingerprint": "fp_new_living_tablet",
            "remember_device": True,
        }),
        content_type="application/json",
    )
    assert select_res.status_code == 200
    data = select_res.get_json()
    assert data["ok"] is True
    assert data["device"]["device_name"] == "Living Room Tablet"
    assert data["device"]["device_type"] == "tablet"


def test_login_direct_backward_compatibility(client, sample_user):
    """Test passing direct_login=True skips two-stage selection."""
    login_res = client.post(
        "/api/auth/login",
        data=json.dumps({
            "identifier": sample_user.username,
            "password": "SecurePassword123",
            "direct_login": True,
            "device_name": "Direct Client",
            "device_fingerprint": "fp_direct_123",
        }),
        content_type="application/json",
    )
    assert login_res.status_code == 200
    data = login_res.get_json()
    assert data["ok"] is True
    assert data["require_device_selection"] is False


def test_switch_active_device_endpoint(client, sample_user, db_session):
    """Test switching active device from within an authenticated session."""
    from app.models import Device, DeviceType

    dev_a = Device(
        user_id=sample_user.id,
        device_name="Machine A",
        device_type=DeviceType.PC,
        device_fingerprint="fp_machine_a",
        is_active=True,
    )
    dev_b = Device(
        user_id=sample_user.id,
        device_name="Machine B",
        device_type=DeviceType.MOBILE,
        device_fingerprint="fp_machine_b",
        is_active=True,
    )
    db_session.add_all([dev_a, dev_b])
    db_session.commit()

    # Log in initially as Machine A
    client.post(
        "/api/auth/login",
        data=json.dumps({
            "identifier": sample_user.username,
            "password": "SecurePassword123",
            "device_id": str(dev_a.id),
            "direct_login": True,
        }),
        content_type="application/json",
    )

    # Switch to Machine B
    switch_res = client.post(
        "/api/devices/switch",
        data=json.dumps({"device_id": str(dev_b.id)}),
        content_type="application/json",
    )
    assert switch_res.status_code == 200
    switch_data = switch_res.get_json()
    assert switch_data["ok"] is True
    assert switch_data["device"]["id"] == str(dev_b.id)

    # Verify session changed to Machine B
    me_res = client.get("/api/auth/me")
    assert me_res.status_code == 200
    assert me_res.get_json()["current_device"]["id"] == str(dev_b.id)

