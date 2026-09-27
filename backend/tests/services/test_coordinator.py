from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier
from typing import cast

import pytest

from app.domain.events import EventType, PendingEvent
from app.domain.models import AdditionalTrip, Bus, BusStatus, Surge
from app.domain.types import AdditionalTripId, BusId
from app.repositories import ReadRepository, StateEditor, entities_from
from app.services import (
    EpochConflictError,
    InMemoryEventSink,
    Mutation,
    MutationCoordinator,
)
from tests.domain.test_models import bus_payload, surge_payload, trip_payload

NOW = datetime(2026, 7, 1, 10, tzinfo=timezone(-timedelta(hours=7)))


def make_bus(*, reserved_for: str | None = None) -> Bus:
    payload = bus_payload()
    payload["status"] = "RESERVED" if reserved_for else "AVAILABLE"
    payload["proposed_trip_id"] = reserved_for
    return Bus.model_validate(payload)


def make_surge(*trip_ids: str) -> Surge:
    payload = surge_payload()
    payload["additional_trip_ids"] = list(trip_ids)
    return Surge.model_validate(payload)


def make_trip(trip_id: str = "trip-1") -> AdditionalTrip:
    payload = trip_payload()
    payload["id"] = trip_id
    return AdditionalTrip.model_validate(payload)


def proposal_events(
    trip: AdditionalTrip, bus: Bus, surge: Surge
) -> tuple[PendingEvent, ...]:
    return (
        PendingEvent(
            type=EventType.DISPATCH_PROPOSED,
            simulation_time=NOW,
            data=trip,
        ),
        PendingEvent(type=EventType.BUS_UPDATED, simulation_time=NOW, data=bus),
        PendingEvent(type=EventType.SURGE_UPDATED, simulation_time=NOW, data=surge),
    )


def test_repository_reads_are_deterministic_and_protocol_typed() -> None:
    bus_b = make_bus().model_copy(update={"id": "bus-b"})
    bus_a = make_bus().model_copy(update={"id": "bus-a"})
    state = entities_from(buses=(bus_b, bus_a))
    repository: ReadRepository[BusId, Bus] = state.buses

    assert [bus.id for bus in repository.list()] == ["bus-a", "bus-b"]
    assert repository.get(BusId("missing")) is None


def test_atomic_proposal_commit_sequences_events_and_snapshot() -> None:
    sink = InMemoryEventSink()
    coordinator = MutationCoordinator(
        sink, entities_from(buses=(make_bus(),), surges=(make_surge(),))
    )

    def propose(state: StateEditor) -> Mutation[str]:
        trip = make_trip()
        bus = make_bus(reserved_for="trip-1")
        surge = make_surge("trip-1")
        state.put_trip(trip)
        state.put_bus(bus)
        state.put_surge(surge)
        return Mutation("created", proposal_events(trip, bus, surge))

    assert coordinator.mutate(propose, expected_epoch=0) == "created"
    snapshot = coordinator.snapshot()

    assert snapshot.last_seq == 3
    assert snapshot.entities.trips.get(AdditionalTripId("trip-1")) is not None
    assert [event.seq for event in sink.events()] == [1, 2, 3]
    assert [event.type for event in sink.events()] == [
        EventType.DISPATCH_PROPOSED,
        EventType.BUS_UPDATED,
        EventType.SURGE_UPDATED,
    ]


def test_failed_transaction_rolls_back_state_events_and_sequence() -> None:
    sink = InMemoryEventSink()
    coordinator = MutationCoordinator(
        sink, entities_from(buses=(make_bus(),), surges=(make_surge(),))
    )

    def invalid(state: StateEditor) -> Mutation[None]:
        state.put_trip(make_trip())
        raise RuntimeError("candidate construction failed")

    with pytest.raises(RuntimeError, match="construction failed"):
        coordinator.mutate(invalid)

    snapshot = coordinator.snapshot()
    assert snapshot.entities.trips.list() == ()
    assert snapshot.last_seq == 0
    assert sink.events() == ()


