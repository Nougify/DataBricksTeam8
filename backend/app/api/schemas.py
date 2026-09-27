from typing import Self

from pydantic import BaseModel, ConfigDict, model_validator

from app.domain.models import (
    AdditionalTrip,
    Bus,
    DispatchEvent,
    SimulationClock,
)
from app.domain.types import Epoch, NonNegativeInt


class ApiSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


Clock = SimulationClock


class StateSnapshot(ApiSchema):
    epoch: Epoch
    last_seq: NonNegativeInt
    simulation: SimulationClock
    dispatch_events: tuple[DispatchEvent, ...]
    buses: tuple[Bus, ...]
    additional_trips: tuple[AdditionalTrip, ...]

    @model_validator(mode="after")
    def matching_epoch(self) -> Self:
        if self.epoch != self.simulation.epoch:
            raise ValueError("snapshot and simulation epochs must match")
        return self


__all__ = [
    "AdditionalTrip",
    "Bus",
    "Clock",
    "DispatchEvent",
    "StateSnapshot",
]
