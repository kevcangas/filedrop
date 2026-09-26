"""
S3 Cloud Storage Service with multi-tenant prefix partitioning.
"""

from io import BytesIO
import mimetypes
import os
import threading
from typing import Dict, List, Optional
import uuid

import boto3
from botocore.config import Config as BotoConfig
from werkzeug.utils import secure_filename


class S3Service:
    """Service wrapping AWS S3 / MinIO operations with user-level key prefixing."""

    def __init__(self, config=None):
        self.config = config
        self._client = None
        self._lock = threading.Lock()
        self._bucket_verified = False

    def is_enabled(self) -> bool:
        if not self.config:
            return False
        return getattr(self.config, "S3_ENABLED", False)

    def get_client(self):
        """Lazily initialize and cache the thread-safe boto3 S3 client."""
        if not self.is_enabled():
            return None

        with self._lock:
            if self._client is not None:
                return self._client

            boto_cfg = BotoConfig(
                signature_version="s3v4",
                s3={"addressing_style": "path"} if getattr(self.config, "S3_ENDPOINT_URL", None) else {},
                retries={"max_attempts": 3, "mode": "standard"},
            )
            kwargs = {
                "service_name": "s3",
                "region_name": getattr(self.config, "S3_REGION", "us-east-1"),
                "config": boto_cfg,
            }
            if getattr(self.config, "S3_ENDPOINT_URL", None):
                kwargs["endpoint_url"] = self.config.S3_ENDPOINT_URL
            if getattr(self.config, "S3_ACCESS_KEY", None):
                kwargs["aws_access_key_id"] = self.config.S3_ACCESS_KEY
            if getattr(self.config, "S3_SECRET_KEY", None):
                kwargs["aws_secret_access_key"] = self.config.S3_SECRET_KEY

            self._client = boto3.client(**kwargs)
            return self._client

    def get_user_prefix(self, user_id: str, device_id: Optional[str] = None) -> str:
        """Construct secure prefix: users/{user_id}/"""
        base = getattr(self.config, "S3_PREFIX", "users/").strip("/")
        if device_id:
            return f"{base}/{user_id}/{device_id}/"
        return f"{base}/{user_id}/"

    def upload_file(
        self,
        user_id: str,
        device_id: str,
        file_obj,
        filename: str,
        subfolder: str = "",
    ) -> dict:
        """Upload a file to S3 under the user's isolated prefix."""
        client = self.get_client()
        if not client:
            raise RuntimeError("S3 service is not enabled or configured.")

        clean_name = secure_filename(filename) or f"upload_{uuid.uuid4().hex[:8]}"
        prefix = self.get_user_prefix(user_id)
        if subfolder:
            prefix += subfolder.strip("/") + "/"

        s3_key = f"{prefix}{uuid.uuid4().hex[:8]}_{clean_name}"
        mime, _ = mimetypes.guess_type(clean_name)
        content_type = mime or "application/octet-stream"

        file_obj.seek(0, os.SEEK_END)
        size = file_obj.tell()
        file_obj.seek(0)

        client.upload_fileobj(
            file_obj,
            self.config.S3_BUCKET,
            s3_key,
            ExtraArgs={"ContentType": content_type},
        )

        return {
            "key": s3_key,
            "filename": clean_name,
            "size": size,
            "content_type": content_type,
        }

    def list_files(self, user_id: str, subfolder: str = "") -> List[dict]:
        """List all objects stored under the user's isolated prefix."""
        client = self.get_client()
        if not client:
            return []

        prefix = self.get_user_prefix(user_id)
        if subfolder:
            prefix += subfolder.strip("/") + "/"

        paginator = client.get_paginator("list_objects_v2")
        results = []
        for page in paginator.paginate(Bucket=self.config.S3_BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if key.endswith("/"):
                    continue  # folder marker
                name = key[len(prefix):]
                results.append({
                    "key": key,
                    "filename": name,
                    "size": obj["Size"],
                    "last_modified": obj["LastModified"].isoformat(),
                })
        return results

    def generate_presigned_url(self, user_id: str, s3_key: str, expiry_seconds: int = 3600) -> str:
        """Generate a presigned GET URL after verifying the key belongs to user_id."""
        user_prefix = self.get_user_prefix(user_id)
        if not s3_key.startswith(user_prefix):
            raise PermissionError("Access denied: Key does not belong to user.")

        client = self.get_client()
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.config.S3_BUCKET, "Key": s3_key},
            ExpiresIn=expiry_seconds,
        )

    def delete_file(self, user_id: str, s3_key: str) -> bool:
        """Delete an object from S3 after verifying ownership."""
        user_prefix = self.get_user_prefix(user_id)
        if not s3_key.startswith(user_prefix):
            raise PermissionError("Access denied: Cannot delete other users' files.")

        client = self.get_client()
        client.delete_object(Bucket=self.config.S3_BUCKET, Key=s3_key)
        return True
