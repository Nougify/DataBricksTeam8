from datetime import date
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, model_validator

from app.domain.models import (
    AdditionalTripStatus,
    BusSource,
    BusStatus,
    ClockStatus,
    CurrentHour,
    Destination,
    Evidence,
    GeoJsonLineString,
    GeoPoint,
    LastFullHour,
    NextSurge,
    PredictedWindow,
    RouteWithLoad,
    SurgeActual,
    SurgeDriver,
    SurgeMagnitude,
    SurgePhase,
    SurgeSeverity,
    SurgeStatus,
    TripImpact,
)
from app.domain.types import (
    Epoch,
    Heading,
    Hour,
    NonEmptyAdditionalTripId,
    NonEmptyBusId,
    NonEmptyHubId,
    NonEmptySurgeId,
    NonEmptyText,
    NonNegativeFloat,
    NonNegativeInt,
    PositiveInt,
    UnitInterval,
    VancouverDateTime,
)


class ApiSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class Clock(ApiSchema):
    current_time: VancouverDateTime
    local_date: date
    hour: Hour
    speed: Literal[1, 60, 300, 900, 3600]
    status: ClockStatus
    min_time: VancouverDateTime
    max_time: VancouverDateTime
    approval_mode: Literal["MANUAL", "AUTOMATIC"]
    auto_pause_on_proposal: bool
    epoch: Epoch


class HubStatus(ApiSchema):
    hub_id: NonEmptyHubId
    as_of: VancouverDateTime
    current_hour: CurrentHour
    last_full_hour: LastFullHour | None
    next_surge: NextSurge | None
    active_trip_count: NonNegativeInt
    pending_proposal_count: NonNegativeInt


class Surge(ApiSchema):
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


class Bus(ApiSchema):
    id: NonEmptyBusId
    status: BusStatus
    location: GeoPoint
    heading_deg: Heading | None
    capacity: PositiveInt
    source: BusSource
    assigned_trip_id: NonEmptyAdditionalTripId | None
    proposed_trip_id: NonEmptyAdditionalTripId | None


class TripBus(ApiSchema):
    id: NonEmptyBusId


class TripProgress(ApiSchema):
    percent_complete: UnitInterval


class AdditionalTrip(ApiSchema):
    id: NonEmptyAdditionalTripId
    surge_id: NonEmptySurgeId
    hub_id: NonEmptyHubId | None
    bus: TripBus
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


class DetailBus(TripBus):
    current_location: GeoPoint


class DetailProgress(TripProgress):
    current_stop_id: NonEmptyText | None
    next_stop_id: NonEmptyText | None


class TripDetail(AdditionalTrip):
    bus: DetailBus
    surge: Surge
    progress: DetailProgress


class StateSnapshot(ApiSchema):
    epoch: Epoch
    last_seq: NonNegativeInt
    simulation: Clock
    hubs: tuple[HubStatus, ...]
    surges: tuple[Surge, ...]
    buses: tuple[Bus, ...]
    additional_trips: tuple[AdditionalTrip, ...]

    @model_validator(mode="after")
    def matching_epoch(self) -> Self:
        if self.epoch != self.simulation.epoch:
            raise ValueError("snapshot and simulation epochs must match")
        return self
