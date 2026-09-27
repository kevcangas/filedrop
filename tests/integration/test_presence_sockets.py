"""
Integration tests for Socket.IO multi-device presence and discovery.
"""

from app.extensions import socketio
from app.models import Device, DeviceType, User


def test_multi_device_presence_and_discovery(app, db_session):
    """Test two connected devices for same user receive real-time presence updates."""
    user = User(username="multi_dev_user", email="multidev@test.com")
    user.set_password("SecurePass123!")
    db_session.add(user)
    db_session.commit()

    dev1 = Device(user_id=user.id, device_name="Laptop PC", device_type=DeviceType.PC, device_fingerprint="fp_lap")
    dev2 = Device(user_id=user.id, device_name="Mobile Phone", device_type=DeviceType.MOBILE, device_fingerprint="fp_mob")
    db_session.add_all([dev1, dev2])
    db_session.commit()

    # Device 1 connects
    with app.test_client() as flask_c1:
        with flask_c1.session_transaction() as sess:
            sess["user_id"] = str(user.id)
            sess["device_id"] = str(dev1.id)

        sio_c1 = socketio.test_client(app, flask_test_client=flask_c1)
        assert sio_c1.is_connected()
        r1 = sio_c1.get_received()
        assert any(e["name"] == "session_ready" for e in r1)

        # Device 2 connects
        with app.test_client() as flask_c2:
            with flask_c2.session_transaction() as sess:
                sess["user_id"] = str(user.id)
                sess["device_id"] = str(dev2.id)

            sio_c2 = socketio.test_client(app, flask_test_client=flask_c2)
            assert sio_c2.is_connected()
            r2 = sio_c2.get_received()
            assert any(e["name"] == "session_ready" for e in r2)

            # Device 2 should see Device 1 in device_list
            dev2_list_events = [e for e in r2 if e["name"] == "device_list"]
            assert len(dev2_list_events) >= 1
            visible_to_dev2 = dev2_list_events[0]["args"][0]
            assert any(d["device_id"] == str(dev1.id) and d["is_online"] for d in visible_to_dev2)

            # Device 1 should have received updated device_list containing Device 2
            r1_after = sio_c1.get_received()
            dev1_list_events = [e for e in r1_after if e["name"] == "device_list"]
            assert len(dev1_list_events) >= 1
            visible_to_dev1 = dev1_list_events[0]["args"][0]
            assert any(d["device_id"] == str(dev2.id) and d["is_online"] for d in visible_to_dev1)


def test_dynamic_registration_with_fingerprint_and_device_id(app, db_session):
    """Test device connecting without device_id in session can dynamically register using fingerprint or device_id."""
    user = User(username="dyn_user", email="dyn@test.com")
    user.set_password("SecurePass123!")
    db_session.add(user)
    db_session.commit()

    phone = Device(user_id=user.id, device_name="Cel Kev Test", device_type=DeviceType.MOBILE, device_fingerprint="fp_cel_kev")
    pc = Device(user_id=user.id, device_name="PC Kev Test", device_type=DeviceType.PC, device_fingerprint="fp_pc_kev")
    db_session.add_all([phone, pc])
    db_session.commit()

    # Mobile connects with only user_id in session, but sends device_fingerprint in register_device
    with app.test_client() as flask_client:
        with flask_client.session_transaction() as sess:
            sess["user_id"] = str(user.id)
            # deliberately omitted device_id

        sio = socketio.test_client(app, flask_test_client=flask_client)
        assert sio.is_connected()

        # Emit explicit registration with fingerprint and device_id
        sio.emit("register_device", {
            "device_id": str(phone.id),
            "device_fingerprint": "fp_cel_kev",
            "device_name": "Cel Kev Test",
            "device_type": "mobile",
        })

        received = sio.get_received()
        ready_events = [e for e in received if e["name"] == "session_ready"]
        assert len(ready_events) >= 1
        ready_data = ready_events[-1]["args"][0]
        assert ready_data["ok"] is True
        assert ready_data["device_id"] == str(phone.id)
        assert ready_data["device_type"] == "mobile"


def test_p2p_file_transfer_end_to_end(app, db_session):
    """Test full P2P file transfer pipeline: send_offer, file_response, file_chunk, chunk_ack."""
    user = User(username="transfer_user", email="tx@test.com")
    user.set_password("SecurePass123!")
    db_session.add(user)
    db_session.commit()

    dev1 = Device(user_id=user.id, device_name="PC", device_type=DeviceType.PC, device_fingerprint="fp1")
    dev2 = Device(user_id=user.id, device_name="Mobile", device_type=DeviceType.MOBILE, device_fingerprint="fp2")
    db_session.add_all([dev1, dev2])
    db_session.commit()

    with app.test_client() as flask_c1, app.test_client() as flask_c2:
        with flask_c1.session_transaction() as sess:
            sess["user_id"] = str(user.id)
            sess["device_id"] = str(dev1.id)
        with flask_c2.session_transaction() as sess:
            sess["user_id"] = str(user.id)
            sess["device_id"] = str(dev2.id)

        sio1 = socketio.test_client(app, flask_test_client=flask_c1)
        sio2 = socketio.test_client(app, flask_test_client=flask_c2)

        # Clear initial connect events
        sio1.get_received()
        sio2.get_received()

        # 1. Dev 1 sends offer to Dev 2
        offer_payload = {
            "file_id": "test_f1",
            "target_device_id": str(dev2.id),
            "filename": "hello.txt",
            "size": 12,
            "mimetype": "text/plain",
        }
        sio1.emit("send_offer", offer_payload)

        # Dev 2 should receive offer
        r2 = sio2.get_received()
        offers = [e for e in r2 if e["name"] in ("send_offer", "file_offer")]
        assert len(offers) >= 1
        rec_offer = offers[0]["args"][0]
        assert rec_offer["file_id"] == "test_f1"
        assert rec_offer["auto_accept"] is True

        # 2. Dev 2 accepts offer
        sio2.emit("file_response", {
            "target_device_id": str(dev1.id),
            "file_id": "test_f1",
            "accept": True,
        })

        # Dev 1 should receive accept response
        r1 = sio1.get_received()
        resp_events = [e for e in r1 if e["name"] in ("file_response", "file_response_relay")]
        assert len(resp_events) >= 1
        assert resp_events[0]["args"][0]["accept"] is True

        # 3. Dev 1 sends chunk
        sio1.emit("file_chunk", {
            "file_id": "test_f1",
            "target_device_id": str(dev2.id),
            "chunk_index": 0,
            "total_chunks": 1,
            "data": "aGVsbG8gd29ybGQ=",
        })

        # Dev 2 should receive chunk
        r2_chunks = sio2.get_received()
        chunk_events = [e for e in r2_chunks if e["name"] in ("file_chunk", "file_chunk_relay")]
        assert len(chunk_events) >= 1
        assert chunk_events[0]["args"][0]["data"] == "aGVsbG8gd29ybGQ="

        # 4. Dev 2 sends chunk_ack
        sio2.emit("chunk_ack", {
            "file_id": "test_f1",
            "target_device_id": str(dev1.id),
            "chunk_index": 0,
        })

        # Dev 1 receives chunk_ack
        r1_acks = sio1.get_received()
        ack_events = [e for e in r1_acks if e["name"] in ("chunk_ack", "chunk_ack_relay")]
        assert len(ack_events) >= 1
        assert ack_events[0]["args"][0]["chunk_index"] == 0
