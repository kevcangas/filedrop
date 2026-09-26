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
