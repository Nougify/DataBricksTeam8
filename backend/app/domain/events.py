from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import Field, model_validator

from app.domain.models import (
    AdditionalTrip,
    Bus,
    DispatchEvent,
    DomainModel,
    SimulationClock,
)
from app.domain.types import (
    Epoch,
    NonEmptyText,
    SequenceNumber,
    VancouverDateTime,
)


class EventType(StrEnum):
    CLOCK_UPDATED = "clock.updated"
    DISPATCH_EVENT_UPDATED = "dispatch_event.updated"
    PROPOSAL_CREATED = "proposal.created"
    PROPOSAL_UPDATED = "proposal.updated"
    TRIP_UPDATED = "trip.updated"
    BUS_UPDATED = "bus.updated"
    SYSTEM_RESET = "system.reset"
    SYSTEM_ERROR = "system.error"


class StateChangeReason(StrEnum):
    PAUSED = "PAUSED"
    RESUMED = "RESUMED"
    SPEED = "SPEED"
    SETTINGS = "SETTINGS"
    AUTO_PAUSE_PROPOSAL = "AUTO_PAUSE_PROPOSAL"


class StateChangedData(SimulationClock):
    reason: StateChangeReason | None = None


class StateResetData(DomainModel):
    epoch: Epoch
    reason: Literal["SEEK"] = "SEEK"


class SystemErrorData(DomainModel):
    message: NonEmptyText


EventData = (
    StateChangedData
    | StateResetData
    | SystemErrorData
    | DispatchEvent
    | AdditionalTrip
    | Bus
)


class PendingEvent(DomainModel):
    type: EventType
    simulation_time: VancouverDateTime
    data: EventData

    @model_validator(mode="after")
    def matching_payload(self) -> Self:
        expected: dict[EventType, type[DomainModel]] = {
            EventType.CLOCK_UPDATED: StateChangedData,
            EventType.DISPATCH_EVENT_UPDATED: DispatchEvent,
            EventType.PROPOSAL_CREATED: AdditionalTrip,
            EventType.PROPOSAL_UPDATED: AdditionalTrip,
            EventType.TRIP_UPDATED: AdditionalTrip,
            EventType.BUS_UPDATED: Bus,
            EventType.SYSTEM_RESET: StateResetData,
            EventType.SYSTEM_ERROR: SystemErrorData,
        }
        if not isinstance(self.data, expected[self.type]):
            raise ValueError(f"{self.type} has an incompatible payload")
        return self


class SequencedEvent(PendingEvent):
    seq: Annotated[SequenceNumber, Field(gt=0)]
    epoch: Epoch
