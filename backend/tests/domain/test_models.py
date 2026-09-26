from typing import Any

import pytest
from pydantic import ValidationError

from app.api.serializers import (
    serialize_additional_trip,
    serialize_bus,
    serialize_surge,
    serialize_trip_detail,
)
from app.domain.models import (
    AdditionalTrip,
    AdditionalTripStatus,
    Bus,
    BusStatus,
    ForecastBucket,
    ForecastVintage,
    GeoJsonLineString,
    GeoPoint,
    RouteRef,
    ScheduledTrip,
    ServicePattern,
    SimulationClock,
    Surge,
    SurgeStatus,
    TripProgress,
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


def surge_payload() -> dict[str, Any]:
    return {
        "id": "surge-1",
        "hub_id": "ubc",
        "location_name": "UBC",
        "location": {"lat": 49.267, "lon": -123.247},
        "detected_at": "2026-07-01T10:00:00-07:00",
        "predicted_window": {
            "start": "2026-07-01T12:00:00-07:00",
            "end": "2026-07-01T14:00:00-07:00",
        },
        "lead_time_minutes": 120,
        "magnitude": {
            "predicted_pings": 180.5,
            "typical_pings": 100,
            "surge_index": 1.805,
            "lower_80": 160,
            "upper_80": 205,
        },
        "severity": "HIGH",
        "drivers": [{"type": "OTHER", "label": "Fixture", "event_id": None}],
        "predicted_destinations": [
            {
                "origin": "Surrey",
                "location": None,
                "share_pct": 14.5,
                "expected_pings": 26.2,
            }
        ],
        "status": "AWAITING_APPROVAL",
        "phase": "UPCOMING",
        "additional_trip_ids": ["trip-1", "trip-2"],
        "actual": None,
        "forecast_vintage_id": "vintage-1",
        "peak_target_hour": "2026-07-01T12:00:00-07:00",
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
    route = {**route_payload(), "load_before_pct": 104.0, "load_after_pct": 87.5}
    return {
        "id": "trip-1",
        "surge_id": "surge-1",
        "hub_id": "ubc",
        "bus": {"id": "bus-1"},
        "route": route,
        "donor_route": None,
        "status": "PROPOSED",
        "proposed_at": "2026-07-01T10:00:00-07:00",
        "approval_expires_at": "2026-07-01T10:30:00-07:00",
        "dispatch_time": "2026-07-01T11:00:00-07:00",
        "arrival_at_surge_time": "2026-07-01T11:45:00-07:00",
        "arrives_before_surge": True,
        "departure_time": "2026-07-01T12:10:00-07:00",
        "estimated_completion_time": "2026-07-01T13:00:00-07:00",
        "surge_location": {"lat": 49.267, "lon": -123.247},
        "predicted_destinations": [],
        "deadhead_path": {
            "type": "LineString",
            "coordinates": [[-123.12, 49.28], [-123.247, 49.267]],
        },
        "service_path": {
            "type": "LineString",
            "coordinates": [[-123.247, 49.267], [-123.1, 49.2]],
        },
        "impact": {"added_capacity": 50, "deadhead_minutes": 45, "deadhead_km": 12},
        "rationale": "Serves the strongest origin safely.",
        "evidence": [{"label": "Load", "value": "104%", "source": "TSPR 2025"}],
        "replaces_trip_id": None,
        "progress": {"percent_complete": 0},
        "service_pattern_id": "pattern-99-west",
        "surge_window_start": "2026-07-01T12:00:00-07:00",
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

    permanent_payload = first.model_dump()
    permanent_payload["current_time"] = "2026-11-01T01:00:00-07:00"
    permanent_payload["local_date"] = "2026-11-01"
    permanent = SimulationClock.model_validate(permanent_payload)
    assert permanent.model_dump(mode="json")["current_time"].endswith("-07:00")

    invalid = first.model_dump()
    invalid["current_time"] = "2026-11-01T01:00:00-08:00"
    invalid["local_date"] = "2026-11-01"
    with pytest.raises(ValidationError, match="offset"):
        SimulationClock.model_validate(invalid)


def test_route_normalizes_colors_and_allows_over_capacity_loads() -> None:
    route = RouteRef.model_validate(route_payload())
    trip = AdditionalTrip.model_validate(trip_payload())
    assert route.color == "#0055AA"
    assert trip.route.load_before_pct == 104


def test_forecast_cutoffs_and_intervals_are_enforced() -> None:
    with pytest.raises(ValidationError, match="trained_through"):
        ForecastVintage.model_validate(
            {
                "id": "v1",
                "issued_at": "2026-07-01T10:00:00-07:00",
                "trained_through": "2026-07-01T10:00:00-07:00",
                "model_name": "model",
                "model_version": "1",
                "source_version": "1",
                "normalization_policy": "wall clock",
            }
        )
    with pytest.raises(ValidationError, match="interval"):
        ForecastBucket.model_validate(
            {
                "id": "b1",
                "vintage_id": "v1",
                "hub_id": "ubc",
                "target_hour": "2026-07-01T12:00:00-07:00",
                "lead_h": 2,
                "forecast": 100,
                "lower_80": 101,
                "upper_80": 120,
                "typical_pings": None,
            }
        )


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


def test_progress_uses_zero_to_one_scale_and_v1_states_are_absent() -> None:
    with pytest.raises(ValidationError):
        TripProgress(percent_complete=50)
    assert "PLANNED" not in {status.value for status in AdditionalTripStatus}
    assert "EVALUATING" not in {status.value for status in SurgeStatus}
    assert "STOPPED" not in {status.value for status in BusStatus}


def test_canonical_serializers_hide_internal_fields_and_keep_nulls() -> None:
    surge = Surge.model_validate(surge_payload())
    bus = Bus.model_validate(bus_payload())
    trip = AdditionalTrip.model_validate(trip_payload())

    surge_json = serialize_surge(surge).model_dump(mode="json")
    bus_json = serialize_bus(bus).model_dump(mode="json")
    trip_json = serialize_additional_trip(trip).model_dump(mode="json")

    assert set(surge_json) == {
        "id",
        "hub_id",
        "location_name",
        "location",
        "detected_at",
        "predicted_window",
        "lead_time_minutes",
        "magnitude",
        "severity",
        "drivers",
        "predicted_destinations",
        "status",
        "phase",
        "additional_trip_ids",
        "actual",
    }
    assert surge_json["predicted_destinations"][0]["location"] is None
    assert surge_json["additional_trip_ids"] == ["trip-1", "trip-2"]
    assert "home_location" not in bus_json
    assert "service_pattern_id" not in trip_json
    assert "surge_window_start" not in trip_json


def test_trip_detail_is_the_only_canonical_extension() -> None:
    surge = Surge.model_validate(surge_payload())
    bus = Bus.model_validate(bus_payload())
    trip = AdditionalTrip.model_validate(trip_payload())
    detail = serialize_trip_detail(
        trip,
        bus=bus,
        surge=surge,
        current_stop_id=None,
        next_stop_id="stop-2",
    ).model_dump(mode="json")
    canonical = serialize_additional_trip(trip).model_dump(mode="json")

    assert set(detail) == set(canonical) | {"surge"}
    assert detail["bus"] == {
        "id": "bus-1",
        "current_location": bus.location.model_dump(),
    }
    assert detail["progress"]["current_stop_id"] is None
    assert detail["progress"]["next_stop_id"] == "stop-2"
