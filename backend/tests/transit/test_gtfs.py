from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.data.adapters import FixtureEventSource
from app.domain.models import (
    DayType,
    GeoJsonMultiLineString,
    RecommendationMappingStatus,
    TransitMode,
)
from app.domain.types import HubId, RouteId
from app.transit import (
    GtfsLoadError,
    RecommendationMapper,
    TransitDataError,
    default_hub_catchments,
    load_gtfs_directory,
    parse_service_time,
)

MAPPING = {
    DayType.MF: date(2026, 10, 14),
    DayType.SAT: date(2026, 10, 17),
    DayType.SUN_HOL: date(2026, 10, 18),
}


def write_feed(root: Path) -> None:
    files = {
        "routes.txt": (
            "route_id,route_short_name,route_long_name,route_type,"
            "route_color,route_text_color\n"
            """
099,099,UBC B-Line,3,0060a9,ffffff
expo,Expo,Expo Line,1,FFD400,000000
seabus,SeaBus,SeaBus,4,0079C2,FFFFFF
wce,WCE,West Coast Express,2,5F2167,FFFFFF
"""
        ),
        "stops.txt": """stop_id,stop_name,stop_lat,stop_lon
UBC1,UBC Exchange,49.2610,-123.2460
ALMA,Alma Street,49.2635,-123.1850
WFSHS,Waterfront Station,49.2857,-123.1115
""",
        "trips.txt": """route_id,service_id,trip_id,trip_headsign,direction_id,shape_id
099,weekday,t-late,Commercial-Broadway,0,shape-west
099,weekday,t-east,UBC,1,shape-east
099,weekday,t-delayed,UBC,1,shape-east
wce,special,t-wce,Mission,0,shape-wce
""",
        "stop_times.txt": """trip_id,arrival_time,departure_time,stop_id,stop_sequence
t-late,24:10:00,24:11:00,UBC1,1
t-late,24:30:00,24:31:00,ALMA,2
t-east,08:00:00,08:00:00,ALMA,1
t-east,08:20:00,08:20:00,UBC1,2
t-delayed,07:00:00,07:00:00,ALMA,1
t-delayed,09:00:00,09:00:00,UBC1,2
t-wce,07:00:00,07:00:00,WFSHS,1
t-wce,08:00:00,08:00:00,ALMA,2
""",
        "shapes.txt": """shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence
shape-west,49.2635,-123.1850,2
shape-west,49.2610,-123.2460,1
shape-east,49.2635,-123.1850,1
shape-east,49.2610,-123.2460,2
shape-wce,49.2857,-123.1115,1
shape-wce,49.2635,-123.1850,2
""",
        "calendar.txt": (
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,"
            "sunday,start_date,end_date\n"
            """
weekday,1,1,1,1,1,0,0,20261001,20261031
sat,0,0,0,0,0,1,0,20261001,20261031
sun,0,0,0,0,0,0,1,20261001,20261031
"""
        ),
        "calendar_dates.txt": """service_id,date,exception_type
special,20261014,1
weekday,20261015,2
""",
    }
    for filename, contents in files.items():
        (root / filename).write_text(contents, encoding="utf-8")


def load_feed(root: Path):  # type: ignore[no-untyped-def]
    return load_gtfs_directory(
        root,
        feed_version="test-feed-v1",
        representative_dates=MAPPING,
        hubs=default_hub_catchments(),
    )


@pytest.mark.parametrize(
    ("value", "seconds"),
    [("00:00:00", 0), ("24:05:00", 86_700), ("27:30:45", 99_045)],
)
def test_parse_service_time_supports_gtfs_overflow(value: str, seconds: int) -> None:
    assert parse_service_time(value) == seconds


@pytest.mark.parametrize("value", ["-1:00:00", "1:60:00", "12:00", "noon"])
def test_parse_service_time_rejects_malformed_values(value: str) -> None:
    with pytest.raises(GtfsLoadError, match="service time"):
        parse_service_time(value)


def test_parser_builds_deterministic_routes_patterns_and_hub_index(
    tmp_path: Path,
) -> None:
    write_feed(tmp_path)

    first = load_feed(tmp_path)
    second = load_feed(tmp_path)

    assert [(route.route_id, route.mode) for route in first.routes()] == [
        ("099", TransitMode.BUS),
        ("expo", TransitMode.SKYTRAIN),
        ("seabus", TransitMode.SEABUS),
        ("wce", TransitMode.WEST_COAST_EXPRESS),
    ]
    route = first.route(RouteId("099"))
    assert route is not None
    assert route.line_key == "99"
    assert first.hub_stop_ids(HubId("ubc")) == ("UBC1",)
    assert first.hub_stop_ids(HubId("waterfront")) == ("WFSHS",)
    assert len(first.patterns_for_route(RouteId("099"))) == 3
    assert len(first.patterns_for_route(RouteId("wce"))) == 1
    assert first.patterns_for_route(RouteId("wce"), dispatch_eligible_only=True) == ()
    assert [pattern.id for pattern in first.patterns_for_route(RouteId("099"))] == [
        pattern.id for pattern in second.patterns_for_route(RouteId("099"))
    ]
    assert isinstance(first.route_shape(RouteId("099")), GeoJsonMultiLineString)


