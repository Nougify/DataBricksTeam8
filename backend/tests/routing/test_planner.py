from datetime import datetime, timedelta, timezone

from app.config import Settings
from app.data.adapters import FixtureEventSource
from app.domain.models import (
    Bus,
    DispatchEvent,
    EventMode,
    GeoJsonLineString,
    GeoPoint,
    RecommendationCandidate,
)
from app.domain.types import StopId
from app.fleet import load_fleet
from app.routing import (
    ItineraryComposer,
    MovementLegKind,
    MovementPlan,
    MovementPlanFailure,
    MovementPlanFailureCode,
    RoutingResult,
    StraightLineRoutingService,
)
from app.transit import RecommendationMapper, TransitIndex, build_fixture_transit_index

PACIFIC = timezone(-timedelta(hours=7))
START = datetime(2026, 7, 10, 9, tzinfo=PACIFIC)
END = datetime(2026, 7, 10, 15, tzinfo=PACIFIC)


def planning_inputs() -> tuple[
    Settings,
    TransitIndex,
    DispatchEvent,
    RecommendationCandidate,
    Bus,
]:
    settings = Settings()
    transit = build_fixture_transit_index(
        settings.gtfs_feed_version, settings.gtfs_service_day_mapping
    )
    source_event = FixtureEventSource("test-v1").load_window(START, END).events[0]
    event = RecommendationMapper(transit, settings).resolve_event(source_event)
    candidate = event.recommendations[0].candidates[0]
    bus = load_fleet(settings, transit).buses[0]
    return settings, transit, event, candidate, bus


def test_proactive_plan_composes_deadhead_gtfs_service_and_home_return() -> None:
    settings, transit, event, candidate, bus = planning_inputs()
    source = transit.stop(StopId(candidate.source_stop_id))
    assert source is not None
    bus = bus.model_copy(update={"location": source.location})
    composer = ItineraryComposer(
        transit,
        StraightLineRoutingService(settings.routing_speed_kph),
        settings.proactive_lateness_tolerance_seconds,
    )

    result = composer.compose(event, candidate, bus, event.actionable_at)

    assert isinstance(result, MovementPlan)
    assert result.deadhead.kind is MovementLegKind.DEADHEAD
    assert result.deadhead.duration_seconds == 0
    assert result.service.path.coordinates == (
        (-123.246, 49.261),
        (-123.185, 49.2635),
    )
    assert result.service.duration_seconds == 1200
    assert result.service.provenance.provider == "gtfs"
    assert result.waiting_seconds == 1800
    assert result.estimated_arrival_time == event.actionable_at
    assert result.service_departure_time == event.event_time
    assert result.estimated_completion_time == event.event_time + timedelta(minutes=20)
    assert result.estimated_return_time > result.estimated_completion_time


def test_reactive_plan_starts_at_event_time_and_reports_late_arrival() -> None:
    settings, transit, event, candidate, bus = planning_inputs()
    waterfront = transit.hubs()[2]
    moved_bus = bus.model_copy(update={"location": waterfront.location})
    reactive = event.model_copy(
        update={
            "available_at": None,
            "actionable_at": event.event_time,
            "mode": EventMode.REACTIVE,
        }
    )
    composer = ItineraryComposer(
        transit, StraightLineRoutingService(settings.routing_speed_kph)
    )

    result = composer.compose(
        reactive,
        candidate,
        moved_bus,
        event.event_time - timedelta(minutes=15),
    )

    assert isinstance(result, MovementPlan)
    assert result.dispatch_time == event.event_time
    assert result.estimated_arrival_time > event.event_time
    assert result.arrival_lateness_seconds > 0
    assert result.service_departure_time == result.estimated_arrival_time
    assert result.waiting_seconds == 0


def test_proactive_lateness_is_typed_and_configurable() -> None:
    _, transit, event, candidate, bus = planning_inputs()
    waterfront = transit.hubs()[2]
    moved_bus = bus.model_copy(update={"location": waterfront.location})
    slow_routing = StraightLineRoutingService(1)

    rejected = ItineraryComposer(transit, slow_routing).compose(
        event, candidate, moved_bus, event.actionable_at
    )
    accepted = ItineraryComposer(
        transit, slow_routing, proactive_lateness_tolerance_seconds=100_000
    ).compose(event, candidate, moved_bus, event.actionable_at)

    assert isinstance(rejected, MovementPlanFailure)
    assert rejected.code is MovementPlanFailureCode.PROACTIVE_ARRIVAL_TOO_LATE
    assert isinstance(accepted, MovementPlan)
    assert accepted.arrival_lateness_seconds > 0
    assert accepted.waiting_seconds == 0


def test_return_provider_failure_discards_partial_plan() -> None:
    _, transit, event, candidate, bus = planning_inputs()

    class FailOnReturn:
        def __init__(self) -> None:
            self.calls = 0
            self.delegate = StraightLineRoutingService(30)

        def route(self, start: GeoPoint, end: GeoPoint) -> RoutingResult:
            self.calls += 1
            if self.calls == 2:
                raise RuntimeError("return unavailable")
            return self.delegate.route(start, end)

    provider = FailOnReturn()
    result = ItineraryComposer(transit, provider).compose(
        event, candidate, bus, event.actionable_at
    )

    assert isinstance(result, MovementPlanFailure)
    assert result.code is MovementPlanFailureCode.ROUTING_PROVIDER_FAILURE
    assert result.leg is MovementLegKind.RETURN
    assert provider.calls == 2


def test_invalid_provider_geometry_is_a_typed_failure() -> None:
    _, transit, event, candidate, bus = planning_inputs()

    class InvalidGeometry:
        def route(self, start: GeoPoint, end: GeoPoint) -> RoutingResult:
            result = StraightLineRoutingService(30).route(start, end)
            return RoutingResult(
                path=GeoJsonLineString(coordinates=((0.0, 0.0), (1.0, 1.0))),
                distance_m=result.distance_m,
                duration_seconds=result.duration_seconds,
                provenance=result.provenance,
            )

    result = ItineraryComposer(transit, InvalidGeometry()).compose(
        event, candidate, bus, event.actionable_at
    )

    assert isinstance(result, MovementPlanFailure)
    assert result.code is MovementPlanFailureCode.INVALID_ROUTING_RESULT
    assert result.leg is MovementLegKind.DEADHEAD


def test_zero_return_leg_and_repeated_composition_are_stable() -> None:
    settings, transit, event, candidate, bus = planning_inputs()
    destination = transit.stop(StopId(candidate.destination_stop_id))
    assert destination is not None
    returning_bus = bus.model_copy(update={"home_location": destination.location})
    composer = ItineraryComposer(
        transit, StraightLineRoutingService(settings.routing_speed_kph)
    )

    first = composer.compose(event, candidate, returning_bus, event.actionable_at)
    second = composer.compose(event, candidate, returning_bus, event.actionable_at)

    assert isinstance(first, MovementPlan)
    assert first == second
    assert first.return_leg.duration_seconds == 0
    assert first.return_leg.distance_m == 0
    assert first.return_leg.path.coordinates[0] == first.return_leg.path.coordinates[1]
