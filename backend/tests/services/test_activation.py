from datetime import datetime, timedelta, timezone

from app.config import Settings
from app.data.adapters import FixtureEventSource
from app.data.models import group_event_rows
from app.data.reader import EventReader
from app.domain.events import EventType
from app.domain.models import DispatchEvent
from app.repositories.memory import entities_from
from app.services import (
    EventActivationService,
    FakeMonotonicTimeSource,
    InMemoryEventSink,
    MutationCoordinator,
    SimulationClockController,
    initial_clock,
)

PACIFIC = timezone(-timedelta(hours=7))
START = datetime(2026, 7, 10, 9, tzinfo=PACIFIC)
END = datetime(2026, 7, 10, 15, tzinfo=PACIFIC)


def make_runtime() -> tuple[
    SimulationClockController,
    FakeMonotonicTimeSource,
    MutationCoordinator,
    InMemoryEventSink,
    EventActivationService,
]:
    reader = EventReader(FixtureEventSource("test-v1").load_window(START, END))
    settings = Settings(
        simulation_min_time=START,
        simulation_start_time=START,
        simulation_max_time=END,
        simulation_speed=3600,
    )
    sink = InMemoryEventSink()
    coordinator = MutationCoordinator(
        sink,
        initial_clock(settings, coverage_start=START, coverage_end=END),
        entities_from(),
    )
    time_source = FakeMonotonicTimeSource()
    clock = SimulationClockController(coordinator, time_source)
    activation = EventActivationService(reader, coordinator, clock)
    activation.start()
    return clock, time_source, coordinator, sink, activation


def activated_events(sink: InMemoryEventSink) -> list[DispatchEvent]:
    return [
        event.data
        for event in sink.events()
        if event.type is EventType.DISPATCH_EVENT_UPDATED
        and isinstance(event.data, DispatchEvent)
    ]


def test_high_speed_jump_activates_events_once_in_canonical_order() -> None:
    clock, time_source, coordinator, sink, activation = make_runtime()
    assert coordinator.snapshot().entities.dispatch_events.list() == ()

    activation.start()
    clock.resume()
    time_source.advance(5)
    clock.pump()

    assert [event.id for event in activated_events(sink)] == [
        "valid-event",
        "too-many-buses",
        "same-time-a",
        "same-time-b",
    ]
    assert len(coordinator.snapshot().entities.dispatch_events.list()) == 4


def test_seek_rebuilds_only_events_actionable_through_target() -> None:
    clock, _, coordinator, sink, _ = make_runtime()

    clock.seek(datetime(2026, 7, 10, 9, 30, tzinfo=PACIFIC))
    assert [
        event.id for event in coordinator.snapshot().entities.dispatch_events.list()
    ] == ["valid-event"]

    clock.seek(START)
    assert coordinator.snapshot().entities.dispatch_events.list() == ()
    clock.seek(datetime(2026, 7, 10, 13, tzinfo=PACIFIC))

    assert sum(event.id == "valid-event" for event in activated_events(sink)) == 2
    assert coordinator.snapshot().epoch == 3


def test_initial_time_event_is_activated_without_registering_past_boundary() -> None:
    reader = EventReader(FixtureEventSource("test-v1").load_window(START, END))
    start = datetime(2026, 7, 10, 9, 30, tzinfo=PACIFIC)
    settings = Settings(
        simulation_min_time=START,
        simulation_start_time=start,
        simulation_max_time=END,
    )
    sink = InMemoryEventSink()
    coordinator = MutationCoordinator(sink, initial_clock(settings), entities_from())
    clock = SimulationClockController(coordinator, FakeMonotonicTimeSource())

    EventActivationService(reader, coordinator, clock).start()

    assert [event.id for event in activated_events(sink)] == ["valid-event"]


def test_empty_event_window_has_no_activation_work() -> None:
    reader = EventReader(group_event_rows([], START, END))
    settings = Settings(
        simulation_min_time=START,
        simulation_start_time=START,
        simulation_max_time=END,
    )
    sink = InMemoryEventSink()
    coordinator = MutationCoordinator(sink, initial_clock(settings), entities_from())
    clock = SimulationClockController(coordinator, FakeMonotonicTimeSource())

    EventActivationService(reader, coordinator, clock).start()

    assert coordinator.snapshot().entities.dispatch_events.list() == ()
    assert activated_events(sink) == []
