from app.domain import models
from app.domain.types import VancouverDateTime
from app.services.movement import project_bus


def serialize_clock(value: models.SimulationClock) -> models.SimulationClock:
    return value


def serialize_bus(
    value: models.Bus,
    trip: models.AdditionalTrip | None = None,
    at: VancouverDateTime | None = None,
) -> models.Bus:
    return project_bus(value, trip, at) if at is not None else value


def serialize_additional_trip(value: models.AdditionalTrip) -> models.AdditionalTrip:
    return value
