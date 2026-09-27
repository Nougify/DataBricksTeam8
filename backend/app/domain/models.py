from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain.types import (
    Epoch,
    Heading,
    Hour,
    NonEmptyAdditionalTripId,
    NonEmptyBusId,
    NonEmptyDispatchEventId,
    NonEmptyHubId,
    NonEmptyLineKey,
    NonEmptyRouteId,
    NonEmptyScheduledTripId,
    NonEmptyServicePatternId,
    NonEmptyStopId,
    NonEmptyText,
    NonNegativeFloat,
    NonNegativeInt,
    Percentage,
    PositiveInt,
    VancouverDateTime,
)


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class DayType(StrEnum):
    MF = "mf"
    SAT = "sat"
    SUN_HOL = "sun_hol"


class TransitMode(StrEnum):
    BUS = "Bus"
    SKYTRAIN = "SkyTrain"
    SEABUS = "SeaBus"
    WEST_COAST_EXPRESS = "West Coast Express"


class ClockStatus(StrEnum):
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"


class BusStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    RESERVED = "RESERVED"
    DEADHEADING = "DEADHEADING"
    WAITING = "WAITING"
    IN_SERVICE = "IN_SERVICE"
    RETURNING = "RETURNING"
    REPOSITIONING = "REPOSITIONING"


class BusSourceType(StrEnum):
    ROUTE = "ROUTE"
    DEPOT = "DEPOT"


class AdditionalTripStatus(StrEnum):
    PROPOSED = "PROPOSED"
    APPROVED = "APPROVED"
    BUS_EN_ROUTE = "BUS_EN_ROUTE"
    IN_SERVICE = "IN_SERVICE"
    COMPLETED = "COMPLETED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"


