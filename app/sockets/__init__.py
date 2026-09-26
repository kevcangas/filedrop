"""
Sockets package exposing real-time WebSocket event listeners.
"""

from .handlers import register_socket_handlers

__all__ = ["register_socket_handlers"]