def test_calendar_exceptions_and_representative_mapping_are_explicit(
    tmp_path: Path,
) -> None:
    write_feed(tmp_path)
    index = load_feed(tmp_path)

    assert index.active_service_ids(date(2026, 10, 14)) == {
        "weekday",
        "special",
    }
    assert index.active_service_ids(date(2026, 10, 15)) == frozenset()

    resolution = index.service_date_resolution(date(2025, 12, 3))
    assert resolution.requested_date == date(2025, 12, 3)
    assert resolution.service_date == date(2026, 10, 14)
    assert resolution.is_representative is True
    assert resolution.feed_version == "test-feed-v1"

    holiday = index.service_date_resolution(date(2025, 12, 25))
    assert holiday.day_type is DayType.SUN_HOL
    assert holiday.service_date == date(2026, 10, 18)
    assert index.service_date_resolution(date(2025, 12, 26)).day_type is DayType.SUN_HOL
    assert index.service_date_resolution(date(2026, 4, 6)).day_type is DayType.SUN_HOL


def test_scheduled_trip_preserves_gtfs_identity_and_overflow_service_date(
    tmp_path: Path,
) -> None:
    write_feed(tmp_path)
    index = load_feed(tmp_path)

    trips = index.scheduled_trips(RouteId("099"), date(2026, 10, 14))
    late = next(trip for trip in trips if trip.gtfs_trip_id == "t-late")

    assert late.id == "2026-10-14:t-late"
    assert late.service_date == date(2026, 10, 14)
    assert late.start_time.date() == date(2026, 10, 15)
    assert late.start_time.hour == 0
    assert late.start_time.minute == 10
    assert late.stop_times[1] - late.stop_times[0] == timedelta(minutes=20)
    departures = index.departures(RouteId("099"), date(2026, 10, 14))
    assert (
        next(
            item.departure_time_seconds
            for item in departures
            if item.gtfs_trip_id == "t-late"
        )
        == 24 * 3600 + 11 * 60
    )
    east = next(item for item in departures if item.gtfs_trip_id == "t-east")
    assert east.stop_id == "UBC1"
    assert east.departure_time_seconds == 8 * 3600 + 20 * 60
    assert [item.gtfs_trip_id for item in departures] == [
        "t-east",
        "t-delayed",
        "t-late",
    ]


def test_mapper_uses_previous_service_date_for_overflow_trip(tmp_path: Path) -> None:
    write_feed(tmp_path)
    index = load_feed(tmp_path)
    pacific = timezone(-timedelta(hours=7))
    source_event = (
        FixtureEventSource("test-v1")
        .load_window(
            datetime(2026, 7, 10, 9, tzinfo=pacific),
            datetime(2026, 7, 10, 15, tzinfo=pacific),
        )
        .events[0]
    )
    event = source_event.model_copy(
        update={
            "event_time": datetime(2026, 10, 15, 0, 15, tzinfo=pacific),
            "source": source_event.source.model_copy(update={"direction": "0"}),
        }
    )
    settings = Settings(
        route_aliases={"99": "099"},
        destination_aliases={
            "Downtown": ("ALMA",),
            "Broadway": ("ALMA",),
            "Commercial-Broadway Station": ("ALMA",),
        },
    )

    result = RecommendationMapper(index, settings).resolve_event(event)
    recommendation = result.recommendations[0]

    assert recommendation.mapping_status is RecommendationMappingStatus.RESOLVED
    assert recommendation.candidates[0].requested_service_date == date(2026, 10, 14)
    assert recommendation.candidates[0].scheduled_trip_ids == ("2026-10-14:t-late",)


def test_shapeless_trip_remains_readable_but_is_not_dispatch_eligible(
    tmp_path: Path,
) -> None:
    write_feed(tmp_path)
    trips = (tmp_path / "trips.txt").read_text(encoding="utf-8")
    (tmp_path / "trips.txt").write_text(
        trips.replace(
            "wce,special,t-wce,Mission,0,shape-wce", "wce,special,t-wce,Mission,0,"
        ),
        encoding="utf-8",
    )

    index = load_feed(tmp_path)

    assert len(index.patterns_for_route(RouteId("wce"))) == 1
    assert index.route_shape(RouteId("wce")) is None
    assert index.patterns_for_route(RouteId("wce"), dispatch_eligible_only=True) == ()


