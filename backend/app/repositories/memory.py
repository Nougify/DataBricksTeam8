from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import TypeVar

from app.domain.models import AdditionalTrip, AdditionalTripStatus, Bus, DispatchEvent
from app.domain.types import AdditionalTripId, BusId, DispatchEventId

IdT = TypeVar("IdT")
EntityT = TypeVar("EntityT")


class InMemoryRepository[IdT, EntityT]:
    """Immutable deterministic repository view over one committed state."""

    def __init__(self, values: Mapping[IdT, EntityT]) -> None:
        self._values = MappingProxyType(dict(values))

    def get(self, entity_id: IdT) -> EntityT | None:
        return self._values.get(entity_id)

    def list(self) -> tuple[EntityT, ...]:
        return tuple(self._values[key] for key in sorted(self._values, key=str))

    def as_dict(self) -> dict[IdT, EntityT]:
        return dict(self._values)


@dataclass(frozen=True)
class SimulationEntities:
    buses: InMemoryRepository[BusId, Bus]
    dispatch_events: InMemoryRepository[DispatchEventId, DispatchEvent]
    trips: InMemoryRepository[AdditionalTripId, AdditionalTrip]

    @classmethod
    def empty(cls) -> SimulationEntities:
        return cls(
            buses=InMemoryRepository({}),
            dispatch_events=InMemoryRepository({}),
            trips=InMemoryRepository({}),
        )


class StateEditor:
    """Transaction-local writable state; never retained by the coordinator."""

    def __init__(self, state: SimulationEntities) -> None:
        self._buses = state.buses.as_dict()
        self._dispatch_events = state.dispatch_events.as_dict()
        self._trips = state.trips.as_dict()

    def bus(self, bus_id: BusId) -> Bus | None:
        return self._buses.get(bus_id)

    def dispatch_event(self, event_id: DispatchEventId) -> DispatchEvent | None:
        return self._dispatch_events.get(event_id)

    def trip(self, trip_id: AdditionalTripId) -> AdditionalTrip | None:
        return self._trips.get(trip_id)

    def buses(self) -> tuple[Bus, ...]:
        return tuple(self._buses[key] for key in sorted(self._buses, key=str))

    def put_bus(self, bus: Bus) -> None:
        self._buses[BusId(bus.id)] = bus

    def put_dispatch_event(self, event: DispatchEvent) -> None:
        self._dispatch_events[DispatchEventId(event.id)] = event

    def put_trip(self, trip: AdditionalTrip) -> None:
        self._trips[AdditionalTripId(trip.id)] = trip

    def remove_bus(self, bus_id: BusId) -> None:
        self._buses.pop(bus_id, None)

    def remove_dispatch_event(self, event_id: DispatchEventId) -> None:
        self._dispatch_events.pop(event_id, None)

    def remove_trip(self, trip_id: AdditionalTripId) -> None:
        self._trips.pop(trip_id, None)

    def freeze(self) -> SimulationEntities:
        state = SimulationEntities(
            buses=InMemoryRepository(self._buses),
            dispatch_events=InMemoryRepository(self._dispatch_events),
            trips=InMemoryRepository(self._trips),
        )
        validate_entities(state)
        return state


def entities_from(
    *,
    buses: Iterable[Bus] = (),
    dispatch_events: Iterable[DispatchEvent] = (),
    trips: Iterable[AdditionalTrip] = (),
) -> SimulationEntities:
    def indexed(
        values: Iterable[EntityT], key: Callable[[EntityT], IdT]
    ) -> dict[IdT, EntityT]:
        result: dict[IdT, EntityT] = {}
        for value in values:
            entity_id = key(value)
            if entity_id in result:
                raise ValueError(f"duplicate entity id: {entity_id}")
            result[entity_id] = value
        return result

    state = SimulationEntities(
        buses=InMemoryRepository(indexed(buses, lambda value: BusId(value.id))),
        dispatch_events=InMemoryRepository(
            indexed(dispatch_events, lambda value: DispatchEventId(value.id))
        ),
        trips=InMemoryRepository(
            indexed(trips, lambda value: AdditionalTripId(value.id))
        ),
    )
    validate_entities(state)
    return state


def validate_entities(state: SimulationEntities) -> None:
    active_statuses = {
        AdditionalTripStatus.PROPOSED,
        AdditionalTripStatus.APPROVED,
        AdditionalTripStatus.BUS_EN_ROUTE,
        AdditionalTripStatus.IN_SERVICE,
    }
    active_by_bus: dict[BusId, AdditionalTrip] = {}
    for trip in state.trips.list():
        bus_id = BusId(trip.bus_id)
        event_id = DispatchEventId(trip.dispatch_event_id)
        bus = state.buses.get(bus_id)
        event = state.dispatch_events.get(event_id)
        if bus is None:
            raise ValueError(f"trip {trip.id} references missing bus {bus_id}")
        if event is None:
            raise ValueError(f"trip {trip.id} references missing event {event_id}")
        if trip.id not in event.additional_trip_ids:
            raise ValueError(f"trip {trip.id} is not linked by event {event_id}")
        if (
            trip.status is AdditionalTripStatus.PROPOSED
            and bus.proposed_trip_id != trip.id
        ):
            raise ValueError(f"proposed trip {trip.id} lacks its bus reservation")
        if (
            trip.status
            in {
                AdditionalTripStatus.APPROVED,
                AdditionalTripStatus.BUS_EN_ROUTE,
                AdditionalTripStatus.IN_SERVICE,
            }
            and bus.assigned_trip_id != trip.id
        ):
            raise ValueError(f"active trip {trip.id} lacks its bus assignment")
        if trip.status in {
            AdditionalTripStatus.REJECTED,
            AdditionalTripStatus.EXPIRED,
            AdditionalTripStatus.CANCELLED,
        } and (bus.proposed_trip_id == trip.id or bus.assigned_trip_id == trip.id):
            raise ValueError(f"terminal trip {trip.id} still reserves its bus")
        if trip.status in active_statuses:
            if bus_id in active_by_bus:
                raise ValueError(f"bus {bus_id} has more than one active trip")
            active_by_bus[bus_id] = trip

    for event in state.dispatch_events.list():
        for trip_id in event.additional_trip_ids:
            event_trip = state.trips.get(AdditionalTripId(trip_id))
            if event_trip is None or event_trip.dispatch_event_id != event.id:
                raise ValueError(f"event {event.id} has invalid trip link {trip_id}")

    for bus in state.buses.list():
        linked_id = bus.proposed_trip_id or bus.assigned_trip_id
        if linked_id is None:
            continue
        linked_trip = state.trips.get(AdditionalTripId(linked_id))
        if linked_trip is None or linked_trip.bus_id != bus.id:
            raise ValueError(f"bus {bus.id} has invalid trip link {linked_id}")
        if (
            bus.proposed_trip_id is not None
            and linked_trip.status is not AdditionalTripStatus.PROPOSED
        ):
            raise ValueError("a proposed bus link must reference a proposed trip")
        if (
            bus.assigned_trip_id is not None
            and linked_trip.status is AdditionalTripStatus.PROPOSED
        ):
            raise ValueError("an assigned bus link cannot reference a proposed trip")
