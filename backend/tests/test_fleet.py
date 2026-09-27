import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.models import BusStatus, GeoPoint
from app.domain.types import BusId
from app.fleet import FleetConfigError, available_buses, load_fleet
from app.main import create_app
from app.repositories import StateEditor, entities_from
from app.services import InMemoryEventSink, Mutation, MutationCoordinator, initial_clock
from app.transit import TransitIndex, build_fixture_transit_index


def write_fleet(path: Path, buses: list[dict[str, object]]) -> Path:
    path.write_text(json.dumps({"buses": buses}), encoding="utf-8")
    return path


def transit_for(settings: Settings) -> TransitIndex:
    return build_fixture_transit_index(
        settings.gtfs_feed_version,
        settings.gtfs_service_day_mapping,
    )


def bus_config(
    bus_id: str,
    *,
    capacity: object = 50,
    initial: str = "ubc",
    home: str = "ubc",
) -> dict[str, object]:
    return {
        "id": bus_id,
        "capacity": capacity,
        "initial_location_id": initial,
        "home_location_id": home,
    }


def test_loads_heterogeneous_fleet_in_bus_id_order(tmp_path: Path) -> None:
    path = write_fleet(
        tmp_path / "fleet.json",
        [
            bus_config("bus-z", capacity=60, initial="waterfront"),
            bus_config("bus-a", capacity=40, home="park-royal"),
        ],
    )
    settings = Settings(fleet_config_path=path)

    fleet = load_fleet(settings, transit_for(settings))

    assert [bus.id for bus in fleet.buses] == ["bus-a", "bus-z"]
    assert [bus.capacity for bus in fleet.buses] == [40, 60]
    assert fleet.size == 2
    assert fleet.total_capacity == 100
    assert fleet.buses[1].source.depot_name == "Waterfront Station"


def test_empty_file_and_generated_zero_fleets_are_valid(tmp_path: Path) -> None:
    path = write_fleet(tmp_path / "empty.json", [])
    configured = Settings(fleet_config_path=path)
    generated = Settings(fleet_size=0)

    assert load_fleet(configured, transit_for(configured)).buses == ()
    assert load_fleet(generated, transit_for(generated)).buses == ()


@pytest.mark.parametrize("capacity", [0, -1, "50", True])
def test_invalid_capacity_is_rejected(tmp_path: Path, capacity: object) -> None:
    path = write_fleet(
        tmp_path / "fleet.json", [bus_config("bus-1", capacity=capacity)]
    )
    settings = Settings(fleet_config_path=path)

    with pytest.raises(FleetConfigError, match="capacity"):
        load_fleet(settings, transit_for(settings))


def test_duplicate_ids_and_unknown_locations_are_rejected(tmp_path: Path) -> None:
    duplicate = write_fleet(
        tmp_path / "duplicate.json", [bus_config("bus-1"), bus_config("bus-1")]
    )
    unknown_initial = write_fleet(
        tmp_path / "initial.json", [bus_config("bus-1", initial="missing")]
    )
    unknown_home = write_fleet(
        tmp_path / "home.json", [bus_config("bus-1", home="missing")]
    )

    with pytest.raises(FleetConfigError, match="unique"):
        settings = Settings(fleet_config_path=duplicate)
        load_fleet(settings, transit_for(settings))
    with pytest.raises(FleetConfigError, match="unknown initial"):
        settings = Settings(fleet_config_path=unknown_initial)
        load_fleet(settings, transit_for(settings))
    with pytest.raises(FleetConfigError, match="unknown home"):
        settings = Settings(fleet_config_path=unknown_home)
        load_fleet(settings, transit_for(settings))


def test_missing_and_malformed_files_fail_closed(tmp_path: Path) -> None:
    missing = Settings(fleet_config_path=tmp_path / "missing.json")
    malformed_path = tmp_path / "malformed.json"
    malformed_path.write_text("not-json", encoding="utf-8")
    malformed = Settings(fleet_config_path=malformed_path)

    with pytest.raises(FleetConfigError, match="cannot read"):
        load_fleet(missing, transit_for(missing))
    with pytest.raises(FleetConfigError, match="invalid fleet"):
        load_fleet(malformed, transit_for(malformed))


def test_available_buses_are_filtered_and_ordered() -> None:
    settings = Settings(fleet_size=3)
    fleet = load_fleet(settings, transit_for(settings))
    unavailable = fleet.buses[1].model_copy(update={"status": BusStatus.WAITING})

    result = available_buses((fleet.buses[2], unavailable, fleet.buses[0]))

    assert [bus.id for bus in result] == ["bus-01", "bus-03"]


def test_coordinator_reset_restores_immutable_configured_fleet(tmp_path: Path) -> None:
    path = write_fleet(tmp_path / "fleet.json", [bus_config("custom-bus")])
    settings = Settings(fleet_config_path=path)
    fleet = load_fleet(settings, transit_for(settings))
    coordinator = MutationCoordinator(
        InMemoryEventSink(), initial_clock(settings), entities_from(buses=fleet.buses)
    )

    def move(editor: StateEditor) -> Mutation[None]:
        bus = editor.bus(BusId("custom-bus"))
        assert bus is not None
        editor.put_bus(
            bus.model_copy(
                update={
                    "location": GeoPoint(lat=49.0, lon=-123.0),
                    "heading_deg": 45.0,
                    "status": BusStatus.REPOSITIONING,
                }
            )
        )
        return Mutation(None)

    coordinator.mutate(move)
    coordinator.reset(settings.simulation_start_time)

    assert coordinator.snapshot().entities.buses.list() == fleet.buses


def test_meta_uses_file_backed_fleet_summary(tmp_path: Path) -> None:
    path = write_fleet(
        tmp_path / "fleet.json",
        [bus_config("small", capacity=20), bus_config("large", capacity=70)],
    )

    with TestClient(create_app(Settings(fleet_config_path=path))) as client:
        metadata = client.get("/api/v1/meta").json()["fleet"]
        buses = client.get("/api/v1/buses").json()

    assert metadata == {
        "size": 2,
        "total_capacity": 90,
        "source": str(path),
        "max_buses_per_event": 3,
    }
    assert [bus["id"] for bus in buses] == ["large", "small"]
