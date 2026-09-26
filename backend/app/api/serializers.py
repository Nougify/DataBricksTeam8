from app.api import schemas
from app.domain import models


def serialize_clock(value: models.SimulationClock) -> schemas.Clock:
    return schemas.Clock.model_validate(value.model_dump())


def serialize_hub_status(value: models.HubStatus) -> schemas.HubStatus:
    return schemas.HubStatus.model_validate(value.model_dump())


def serialize_surge(value: models.Surge) -> schemas.Surge:
    return schemas.Surge.model_validate(value.model_dump())


def serialize_bus(value: models.Bus) -> schemas.Bus:
    return schemas.Bus.model_validate(value.model_dump())


def serialize_additional_trip(value: models.AdditionalTrip) -> schemas.AdditionalTrip:
    return schemas.AdditionalTrip.model_validate(value.model_dump())


def serialize_trip_detail(
    trip: models.AdditionalTrip,
    *,
    bus: models.Bus,
    surge: models.Surge,
    current_stop_id: str | None,
    next_stop_id: str | None,
) -> schemas.TripDetail:
    payload = serialize_additional_trip(trip).model_dump()
    payload["bus"] = {"id": bus.id, "current_location": bus.location}
    payload["surge"] = serialize_surge(surge).model_dump()
    payload["progress"] = {
        "percent_complete": trip.progress.percent_complete,
        "current_stop_id": current_stop_id,
        "next_stop_id": next_stop_id,
    }
    return schemas.TripDetail.model_validate(payload)
