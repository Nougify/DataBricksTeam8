import json
import math
from pathlib import Path

from pydantic import ValidationError

from app.domain.models import (
    DomainModel,
    ScheduledStopTime,
    ServicePattern,
    TransitMode,
)
from app.domain.types import HubId, NonEmptyText, RouteId, ServicePatternId
from app.transit.index import TransitDataError, TransitIndex

MIN_DISPATCH_PATH_DISTANCE_M = 1_000


class DispatchPathMapping(DomainModel):
    hub_id: NonEmptyText
    route_key: NonEmptyText
    route_id: NonEmptyText
    pattern_id: NonEmptyText
    source_stop_id: NonEmptyText
    source_stop_sequence: int
    destination_stop_id: NonEmptyText
    destination_stop_sequence: int


class RecommendationMappingArtifact(DomainModel):
    gtfs_feed_version: NonEmptyText
    mappings: tuple[DispatchPathMapping, ...]


def generate_recommendation_mappings(
    transit: TransitIndex, pairs: set[tuple[str, str]]
) -> RecommendationMappingArtifact:
    routes_by_key: dict[str, list[str]] = {}
    for route in transit.routes():
        routes_by_key.setdefault(_normalize(str(route.line_key)), []).append(
            str(route.route_id)
        )

    best_mappings: dict[
        tuple[str, str, str, int | None],
        tuple[int, DispatchPathMapping],
    ] = {}
    for hub_id, route_key in sorted(pairs):
        route_ids = routes_by_key.get(_normalize(route_key), ())
        if len(route_ids) != 1 or transit.hub(HubId(hub_id)) is None:
            continue
        hub_stops = set(transit.hub_stop_ids(HubId(hub_id)))
        for pattern in transit.patterns_for_route(
            RouteId(route_ids[0]), dispatch_eligible_only=True
        ):
            destination_index = len(pattern.stops) - 1
            source = next(
                (
                    stop_time
                    for index, stop_time in enumerate(pattern.stops)
                    if stop_time.stop.id in hub_stops and index < destination_index
                ),
                None,
            )
            if source is None:
                continue
            destination = pattern.stops[destination_index]
            if destination.stop.id in hub_stops or not dispatch_path_leaves_source(
                source, destination
            ):
                continue
            mapping = DispatchPathMapping(
                hub_id=hub_id,
                route_key=route_key,
                route_id=route_ids[0],
                pattern_id=str(pattern.id),
                source_stop_id=str(source.stop.id),
                source_stop_sequence=source.sequence,
                destination_stop_id=str(destination.stop.id),
                destination_stop_sequence=destination.sequence,
            )
            key = (
                hub_id,
                _normalize(route_key),
                route_ids[0],
                pattern.direction_id,
            )
            candidate = (transit.trip_template_count(pattern.id), mapping)
            current = best_mappings.get(key)
            if current is None or candidate[0] > current[0] or (
                candidate[0] == current[0]
                and candidate[1].pattern_id < current[1].pattern_id
            ):
                best_mappings[key] = candidate
    return RecommendationMappingArtifact(
        gtfs_feed_version=transit.feed_version,
        mappings=tuple(
            mapping
            for _, mapping in sorted(
                best_mappings.values(),
                key=lambda item: (
                    item[1].hub_id,
                    item[1].route_key,
                    item[1].pattern_id,
                ),
            )
        ),
    )


