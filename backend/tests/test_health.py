from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.runtime import RuntimeOwner


def test_healthz() -> None:
    with TestClient(create_app(Settings())) as client:
        response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_undefined_health_route_is_not_exposed() -> None:
    with TestClient(create_app(Settings())) as client:
        response = client.get("/api/health")

    assert response.status_code == 404


def test_lifespan_installs_one_application_runtime() -> None:
    application = create_app(Settings())

    with TestClient(application) as client:
        runtime = application.state.runtime
        client.get("/healthz")

        assert isinstance(runtime, RuntimeOwner)
        assert application.state.runtime is runtime
        assert application.state.runtime.coordinator is runtime.coordinator
        assert application.state.runtime.clock is runtime.clock
        assert runtime.clock.clock.status.value == "PAUSED"
        assert application.state.runtime.events is runtime.events