def test_departure_without_a_hub_stop_uses_first_stop_with_null_id(
    tmp_path: Path,
) -> None:
    write_feed(tmp_path)
    index = load_gtfs_directory(
        tmp_path,
        feed_version="test-feed-v1",
        representative_dates=MAPPING,
        hubs=(),
    )

    departures = index.departures(RouteId("099"), date(2026, 10, 14))
    east = next(item for item in departures if item.gtfs_trip_id == "t-east")
    assert east.stop_id is None
    assert east.departure_time_seconds == 8 * 3600


def test_missing_file_and_broken_references_fail_without_fallback(
    tmp_path: Path,
) -> None:
    write_feed(tmp_path)
    (tmp_path / "shapes.txt").unlink()
    with pytest.raises(GtfsLoadError, match="missing required GTFS file"):
        load_feed(tmp_path)

    write_feed(tmp_path)
    trips = (tmp_path / "trips.txt").read_text(encoding="utf-8")
    (tmp_path / "trips.txt").write_text(
        trips.replace("099,weekday,t-late", "missing,weekday,t-late"),
        encoding="utf-8",
    )
    with pytest.raises(GtfsLoadError, match="unknown route"):
        load_feed(tmp_path)


def test_zero_based_gtfs_sequences_are_valid(tmp_path: Path) -> None:
    write_feed(tmp_path)
    stop_times = (tmp_path / "stop_times.txt").read_text(encoding="utf-8")
    (tmp_path / "stop_times.txt").write_text(
        stop_times.replace(
            "t-late,24:10:00,24:11:00,UBC1,1", "t-late,24:10:00,24:11:00,UBC1,0"
        ),
        encoding="utf-8",
    )
    shapes = (tmp_path / "shapes.txt").read_text(encoding="utf-8")
    (tmp_path / "shapes.txt").write_text(
        shapes.replace(
            "shape-west,49.2610,-123.2460,1", "shape-west,49.2610,-123.2460,0"
        ),
        encoding="utf-8",
    )

    assert load_feed(tmp_path).scheduled_trips(RouteId("099"), date(2026, 10, 14))


def test_representative_dates_and_hub_ids_are_validated(tmp_path: Path) -> None:
    write_feed(tmp_path)
    outside_mapping = dict(MAPPING)
    outside_mapping[DayType.MF] = date(2027, 10, 13)
    with pytest.raises(TransitDataError, match="outside feed coverage"):
        load_gtfs_directory(
            tmp_path,
            feed_version="test-feed-v1",
            representative_dates=outside_mapping,
            hubs=default_hub_catchments(),
        )

    hubs = default_hub_catchments()
    with pytest.raises(TransitDataError, match="duplicate hub"):
        load_gtfs_directory(
            tmp_path,
            feed_version="test-feed-v1",
            representative_dates=MAPPING,
            hubs=(hubs[0], hubs[0]),
        )


def test_duplicate_stop_sequence_and_invalid_shape_are_rejected(
    tmp_path: Path,
) -> None:
    write_feed(tmp_path)
    stop_times = (tmp_path / "stop_times.txt").read_text(encoding="utf-8")
    (tmp_path / "stop_times.txt").write_text(
        stop_times.replace(
            "t-late,24:30:00,24:31:00,ALMA,2", "t-late,24:30:00,24:31:00,ALMA,1"
        ),
        encoding="utf-8",
    )
    with pytest.raises(GtfsLoadError, match="duplicate stop_sequence"):
        load_feed(tmp_path)

    write_feed(tmp_path)
    shapes = (tmp_path / "shapes.txt").read_text(encoding="utf-8")
    (tmp_path / "shapes.txt").write_text(
        shapes.replace("shape-wce,49.2635,-123.1850,2\n", ""),
        encoding="utf-8",
    )
    with pytest.raises(GtfsLoadError, match="at least two points"):
        load_feed(tmp_path)


def test_unknown_hub_and_bad_coordinates_are_explicit(tmp_path: Path) -> None:
    write_feed(tmp_path)
    index = load_feed(tmp_path)
    with pytest.raises(KeyError, match="unknown hub"):
        index.hub_stop_ids(HubId("missing"))

    stops = (tmp_path / "stops.txt").read_text(encoding="utf-8")
    (tmp_path / "stops.txt").write_text(
        stops.replace("49.2610,-123.2460", "100,-123.2460"),
        encoding="utf-8",
    )
    with pytest.raises((GtfsLoadError, ValidationError)):
        load_feed(tmp_path)
