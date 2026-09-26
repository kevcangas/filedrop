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

    def _get_config(self, key: str, default=None):
        """Retrieve config value whether config is a Flask Config dict or object."""
        if self.config is None:
            return default
        if isinstance(self.config, dict) or hasattr(self.config, "get"):
            val = self.config.get(key)
            if val is not None:
                return val
        return getattr(self.config, key, default)

    @property
    def bucket_name(self) -> str:
        return self._get_config("S3_BUCKET", "filedrop-storage")

    def is_enabled(self) -> bool:
        if not self.config:
            return False
        val = self._get_config("S3_ENABLED", False)
        if isinstance(val, str):
            return val.strip().lower() in ("1", "true", "yes")
        return bool(val)

    def get_client(self):
        """Lazily initialize and cache the thread-safe boto3 S3 client."""
        if not self.is_enabled():
            return None

        with self._lock:
            if self._client is not None:
                return self._client

            endpoint_url = self._get_config("S3_ENDPOINT_URL")
            region_name = self._get_config("S3_REGION", "us-east-1")
            access_key = self._get_config("S3_ACCESS_KEY")
            secret_key = self._get_config("S3_SECRET_KEY")

            boto_cfg = BotoConfig(
                signature_version="s3v4",
                s3={"addressing_style": "path"} if endpoint_url else {},
                retries={"max_attempts": 3, "mode": "standard"},
            )
            kwargs = {
                "service_name": "s3",
                "region_name": region_name or "us-east-1",
                "config": boto_cfg,
            }
            if endpoint_url:
                kwargs["endpoint_url"] = endpoint_url
            if access_key:
                kwargs["aws_access_key_id"] = access_key
            if secret_key:
                kwargs["aws_secret_access_key"] = secret_key

            self._client = boto3.client(**kwargs)
            return self._client

    def ensure_bucket_exists(self) -> None:
        """Verify target bucket exists or auto-create if configured."""
        if self._bucket_verified:
            return
        client = self.get_client()
        if not client:
            return

        bucket = self.bucket_name
        auto_create = self._get_config("S3_AUTO_CREATE_BUCKET", True)
        if isinstance(auto_create, str):
            auto_create = auto_create.strip() in ("1", "true", "True")

        try:
            client.head_bucket(Bucket=bucket)
            self._bucket_verified = True
        except Exception:
            if auto_create:
                try:
                    region = self._get_config("S3_REGION", "us-east-1")
                    if region and region != "us-east-1":
                        client.create_bucket(
                            Bucket=bucket,
                            CreateBucketConfiguration={"LocationConstraint": region},
                        )
                    else:
                        client.create_bucket(Bucket=bucket)
                    self._bucket_verified = True
                except Exception as ex:
                    print(f"[S3Service] Could not auto-create bucket '{bucket}': {ex}")

    def get_user_prefix(self, user_id: str, device_id: Optional[str] = None) -> str:
        """Construct secure prefix: users/{user_id}/"""
        base = self._get_config("S3_PREFIX", "users/").strip("/")
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

        self.ensure_bucket_exists()

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
            self.bucket_name,
            s3_key,
            ExtraArgs={"ContentType": content_type},
        )

        return {
            "key": s3_key,
            "filename": clean_name,
            "size": size,
            "content_type": content_type,
        }

    def list_objects(self, user_id: str, subfolder: str = "") -> dict:
        """List folders and files under the user's isolated subfolder."""
        client = self.get_client()
        if not client:
            return {"folders": [], "files": []}

        self.ensure_bucket_exists()

        prefix = self.get_user_prefix(user_id)
        if subfolder:
            prefix += subfolder.strip("/") + "/"

        paginator = client.get_paginator("list_objects_v2")
        files = []
        folders = set()

        for page in paginator.paginate(Bucket=self.bucket_name, Prefix=prefix, Delimiter="/"):
            # Subfolders (CommonPrefixes)
            for cp in page.get("CommonPrefixes", []):
                p = cp.get("Prefix", "")
                folder_name = p[len(prefix):].strip("/")
                if folder_name:
                    folders.add(folder_name)

            # Files
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if key == prefix or key.endswith("/"):
                    continue  # Directory placeholder
                name = key[len(prefix):]
                if "/" in name:
                    # Belongs to subfolder
                    folders.add(name.split("/")[0])
                    continue
                files.append({
                    "key": key,
                    "filename": name,
                    "size": obj["Size"],
                    "last_modified": obj["LastModified"].isoformat(),
                })

        return {"folders": sorted(list(folders)), "files": files}

    def list_files(self, user_id: str, subfolder: str = "") -> List[dict]:
        """Backward compatible list returning files list."""
        return self.list_objects(user_id, subfolder).get("files", [])

    def create_folder(self, user_id: str, folder_path: str) -> bool:
        """Create a zero-byte directory marker object."""
        client = self.get_client()
        if not client:
            raise RuntimeError("S3 service is not enabled.")

        self.ensure_bucket_exists()

        clean_path = folder_path.strip("/")
        if not clean_path:
            return False

        key = f"{self.get_user_prefix(user_id)}{clean_path}/"
        client.put_object(Bucket=self.bucket_name, Key=key, Body=b"")
        return True

    def delete_folder(self, user_id: str, folder_path: str) -> bool:
        """Delete all objects stored within a folder prefix."""
        client = self.get_client()
        if not client:
            raise RuntimeError("S3 service is not enabled.")

        clean_path = folder_path.strip("/")
        if not clean_path:
            return False

        folder_prefix = f"{self.get_user_prefix(user_id)}{clean_path}/"
        paginator = client.get_paginator("list_objects_v2")
        delete_keys = []

        for page in paginator.paginate(Bucket=self.bucket_name, Prefix=folder_prefix):
            for obj in page.get("Contents", []):
                delete_keys.append({"Key": obj["Key"]})

        if delete_keys:
            client.delete_objects(
                Bucket=self.bucket_name,
                Delete={"Objects": delete_keys},
            )
        return True

    def generate_presigned_url(self, user_id: str, s3_key: str, expiry_seconds: int = 3600) -> str:
        """Generate a presigned GET URL after verifying the key belongs to user_id."""
        user_prefix = self.get_user_prefix(user_id)
        if not s3_key.startswith(user_prefix):
            raise PermissionError("Access denied: Key does not belong to user.")

        client = self.get_client()
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket_name, "Key": s3_key},
            ExpiresIn=expiry_seconds,
        )

    def delete_file(self, user_id: str, s3_key: str) -> bool:
        """Delete an object from S3 after verifying ownership."""
        user_prefix = self.get_user_prefix(user_id)
        if not s3_key.startswith(user_prefix):
            raise PermissionError("Access denied: Cannot delete other users' files.")

        client = self.get_client()
        client.delete_object(Bucket=self.bucket_name, Key=s3_key)
        return True
