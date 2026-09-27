from enum import StrEnum
from typing import Annotated, Self

from pydantic import Field, model_validator

from app.domain.models import DomainModel, EventMode, GeoJsonLineString
from app.domain.types import (
    NonEmptyRouteId,
    NonEmptyScheduledTripId,
    NonEmptyServicePatternId,
    NonEmptyStopId,
    NonEmptyText,
    NonNegativeFloat,
    NonNegativeInt,
    VancouverDateTime,
)


class RoutingProvenance(DomainModel):
    provider: NonEmptyText
    is_approximation: bool
    method: NonEmptyText
    speed_kph: Annotated[float, Field(gt=0)] | None


class RoutingResult(DomainModel):
    path: GeoJsonLineString
    distance_m: NonNegativeFloat
    duration_seconds: NonNegativeFloat
    provenance: RoutingProvenance


class MovementLegKind(StrEnum):
    DEADHEAD = "DEADHEAD"
    SERVICE = "SERVICE"
    RETURN = "RETURN"


class MovementLeg(DomainModel):
    kind: MovementLegKind
    path: GeoJsonLineString
    distance_m: NonNegativeFloat
    duration_seconds: NonNegativeInt
    provenance: RoutingProvenance


class MovementPlan(DomainModel):
    route_id: NonEmptyRouteId
    pattern_id: NonEmptyServicePatternId
    source_stop_id: NonEmptyStopId
    destination_stop_id: NonEmptyStopId
    reference_scheduled_trip_id: NonEmptyScheduledTripId
    mode: EventMode
    deadhead: MovementLeg
    service: MovementLeg
    return_leg: MovementLeg
    dispatch_time: VancouverDateTime
    estimated_arrival_time: VancouverDateTime
    service_departure_time: VancouverDateTime
    estimated_completion_time: VancouverDateTime
    estimated_return_time: VancouverDateTime
    waiting_seconds: NonNegativeInt
    arrival_lateness_seconds: NonNegativeInt
    total_distance_m: NonNegativeFloat

    @model_validator(mode="after")
    def valid_plan(self) -> Self:
        if (
            self.deadhead.kind is not MovementLegKind.DEADHEAD
            or self.service.kind is not MovementLegKind.SERVICE
            or self.return_leg.kind is not MovementLegKind.RETURN
        ):
            raise ValueError("movement plan legs are out of order")
        times = (
            self.dispatch_time,
            self.estimated_arrival_time,
            self.service_departure_time,
            self.estimated_completion_time,
            self.estimated_return_time,
        )
        if tuple(sorted(times)) != times:
            raise ValueError("movement plan timestamps must be chronological")
        expected_distance = (
            self.deadhead.distance_m
            + self.service.distance_m
            + self.return_leg.distance_m
        )
        if abs(self.total_distance_m - expected_distance) > 1e-6:
            raise ValueError("movement plan total distance is inconsistent")
        return self


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
