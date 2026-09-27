from app.domain import models


def serialize_clock(value: models.SimulationClock) -> models.SimulationClock:
    return value


def serialize_bus(value: models.Bus) -> models.Bus:
    return value


def serialize_additional_trip(value: models.AdditionalTrip) -> models.AdditionalTrip:
    return value
