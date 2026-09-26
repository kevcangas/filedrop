"""
Integration tests for S3 Storage REST endpoints (/api/s3/*).
"""

from io import BytesIO
import json
from unittest.mock import MagicMock, patch
import pytest


def test_s3_status_endpoint(client):
    """Test /api/s3/status returns availability information."""
    res = client.get("/api/s3/status")
    assert res.status_code == 200
    data = res.get_json()
    assert data["ok"] is True
    assert "enabled" in data
    assert "bucket" in data


def test_s3_upload_and_list_mocked(client, sample_user):
    """Test uploading a file to S3 and listing files with S3 enabled."""
    client.post(
        "/api/auth/login",
        data=json.dumps({"identifier": sample_user.username, "password": "SecurePassword123"}),
        content_type="application/json",
    )

    with patch("app.services.s3_service.S3Service.is_enabled", return_value=True), \
         patch("app.services.s3_service.S3Service.get_client") as mock_get_client:
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_client.head_bucket.return_value = {}

        # 1. Test Upload
        data = {
            "file": (BytesIO(b"file content for test"), "sample_test.txt"),
            "folder": "documents",
        }
        res_upload = client.post(
            "/api/s3/upload",
            data=data,
            content_type="multipart/form-data",
        )
        assert res_upload.status_code == 201
        upload_data = res_upload.get_json()
        assert upload_data["ok"] is True
        assert upload_data["file"]["filename"] == "sample_test.txt"

        # 2. Test Folders Create
        res_folder = client.post(
            "/api/s3/folders/create",
            data=json.dumps({"path": "projects"}),
            content_type="application/json",
        )
        assert res_folder.status_code == 201
        assert res_folder.get_json()["ok"] is True

        # 3. Test Delete
        res_del = client.post(
            "/api/s3/delete",
            data=json.dumps({"key": f"users/{sample_user.id}/sample_test.txt"}),
            content_type="application/json",
        )
        assert res_del.status_code == 200
        assert res_del.get_json()["ok"] is True
