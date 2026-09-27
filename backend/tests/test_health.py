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


def test_v3_state_hides_future_events_and_initializes_fleet() -> None:
    with TestClient(create_app(Settings())) as client:
        initial = client.get("/api/v1/state")
        seek = client.post(
            "/api/v1/clock/seek", json={"time": "2026-07-10T09:30:00-07:00"}
        )
        activated = client.get("/api/v1/state")

    assert initial.status_code == 200
    assert len(initial.json()["buses"]) == 3
    assert initial.json()["dispatch_events"] == []
    assert seek.status_code == 200
    assert seek.json()["epoch"] == 1
    assert [event["id"] for event in activated.json()["dispatch_events"]] == [
        "valid-event"
    ]


def test_v3_detail_and_route_endpoints() -> None:
    with TestClient(create_app(Settings())) as client:
        client.post("/api/v1/clock/seek", json={"time": "2026-07-10T10:00:00-07:00"})
        event = client.get("/api/v1/dispatch-events/valid-event")
        bus = client.get("/api/v1/buses/bus-01")
        routes = client.get("/api/v1/routes", params={"include_shape": True})
        route = client.get("/api/v1/routes/fixture-99")

    assert event.status_code == 200
    assert event.json()["recommendations"][0]["route_id"] == "fixture-99"
    assert bus.status_code == 200
    assert bus.json()["capacity"] == 50
    assert routes.status_code == 200
    assert routes.json()[0]["shape"]["type"] == "LineString"
    assert route.status_code == 200
