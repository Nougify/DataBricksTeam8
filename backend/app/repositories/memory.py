from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import TypeVar

from app.domain.models import (
    AdditionalTrip,
    AdditionalTripStatus,
    Bus,
    DispatchDecision,
    Surge,
)
from app.domain.types import AdditionalTripId, BusId, SurgeId

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
    surges: InMemoryRepository[SurgeId, Surge]
    trips: InMemoryRepository[AdditionalTripId, AdditionalTrip]
    decisions: InMemoryRepository[SurgeId, DispatchDecision]

    @classmethod
    def empty(cls) -> SimulationEntities:
        return cls(
            buses=InMemoryRepository({}),
            surges=InMemoryRepository({}),
            trips=InMemoryRepository({}),
            decisions=InMemoryRepository({}),
        )


class StateEditor:
    """Transaction-local writable state; never retained by the coordinator."""

    def __init__(self, state: SimulationEntities) -> None:
        self._buses = state.buses.as_dict()
        self._surges = state.surges.as_dict()
        self._trips = state.trips.as_dict()
        self._decisions = state.decisions.as_dict()

    def bus(self, bus_id: BusId) -> Bus | None:
        return self._buses.get(bus_id)

    def surge(self, surge_id: SurgeId) -> Surge | None:
        return self._surges.get(surge_id)

    def trip(self, trip_id: AdditionalTripId) -> AdditionalTrip | None:
        return self._trips.get(trip_id)

    def decision(self, surge_id: SurgeId) -> DispatchDecision | None:
        return self._decisions.get(surge_id)

    def put_bus(self, bus: Bus) -> None:
        self._buses[BusId(bus.id)] = bus

    def put_surge(self, surge: Surge) -> None:
        self._surges[SurgeId(surge.id)] = surge

    def put_trip(self, trip: AdditionalTrip) -> None:
        self._trips[AdditionalTripId(trip.id)] = trip

    def put_decision(self, decision: DispatchDecision) -> None:
        self._decisions[SurgeId(decision.surge_id)] = decision

    def remove_bus(self, bus_id: BusId) -> None:
        self._buses.pop(bus_id, None)

    def remove_surge(self, surge_id: SurgeId) -> None:
        self._surges.pop(surge_id, None)

    def remove_trip(self, trip_id: AdditionalTripId) -> None:
        self._trips.pop(trip_id, None)

    def remove_decision(self, surge_id: SurgeId) -> None:
        self._decisions.pop(surge_id, None)

    def freeze(self) -> SimulationEntities:
        state = SimulationEntities(
            buses=InMemoryRepository(self._buses),
            surges=InMemoryRepository(self._surges),
            trips=InMemoryRepository(self._trips),
            decisions=InMemoryRepository(self._decisions),
        )
        validate_entities(state)
        return state


def entities_from(
    *,
    buses: Iterable[Bus] = (),
    surges: Iterable[Surge] = (),
    trips: Iterable[AdditionalTrip] = (),
    decisions: Iterable[DispatchDecision] = (),
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
        surges=InMemoryRepository(indexed(surges, lambda value: SurgeId(value.id))),
        trips=InMemoryRepository(
            indexed(trips, lambda value: AdditionalTripId(value.id))
        ),
        decisions=InMemoryRepository(
            indexed(decisions, lambda value: SurgeId(value.surge_id))
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
        bus_id = BusId(trip.bus.id)
        surge_id = SurgeId(trip.surge_id)
        bus = state.buses.get(bus_id)
        surge = state.surges.get(surge_id)
        if bus is None:
            raise ValueError(f"trip {trip.id} references missing bus {bus_id}")
        if surge is None:
            raise ValueError(f"trip {trip.id} references missing surge {surge_id}")
        if trip.id not in surge.additional_trip_ids:
            raise ValueError(f"trip {trip.id} is not linked by surge {surge_id}")
        if trip.status in active_statuses:
            if bus_id in active_by_bus:
                raise ValueError(f"bus {bus_id} has more than one active trip")
            active_by_bus[bus_id] = trip

    for surge in state.surges.list():
        for trip_id in surge.additional_trip_ids:
            surge_trip = state.trips.get(AdditionalTripId(trip_id))
            if surge_trip is None or surge_trip.surge_id != surge.id:
                raise ValueError(f"surge {surge.id} has invalid trip link {trip_id}")

    for bus in state.buses.list():
        linked_id = bus.proposed_trip_id or bus.assigned_trip_id
        if linked_id is None:
            continue
        linked_trip = state.trips.get(AdditionalTripId(linked_id))
        if linked_trip is None or linked_trip.bus.id != bus.id:
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

    for decision in state.decisions.list():
        if state.surges.get(SurgeId(decision.surge_id)) is None:
            raise ValueError(f"decision references missing surge {decision.surge_id}")
