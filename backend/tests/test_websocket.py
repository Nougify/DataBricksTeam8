from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.config import Settings
from app.main import create_app

ORIGIN = "http://localhost:3001"


def test_websocket_rejects_missing_and_untrusted_origins() -> None:
    with TestClient(create_app(Settings())) as client:
        for headers in ({}, {"origin": "https://untrusted.example"}):
            try:
                with client.websocket_connect("/ws", headers=headers):
                    raise AssertionError("connection should have been rejected")
            except WebSocketDisconnect as exc:
                assert exc.code == 1008


def test_websocket_bootstrap_matches_atomic_rest_state() -> None:
    application = create_app(Settings())
    with TestClient(application) as client:
        with client.websocket_connect("/ws", headers={"origin": ORIGIN}) as socket:
            bootstrap = socket.receive_json()
            state = client.get("/api/v1/state").json()

            assert bootstrap == state
            assert bootstrap["epoch"] == 0
            assert bootstrap["last_seq"] == 0
            assert bootstrap["dispatch_events"] == []
            assert "home_location" not in bootstrap["buses"][0]
            assert application.state.runtime.events.subscription_count() == 1

        assert application.state.runtime.events.subscription_count() == 0


def test_websocket_streams_committed_events_and_reconnects_from_state() -> None:
    with TestClient(create_app(Settings())) as client:
        with client.websocket_connect("/ws", headers={"origin": ORIGIN}) as socket:
            bootstrap = socket.receive_json()
            response = client.post("/api/v1/clock/resume")
            update = socket.receive_json()

        assert response.status_code == 200
        assert update["type"] == "clock.updated"
        assert update["epoch"] == bootstrap["epoch"]
        assert update["seq"] == bootstrap["last_seq"] + 1

        client.post("/api/v1/clock/pause")
        with client.websocket_connect("/ws", headers={"origin": ORIGIN}) as socket:
            reconnected = socket.receive_json()

        current = client.get("/api/v1/state").json()
        assert reconnected == current
        assert reconnected["last_seq"] >= update["seq"]


def test_websocket_streams_epoch_reset() -> None:
    with TestClient(create_app(Settings())) as client:
        with client.websocket_connect("/ws", headers={"origin": ORIGIN}) as socket:
            bootstrap = socket.receive_json()
            seek = client.post(
                "/api/v1/clock/seek",
                json={"time": "2026-07-10T09:30:00-07:00"},
            )
            reset = socket.receive_json()

        assert seek.status_code == 200
        assert reset["type"] == "system.reset"
        assert reset["epoch"] == 1
        assert reset["data"]["epoch"] == 1
        assert reset["seq"] == bootstrap["last_seq"] + 1
