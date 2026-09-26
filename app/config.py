"""
Application configuration module loading environment variables with typed fallbacks.
"""

from datetime import timedelta
import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Config:
    """Base configuration class."""
    SECRET_KEY = os.environ.get("ENLACE_SECRET_KEY") or secrets.token_hex(32)
    
    # Session setup
    SESSION_DAYS = int(os.environ.get("ENLACE_SESION_DIAS", "10"))
    PERMANENT_SESSION_LIFETIME = timedelta(days=SESSION_DAYS)
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("ENLACE_HTTPS", "0") == "1"

    # Database
    is_docker = os.path.exists("/.dockerenv") or os.environ.get("POSTGRES_HOST") == "postgres"
    pg_host = os.environ.get("POSTGRES_HOST", "postgres" if is_docker else "localhost")
    DATABASE_URL = os.environ.get("DATABASE_URL")

    # If running inside Docker and DATABASE_URL mistakenly points to localhost/127.0.0.1, auto-redirect to POSTGRES_HOST
    if DATABASE_URL and is_docker:
        for local_target in ("@localhost", "@127.0.0.1", "@::1"):
            if local_target in DATABASE_URL:
                DATABASE_URL = DATABASE_URL.replace(local_target, f"@{pg_host}")

    if not DATABASE_URL:
        pg_user = os.environ.get("POSTGRES_USER", "enlace")
        pg_pass = os.environ.get("POSTGRES_PASSWORD", "enlace_secret")
        pg_port = os.environ.get("POSTGRES_PORT", "5432")
        pg_db = os.environ.get("POSTGRES_DB", "enlace_db")
        DATABASE_URL = f"postgresql+psycopg2://{pg_user}:{pg_pass}@{pg_host}:{pg_port}/{pg_db}"
    
    SQLALCHEMY_DATABASE_URI = DATABASE_URL
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
    }

    # Storage paths
    UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
    MAILBOX_DIR = os.path.join(BASE_DIR, "buzon")
    MAILBOX_TTL_HOURS = float(os.environ.get("ENLACE_BUZON_HORAS", "72"))

    # S3 Settings
    S3_ENABLED = os.environ.get("ENLACE_S3_ENABLED", "0") in ("1", "true", "True")
    S3_ENDPOINT_URL = os.environ.get("ENLACE_S3_ENDPOINT_URL") or None
    S3_PUBLIC_URL = os.environ.get("ENLACE_S3_PUBLIC_URL") or None
    S3_REGION = os.environ.get("ENLACE_S3_REGION", "us-east-1")
    S3_BUCKET = os.environ.get("ENLACE_S3_BUCKET", "filedrop-storage")
    S3_ACCESS_KEY = os.environ.get("ENLACE_S3_ACCESS_KEY") or None
    S3_SECRET_KEY = os.environ.get("ENLACE_S3_SECRET_KEY") or None
    S3_PREFIX = os.environ.get("ENLACE_S3_PREFIX", "users/")
    S3_AUTO_CREATE_BUCKET = os.environ.get("ENLACE_S3_AUTO_CREATE_BUCKET", "1") == "1"

    # Networking & Port
    PORT = int(os.environ.get("ENLACE_PORT", "41823"))
    PUBLIC_URL = os.environ.get("ENLACE_PUBLIC_URL", "")
    HOST_IP = os.environ.get("ENLACE_HOST_IP", "")
    
    # Legacy shared password fallback
    ENLACE_PASSWORD = os.environ.get("ENLACE_PASSWORD", "")


class TestingConfig(Config):
    """Configuration for automated test execution."""
    TESTING = True
    # Use in-memory SQLite for high-speed automated testing
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_ENGINE_OPTIONS = {}
    WTF_CSRF_ENABLED = False
    S3_ENABLED = False
    MAILBOX_TTL_HOURS = 1
