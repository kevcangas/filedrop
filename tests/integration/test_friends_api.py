"""
Integration tests for Friendship API endpoints (/api/friends/*).
"""

import json
import pytest


def login_as(client, username, password):
    """Helper to authenticate a test client as a given user."""
    return client.post(
        "/api/auth/login",
        data=json.dumps({"identifier": username, "password": password}),
        content_type="application/json",
    )


def test_friend_request_and_accept(client, sample_user, sample_friend):
    """Test full friendship invitation workflow: request -> list -> respond -> list."""
    # 1. Login as sample_user
    login_as(client, sample_user.username, "SecurePassword123")

    # 2. Send friend request to sample_friend
    req_res = client.post(
        "/api/friends/request",
        data=json.dumps({"username": sample_friend.username}),
        content_type="application/json",
    )
    assert req_res.status_code == 201
    friendship_id = req_res.get_json()["friendship"]["id"]

    # 3. Check outgoing list for sample_user
    list_res1 = client.get("/api/friends/list")
    assert len(list_res1.get_json()["pending_outgoing"]) == 1

    # 4. Switch session to sample_friend
    login_as(client, sample_friend.username, "AliceSecure123")

    # 5. Check incoming list for sample_friend
    list_res2 = client.get("/api/friends/list")
    assert len(list_res2.get_json()["pending_incoming"]) == 1

    # 6. Accept request
    resp_res = client.post(
        "/api/friends/respond",
        data=json.dumps({"friendship_id": friendship_id, "action": "ACCEPT"}),
        content_type="application/json",
    )
    assert resp_res.status_code == 200

    # 7. Check friends list shows accepted friend
    final_list = client.get("/api/friends/list").get_json()
    assert len(final_list["friends"]) == 1
    assert final_list["friends"][0]["username"] == sample_user.username


def test_reciprocal_friend_request_instant_accept(client, sample_user, sample_friend):
    """Test that reciprocal invitation automatically transitions to ACCEPTED."""
    # User A requests User B
    login_as(client, sample_user.username, "SecurePassword123")
    client.post(
        "/api/friends/request",
        data=json.dumps({"username": sample_friend.username}),
        content_type="application/json",
    )

    # User B requests User A
    login_as(client, sample_friend.username, "AliceSecure123")
    recip_res = client.post(
        "/api/friends/request",
        data=json.dumps({"username": sample_user.username}),
        content_type="application/json",
    )
    assert recip_res.status_code == 200
    assert recip_res.get_json()["friendship"]["status"] == "ACCEPTED"