def test_cross_entity_failure_emits_nothing() -> None:
    sink = InMemoryEventSink()
    coordinator = MutationCoordinator(
        sink, entities_from(buses=(make_bus(),), surges=(make_surge(),))
    )

    def broken(state: StateEditor) -> Mutation[None]:
        state.put_trip(make_trip())
        return Mutation(None)

    with pytest.raises(ValueError, match="not linked"):
        coordinator.mutate(broken)

    assert coordinator.snapshot().entities.trips.list() == ()
    assert sink.events() == ()


def test_concurrent_proposals_cannot_reserve_one_bus_twice() -> None:
    sink = InMemoryEventSink()
    coordinator = MutationCoordinator(
        sink, entities_from(buses=(make_bus(),), surges=(make_surge(),))
    )
    start = Barrier(3)

    def compete(trip_id: str) -> str:
        start.wait()

        def reserve(state: StateEditor) -> Mutation[str]:
            bus = state.bus(BusId("bus-1"))
            if bus is None or bus.status is not BusStatus.AVAILABLE:
                raise RuntimeError("bus already reserved")
            trip = make_trip(trip_id)
            reserved = make_bus(reserved_for=trip_id)
            surge = make_surge(trip_id)
            state.put_trip(trip)
            state.put_bus(reserved)
            state.put_surge(surge)
            return Mutation(trip_id, proposal_events(trip, reserved, surge))

        return coordinator.mutate(reserve)

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(compete, "trip-a")
        second = executor.submit(compete, "trip-b")
        start.wait()
        outcomes: list[str] = []
        failures = 0
        for future in (first, second):
            try:
                outcomes.append(future.result())
            except RuntimeError as exc:
                assert str(exc) == "bus already reserved"
                failures += 1

    assert len(outcomes) == 1
    assert failures == 1
    assert len(coordinator.snapshot().entities.trips.list()) == 1
    assert len(sink.events()) == 3


def test_epoch_is_checked_before_operation_and_sequence_continues_after_swap() -> None:
    sink = InMemoryEventSink()
    initial = entities_from(buses=(make_bus(),), surges=(make_surge(),))
    coordinator = MutationCoordinator(sink, initial)
    called = False

    def should_not_run(editor: StateEditor) -> Mutation[None]:
        del editor
        nonlocal called
        called = True
        return Mutation(None)

    with pytest.raises(EpochConflictError):
        coordinator.mutate(should_not_run, expected_epoch=4)
    assert not called

    replaced = coordinator.replace_state(initial, simulation_time=NOW, expected_epoch=0)
    assert replaced.epoch == 1
    assert replaced.last_seq == 1
    assert sink.events()[0].type is EventType.STATE_RESET
    assert sink.events()[0].epoch == 1

    coordinator.mutate(
        lambda editor: Mutation(
            None,
            (
                PendingEvent(
                    type=EventType.BUS_UPDATED,
                    simulation_time=NOW,
                    data=cast(Bus, editor.bus(BusId("bus-1"))),
                ),
            ),
        ),
        expected_epoch=1,
    )
    assert [event.seq for event in sink.events()] == [1, 2]


def test_sink_failure_rolls_back_committed_candidate() -> None:
    class FailingSink:
        def publish(self, events: object) -> None:
            del events
            raise RuntimeError("sink unavailable")

    coordinator = MutationCoordinator(
        FailingSink(), entities_from(buses=(make_bus(),), surges=(make_surge(),))
    )

    def update(state: StateEditor) -> Mutation[None]:
        changed = make_bus().model_copy(update={"heading_deg": 90.0})
        state.put_bus(changed)
        return Mutation(
            None,
            (
                PendingEvent(
                    type=EventType.BUS_UPDATED,
                    simulation_time=NOW,
                    data=changed,
                ),
            ),
        )

    with pytest.raises(RuntimeError, match="sink unavailable"):
        coordinator.mutate(update)

    snapshot = coordinator.snapshot()
    assert snapshot.last_seq == 0
    bus = snapshot.entities.buses.get(BusId("bus-1"))
    assert bus is not None
    assert bus.heading_deg is None
