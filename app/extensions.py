"""
Flask extensions registry for database, migrations, WebSockets, and rate limiting.
"""

from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_socketio import SocketIO
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from app.models.base import Base

# SQLAlchemy instance bound to declarative Base
db = SQLAlchemy(model_class=Base)
migrate = Migrate()
socketio = SocketIO(cors_allowed_origins="*", max_http_buffer_size=16 * 1024 * 1024)
limiter = Limiter(key_func=get_remote_address, default_limits=["10000 per hour", "500 per minute"])
