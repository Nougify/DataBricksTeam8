from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain.types import (
    Epoch,
    Heading,
    Hour,
    LoadPercentage,
    NonEmptyAdditionalTripId,
    NonEmptyBusId,
    NonEmptyForecastBucketId,
    NonEmptyForecastVintageId,
    NonEmptyHubId,
    NonEmptyLineKey,
    NonEmptyRouteId,
    NonEmptyScheduledTripId,
    NonEmptyServicePatternId,
    NonEmptyStopId,
    NonEmptySurgeId,
    NonEmptyText,
    NonNegativeFloat,
    NonNegativeInt,
    Percentage,
    PositiveInt,
    UnitInterval,
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


class DriverType(StrEnum):
    EXAM = "EXAM"
    HOLIDAY = "HOLIDAY"
    SPORTS = "SPORTS"
    CONCERT = "CONCERT"
    FESTIVAL = "FESTIVAL"
    NIGHTLIFE = "NIGHTLIFE"
    WEATHER = "WEATHER"
    OTHER = "OTHER"


class ClockStatus(StrEnum):
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"


class SurgeSeverity(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class SurgeStatus(StrEnum):
    PENDING = "PENDING"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    DISPATCHED = "DISPATCHED"
    NO_MATCHING_ROUTE = "NO_MATCHING_ROUTE"
    NO_BUS_AVAILABLE = "NO_BUS_AVAILABLE"
    EXPIRED = "EXPIRED"


class SurgePhase(StrEnum):
    UPCOMING = "UPCOMING"
    ACTIVE = "ACTIVE"
    RESOLVED = "RESOLVED"


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


class RouteWithLoad(RouteRef):
    load_before_pct: LoadPercentage | None
    load_after_pct: LoadPercentage | None


class Destination(DomainModel):
    origin: NonEmptyText
    location: GeoPoint | None
    share_pct: Percentage
    expected_pings: NonNegativeFloat


class ForecastVintage(DomainModel):
    id: NonEmptyForecastVintageId
    issued_at: VancouverDateTime
    trained_through: VancouverDateTime
    model_name: NonEmptyText
    model_version: NonEmptyText
    source_version: NonEmptyText
    normalization_policy: NonEmptyText

    @model_validator(mode="after")
    def cutoff_precedes_issuance(self) -> Self:
        if self.trained_through >= self.issued_at:
            raise ValueError("trained_through must be before issued_at")
        return self


class ForecastBucket(DomainModel):
    id: NonEmptyForecastBucketId
    vintage_id: NonEmptyForecastVintageId
    hub_id: NonEmptyHubId
    target_hour: VancouverDateTime
    lead_h: NonNegativeFloat
    forecast: NonNegativeFloat
    lower_80: NonNegativeFloat | None
    upper_80: NonNegativeFloat | None
    typical_pings: NonNegativeFloat | None

    @model_validator(mode="after")
    def ordered_interval(self) -> Self:
        if (self.lower_80 is None) != (self.upper_80 is None):
            raise ValueError("interval bounds must both be present or null")
        if (
            self.lower_80 is not None
            and self.upper_80 is not None
            and not self.lower_80 <= self.forecast <= self.upper_80
        ):
            raise ValueError("interval must contain forecast")
        return self


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
    approval_mode: Literal["MANUAL"] = "MANUAL"
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


class HourBucket(DomainModel):
    time: VancouverDateTime
    local_date: date
    hour: Hour

    @model_validator(mode="after")
    def valid_key(self) -> Self:
        if (self.local_date, self.hour) != (self.time.date(), self.time.hour):
            raise ValueError("local_date and hour must describe time")
        return self


class CurrentHour(HourBucket):
    pings_so_far: NonNegativeInt | None
    typical_pings_so_far: NonNegativeFloat | None
    complete: bool


class LastFullHour(HourBucket):
    pings: NonNegativeInt | None
    typical_pings: NonNegativeFloat | None
    surge_index: NonNegativeFloat | None
    is_surge: bool

    @model_validator(mode="after")
    def valid_surge_flag(self) -> Self:
        expected = self.surge_index is not None and self.surge_index >= 1.25
        if self.is_surge != expected:
            raise ValueError("is_surge must agree with surge_index")
        return self


class NextSurge(DomainModel):
    surge_id: NonEmptySurgeId
    window_start: VancouverDateTime
    surge_index: Annotated[float, Field(ge=1.25)]
    severity: SurgeSeverity

    @model_validator(mode="after")
    def valid_severity(self) -> Self:
        if self.severity is not severity_for_index(self.surge_index):
            raise ValueError("severity must agree with surge_index")
        return self


class HubStatus(DomainModel):
    hub_id: NonEmptyHubId
    as_of: VancouverDateTime
    current_hour: CurrentHour
    last_full_hour: LastFullHour | None
    next_surge: NextSurge | None
    active_trip_count: NonNegativeInt
    pending_proposal_count: NonNegativeInt


class PredictedWindow(DomainModel):
    start: VancouverDateTime
    end: VancouverDateTime

    @model_validator(mode="after")
    def positive_window(self) -> Self:
        if self.end <= self.start:
            raise ValueError("window end must be after start")
        return self


class SurgeMagnitude(DomainModel):
    predicted_pings: NonNegativeFloat
    typical_pings: Annotated[float, Field(gt=0)]
    surge_index: Annotated[float, Field(ge=1.25)]
    lower_80: NonNegativeFloat | None
    upper_80: NonNegativeFloat | None

    @model_validator(mode="after")
    def ordered_interval(self) -> Self:
        if (self.lower_80 is None) != (self.upper_80 is None):
            raise ValueError("interval bounds must both be present or null")
        if (
            self.lower_80 is not None
            and self.upper_80 is not None
            and not self.lower_80 <= self.predicted_pings <= self.upper_80
        ):
            raise ValueError("interval must contain predicted_pings")
        return self


class SurgeDriver(DomainModel):
    type: DriverType
    label: NonEmptyText
    event_id: NonEmptyText | None


class SurgeActual(DomainModel):
    pings: NonNegativeInt | None
    surge_index: NonNegativeFloat | None


def severity_for_index(index: float) -> SurgeSeverity:
    if index < 1.25:
        raise ValueError("surge index must be at least 1.25")
    if index < 1.5:
        return SurgeSeverity.LOW
    if index < 1.75:
        return SurgeSeverity.MEDIUM
    return SurgeSeverity.HIGH


class Surge(DomainModel):
    id: NonEmptySurgeId
    hub_id: NonEmptyHubId | None
    location_name: NonEmptyText
    location: GeoPoint
    detected_at: VancouverDateTime
    predicted_window: PredictedWindow
    lead_time_minutes: NonNegativeFloat
    magnitude: SurgeMagnitude
    severity: SurgeSeverity
    drivers: tuple[SurgeDriver, ...]
    predicted_destinations: tuple[Destination, ...]
    status: SurgeStatus
    phase: SurgePhase
    additional_trip_ids: tuple[NonEmptyAdditionalTripId, ...]
    actual: SurgeActual | None
    forecast_vintage_id: NonEmptyForecastVintageId = Field(exclude=True)
    peak_target_hour: VancouverDateTime = Field(exclude=True)

    @model_validator(mode="after")
    def valid_surge(self) -> Self:
        if self.severity is not severity_for_index(self.magnitude.surge_index):
            raise ValueError("severity must agree with surge_index")
        if (
            not self.predicted_window.start
            <= self.peak_target_hour
            < self.predicted_window.end
        ):
            raise ValueError("peak target must be inside the window")
        if (self.phase is SurgePhase.RESOLVED) != (self.actual is not None):
            raise ValueError("actual is required exactly when resolved")
        if len(self.additional_trip_ids) != len(set(self.additional_trip_ids)):
            raise ValueError("trip links must be unique")
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


class TripBusRef(DomainModel):
    id: NonEmptyBusId


class TripProgress(DomainModel):
    percent_complete: UnitInterval


class TripImpact(DomainModel):
    added_capacity: PositiveInt
    deadhead_minutes: NonNegativeFloat
    deadhead_km: NonNegativeFloat


class Evidence(DomainModel):
    label: NonEmptyText
    value: NonEmptyText
    source: NonEmptyText


class AdditionalTrip(DomainModel):
    id: NonEmptyAdditionalTripId
    surge_id: NonEmptySurgeId
    hub_id: NonEmptyHubId | None
    bus: TripBusRef
    route: RouteWithLoad
    donor_route: RouteWithLoad | None
    status: AdditionalTripStatus
    proposed_at: VancouverDateTime
    approval_expires_at: VancouverDateTime
    dispatch_time: VancouverDateTime
    arrival_at_surge_time: VancouverDateTime
    arrives_before_surge: bool
    departure_time: VancouverDateTime
    estimated_completion_time: VancouverDateTime
    surge_location: GeoPoint
    predicted_destinations: tuple[Destination, ...]
    deadhead_path: GeoJsonLineString
    service_path: GeoJsonLineString
    impact: TripImpact
    rationale: NonEmptyText
    evidence: tuple[Evidence, ...]
    replaces_trip_id: NonEmptyAdditionalTripId | None
    progress: TripProgress
    service_pattern_id: NonEmptyServicePatternId = Field(exclude=True)
    surge_window_start: VancouverDateTime = Field(exclude=True)

    @model_validator(mode="after")
    def valid_timing(self) -> Self:
        if not (
            self.proposed_at
            < self.approval_expires_at
            <= self.dispatch_time
            <= self.arrival_at_surge_time
            <= self.departure_time
            < self.estimated_completion_time
        ):
            raise ValueError("trip times violate lifecycle ordering")
        if self.arrives_before_surge != (
            self.arrival_at_surge_time < self.surge_window_start
        ):
            raise ValueError("arrives_before_surge must agree with timing")
        return self


class RouteScoreComponents(DomainModel):
    origin_proximity: UnitInterval
    destination_coverage: UnitInterval
    schedule_gap: UnitInterval
    deadhead_time: UnitInterval


class CandidateRouteScore(DomainModel):
    service_pattern_id: NonEmptyServicePatternId
    score: UnitInterval
    components: RouteScoreComponents
    failure_reason: NonEmptyText | None


class DispatchDecision(DomainModel):
    surge_id: NonEmptySurgeId
    selected_pattern_id: NonEmptyServicePatternId | None
    candidates: tuple[CandidateRouteScore, ...]
    failure_reason: NonEmptyText | None

    @model_validator(mode="after")
    def one_outcome(self) -> Self:
        if (self.selected_pattern_id is None) == (self.failure_reason is None):
            raise ValueError("decision requires either selection or failure")
        return self
