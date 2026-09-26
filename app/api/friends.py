"""
Friendship API Blueprint: invitation dispatch, responses, friendship listing, and mutual trust gating.
"""

from datetime import datetime, timezone
import uuid
from flask import Blueprint, jsonify, request, session
from sqlalchemy import and_, or_, select

from app.models import Friendship, FriendshipStatus, User, to_uuid

friends_bp = Blueprint("friends_bp", __name__, url_prefix="/api/friends")


def get_db():
    from app.extensions import db
    return db.session


def require_user():
    user_id = to_uuid(session.get("user_id"))
    if not user_id:
        return None
    db_sess = get_db()
    return db_sess.scalar(select(User).where(User.id == user_id, User.is_active == True))


@friends_bp.route("/request", methods=["POST"])
def send_request():
    """Send a friendship invitation to another registered user by username."""
    current_user = require_user()
    if not current_user:
        return jsonify({"ok": False, "error": "Authentication required."}), 401

    data = request.get_json(silent=True) or {}
    target_username = (data.get("username") or "").strip().lower()

    if not target_username:
        return jsonify({"ok": False, "error": "Target username is required."}), 400

    if target_username == current_user.username:
        return jsonify({"ok": False, "error": "You cannot send a friend invitation to yourself."}), 400

    db_sess = get_db()
    target_user = db_sess.scalar(select(User).where(User.username == target_username, User.is_active == True))
    if not target_user:
        return jsonify({"ok": False, "error": f"User '{target_username}' not found."}), 404

    # Check for existing relationship
    existing = db_sess.scalar(
        select(Friendship).where(
            or_(
                and_(Friendship.requester_id == current_user.id, Friendship.addressee_id == target_user.id),
                and_(Friendship.requester_id == target_user.id, Friendship.addressee_id == current_user.id),
            )
        )
    )

    if existing:
        if existing.status == FriendshipStatus.ACCEPTED:
            return jsonify({"ok": False, "error": "You are already friends with this user."}), 409
        if existing.status == FriendshipStatus.BLOCKED:
            return jsonify({"ok": False, "error": "Cannot establish connection with this user."}), 403
        if existing.status == FriendshipStatus.PENDING:
            if existing.requester_id == current_user.id:
                return jsonify({"ok": False, "error": "Invitation already sent and awaiting response."}), 409
            # If the other user already sent a request, automatically accept it!
            existing.status = FriendshipStatus.ACCEPTED
            existing.updated_at = datetime.now(timezone.utc)
            db_sess.commit()
            return jsonify({
                "ok": True,
                "message": f"Reciprocal request detected! You are now friends with {target_user.username}.",
                "friendship": existing.to_dict(),
            }), 200

    # Create new pending friendship
    friendship = Friendship(
        requester_id=current_user.id,
        addressee_id=target_user.id,
        status=FriendshipStatus.PENDING,
    )
    db_sess.add(friendship)
    db_sess.commit()

    return jsonify({
        "ok": True,
        "message": f"Invitation sent to {target_user.username}.",
        "friendship": friendship.to_dict(),
    }), 201


@friends_bp.route("/respond", methods=["POST"])
def respond():
    """Accept, decline, or block an incoming friendship invitation."""
    current_user = require_user()
    if not current_user:
        return jsonify({"ok": False, "error": "Authentication required."}), 401

    data = request.get_json(silent=True) or {}
    friendship_id = to_uuid(data.get("friendship_id"))
    action = (data.get("action") or "").strip().upper()

    if not friendship_id or action not in ("ACCEPT", "DECLINE", "BLOCK"):
        return jsonify({"ok": False, "error": "Valid friendship_id and action (ACCEPT, DECLINE, BLOCK) are required."}), 400

    db_sess = get_db()
    friendship = db_sess.scalar(select(Friendship).where(Friendship.id == friendship_id))
    if not friendship:
        return jsonify({"ok": False, "error": "Invitation not found."}), 404

    # Only the recipient can accept/decline; either can block
    if action in ("ACCEPT", "DECLINE") and friendship.addressee_id != current_user.id:
        return jsonify({"ok": False, "error": "Only the recipient can respond to this invitation."}), 403

    if action == "ACCEPT":
        friendship.status = FriendshipStatus.ACCEPTED
    elif action == "DECLINE":
        friendship.status = FriendshipStatus.DECLINED
    elif action == "BLOCK":
        friendship.status = FriendshipStatus.BLOCKED

    friendship.updated_at = datetime.now(timezone.utc)
    db_sess.commit()

    return jsonify({
        "ok": True,
        "message": f"Invitation {action.lower()}ed successfully.",
        "friendship": friendship.to_dict(),
    }), 200


@friends_bp.route("/list", methods=["GET"])
def list_friends():
    """Fetch friends list along with pending sent/received requests and friend devices."""
    current_user = require_user()
    if not current_user:
        return jsonify({"ok": False, "error": "Authentication required."}), 401

    db_sess = get_db()

    # Query all relationships involving current_user
    stmt = select(Friendship).where(
        or_(Friendship.requester_id == current_user.id, Friendship.addressee_id == current_user.id)
    )
    relationships = db_sess.scalars(stmt).all()

    accepted_friends = []
    pending_incoming = []
    pending_outgoing = []

    for rel in relationships:
        if rel.status == FriendshipStatus.ACCEPTED:
            friend_user = rel.addressee if rel.requester_id == current_user.id else rel.requester
            if friend_user and friend_user.is_active:
                friend_data = friend_user.to_dict(include_devices=True)
                friend_data["friendship_id"] = str(rel.id)
                accepted_friends.append(friend_data)
        elif rel.status == FriendshipStatus.PENDING:
            if rel.addressee_id == current_user.id:
                pending_incoming.append({
                    "friendship_id": str(rel.id),
                    "requester": rel.requester.to_dict() if rel.requester else None,
                    "created_at": rel.created_at.isoformat() if rel.created_at else None,
                })
            else:
                pending_outgoing.append({
                    "friendship_id": str(rel.id),
                    "addressee": rel.addressee.to_dict() if rel.addressee else None,
                    "created_at": rel.created_at.isoformat() if rel.created_at else None,
                })

    return jsonify({
        "ok": True,
        "friends": accepted_friends,
        "pending_incoming": pending_incoming,
        "pending_outgoing": pending_outgoing,
    }), 200
