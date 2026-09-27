from collections.abc import Mapping
from datetime import date

from app.domain.models import (
    DayType,
    GeoJsonLineString,
    GeoPoint,
    RouteRef,
    ScheduledStopTime,
    ServicePattern,
    Stop,
    TransitMode,
)
from app.transit.index import TransitIndex
from app.transit.models import CalendarRule, HubCatchment, TripTemplate


def default_hub_catchments() -> tuple[HubCatchment, ...]:
    return (
        HubCatchment(
            hub_id="ubc",
            name="UBC",
            location_name="UBC",
            location=GeoPoint(lat=49.2606, lon=-123.2460),
            catchment_m=800,
            description="UBC campus and exchange",
        ),
        HubCatchment(
            hub_id="waterfront",
            name="Waterfront Station",
            location_name="Waterfront Station",
            location=GeoPoint(lat=49.2857, lon=-123.1115),
            catchment_m=300,
            description="Downtown multimodal terminal",
        ),
        HubCatchment(
            hub_id="park-royal",
            name="Park Royal Mall",
            location_name="Park Royal Mall",
            location=GeoPoint(lat=49.3265, lon=-123.1380),
            catchment_m=300,
            description="North Shore shopping and transit hub",
        ),
        HubCatchment(
            hub_id="vancouver-transit-centre",
            name="Vancouver Transit Centre",
            location_name="Vancouver Transit Centre",
            location=GeoPoint(lat=49.2018233, lon=-123.1378145),
            catchment_m=300,
            description="TransLink bus depot at 9149 Hudson Street",
        ),
    )


def build_fixture_transit_index(
    feed_version: str,
    representative_dates: Mapping[DayType, date] | None = None,
) -> TransitIndex:
    route = RouteRef(
        route_id="fixture-99",
        line_key="99",
        short_name="99",
        long_name="Commercial-Broadway / UBC",
        mode=TransitMode.BUS,
        color="0060A9",
        text_color="FFFFFF",
    )
    stops = (
        Stop(
            id="UBC1",
            name="UBC Exchange",
            location=GeoPoint(lat=49.2610, lon=-123.2460),
        ),
        Stop(
            id="ALMA",
            name="West Broadway at Alma",
            location=GeoPoint(lat=49.2635, lon=-123.1850),
        ),
    )
    pattern = ServicePattern(
        id="fixture-pattern-99",
        route=route,
        direction_id=0,
        headsign="Commercial-Broadway Station",
        stops=(
            ScheduledStopTime(
                stop=stops[0],
                sequence=1,
                arrival_offset_seconds=0,
                departure_offset_seconds=0,
            ),
            ScheduledStopTime(
                stop=stops[1],
                sequence=2,
                arrival_offset_seconds=1200,
                departure_offset_seconds=1200,
            ),
        ),
        shape=GeoJsonLineString(
            coordinates=((-123.2460, 49.2610), (-123.1850, 49.2635))
        ),
    )
    return TransitIndex(
        feed_version=feed_version,
        routes=(route,),
        stops=stops,
        patterns=(pattern,),
        templates=(
            TripTemplate(
                gtfs_trip_id="fixture-trip-99",
                service_id="fixture-mf",
                route_id="fixture-99",
                pattern_id=pattern.id,
                first_arrival_seconds=8 * 3600,
                first_departure_seconds=8 * 3600,
                arrival_seconds=(8 * 3600, 8 * 3600 + 1200),
                departure_seconds=(8 * 3600, 8 * 3600 + 1200),
            ),
        ),
        calendars=(
            CalendarRule(
                service_id="fixture-mf",
                start_date=date(2026, 1, 1),
                end_date=date(2026, 12, 31),
                weekdays=(True, True, True, True, True, True, True),
            ),
        ),
        exceptions=(),
        representative_dates=representative_dates
        or {
            DayType.MF: date(2026, 10, 14),
            DayType.SAT: date(2026, 10, 17),
            DayType.SUN_HOL: date(2026, 10, 18),
        },
        hubs=default_hub_catchments(),
    )
