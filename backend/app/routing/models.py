from enum import StrEnum

from app.domain.models import (
    DomainModel,
    GeoJsonLineString,
    MovementLeg,
    MovementLegKind,
    MovementPlan,
    RoutingProvenance,
)
from app.domain.types import NonEmptyText, NonNegativeFloat

__all__ = [
    "MovementLeg",
    "MovementLegKind",
    "MovementPlan",
    "MovementPlanFailure",
    "MovementPlanFailureCode",
    "RoutingProvenance",
    "RoutingResult",
]


class RoutingResult(DomainModel):
    path: GeoJsonLineString
    distance_m: NonNegativeFloat
    duration_seconds: NonNegativeFloat
    provenance: RoutingProvenance


class MovementPlanFailureCode(StrEnum):
    PATTERN_NOT_FOUND = "PATTERN_NOT_FOUND"
    STOP_OCCURRENCE_NOT_FOUND = "STOP_OCCURRENCE_NOT_FOUND"
    INVALID_SERVICE_TIMING = "INVALID_SERVICE_TIMING"
    SERVICE_SHAPE_SEGMENT_FAILURE = "SERVICE_SHAPE_SEGMENT_FAILURE"
    ROUTING_PROVIDER_FAILURE = "ROUTING_PROVIDER_FAILURE"
    INVALID_ROUTING_RESULT = "INVALID_ROUTING_RESULT"
    PROACTIVE_ARRIVAL_TOO_LATE = "PROACTIVE_ARRIVAL_TOO_LATE"


class MovementPlanFailure(DomainModel):
    code: MovementPlanFailureCode
    leg: MovementLegKind | None
    reason: NonEmptyText
