"""
Mailbox Service managing temporary file persistence and TTL garbage collection.
"""

from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import threading
import time
from typing import List, Optional
import uuid

from sqlalchemy import delete, select
from werkzeug.utils import secure_filename

from app.models import MailboxItem, StorageType


class MailboxService:
    """Service managing offline file uploads and TTL expiration cycles."""

    def __init__(self, mailbox_dir: str = "buzon", default_ttl_hours: float = 72.0):
        self.mailbox_dir = Path(mailbox_dir)
        self.mailbox_dir.mkdir(parents=True, exist_ok=True)
        self.default_ttl_hours = default_ttl_hours
        self._cleanup_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def save_file(
        self,
        file_obj,
        sender_user_id: Optional[uuid.UUID],
        sender_device_id: Optional[uuid.UUID],
        recipient_user_id: Optional[uuid.UUID],
        recipient_device_id: Optional[uuid.UUID],
        custom_ttl_hours: Optional[float] = None,
    ) -> MailboxItem:
        """Store incoming file to disk and record metadata in database."""
        raw_name = getattr(file_obj, "filename", "unnamed_file")
        clean_name = secure_filename(raw_name) or f"file_{int(time.time())}"
        
        item_id = uuid.uuid4()
        user_folder = self.mailbox_dir / (str(recipient_user_id) if recipient_user_id else "global")
        user_folder.mkdir(parents=True, exist_ok=True)
        
        disk_filename = f"{item_id}__{clean_name}"
        disk_path = user_folder / disk_filename

        file_obj.save(str(disk_path))
        file_size = disk_path.stat().st_size

        ttl = custom_ttl_hours if custom_ttl_hours is not None else self.default_ttl_hours
        expires_at = datetime.now(timezone.utc) + timedelta(hours=ttl)

        return MailboxItem(
            id=item_id,
            sender_user_id=sender_user_id,
            sender_device_id=sender_device_id,
            recipient_user_id=recipient_user_id,
            recipient_device_id=recipient_device_id,
            storage_type=StorageType.LOCAL,
            file_name=clean_name,
            file_path=str(disk_path),
            file_size=file_size,
            expires_at=expires_at,
            is_downloaded=False,
        )

    def purge_expired(self, db_session) -> int:
        """Delete expired files from disk and remove their database records."""
        now = datetime.now(timezone.utc)
        stmt = select(MailboxItem).where(MailboxItem.expires_at <= now)
        expired_items = db_session.scalars(stmt).all()

        purged_count = 0
        for item in expired_items:
            try:
                p = Path(item.file_path)
                if p.exists():
                    p.unlink(missing_ok=True)
                db_session.delete(item)
                purged_count += 1
            except Exception as e:
                print(f"[MailboxService] Error purging {item.file_path}: {e}")

        if purged_count > 0:
            db_session.commit()

        return purged_count

    def start_cleanup_loop(self, app_or_factory) -> None:
        """Start a daemon thread periodically purging expired mailbox files."""
        if self._cleanup_thread and self._cleanup_thread.is_alive():
            return

        def _loop():
            while not self._stop_event.is_set():
                try:
                    app = app_or_factory() if (callable(app_or_factory) and not hasattr(app_or_factory, "app_context")) else app_or_factory
                    with app.app_context():
                        from app.extensions import db
                        self.purge_expired(db.session)
                except Exception as ex:
                    print(f"[MailboxService] Cleanup loop error: {ex}")
                # Sleep in 10-second increments for clean shutdown
                for _ in range(180):  # 30 minutes total
                    if self._stop_event.is_set():
                        break
                    time.sleep(10)

        self._cleanup_thread = threading.Thread(target=_loop, daemon=True, name="MailboxCleanupThread")
        self._cleanup_thread.start()

    def stop_cleanup_loop(self) -> None:
        """Signal background thread to terminate."""
        self._stop_event.set()
