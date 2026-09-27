from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import Field, model_validator

from app.domain.models import (
    AdditionalTrip,
    Bus,
    BusStatus,
    DomainModel,
    GeoPoint,
    HubStatus,
    SimulationClock,
    Surge,
)
from app.domain.types import (
    Epoch,
    Heading,
    Hour,
    NonEmptyBusId,
    SequenceNumber,
    VancouverDateTime,
)


class EventType(StrEnum):
    SIMULATION_TICK = "simulation.tick"
    SIMULATION_STATE_CHANGED = "simulation.state_changed"
    STATE_RESET = "state.reset"
    SURGE_UPDATED = "surge.updated"
    DISPATCH_PROPOSED = "dispatch.proposed"
    DISPATCH_APPROVED = "dispatch.approved"
    DISPATCH_REJECTED = "dispatch.rejected"
    TRIP_UPDATED = "trip.updated"
    BUS_UPDATED = "bus.updated"
    BUS_POSITIONS_UPDATED = "bus.positions_updated"
    HUB_DEMAND_UPDATED = "hub.demand_updated"


class StateChangeReason(StrEnum):
    PAUSED = "PAUSED"
    RESUMED = "RESUMED"
    SPEED = "SPEED"
    SETTINGS = "SETTINGS"
    AUTO_PAUSE_PROPOSAL = "AUTO_PAUSE_PROPOSAL"


class TickData(DomainModel):
    current_time: VancouverDateTime
    local_date: date
    hour: Hour


class StateChangedData(SimulationClock):
    reason: StateChangeReason


class StateResetData(DomainModel):
    epoch: Epoch
    reason: Literal["SEEK"] = "SEEK"


class BusPosition(DomainModel):
    bus_id: NonEmptyBusId
    location: GeoPoint
    heading_deg: Heading | None
    status: BusStatus


class BusPositionsData(DomainModel):
    positions: tuple[BusPosition, ...]


EventData = (
    TickData
    | StateChangedData
    | StateResetData
    | Surge
    | AdditionalTrip
    | Bus
    | BusPositionsData
    | HubStatus
)


class PendingEvent(DomainModel):
    type: EventType
    simulation_time: VancouverDateTime
    data: EventData

    @model_validator(mode="after")
    def matching_payload(self) -> Self:
        expected: dict[EventType, type[DomainModel]] = {
            EventType.SIMULATION_TICK: TickData,
            EventType.SIMULATION_STATE_CHANGED: StateChangedData,
            EventType.STATE_RESET: StateResetData,
            EventType.SURGE_UPDATED: Surge,
            EventType.DISPATCH_PROPOSED: AdditionalTrip,
            EventType.DISPATCH_APPROVED: AdditionalTrip,
            EventType.DISPATCH_REJECTED: AdditionalTrip,
            EventType.TRIP_UPDATED: AdditionalTrip,
            EventType.BUS_UPDATED: Bus,
            EventType.BUS_POSITIONS_UPDATED: BusPositionsData,
            EventType.HUB_DEMAND_UPDATED: HubStatus,
        }
        if not isinstance(self.data, expected[self.type]):
            raise ValueError(f"{self.type} has an incompatible payload")
        return self


class SequencedEvent(PendingEvent):
    seq: Annotated[SequenceNumber, Field(gt=0)]
    epoch: Epoch
