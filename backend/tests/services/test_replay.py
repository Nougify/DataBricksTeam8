from collections.abc import Callable
from datetime import datetime

import pytest

from app.config import Settings
from app.data.adapters import FixtureEventSource
from app.data.models import EventWindow
from app.data.store import IntegrationStatus
from app.domain.decisions import HumanDecisionAction, pending_decision
from app.domain.events import EventType
from app.domain.models import AdditionalTripStatus, BusStatus, EventStatus
from app.domain.types import AdditionalTripId, BusId, DispatchEventId
from app.services import (
    EpochConflictError,
    Mutation,
    ReplayConflictError,
    ReplayDataError,
)
from tests.services.test_movement import advance_seconds
from tests.services.test_proposals import (
    END,
    PACIFIC,
    START,
    activate_first_event,
    make_runtime,
)


def test_seek_rebuilds_pending_proposals_at_original_activation_time() -> None:
    runtime = make_runtime()
    activate_first_event(runtime)
    before_events = len(runtime.sink.events())
    target = datetime(2026, 7, 10, 9, 45, tzinfo=PACIFIC)

    clock = runtime.clock.seek(target)
    snapshot = runtime.coordinator.snapshot()
    trips = snapshot.entities.trips.list()

    assert clock.current_time == target
    assert clock.status.value == "PAUSED"
    assert snapshot.epoch == 1
    assert len(trips) == 2
    assert {trip.status for trip in trips} == {AdditionalTripStatus.PROPOSED}
    assert {trip.proposed_at.hour for trip in trips} == {9}
    assert {trip.proposed_at.minute for trip in trips} == {30}
    assert {trip.approval_expires_at.hour for trip in trips} == {10}
    assert all(
        snapshot.entities.buses.get(trip.bus_id).status is BusStatus.RESERVED  # type: ignore[union-attr]
        for trip in trips
    )
    assert [event.type for event in runtime.sink.events()[before_events:]] == [
        EventType.SYSTEM_RESET
    ]

    runtime.clock.resume()
    advance_seconds(runtime, 15 * 60)
    assert {
        trip.status for trip in runtime.coordinator.snapshot().entities.trips.list()
    } == {AdditionalTripStatus.EXPIRED}


def test_seek_replays_recorded_decisions_and_in_flight_movement() -> None:
    runtime = make_runtime()
    activate_first_event(runtime)
    original = runtime.coordinator.snapshot().entities.trips.list()
    approved_id = original[0].id
    runtime.proposals.approve(approved_id)
    runtime.proposals.reject(original[1].id)
    decision_snapshot = runtime.coordinator.snapshot()
    before_seq = decision_snapshot.last_seq
    before_events = len(runtime.sink.events())
    target = datetime(2026, 7, 10, 10, 10, tzinfo=PACIFIC)

    runtime.clock.seek(target)
    snapshot = runtime.coordinator.snapshot()
    approved = snapshot.entities.trips.get(approved_id)
    event = snapshot.entities.dispatch_events.get(DispatchEventId("valid-event"))

    assert approved is not None
    assert approved.status is AdditionalTripStatus.IN_SERVICE
    bus = snapshot.entities.buses.get(approved.bus_id)
    assert bus is not None and bus.status is BusStatus.IN_SERVICE
    assert len(snapshot.decisions) == 2
    assert snapshot.last_seq == before_seq + 1
    assert [event.type for event in runtime.sink.events()[before_events:]] == [
        EventType.SYSTEM_RESET
    ]
    assert event is not None and event.status is EventStatus.DISPATCHED


def test_backward_seek_discards_later_decisions() -> None:
    runtime = make_runtime()
    activate_first_event(runtime)
    trips = runtime.coordinator.snapshot().entities.trips.list()
    runtime.proposals.approve(trips[0].id)
    runtime.proposals.reject(trips[1].id)

    runtime.clock.seek(START)
    snapshot = runtime.coordinator.snapshot()

    assert snapshot.entities.dispatch_events.list() == ()
    assert snapshot.entities.trips.list() == ()
    assert snapshot.decisions == ()

    runtime.clock.seek(datetime(2026, 7, 10, 10, 10, tzinfo=PACIFIC))
    replayed = runtime.coordinator.snapshot()
    assert {trip.status for trip in replayed.entities.trips.list()} == {
        AdditionalTripStatus.EXPIRED
    }


