from app.domain.models import (
    AdditionalTripStatus,
    DispatchEvent,
    EventStatus,
)
from app.domain.types import AdditionalTripId
from app.repositories.memory import StateEditor


def aggregate_dispatch_event(
    editor: StateEditor, event: DispatchEvent
) -> DispatchEvent:
    trips = tuple(
        trip
        for trip_id in event.additional_trip_ids
        if (trip := editor.trip(AdditionalTripId(trip_id))) is not None
    )
    statuses = {trip.status for trip in trips}
    active = {
        AdditionalTripStatus.APPROVED,
        AdditionalTripStatus.BUS_EN_ROUTE,
        AdditionalTripStatus.IN_SERVICE,
    }
    if statuses & active:
        status = EventStatus.DISPATCHED
    elif AdditionalTripStatus.COMPLETED in statuses:
        status = (
            EventStatus.DISPATCHED
            if AdditionalTripStatus.PROPOSED in statuses
            else EventStatus.COMPLETED
        )
    elif AdditionalTripStatus.PROPOSED in statuses:
        status = EventStatus.AWAITING_APPROVAL
    elif AdditionalTripStatus.REJECTED in statuses:
        status = EventStatus.REJECTED
    elif AdditionalTripStatus.EXPIRED in statuses:
        status = EventStatus.EXPIRED
    else:
        status = EventStatus.NO_BUS_AVAILABLE
    return event.model_copy(update={"status": status})
