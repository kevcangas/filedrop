"""
Application Factory for Enlace (Filedrop) platform.
Initializes extensions, registers API blueprints, and binds WebSocket event listeners.
"""

from pathlib import Path
from flask import Flask

from app.config import Config
from app.extensions import db, limiter, migrate, socketio
from app.models import Base
from app.api.auth import auth_bp
from app.api.friends import friends_bp
from app.api.devices import devices_bp
from app.api.logs import logs_bp
from app.api.buzon import buzon_bp
from app.api.s3 import s3_bp
from app.views.web import web_bp
from app.sockets import register_socket_handlers


def create_app(config_class=Config) -> Flask:
    """Instantiate and configure the Flask web application."""
    root_dir = Path(__file__).resolve().parent.parent

    app = Flask(
        __name__,
        template_folder=str(root_dir / "templates"),
        static_folder=str(root_dir / "static"),
    )
    app.config.from_object(config_class)

    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    socketio.init_app(app)
    limiter.init_app(app)

    # Register API Blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(friends_bp)
    app.register_blueprint(devices_bp)
    app.register_blueprint(logs_bp)
    app.register_blueprint(buzon_bp)
    app.register_blueprint(s3_bp)

    # Register Web View Blueprint
    app.register_blueprint(web_bp)

    # Register WebSocket handlers
    register_socket_handlers(socketio)

    # Create directories
    upload_dir = Path(app.config["UPLOAD_DIR"])
    mailbox_dir = Path(app.config["MAILBOX_DIR"])
    upload_dir.mkdir(parents=True, exist_ok=True)
    mailbox_dir.mkdir(parents=True, exist_ok=True)

    return app
