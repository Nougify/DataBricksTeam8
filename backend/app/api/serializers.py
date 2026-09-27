from app.api.schemas import StateSnapshot
from app.domain import models
from app.domain.types import VancouverDateTime
from app.services.coordinator import CoordinatorSnapshot
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


def serialize_state(snapshot: CoordinatorSnapshot) -> StateSnapshot:
    at = snapshot.clock.current_time
    return StateSnapshot(
        epoch=snapshot.epoch,
        last_seq=snapshot.last_seq,
        simulation=snapshot.clock,
        dispatch_events=tuple(
            event
            for event in snapshot.entities.dispatch_events.list()
            if event.actionable_at <= at
        ),
        buses=tuple(
            serialize_bus(
                bus,
                snapshot.entities.trips.get(bus.assigned_trip_id)
                if bus.assigned_trip_id is not None
                else None,
                at,
            )
            for bus in snapshot.entities.buses.list()
        ),
        additional_trips=snapshot.entities.trips.list(),
    )
