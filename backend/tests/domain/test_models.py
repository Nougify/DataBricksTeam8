from typing import Any

import pytest
from pydantic import ValidationError

from app.api.serializers import serialize_additional_trip, serialize_bus
from app.domain.models import (
    AdditionalTrip,
    AdditionalTripStatus,
    Bus,
    BusStatus,
    DispatchEvent,
    GeoJsonLineString,
    GeoPoint,
    RouteRef,
    ScheduledTrip,
    ServicePattern,
    SimulationClock,
)


def route_payload() -> dict[str, Any]:
    return {
        "route_id": "route-99",
        "line_key": "99",
        "short_name": "99",
        "long_name": None,
        "mode": "Bus",
        "color": "0055aa",
        "text_color": None,
    }


def dispatch_event_payload(*trip_ids: str) -> dict[str, Any]:
    return {
        "id": "event-1",
        "hub_id": "ubc",
        "source_location": "UBC",
        "location": {"lat": 49.267, "lon": -123.247},
        "available_at": "2026-07-01T10:00:00-07:00",
        "actionable_at": "2026-07-01T10:00:00-07:00",
        "event_time": "2026-07-01T12:00:00-07:00",
        "mode": "PROACTIVE",
        "surge_type": "EVENT",
        "predicted_people": 180.5,
        "normal_people": 100,
        "surge_ratio": 1.805,
        "suggested_extra_buses": 1,
        "priority_score": 0.9,
        "recommendations": [
            {
                "destination": "Downtown",
                "destination_share": 100,
                "route_id": "route-99",
                "source_route": "99",
                "extra_bus_trips_est": 1,
                "priority_score": 0.9,
            }
        ],
        "status": "AWAITING_APPROVAL" if trip_ids else "PENDING",
        "additional_trip_ids": list(trip_ids),
        "source": {"version": "test-v1"},
    }


def bus_payload() -> dict[str, Any]:
    return {
        "id": "bus-1",
        "status": "RESERVED",
        "location": {"lat": 49.28, "lon": -123.12},
        "heading_deg": None,
        "capacity": 50,
        "source": {"type": "DEPOT", "route": None, "depot_name": "Burnaby"},
        "assigned_trip_id": None,
        "proposed_trip_id": "trip-1",
        "home_location": {"lat": 49.28, "lon": -123.12},
    }


def trip_payload() -> dict[str, Any]:
    return {
        "id": "trip-1",
        "dispatch_event_id": "event-1",
        "bus_id": "bus-1",
        "route_id": "route-99",
        "status": "PROPOSED",
        "proposed_at": "2026-07-01T10:00:00-07:00",
        "approval_expires_at": "2026-07-01T10:30:00-07:00",
        "dispatch_time": None,
        "target_event_time": "2026-07-01T12:00:00-07:00",
        "estimated_arrival_time": "2026-07-01T11:45:00-07:00",
        "service_departure_time": "2026-07-01T12:10:00-07:00",
        "estimated_completion_time": "2026-07-01T13:00:00-07:00",
        "added_capacity": 50,
        "rationale": "Serves the highest-priority recommendation.",
        "source_priority": 0.9,
    }


@pytest.mark.parametrize(
    ("payload", "field"),
    [({"lat": 91, "lon": 0}, "lat"), ({"lat": 0, "lon": -181}, "lon")],
)
def test_geography_rejects_invalid_coordinates(
    payload: dict[str, int], field: str
) -> None:
    with pytest.raises(ValidationError, match=field):
        GeoPoint.model_validate(payload)


def test_paths_require_two_lon_lat_positions() -> None:
    path = GeoJsonLineString.model_validate(
        {"type": "LineString", "coordinates": [[-123.2, 49.2], [-123.1, 49.3]]}
    )
    assert path.coordinates[0] == (-123.2, 49.2)
    with pytest.raises(ValidationError):
        GeoJsonLineString.model_validate(
            {"type": "LineString", "coordinates": [[-123.2, 49.2]]}
        )


def test_vancouver_uses_historical_dst_then_permanent_pacific_time() -> None:
    first = SimulationClock.model_validate(
        {
            "current_time": "2025-11-02T01:00:00-07:00",
            "local_date": "2025-11-02",
            "hour": 1,
            "speed": 1,
            "status": "PAUSED",
            "min_time": "2025-01-01T00:00:00-08:00",
            "max_time": "2026-11-02T01:00:00-07:00",
            "approval_mode": "MANUAL",
            "auto_pause_on_proposal": True,
            "epoch": 0,
        }
    )
    assert first.current_time.isoformat().endswith("-07:00")
    invalid = first.model_dump()
    invalid["current_time"] = "2026-11-01T01:00:00-08:00"
    invalid["local_date"] = "2026-11-01"
    with pytest.raises(ValidationError, match="offset"):
        SimulationClock.model_validate(invalid)


def test_route_normalizes_colors() -> None:
    assert RouteRef.model_validate(route_payload()).color == "#0055AA"


def test_schedule_is_ordered_and_immutable() -> None:
    pattern = ServicePattern.model_validate(
        {
            "id": "p1",
            "route": route_payload(),
            "direction_id": 0,
            "headsign": "UBC",
            "stops": [
                {
                    "stop": {
                        "id": "s1",
                        "name": "One",
                        "location": {"lat": 49.2, "lon": -123.1},
                    },
                    "sequence": 1,
                    "arrival_offset_seconds": 0,
                    "departure_offset_seconds": 0,
                },
                {
                    "stop": {
                        "id": "s2",
                        "name": "Two",
                        "location": {"lat": 49.3, "lon": -123.2},
                    },
                    "sequence": 2,
                    "arrival_offset_seconds": 600,
                    "departure_offset_seconds": 620,
                },
            ],
            "shape": {
                "type": "LineString",
                "coordinates": [[-123.1, 49.2], [-123.2, 49.3]],
            },
        }
    )
    with pytest.raises(ValidationError):
        pattern.route = RouteRef.model_validate(route_payload())  # type: ignore[misc]
    with pytest.raises(ValidationError):
        ScheduledTrip.model_validate(
            {
                "id": "scheduled-1",
                "gtfs_trip_id": "gtfs-trip-1",
                "service_pattern_id": "p1",
                "service_date": "2026-07-01",
                "start_time": "2026-07-01T10:00:00-07:00",
                "stop_times": [
                    "2026-07-01T10:10:00-07:00",
                    "2026-07-01T10:05:00-07:00",
                ],
            }
        )


def test_bus_source_links_and_capacity_are_validated() -> None:
    bus = Bus.model_validate(bus_payload())
    assert bus.capacity == 50
    invalid = bus_payload()
    invalid["status"] = "AVAILABLE"
    with pytest.raises(ValidationError, match="links"):
        Bus.model_validate(invalid)


def test_v3_trip_contract_and_nullable_lifecycle() -> None:
    trip = AdditionalTrip.model_validate(trip_payload())
    payload = serialize_additional_trip(trip).model_dump(mode="json")
    assert payload["dispatch_event_id"] == "event-1"
    assert payload["dispatch_time"] is None
    assert "surge_id" not in payload
    assert "PLANNED" not in {status.value for status in AdditionalTripStatus}
    assert "STOPPED" not in {status.value for status in BusStatus}


def test_canonical_serializers_hide_bus_internal_state() -> None:
    bus_json = serialize_bus(Bus.model_validate(bus_payload())).model_dump(mode="json")
    assert "home_location" not in bus_json
    assert DispatchEvent.model_validate(dispatch_event_payload()).id == "event-1"
