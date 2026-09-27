from __future__ import annotations

import math
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from app.domain.models import GeoJsonLineString, GeoPoint
from app.routing.models import RoutingProvenance, RoutingResult

EARTH_RADIUS_M = 6_371_008.8


class RoutingProvider(StrEnum):
    STRAIGHT_LINE = "straight_line"


class RoutingService(Protocol):
    """Replaceable routing boundary used by dispatch and return movement."""

    def route(self, start: GeoPoint, end: GeoPoint) -> RoutingResult: ...


@dataclass(frozen=True)
class StraightLineRoutingService:
    speed_kph: float

    def __post_init__(self) -> None:
        if not math.isfinite(self.speed_kph) or self.speed_kph <= 0:
            raise ValueError("routing speed must be finite and positive")

    def route(self, start: GeoPoint, end: GeoPoint) -> RoutingResult:
        distance_m = great_circle_distance_m(start, end)
        speed_mps = self.speed_kph / 3.6
        return RoutingResult(
            path=GeoJsonLineString(
                coordinates=((start.lon, start.lat), (end.lon, end.lat))
            ),
            distance_m=distance_m,
            duration_seconds=distance_m / speed_mps,
            provenance=RoutingProvenance(
                provider=RoutingProvider.STRAIGHT_LINE.value,
                is_approximation=True,
                method="great-circle distance at configured constant speed",
                speed_kph=self.speed_kph,
            ),
        )


def great_circle_distance_m(start: GeoPoint, end: GeoPoint) -> float:
    """Return great-circle distance using the haversine formula."""
    start_lat = math.radians(start.lat)
    end_lat = math.radians(end.lat)
    latitude_delta = end_lat - start_lat
    longitude_delta = math.radians(end.lon - start.lon)
    haversine = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(start_lat) * math.cos(end_lat) * math.sin(longitude_delta / 2) ** 2
    )
    central_angle = 2 * math.asin(math.sqrt(min(1.0, haversine)))
    return EARTH_RADIUS_M * central_angle


def build_routing_service(
    provider: RoutingProvider, speed_kph: float
) -> RoutingService:
    if provider is RoutingProvider.STRAIGHT_LINE:
        return StraightLineRoutingService(speed_kph=speed_kph)
    raise ValueError(f"unsupported routing provider: {provider}")
