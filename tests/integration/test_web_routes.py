"""
Integration tests for web routes, PWA manifest, service worker, and authentication gating.
"""

import json


def test_manifest_json(client):
    """Test /manifest.json is accessible without authentication and returns valid PWA metadata."""
    res = client.get("/manifest.json")
    assert res.status_code == 200
    data = res.get_json()
    assert data is not None
    assert "name" in data
    assert "icons" in data
    assert len(data["icons"]) >= 1


def test_service_worker_js(client):
    """Test /service-worker.js is accessible without authentication."""
    res = client.get("/service-worker.js")
    assert res.status_code == 200
    assert "javascript" in res.content_type


def test_unauthenticated_redirect_to_login(client):
    """Test unauthenticated visit to root / redirects to /login."""
    res = client.get("/")
    assert res.status_code in (301, 302)
    assert "/login" in res.headers.get("Location", "")


def test_authenticated_root_view(client, sample_user):
    """Test authenticated visit to root / renders unified app template."""
    client.post(
        "/api/auth/login",
        data=json.dumps({"identifier": sample_user.username, "password": "SecurePassword123"}),
        content_type="application/json",
    )
    res = client.get("/")
    assert res.status_code == 200
    assert b"FILEDROP" in res.data
    assert b"tab-content-transfer" in res.data
