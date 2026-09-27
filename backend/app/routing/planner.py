from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, timedelta
from typing import TYPE_CHECKING

from app.domain.models import (
    Bus,
    DispatchEvent,
    EventMode,
    GeoJsonLineString,
    GeoPoint,
    RecommendationCandidate,
    ScheduledStopTime,
    ServicePattern,
)
from app.domain.types import (
    PERMANENT_PACIFIC,
    PERMANENT_PACIFIC_START,
    VANCOUVER,
    VancouverDateTime,
)
from app.routing.models import (
    MovementLeg,
    MovementLegKind,
    MovementPlan,
    MovementPlanFailure,
    MovementPlanFailureCode,
    RoutingProvenance,
    RoutingResult,
)
from app.routing.service import RoutingService, great_circle_distance_m

if TYPE_CHECKING:
    from app.transit.index import TransitIndex

MovementPlanOutcome = MovementPlan | MovementPlanFailure


@dataclass(frozen=True)
class ItineraryComposer:
    transit: TransitIndex
    routing: RoutingService
    proactive_lateness_tolerance_seconds: int = 0

    def __post_init__(self) -> None:
        if self.proactive_lateness_tolerance_seconds < 0:
            raise ValueError("proactive lateness tolerance must be nonnegative")

    def compose(
        self,
        event: DispatchEvent,
        candidate: RecommendationCandidate,
        bus: Bus,
        planning_time: VancouverDateTime,
    ) -> MovementPlanOutcome:
        pattern = self.transit.pattern(candidate.pattern_id)
        if pattern is None or pattern.route.route_id != candidate.route_id:
            return _failure(
                MovementPlanFailureCode.PATTERN_NOT_FOUND,
                None,
                f"candidate pattern not found: {candidate.pattern_id}",
            )
        occurrences = _candidate_occurrences(pattern, candidate)
        if occurrences is None:
            return _failure(
                MovementPlanFailureCode.STOP_OCCURRENCE_NOT_FOUND,
                MovementLegKind.SERVICE,
                "candidate stop sequences do not match the GTFS pattern",
            )
        source, destination = occurrences
        service_duration = (
            destination.arrival_offset_seconds - source.departure_offset_seconds
        )
        if service_duration < 0:
            return _failure(
                MovementPlanFailureCode.INVALID_SERVICE_TIMING,
                MovementLegKind.SERVICE,
                "destination arrival precedes source departure",
            )

        deadhead = self._provider_leg(
            MovementLegKind.DEADHEAD, bus.location, source.stop.location
        )
        if isinstance(deadhead, MovementPlanFailure):
            return deadhead
        service = _service_leg(pattern, source, destination, service_duration)
        if isinstance(service, MovementPlanFailure):
            return service
        return_leg = self._provider_leg(
            MovementLegKind.RETURN, destination.stop.location, bus.home_location
        )
        if isinstance(return_leg, MovementPlanFailure):
            return return_leg

        dispatch_time = (
            max(planning_time, event.event_time)
            if event.mode is EventMode.REACTIVE
            else planning_time
        )
        arrival = _add_seconds(dispatch_time, deadhead.duration_seconds)
        lateness = max(
            0,
            math.ceil(
                (
                    arrival.astimezone(UTC) - event.event_time.astimezone(UTC)
                ).total_seconds()
            ),
        )
        if (
            event.mode is EventMode.PROACTIVE
            and lateness > self.proactive_lateness_tolerance_seconds
        ):
            return _failure(
                MovementPlanFailureCode.PROACTIVE_ARRIVAL_TOO_LATE,
                MovementLegKind.DEADHEAD,
                f"arrival is {lateness} seconds after proactive target",
            )
        service_departure = (
            max(arrival, event.event_time)
            if event.mode is EventMode.PROACTIVE
            else arrival
        )
        waiting = max(
            0,
            math.ceil(
                (
                    service_departure.astimezone(UTC) - arrival.astimezone(UTC)
                ).total_seconds()
            ),
        )
        completion = _add_seconds(service_departure, service.duration_seconds)
        returned = _add_seconds(completion, return_leg.duration_seconds)
        return MovementPlan(
            route_id=candidate.route_id,
            pattern_id=candidate.pattern_id,
            source_stop_id=candidate.source_stop_id,
            destination_stop_id=candidate.destination_stop_id,
            reference_scheduled_trip_id=candidate.scheduled_trip_ids[0],
            mode=event.mode,
            deadhead=deadhead,
            service=service,
            return_leg=return_leg,
            dispatch_time=dispatch_time,
            estimated_arrival_time=arrival,
            service_departure_time=service_departure,
            estimated_completion_time=completion,
            estimated_return_time=returned,
            waiting_seconds=waiting,
            arrival_lateness_seconds=lateness,
            total_distance_m=(
                deadhead.distance_m + service.distance_m + return_leg.distance_m
            ),
        )

    def _provider_leg(
        self, kind: MovementLegKind, start: GeoPoint, end: GeoPoint
    ) -> MovementLeg | MovementPlanFailure:
        try:
            result = self.routing.route(start, end)
        except Exception as exc:
            return _failure(
                MovementPlanFailureCode.ROUTING_PROVIDER_FAILURE,
                kind,
                f"routing provider failed: {exc}",
            )
        if not isinstance(result, RoutingResult):
            return _failure(
                MovementPlanFailureCode.INVALID_ROUTING_RESULT,
                kind,
                "routing provider returned an incompatible result",
            )
        if not _result_matches_endpoints(result, start, end):
            return _failure(
                MovementPlanFailureCode.INVALID_ROUTING_RESULT,
                kind,
                "routing path endpoints do not match requested locations",
            )
        return MovementLeg(
            kind=kind,
            path=result.path,
            distance_m=result.distance_m,
            duration_seconds=math.ceil(result.duration_seconds),
            provenance=result.provenance,
        )


