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

        # 3. Test Folders Delete
        mock_client.get_paginator.return_value.paginate.return_value = [
            {"Contents": [{"Key": f"users/{sample_user.id}/projects/"}]}
        ]
        res_folder_del = client.post(
            "/api/s3/folders/delete",
            data=json.dumps({"path": "projects"}),
            content_type="application/json",
        )
        assert res_folder_del.status_code == 200
        assert res_folder_del.get_json()["ok"] is True

        # 4. Test Files List
        mock_client.get_paginator.return_value.paginate.return_value = [
            {
                "CommonPrefixes": [{"Prefix": f"users/{sample_user.id}/docs/"}],
                "Contents": [
                    {
                        "Key": f"users/{sample_user.id}/sample_test.txt",
                        "Size": 1234,
                        "LastModified": MagicMock(isoformat=lambda: "2026-09-26T22:00:00Z"),
                    }
                ],
            }
        ]
        res_list = client.get("/api/s3/files")
        assert res_list.status_code == 200
        list_data = res_list.get_json()
        assert list_data["ok"] is True
        assert len(list_data["folders"]) == 1
        assert list_data["folders"][0]["name"] == "docs"
        assert list_data["folders"][0]["path"] == "docs"
        assert len(list_data["files"]) == 1
        assert list_data["files"][0]["filename"] == "sample_test.txt"

        # 5. Test Download Stream
        mock_body = MagicMock()
        mock_body.read.side_effect = [b"stream chunk", b""]
        mock_client.get_object.return_value = {
            "Body": mock_body,
            "ContentType": "text/plain",
            "ContentLength": 12,
        }
        res_dl = client.get(f"/api/s3/download/users/{sample_user.id}/sample_test.txt?stream=1")
        assert res_dl.status_code == 200
        assert b"stream chunk" in res_dl.data

        # 6. Test Delete File
        res_del = client.post(
            "/api/s3/delete",
            data=json.dumps({"key": f"users/{sample_user.id}/sample_test.txt"}),
            content_type="application/json",
        )
        assert res_del.status_code == 200
        assert res_del.get_json()["ok"] is True
