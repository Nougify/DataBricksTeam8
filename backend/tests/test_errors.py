from typing import Annotated

from fastapi import Query
from fastapi.testclient import TestClient

from app.config import Settings
from app.errors import ApiError
from app.main import create_app


def test_not_found_uses_error_envelope() -> None:
    with TestClient(create_app(Settings())) as client:
        response = client.get("/missing")

    assert response.status_code == 404
    assert response.json() == {"error": {"code": "NOT_FOUND", "message": "Not Found"}}


def test_validation_error_uses_error_envelope() -> None:
    application = create_app(Settings())

    @application.get("/_test/number")
    async def number(value: Annotated[int, Query()]) -> dict[str, int]:
        return {"value": value}

    with TestClient(application) as client:
        response = client.get("/_test/number", params={"value": "invalid"})

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "VALIDATION_ERROR",
            "message": "Request validation failed",
        }
    }


def test_api_error_uses_error_envelope() -> None:
    application = create_app(Settings())

    @application.get("/_test/conflict")
    async def conflict() -> None:
        raise ApiError(409, "STATE_CONFLICT", "State changed")

    with TestClient(application) as client:
        response = client.get("/_test/conflict")

    assert response.status_code == 409
    assert response.json() == {
        "error": {"code": "STATE_CONFLICT", "message": "State changed"}
    }


def test_unexpected_error_hides_details() -> None:
    application = create_app(Settings())

    @application.get("/_test/failure")
    async def failure() -> None:
        raise RuntimeError("secret implementation detail")

    with TestClient(application, raise_server_exceptions=False) as client:
        response = client.get("/_test/failure")

    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "INTERNAL_ERROR", "message": "Internal server error"}
    }
