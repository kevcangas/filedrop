"""
Integration tests for Device management endpoints (/api/devices/*).
"""

import json
import pytest
from app.models import Device, DeviceType


def login_as(client, username, password):
    return client.post(
        "/api/auth/login",
        data=json.dumps({"identifier": username, "password": password}),
        content_type="application/json",
    )


def test_list_and_rename_device(client, sample_user):
    """Test listing owned devices and updating a device's label."""
    login_as(client, sample_user.username, "SecurePassword123")

    list_res = client.get("/api/devices")
    assert list_res.status_code == 200
    devices = list_res.get_json()["devices"]
    assert len(devices) >= 1
    device_id = devices[0]["id"]

    # Rename device
    rename_res = client.patch(
        f"/api/devices/{device_id}/rename",
        data=json.dumps({"device_name": "Studio Workstation"}),
        content_type="application/json",
    )
    assert rename_res.status_code == 200
    assert rename_res.get_json()["device"]["device_name"] == "Studio Workstation"


def test_revoke_device(client, sample_user, db_session):
    """Test revoking a secondary device deactivates it without terminating current session."""
    # Add a second device to sample_user
    second_device = Device(
        user_id=sample_user.id,
        device_name="Old Tablet",
        device_type=DeviceType.TABLET,
        device_fingerprint="fp_old_tablet",
        is_active=True,
    )
    db_session.add(second_device)
    db_session.commit()

    login_as(client, sample_user.username, "SecurePassword123")

    # Revoke second device
    revoke_res = client.delete(f"/api/devices/{second_device.id}/revoke")
    assert revoke_res.status_code == 200
    assert revoke_res.get_json()["session_terminated"] is False

    # Primary session remains active, and revoked device is marked inactive
    after_res = client.get("/api/devices")
    assert after_res.status_code == 200
    devices = after_res.get_json()["devices"]
    target = next((d for d in devices if d["id"] == str(second_device.id)), None)
    assert target is not None
    assert target["is_active"] is False


def test_get_visible_devices(client, sample_user):
    """Test retrieving all visible devices for current authenticated user with presence state."""
    login_as(client, sample_user.username, "SecurePassword123")

    res = client.get("/api/devices/visible")
    assert res.status_code == 200
    data = res.get_json()
    assert data["ok"] is True
    assert isinstance(data["devices"], list)
    assert len(data["devices"]) >= 1
    first = data["devices"][0]
    assert "device_id" in first
    assert "device_name" in first
    assert "is_online" in first
    assert "is_own_account" in first
    assert first["is_own_account"] is True

