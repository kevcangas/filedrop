"""
API blueprints package exposing all modular REST endpoints.
"""

from .auth import auth_bp
from .friends import friends_bp
from .devices import devices_bp
from .logs import logs_bp

__all__ = [
    "auth_bp",
    "friends_bp",
    "devices_bp",
    "logs_bp",
]
