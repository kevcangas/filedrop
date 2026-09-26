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