def _candidate_occurrences(
    pattern: ServicePattern, candidate: RecommendationCandidate
) -> tuple[ScheduledStopTime, ScheduledStopTime] | None:
    by_sequence = {stop.sequence: stop for stop in pattern.stops}
    source = by_sequence.get(candidate.source_stop_sequence)
    destination = by_sequence.get(candidate.destination_stop_sequence)
    if (
        source is None
        or destination is None
        or source.stop.id != candidate.source_stop_id
        or destination.stop.id != candidate.destination_stop_id
    ):
        return None
    return source, destination


def _service_leg(
    pattern: ServicePattern,
    source: ScheduledStopTime,
    destination: ScheduledStopTime,
    duration_seconds: int,
) -> MovementLeg | MovementPlanFailure:
    if not isinstance(pattern.shape, GeoJsonLineString):
        return _failure(
            MovementPlanFailureCode.SERVICE_SHAPE_SEGMENT_FAILURE,
            MovementLegKind.SERVICE,
            "service pattern does not have one ordered line shape",
        )
    path = _slice_shape(pattern.shape, source.stop.location, destination.stop.location)
    if path is None:
        return _failure(
            MovementPlanFailureCode.SERVICE_SHAPE_SEGMENT_FAILURE,
            MovementLegKind.SERVICE,
            "could not extract an ordered GTFS shape segment",
        )
    distance = sum(
        great_circle_distance_m(
            GeoPoint(lat=start[1], lon=start[0]),
            GeoPoint(lat=end[1], lon=end[0]),
        )
        for start, end in zip(path.coordinates, path.coordinates[1:], strict=False)
    )
    return MovementLeg(
        kind=MovementLegKind.SERVICE,
        path=path,
        distance_m=distance,
        duration_seconds=duration_seconds,
        provenance=RoutingProvenance(
            provider="gtfs",
            is_approximation=False,
            method="selected GTFS pattern shape and stop-time offsets",
            speed_kph=None,
        ),
    )


def _slice_shape(
    shape: GeoJsonLineString, source: GeoPoint, destination: GeoPoint
) -> GeoJsonLineString | None:
    coordinates = shape.coordinates
    source_projection = _nearest_projection(source, coordinates)
    if source_projection is None:
        return None
    destination_projection = _nearest_projection(
        destination, coordinates, minimum=source_projection[:2]
    )
    if destination_projection is None:
        return None
    source_segment, _, _ = source_projection
    destination_segment, _, _ = destination_projection
    points = [(source.lon, source.lat)]
    points.extend(
        coordinates[index]
        for index in range(source_segment + 1, destination_segment + 1)
    )
    points.append((destination.lon, destination.lat))
    deduplicated = tuple(
        point
        for index, point in enumerate(points)
        if index == 0 or point != points[index - 1]
    )
    if len(deduplicated) == 1:
        deduplicated = (deduplicated[0], deduplicated[0])
    return GeoJsonLineString(coordinates=deduplicated)


def _nearest_projection(
    point: GeoPoint,
    coordinates: tuple[tuple[float, float], ...],
    *,
    minimum: tuple[int, float] | None = None,
) -> tuple[int, float, tuple[float, float]] | None:
    best: tuple[float, int, float, tuple[float, float]] | None = None
    longitude_scale = math.cos(math.radians(point.lat))
    for index, (start, end) in enumerate(
        zip(coordinates, coordinates[1:], strict=False)
    ):
        if minimum is not None and index < minimum[0]:
            continue
        start_x = start[0] * longitude_scale
        end_x = end[0] * longitude_scale
        point_x = point.lon * longitude_scale
        delta_x = end_x - start_x
        delta_y = end[1] - start[1]
        denominator = delta_x * delta_x + delta_y * delta_y
        fraction = (
            0.0
            if denominator == 0
            else ((point_x - start_x) * delta_x + (point.lat - start[1]) * delta_y)
            / denominator
        )
        lower = minimum[1] if minimum is not None and index == minimum[0] else 0.0
        fraction = min(1.0, max(lower, fraction))
        projected = (
            start[0] + (end[0] - start[0]) * fraction,
            start[1] + (end[1] - start[1]) * fraction,
        )
        distance_sq = ((projected[0] - point.lon) * longitude_scale) ** 2 + (
            projected[1] - point.lat
        ) ** 2
        candidate = (distance_sq, index, fraction, projected)
        if best is None or candidate[:3] < best[:3]:
            best = candidate
    if best is None:
        return None
    return best[1], best[2], best[3]


def _result_matches_endpoints(
    result: RoutingResult, start: GeoPoint, end: GeoPoint
) -> bool:
    first = result.path.coordinates[0]
    last = result.path.coordinates[-1]
    return _same_position(first, (start.lon, start.lat)) and _same_position(
        last, (end.lon, end.lat)
    )


def _same_position(first: tuple[float, float], second: tuple[float, float]) -> bool:
    return math.isclose(first[0], second[0], abs_tol=1e-7) and math.isclose(
        first[1], second[1], abs_tol=1e-7
    )


def _add_seconds(value: VancouverDateTime, seconds: int) -> VancouverDateTime:
    instant = value.astimezone(UTC) + timedelta(seconds=seconds)
    zone = PERMANENT_PACIFIC if instant >= PERMANENT_PACIFIC_START else VANCOUVER
    return instant.astimezone(zone)


def _failure(
    code: MovementPlanFailureCode,
    leg: MovementLegKind | None,
    reason: str,
) -> MovementPlanFailure:
    return MovementPlanFailure(code=code, leg=leg, reason=reason)