def load_recommendation_mappings(
    path: Path | None, transit: TransitIndex
) -> dict[tuple[str, str], tuple[tuple[DispatchPathMapping, ServicePattern], ...]]:
    if path is None:
        return {}
    try:
        artifact = RecommendationMappingArtifact.model_validate_json(
            path.read_text("utf-8")
        )
    except (OSError, UnicodeError, ValidationError, json.JSONDecodeError) as exc:
        raise TransitDataError(f"cannot load recommendation mappings: {path}") from exc
    if artifact.gtfs_feed_version != transit.feed_version:
        raise TransitDataError(
            "recommendation mapping GTFS version does not match configured feed"
        )

    grouped: dict[
        tuple[str, str], list[tuple[DispatchPathMapping, ServicePattern]]
    ] = {}
    seen: set[tuple[str, str, str, int, int]] = set()
    known_hubs = {str(hub.hub_id) for hub in transit.hubs()}
    for mapping in artifact.mappings:
        if mapping.hub_id not in known_hubs:
            raise TransitDataError(
                f"recommendation mapping references unknown hub: {mapping.hub_id}"
            )
        pattern = transit.pattern(ServicePatternId(mapping.pattern_id))
        if pattern is None:
            raise TransitDataError(
                "recommendation mapping references unknown pattern: "
                f"{mapping.pattern_id}"
            )
        if str(pattern.route.route_id) != mapping.route_id:
            raise TransitDataError(
                "recommendation mapping route differs from pattern: "
                f"{mapping.pattern_id}"
            )
        if pattern.route.mode is not TransitMode.BUS or pattern.shape is None:
            raise TransitDataError(
                "recommendation mapping pattern is not dispatch eligible: "
                f"{mapping.pattern_id}"
            )
        source_index = _stop_index(
            pattern, mapping.source_stop_id, mapping.source_stop_sequence
        )
        destination_index = _stop_index(
            pattern,
            mapping.destination_stop_id,
            mapping.destination_stop_sequence,
        )
        if source_index >= destination_index:
            raise TransitDataError(
                "recommendation mapping destination is not downstream: "
                f"{mapping.pattern_id}"
            )
        if mapping.destination_stop_id in {
            str(stop_id) for stop_id in transit.hub_stop_ids(HubId(mapping.hub_id))
        }:
            raise TransitDataError(
                "recommendation mapping destination remains inside source hub: "
                f"{mapping.pattern_id}"
            )
        if not dispatch_path_leaves_source(
            pattern.stops[source_index], pattern.stops[destination_index]
        ):
            raise TransitDataError(
                "recommendation mapping path is too short for dispatch: "
                f"{mapping.pattern_id}"
            )
        identity = (
            mapping.hub_id,
            _normalize(mapping.route_key),
            mapping.pattern_id,
            mapping.source_stop_sequence,
            mapping.destination_stop_sequence,
        )
        if identity in seen:
            raise TransitDataError("duplicate recommendation mapping path")
        seen.add(identity)
        grouped.setdefault(identity[:2], []).append((mapping, pattern))
    return {
        key: _validated_group(key, values) for key, values in grouped.items()
    }


def mapping_stop_indexes(
    mapping: DispatchPathMapping, pattern: ServicePattern
) -> tuple[int, int]:
    return (
        _stop_index(pattern, mapping.source_stop_id, mapping.source_stop_sequence),
        _stop_index(
            pattern,
            mapping.destination_stop_id,
            mapping.destination_stop_sequence,
        ),
    )


def dispatch_path_leaves_source(
    source: ScheduledStopTime, destination: ScheduledStopTime
) -> bool:
    first = source.stop.location
    second = destination.stop.location
    lat1 = math.radians(first.lat)
    lat2 = math.radians(second.lat)
    delta_lat = lat2 - lat1
    delta_lon = math.radians(second.lon - first.lon)
    value = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(math.sqrt(value)) >= MIN_DISPATCH_PATH_DISTANCE_M


def _stop_index(pattern: ServicePattern, stop_id: str, sequence: int) -> int:
    for index, stop_time in enumerate(pattern.stops):
        if str(stop_time.stop.id) == stop_id and stop_time.sequence == sequence:
            return index
    raise TransitDataError(
        f"recommendation mapping stop is not on pattern {pattern.id}: {stop_id}"
    )


def _validated_group(
    key: tuple[str, str],
    values: list[tuple[DispatchPathMapping, ServicePattern]],
) -> tuple[tuple[DispatchPathMapping, ServicePattern], ...]:
    if len({mapping.route_id for mapping, _ in values}) != 1:
        raise TransitDataError(
            f"recommendation mapping has multiple route IDs for {key[0]} / {key[1]}"
        )
    return tuple(sorted(values, key=lambda item: item[0].pattern_id))


def _normalize(value: str) -> str:
    return " ".join(value.casefold().split())
