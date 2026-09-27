from datetime import date

from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.models import DayType
from app.main import create_app
from app.routing import StraightLineRoutingService
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
        assert application.state.runtime.transit is runtime.transit
        assert runtime.transit.feed_version == "fall-2026"
        assert isinstance(runtime.routing, StraightLineRoutingService)
        assert runtime.routing.speed_kph == 30
        assert application.state.runtime.coordinator is runtime.coordinator
        assert application.state.runtime.clock is runtime.clock
        assert runtime.clock.clock.status.value == "PAUSED"
        assert application.state.runtime.events is runtime.events


def test_fixture_runtime_uses_configured_representative_dates() -> None:
    mapping = {
        DayType.MF: date(2026, 10, 21),
        DayType.SAT: date(2026, 10, 24),
        DayType.SUN_HOL: date(2026, 10, 25),
    }
    application = create_app(Settings(gtfs_service_day_mapping=mapping))

    with TestClient(application):
        runtime = application.state.runtime
        resolution = runtime.transit.service_date_resolution(date(2025, 12, 6))
        assert resolution.service_date == mapping[DayType.SAT]
        assert runtime.transit.active_service_ids(date(2025, 12, 6)) == {"fixture-mf"}