def test_same_target_replay_is_stable_and_continues_future_movement() -> None:
    runtime = make_runtime(
        Settings(
            simulation_min_time=START,
            simulation_start_time=START,
            simulation_max_time=END,
            event_window_start=START,
            event_window_end=END,
            simulation_speed=3600,
            approval_mode="AUTOMATIC",
        )
    )
    target = datetime(2026, 7, 10, 10, 10, tzinfo=PACIFIC)

    runtime.clock.seek(target)
    first = runtime.coordinator.snapshot()
    runtime.clock.seek(target)
    second = runtime.coordinator.snapshot()

    assert (
        first.entities.dispatch_events.list() == second.entities.dispatch_events.list()
    )
    assert first.entities.trips.list() == second.entities.trips.list()
    assert first.entities.buses.list() == second.entities.buses.list()
    assert second.epoch == first.epoch + 1
    assert second.last_seq == first.last_seq + 1

    runtime.clock.resume()
    advance_seconds(runtime, 80 * 60)
    completed = runtime.coordinator.snapshot()
    first_trip = completed.entities.trips.list()[0]
    bus = completed.entities.buses.get(first_trip.bus_id)
    assert first_trip.status is AdditionalTripStatus.COMPLETED
    assert bus is not None and bus.status is BusStatus.AVAILABLE


class ReloadingFixtureSource:
    mode = FixtureEventSource("test-v1").mode

    def __init__(self) -> None:
        self.calls = 0
        self.fail = False
        self.on_load: Callable[[], None] | None = None
        self.delegate = FixtureEventSource("test-v1")

    def load_window(self, start: datetime, end: datetime) -> EventWindow:
        self.calls += 1
        if self.fail:
            raise RuntimeError("source unavailable")
        if self.on_load is not None:
            self.on_load()
        return self.delegate.load_window(start, end)


def test_seek_atomically_loads_a_window_outside_cached_coverage() -> None:
    source = ReloadingFixtureSource()
    narrow_end = datetime(2026, 7, 10, 10, tzinfo=PACIFIC)
    runtime = make_runtime(source=source, window_end=narrow_end)
    target = datetime(2026, 7, 10, 12, tzinfo=PACIFIC)

    runtime.clock.seek(target)

    assert source.calls == 2
    assert runtime.data.reader().window.metadata.window_end == END
    assert [
        event.id
        for event in runtime.coordinator.snapshot().entities.dispatch_events.list()
    ] == ["too-many-buses", "unknown-route", "valid-event"]


def test_failed_window_reload_preserves_state_epoch_and_reader() -> None:
    source = ReloadingFixtureSource()
    narrow_end = datetime(2026, 7, 10, 10, tzinfo=PACIFIC)
    runtime = make_runtime(source=source, window_end=narrow_end)
    before = runtime.coordinator.snapshot()
    reader = runtime.data.reader()
    source.fail = True

    with pytest.raises(ReplayDataError, match="reload failed"):
        runtime.clock.seek(datetime(2026, 7, 10, 12, tzinfo=PACIFIC))

    after = runtime.coordinator.snapshot()
    assert after == before
    assert runtime.data.reader() is reader
    assert runtime.data.status is IntegrationStatus.DEGRADED
    assert runtime.data.last_error == "source unavailable"


def test_seek_rejects_exclusive_window_end_without_mutating_state() -> None:
    runtime = make_runtime()
    before = runtime.coordinator.snapshot()

    with pytest.raises(ReplayDataError, match="does not cover"):
        runtime.clock.seek(END)

    assert runtime.coordinator.snapshot() == before


def test_replay_conflict_preserves_live_state() -> None:
    runtime = make_runtime()
    decided_at = datetime(2026, 7, 10, 9, 15, tzinfo=PACIFIC)
    invalid = pending_decision(
        trip_id=AdditionalTripId("missing-trip"),
        dispatch_event_id=DispatchEventId("valid-event"),
        bus_id=BusId("bus-01"),
        action=HumanDecisionAction.APPROVE,
        decided_at=decided_at,
    )
    runtime.coordinator.transact(
        lambda editor, clock: Mutation(
            None,
            decisions=(invalid,),
        )
    )
    before = runtime.coordinator.snapshot()

    with pytest.raises(ReplayConflictError, match="does not match"):
        runtime.clock.seek(datetime(2026, 7, 10, 10, tzinfo=PACIFIC))

    assert runtime.coordinator.snapshot() == before


def test_concurrent_decision_is_not_overwritten_by_replay_commit() -> None:
    source = ReloadingFixtureSource()
    narrow_end = datetime(2026, 7, 10, 10, 30, tzinfo=PACIFIC)
    runtime = make_runtime(source=source, window_end=narrow_end)
    activate_first_event(runtime)
    trip = runtime.coordinator.snapshot().entities.trips.list()[0]

    def reject_during_load() -> None:
        runtime.proposals.reject(trip.id)

    source.on_load = reject_during_load

    with pytest.raises(EpochConflictError, match="revision"):
        runtime.clock.seek(datetime(2026, 7, 10, 12, tzinfo=PACIFIC))

    snapshot = runtime.coordinator.snapshot()
    rejected = snapshot.entities.trips.get(trip.id)
    assert rejected is not None
    assert rejected.status is AdditionalTripStatus.REJECTED
    assert snapshot.epoch == 0
    assert len(snapshot.decisions) == 1