class GeoPoint(DomainModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class EventMode(StrEnum):
    REACTIVE = "REACTIVE"
    PROACTIVE = "PROACTIVE"


class EventStatus(StrEnum):
    PENDING = "PENDING"
    NO_ACTION_REQUIRED = "NO_ACTION_REQUIRED"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    DISPATCHED = "DISPATCHED"
    COMPLETED = "COMPLETED"
    NO_MATCHING_ROUTE = "NO_MATCHING_ROUTE"
    NO_BUS_AVAILABLE = "NO_BUS_AVAILABLE"
    EXPIRED = "EXPIRED"
    REJECTED = "REJECTED"
    INVALID_SOURCE = "INVALID_SOURCE"


class RecommendationMappingStatus(StrEnum):
    UNRESOLVED = "UNRESOLVED"
    RESOLVED = "RESOLVED"
    INVALID = "INVALID"


class RecommendationFailureCode(StrEnum):
    UNKNOWN_HUB = "UNKNOWN_HUB"
    UNKNOWN_ROUTE = "UNKNOWN_ROUTE"
    AMBIGUOUS_ROUTE = "AMBIGUOUS_ROUTE"
    ROUTE_NOT_SERVING_HUB = "ROUTE_NOT_SERVING_HUB"
    UNKNOWN_DESTINATION = "UNKNOWN_DESTINATION"
    DESTINATION_NOT_ON_ROUTE = "DESTINATION_NOT_ON_ROUTE"
    UNKNOWN_DIRECTION = "UNKNOWN_DIRECTION"
    INCOMPATIBLE_DIRECTION = "INCOMPATIBLE_DIRECTION"
    NO_DISPATCH_ELIGIBLE_PATTERN = "NO_DISPATCH_ELIGIBLE_PATTERN"
    NO_SERVICE_ON_DATE = "NO_SERVICE_ON_DATE"


class RecommendationCandidate(DomainModel):
    route_id: NonEmptyRouteId
    pattern_id: NonEmptyServicePatternId
    source_stop_id: NonEmptyStopId
    destination_stop_id: NonEmptyStopId
    source_stop_sequence: NonNegativeInt
    destination_stop_sequence: NonNegativeInt
    direction_id: int | None
    requested_service_date: date
    feed_service_date: date
    representative_service: bool
    scheduled_trip_ids: tuple[NonEmptyScheduledTripId, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def destination_follows_source(self) -> Self:
        if self.destination_stop_sequence <= self.source_stop_sequence:
            raise ValueError("candidate destination must follow source")
        return self


class EventRecommendation(DomainModel):
    destination: NonEmptyText
    destination_share: Percentage
    route_id: NonEmptyRouteId | None
    source_route: NonEmptyText
    extra_bus_trips_est: NonNegativeFloat
    priority_score: NonNegativeFloat
    scheduled_trips_that_hour: NonNegativeInt | None = None
    extra_people_on_route: NonNegativeFloat | None = None
    avg_daily_boardings: NonNegativeFloat | None = None
    pct_trips_overcrowded: NonNegativeFloat | None = None
    mapping_status: RecommendationMappingStatus = RecommendationMappingStatus.UNRESOLVED
    failure_code: RecommendationFailureCode | None = None
    failure_reason: NonEmptyText | None = None
    candidates: tuple[RecommendationCandidate, ...] = ()

    @property
    def destination_share_pct(self) -> float:
        return self.destination_share

    @property
    def route_key(self) -> str:
        return self.source_route

    @model_validator(mode="after")
    def valid_mapping(self) -> Self:
        if self.mapping_status is RecommendationMappingStatus.UNRESOLVED:
            if self.failure_code is not None or self.failure_reason or self.candidates:
                raise ValueError("unresolved recommendation has mapping output")
        elif self.mapping_status is RecommendationMappingStatus.RESOLVED:
            if self.route_id is None or not self.candidates:
                raise ValueError(
                    "resolved recommendation requires route and candidates"
                )
            if self.failure_code is not None or self.failure_reason is not None:
                raise ValueError("resolved recommendation cannot have a failure")
        elif (
            self.failure_code is None or self.failure_reason is None or self.candidates
        ):
            raise ValueError("invalid recommendation requires one typed failure")
        return self


class EventSourceMetadata(DomainModel):
    split: NonEmptyText | None = None
    direction: NonEmptyText | None = None
    link: NonEmptyText | None = None
    version: NonEmptyText | None = None
    generated_at: VancouverDateTime | None = None


class DispatchEvent(DomainModel):
    id: NonEmptyDispatchEventId
    hub_id: NonEmptyHubId | None
    source_location: NonEmptyText
    location: GeoPoint | None = None
    available_at: VancouverDateTime | None
    actionable_at: VancouverDateTime
    event_time: VancouverDateTime
    mode: EventMode
    surge_type: NonEmptyText | None
    predicted_people: NonNegativeFloat
    normal_people: NonNegativeFloat
    surge_ratio: NonNegativeFloat | None
    suggested_extra_buses: NonNegativeInt
    priority_score: NonNegativeFloat
    recommendations: tuple[EventRecommendation, ...] = Field(min_length=1)
    status: EventStatus = EventStatus.PENDING
    additional_trip_ids: tuple[NonEmptyAdditionalTripId, ...] = ()
    source: EventSourceMetadata
    invalid_source_reason: str | None = Field(default=None, exclude=True)

    @property
    def event_id(self) -> str:
        return self.id

    @property
    def source_version(self) -> str | None:
        return self.source.version

    @property
    def generated_at(self) -> VancouverDateTime | None:
        return self.source.generated_at

    @model_validator(mode="after")
    def valid_event(self) -> Self:
        expected = tuple(
            sorted(
                self.recommendations,
                key=lambda row: (
                    -row.priority_score,
                    row.source_route,
                    row.destination,
                ),
            )
        )
        if self.recommendations != expected:
            raise ValueError("recommendations must be ordered by priority")
        expected_actionable = self.available_at or self.event_time
        expected_mode = (
            EventMode.PROACTIVE
            if self.available_at is not None and self.available_at < self.event_time
            else EventMode.REACTIVE
        )
        if self.actionable_at != expected_actionable or self.mode is not expected_mode:
            raise ValueError("event availability fields are inconsistent")
        if (
            self.invalid_source_reason is not None
            and self.status is not EventStatus.INVALID_SOURCE
        ):
            raise ValueError("invalid source events must have INVALID_SOURCE status")
        if len(self.additional_trip_ids) != len(set(self.additional_trip_ids)):
            raise ValueError("trip links must be unique")
        return self


Position = tuple[
    Annotated[float, Field(ge=-180, le=180)],
    Annotated[float, Field(ge=-90, le=90)],
]


class GeoJsonLineString(DomainModel):
    type: Literal["LineString"] = "LineString"
    coordinates: tuple[Position, ...] = Field(min_length=2)


class GeoJsonMultiLineString(DomainModel):
    type: Literal["MultiLineString"] = "MultiLineString"
    coordinates: tuple[tuple[Position, ...], ...] = Field(min_length=1)

    @field_validator("coordinates")
    @classmethod
    def lines_have_geometry(
        cls, value: tuple[tuple[Position, ...], ...]
    ) -> tuple[tuple[Position, ...], ...]:
        if any(len(line) < 2 for line in value):
            raise ValueError("each line must contain at least two positions")
        return value


RouteShape = GeoJsonLineString | GeoJsonMultiLineString


class RoutingProvenance(DomainModel):
    provider: NonEmptyText
    is_approximation: bool
    method: NonEmptyText
    speed_kph: Annotated[float, Field(gt=0)] | None


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


class RouteRef(DomainModel):
    route_id: NonEmptyRouteId
    line_key: NonEmptyLineKey
    short_name: NonEmptyText
    long_name: NonEmptyText | None
    mode: TransitMode
    color: str | None
    text_color: str | None

    @field_validator("color", "text_color", mode="before")
    @classmethod
    def normalize_color(cls, value: object) -> object:
        if value is None or not isinstance(value, str):
            return value
        color = value.removeprefix("#").upper()
        if len(color) != 6 or any(c not in "0123456789ABCDEF" for c in color):
            raise ValueError("route colors must be six hexadecimal digits")
        return f"#{color}"


class Stop(DomainModel):
    id: NonEmptyStopId
    name: NonEmptyText
    location: GeoPoint


class ScheduledStopTime(DomainModel):
    stop: Stop
    sequence: NonNegativeInt
    arrival_offset_seconds: NonNegativeInt
    departure_offset_seconds: NonNegativeInt

    @model_validator(mode="after")
    def departure_follows_arrival(self) -> Self:
        if self.departure_offset_seconds < self.arrival_offset_seconds:
            raise ValueError("departure cannot precede arrival")
        return self


class ServicePattern(DomainModel):
    id: NonEmptyServicePatternId
    route: RouteRef
    direction_id: int | None
    headsign: NonEmptyText | None
    stops: tuple[ScheduledStopTime, ...] = Field(min_length=2)
    shape: RouteShape | None

    @field_validator("stops")
    @classmethod
    def ordered_stops(
        cls, value: tuple[ScheduledStopTime, ...]
    ) -> tuple[ScheduledStopTime, ...]:
        sequences = [stop.sequence for stop in value]
        if sequences != sorted(set(sequences)) or any(
            current.departure_offset_seconds > following.arrival_offset_seconds
            for current, following in zip(value, value[1:], strict=False)
        ):
            raise ValueError("pattern stops must be uniquely ordered and chronological")
        return value


class ScheduledTrip(DomainModel):
    id: NonEmptyScheduledTripId
    gtfs_trip_id: NonEmptyText
    service_pattern_id: NonEmptyServicePatternId
    service_date: date
    start_time: VancouverDateTime
    stop_times: tuple[VancouverDateTime, ...] = Field(min_length=2)

    @model_validator(mode="after")
    def chronological(self) -> Self:
        if self.stop_times[0] < self.start_time or any(
            a > b for a, b in zip(self.stop_times, self.stop_times[1:], strict=False)
        ):
            raise ValueError("scheduled stop times must be chronological")
        return self


class SimulationClock(DomainModel):
    current_time: VancouverDateTime
    local_date: date
    hour: Hour
    speed: Literal[1, 60, 300, 900, 3600]
    status: ClockStatus
    min_time: VancouverDateTime
    max_time: VancouverDateTime
    approval_mode: Literal["MANUAL", "AUTOMATIC"] = "MANUAL"
    auto_pause_on_proposal: bool
    epoch: Epoch

    @model_validator(mode="after")
    def valid_clock(self) -> Self:
        if not self.min_time <= self.current_time <= self.max_time:
            raise ValueError("current_time must be within bounds")
        if (self.local_date, self.hour) != (
            self.current_time.date(),
            self.current_time.hour,
        ):
            raise ValueError("local_date and hour must describe current_time")
        return self


class BusSource(DomainModel):
    type: BusSourceType
    route: RouteRef | None
    depot_name: NonEmptyText | None

    @model_validator(mode="after")
    def valid_source(self) -> Self:
        route_valid = (
            self.type is BusSourceType.ROUTE
            and self.route is not None
            and self.depot_name is None
        )
        depot_valid = (
            self.type is BusSourceType.DEPOT
            and self.route is None
            and self.depot_name is not None
        )
        if not (route_valid or depot_valid):
            raise ValueError("source discriminator and fields do not agree")
        return self


class Bus(DomainModel):
    id: NonEmptyBusId
    status: BusStatus
    location: GeoPoint
    heading_deg: Heading | None
    capacity: PositiveInt
    source: BusSource
    assigned_trip_id: NonEmptyAdditionalTripId | None
    proposed_trip_id: NonEmptyAdditionalTripId | None
    home_location: GeoPoint = Field(exclude=True)

    @model_validator(mode="after")
    def valid_links(self) -> Self:
        links = (self.assigned_trip_id is not None, self.proposed_trip_id is not None)
        if all(links) or (self.status is BusStatus.AVAILABLE and any(links)):
            raise ValueError("bus trip links conflict with status")
        if self.status is BusStatus.RESERVED and sum(links) != 1:
            raise ValueError("reserved bus must reference exactly one trip")
        return self


class AdditionalTrip(DomainModel):
    id: NonEmptyAdditionalTripId
    dispatch_event_id: NonEmptyDispatchEventId
    bus_id: NonEmptyBusId
    route_id: NonEmptyRouteId
    status: AdditionalTripStatus
    proposed_at: VancouverDateTime
    approval_expires_at: VancouverDateTime
    dispatch_time: VancouverDateTime | None = None
    target_event_time: VancouverDateTime
    estimated_arrival_time: VancouverDateTime | None = None
    service_departure_time: VancouverDateTime | None = None
    estimated_completion_time: VancouverDateTime | None = None
    added_capacity: PositiveInt
    rationale: NonEmptyText
    source_priority: NonNegativeFloat
    source_route: NonEmptyText | None = None
    destination: NonEmptyText | None = None
    selected_candidate: RecommendationCandidate | None = None
    movement_plan: MovementPlan | None = None

    @model_validator(mode="after")
    def valid_timing(self) -> Self:
        if self.approval_expires_at <= self.proposed_at:
            raise ValueError("approval expiry must follow proposal")
        times = tuple(
            value
            for value in (
                self.dispatch_time,
                self.estimated_arrival_time,
                self.service_departure_time,
                self.estimated_completion_time,
            )
            if value is not None
        )
        if times != tuple(sorted(times)):
            raise ValueError("trip lifecycle times must be chronological")
        return self
