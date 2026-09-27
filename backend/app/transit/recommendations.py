from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from math import ceil

from app.config import Settings
from app.data.models import EventWindow
from app.domain.models import (
    DispatchEvent,
    EventRecommendation,
    EventStatus,
    RecommendationCandidate,
    RecommendationFailureCode,
    RecommendationMappingStatus,
    RouteRef,
    ServicePattern,
)
from app.domain.types import HubId, ServicePatternId, StopId
from app.transit.index import TransitDataError, TransitIndex


class RecommendationMapper:
    """Resolves source recommendations to deterministic, service-backed GTFS paths."""

    def __init__(self, transit: TransitIndex, settings: Settings) -> None:
        self._transit = transit
        self._hub_aliases = {
            _normalize(source): target
            for source, target in settings.hub_aliases.items()
        }
        self._route_aliases = {
            _normalize(source): target
            for source, target in settings.route_aliases.items()
        }
        self._destination_aliases = {
            _normalize(source): targets
            for source, targets in settings.destination_aliases.items()
        }
        self._direction_aliases = {
            _normalize(source): target
            for source, target in settings.direction_aliases.items()
        }
        self._hubs = {str(hub.hub_id): hub for hub in transit.hubs()}
        self._normalized_hubs = {
            _normalize(str(hub.hub_id)): str(hub.hub_id) for hub in transit.hubs()
        }
        self._routes = {str(route.route_id): route for route in transit.routes()}
        self._routes_by_line: dict[str, tuple[RouteRef, ...]] = {}
        grouped_routes: dict[str, list[RouteRef]] = defaultdict(list)
        for route in transit.routes():
            grouped_routes[_normalize(str(route.line_key))].append(route)
        self._routes_by_line = {
            key: tuple(values) for key, values in grouped_routes.items()
        }
        self._stops_by_name: dict[str, tuple[StopId, ...]] = {}
        grouped_stops: dict[str, list[StopId]] = defaultdict(list)
        for stop in transit.stops():
            grouped_stops[_normalize(stop.name)].append(stop.id)
        self._stops_by_name = {
            key: tuple(sorted(values, key=str)) for key, values in grouped_stops.items()
        }
        self._validate_aliases()

    def resolve_window(self, window: EventWindow) -> EventWindow:
        return window.model_copy(
            update={
                "events": tuple(self.resolve_event(event) for event in window.events)
            }
        )

    def resolve_event(self, event: DispatchEvent) -> DispatchEvent:
        hub_id = self._resolve_hub(event)
        recommendations = tuple(
            self._resolve_recommendation(event, recommendation, hub_id)
            for recommendation in event.recommendations
        )
        resolved = next(
            (
                item
                for item in recommendations
                if item.mapping_status is RecommendationMappingStatus.RESOLVED
            ),
            None,
        )
        first_failure = recommendations[0]
        invalid_source = {
            RecommendationFailureCode.UNKNOWN_HUB,
            RecommendationFailureCode.UNKNOWN_ROUTE,
            RecommendationFailureCode.AMBIGUOUS_ROUTE,
            RecommendationFailureCode.UNKNOWN_DESTINATION,
            RecommendationFailureCode.UNKNOWN_DIRECTION,
        }
        status = (
            EventStatus.PENDING
            if resolved is not None
            else (
                EventStatus.INVALID_SOURCE
                if first_failure.failure_code in invalid_source
                else EventStatus.NO_MATCHING_ROUTE
            )
        )
        return event.model_copy(
            update={
                "hub_id": hub_id,
                "location": (
                    self._hubs[hub_id].location if hub_id is not None else None
                ),
                "recommendations": recommendations,
                "status": status,
                "suggested_extra_buses": (
                    ceil(resolved.extra_bus_trips_est)
                    if resolved is not None
                    else event.suggested_extra_buses
                ),
                "priority_score": (
                    resolved.priority_score
                    if resolved is not None
                    else event.priority_score
                ),
                "invalid_source_reason": (
                    first_failure.failure_reason
                    if status is EventStatus.INVALID_SOURCE
                    else None
                ),
            }
        )

    def _resolve_recommendation(
        self,
        event: DispatchEvent,
        recommendation: EventRecommendation,
        hub_id: str | None,
    ) -> EventRecommendation:
        if hub_id is None:
            return _failure(
                recommendation,
                RecommendationFailureCode.UNKNOWN_HUB,
                f"unknown source hub: {event.hub_id or event.source_location}",
            )
        route = self._resolve_route(recommendation)
        if isinstance(route, RecommendationFailureCode):
            reason = (
                f"ambiguous source route: {recommendation.source_route}"
                if route is RecommendationFailureCode.AMBIGUOUS_ROUTE
                else f"unknown source route: {recommendation.source_route}"
            )
            return _failure(recommendation, route, reason)
        destination_ids = self._resolve_destination(recommendation.destination)
        if not destination_ids:
            return _failure(
                recommendation,
                RecommendationFailureCode.UNKNOWN_DESTINATION,
                f"unknown destination: {recommendation.destination}",
                route_id=str(route.route_id),
            )
        direction = self._resolve_direction(event.source.direction)
        if event.source.direction is not None and direction is None:
            return _failure(
                recommendation,
                RecommendationFailureCode.UNKNOWN_DIRECTION,
                f"unknown direction: {event.source.direction}",
                route_id=str(route.route_id),
            )

        patterns = self._transit.patterns_for_route(
            route.route_id, dispatch_eligible_only=True
        )
        if not patterns:
            return _failure(
                recommendation,
                RecommendationFailureCode.NO_DISPATCH_ELIGIBLE_PATTERN,
                f"route {route.route_id} has no dispatch-eligible pattern",
                route_id=str(route.route_id),
            )
        hub_stops = set(self._transit.hub_stop_ids(HubId(hub_id)))
        serving_hub = tuple(
            pattern
            for pattern in patterns
            if any(item.stop.id in hub_stops for item in pattern.stops)
        )
        if not serving_hub:
            return _failure(
                recommendation,
                RecommendationFailureCode.ROUTE_NOT_SERVING_HUB,
                f"route {route.route_id} does not serve hub {hub_id}",
                route_id=str(route.route_id),
            )
        directed = tuple(
            pattern
            for pattern in serving_hub
            if direction is None or pattern.direction_id == direction
        )
        if not directed:
            return _failure(
                recommendation,
                RecommendationFailureCode.INCOMPATIBLE_DIRECTION,
                f"route {route.route_id} has no pattern for direction {direction}",
                route_id=str(route.route_id),
            )

        ordered_pairs = tuple(
            (pattern, source_index, destination_index)
            for pattern in directed
            for source_index, stop_time in enumerate(pattern.stops)
            if stop_time.stop.id in hub_stops
            for destination_index in range(source_index + 1, len(pattern.stops))
            if pattern.stops[destination_index].stop.id in destination_ids
        )
        if not ordered_pairs:
            return _failure(
                recommendation,
                RecommendationFailureCode.DESTINATION_NOT_ON_ROUTE,
                f"destination {recommendation.destination} is not downstream of hub",
                route_id=str(route.route_id),
            )

        candidates = tuple(
            sorted(
                (
                    candidate
                    for pattern, source_index, destination_index in ordered_pairs
                    for candidate in self._service_candidates(
                        event, pattern, source_index, destination_index
                    )
                ),
                key=lambda item: (
                    item.pattern_id,
                    item.source_stop_id,
                    item.destination_stop_id,
                    item.requested_service_date,
                ),
            )
        )
        if not candidates:
            return _failure(
                recommendation,
                RecommendationFailureCode.NO_SERVICE_ON_DATE,
                f"route {route.route_id} has no service on the event date",
                route_id=str(route.route_id),
            )
        return EventRecommendation.model_validate(
            {
                **recommendation.model_dump(),
                "route_id": route.route_id,
                "mapping_status": RecommendationMappingStatus.RESOLVED,
                "failure_code": None,
                "failure_reason": None,
                "candidates": candidates,
            }
        )

    def _service_candidates(
        self,
        event: DispatchEvent,
        pattern: ServicePattern,
        source_index: int,
        destination_index: int,
    ) -> tuple[RecommendationCandidate, ...]:
        event_date = event.event_time.date()
        candidates: list[RecommendationCandidate] = []
        for requested_date in (event_date - timedelta(days=1), event_date):
            trips = tuple(
                trip
                for trip in self._transit.scheduled_trips_for_pattern(
                    ServicePatternId(pattern.id), requested_date
                )
                if trip.stop_times[source_index].date() == event_date
            )
            if not trips:
                continue
            resolution = self._transit.service_date_resolution(requested_date)
            candidates.append(
                RecommendationCandidate(
                    route_id=pattern.route.route_id,
                    pattern_id=pattern.id,
                    source_stop_id=pattern.stops[source_index].stop.id,
                    destination_stop_id=pattern.stops[destination_index].stop.id,
                    source_stop_sequence=pattern.stops[source_index].sequence,
                    destination_stop_sequence=pattern.stops[destination_index].sequence,
                    direction_id=pattern.direction_id,
                    requested_service_date=requested_date,
                    feed_service_date=resolution.service_date,
                    representative_service=resolution.is_representative,
                    scheduled_trip_ids=tuple(trip.id for trip in trips),
                )
            )
        return tuple(candidates)

    def _resolve_hub(self, event: DispatchEvent) -> str | None:
        if event.hub_id is not None:
            return str(event.hub_id) if str(event.hub_id) in self._hubs else None
        source = _normalize(event.source_location)
        mapped = self._hub_aliases.get(source) or self._normalized_hubs.get(source)
        return mapped if mapped in self._hubs else None

    def _resolve_route(
        self, recommendation: EventRecommendation
    ) -> RouteRef | RecommendationFailureCode:
        if recommendation.route_id is not None:
            return self._routes.get(
                str(recommendation.route_id), RecommendationFailureCode.UNKNOWN_ROUTE
            )
        source = _normalize(recommendation.source_route)
        mapped = self._route_aliases.get(source)
        if mapped is not None:
            return self._routes.get(mapped, RecommendationFailureCode.UNKNOWN_ROUTE)
        if recommendation.source_route in self._routes:
            return self._routes[recommendation.source_route]
        matches = self._routes_by_line.get(source, ())
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            return RecommendationFailureCode.AMBIGUOUS_ROUTE
        return RecommendationFailureCode.UNKNOWN_ROUTE

    def _resolve_destination(self, destination: str) -> frozenset[StopId]:
        normalized = _normalize(destination)
        aliases = self._destination_aliases.get(normalized)
        if aliases is not None:
            return frozenset(StopId(item) for item in aliases)
        direct = self._transit.stop(StopId(destination))
        if direct is not None:
            return frozenset((direct.id,))
        return frozenset(self._stops_by_name.get(normalized, ()))

    def _resolve_direction(self, direction: str | None) -> int | None:
        if direction is None:
            return None
        return self._direction_aliases.get(_normalize(direction))

    def _validate_aliases(self) -> None:
        for target in self._hub_aliases.values():
            if target not in self._hubs:
                raise TransitDataError(f"hub alias references unknown hub: {target}")
        for target in self._route_aliases.values():
            if target not in self._routes:
                raise TransitDataError(
                    f"route alias references unknown route: {target}"
                )
        for targets in self._destination_aliases.values():
            if not targets:
                raise TransitDataError(
                    "destination alias must contain at least one stop"
                )
            for target in targets:
                if self._transit.stop(StopId(target)) is None:
                    raise TransitDataError(
                        f"destination alias references unknown stop: {target}"
                    )


def _failure(
    recommendation: EventRecommendation,
    code: RecommendationFailureCode,
    reason: str,
    *,
    route_id: str | None = None,
) -> EventRecommendation:
    return EventRecommendation.model_validate(
        {
            **recommendation.model_dump(),
            "route_id": route_id,
            "mapping_status": RecommendationMappingStatus.INVALID,
            "failure_code": code,
            "failure_reason": reason,
            "candidates": (),
        }
    )


def _normalize(value: str) -> str:
    return " ".join(value.casefold().split())
