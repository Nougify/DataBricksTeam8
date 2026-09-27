from fastapi.testclient import TestClient
from pydantic import AnyHttpUrl

from app.config import Settings
from app.main import create_app
from app.origins import is_websocket_origin_allowed


def test_allowed_rest_origin_receives_cors_header() -> None:
    settings = Settings(
        cors_origins=[AnyHttpUrl("https://console.example.com")],
    )

    with TestClient(create_app(settings)) as client:
        response = client.get(
            "/healthz", headers={"Origin": "https://console.example.com"}
        )

    assert response.headers["access-control-allow-origin"] == (
        "https://console.example.com"
    )


def test_denied_rest_origin_receives_no_cors_header() -> None:
    with TestClient(create_app(Settings())) as client:
        response = client.get(
            "/healthz", headers={"Origin": "https://untrusted.example.com"}
        )

    assert "access-control-allow-origin" not in response.headers


def test_websocket_origin_uses_same_policy() -> None:
    allowed_origins = {"http://localhost:3001", "http://127.0.0.1:3001"}

    assert is_websocket_origin_allowed("http://localhost:3001", allowed_origins)
    assert not is_websocket_origin_allowed(None, allowed_origins)
    assert not is_websocket_origin_allowed(
        "https://untrusted.example.com", allowed_origins
    )
