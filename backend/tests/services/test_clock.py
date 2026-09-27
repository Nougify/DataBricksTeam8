from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.config import AllowedSimulationSpeed, Settings
from app.domain.events import EventType, StateChangedData, StateChangeReason
from app.domain.models import ClockStatus, SimulationClock
from app.services import (
    BoundaryPriority,
    BoundaryResult,
    FakeMonotonicTimeSource,
    InMemoryEventSink,
    MutationCoordinator,
    SimulationClockController,
    initial_clock,
)

PACIFIC = timezone(-timedelta(hours=7))
START = datetime(2026, 7, 1, 10, tzinfo=PACIFIC)


def make_controller(
    *,
    start: datetime = START,
    maximum: datetime | None = None,
    speed: AllowedSimulationSpeed = 1,
    auto_pause: bool = True,
) -> tuple[SimulationClockController, FakeMonotonicTimeSource, InMemoryEventSink]:
    settings = Settings(
        simulation_min_time=start - timedelta(days=1),
        simulation_start_time=start,
        simulation_max_time=maximum or start + timedelta(days=1),
        simulation_speed=speed,
        auto_pause_on_proposal=auto_pause,
    )
    sink = InMemoryEventSink()
    coordinator = MutationCoordinator(sink, initial_clock(settings))
    source = FakeMonotonicTimeSource()
    return SimulationClockController(coordinator, source), source, sink


def state_reasons(sink: InMemoryEventSink) -> list[StateChangeReason]:
    return [
        event.data.reason
        for event in sink.events()
        if isinstance(event.data, StateChangedData)
    ]


def test_clock_starts_paused_manual_and_controls_are_idempotent() -> None:
    controller, source, sink = make_controller()

    clock = controller.clock
    assert clock.current_time == START
    assert clock.status is ClockStatus.PAUSED
    assert clock.approval_mode == "MANUAL"

    source.advance(30)
    assert controller.pump().current_time == START
    assert controller.pause().status is ClockStatus.PAUSED
    assert sink.events() == ()

    assert controller.resume().status is ClockStatus.RUNNING
    assert controller.resume().status is ClockStatus.RUNNING
    assert controller.pause().status is ClockStatus.PAUSED
    assert controller.pause().status is ClockStatus.PAUSED
    assert state_reasons(sink) == [
        StateChangeReason.RESUMED,
        StateChangeReason.PAUSED,
    ]


@pytest.mark.parametrize("speed", [1, 60, 300, 900, 3600])
def test_all_allowed_speeds_advance_elapsed_instants(
    speed: AllowedSimulationSpeed,
) -> None:
    controller, source, sink = make_controller(speed=speed)
    controller.resume()

    source.advance(2)
    clock = controller.pump()

    assert clock.current_time.astimezone(UTC) == START.astimezone(UTC) + timedelta(
        seconds=2 * speed
    )
    assert sink.events()[-1].type is EventType.SIMULATION_TICK


def test_speed_and_settings_changes_settle_old_speed_and_are_idempotent() -> None:
    controller, source, sink = make_controller()
    controller.resume()
    source.advance(2)

    controller.set_speed(60)
    assert controller.clock.current_time == START + timedelta(seconds=2)
    controller.set_speed(60)
    source.advance(2)
    controller.set_auto_pause_on_proposal(False)
    assert controller.clock.current_time == START + timedelta(seconds=122)
    controller.set_auto_pause_on_proposal(False)

    assert state_reasons(sink) == [
        StateChangeReason.RESUMED,
        StateChangeReason.SPEED,
        StateChangeReason.SETTINGS,
    ]


def test_invalid_speed_and_poll_interval_are_rejected() -> None:
    controller, _, _ = make_controller()
    with pytest.raises(ValueError, match="unsupported"):
        controller.set_speed(2)  # type: ignore[arg-type]

    settings = Settings()
    sink = InMemoryEventSink()
    coordinator = MutationCoordinator(sink, initial_clock(settings))
    with pytest.raises(ValueError, match="four per second"):
        SimulationClockController(
            coordinator, FakeMonotonicTimeSource(), poll_interval_seconds=0.1
        )


def test_large_step_processes_boundaries_in_time_priority_and_registration_order() -> (
    None
):
    controller, source, _ = make_controller(speed=3600)
    calls: list[str] = []

    def handler(label: str):  # type: ignore[no-untyped-def]
        def apply(editor: object, clock: SimulationClock) -> BoundaryResult:
            del editor
            calls.append(f"{clock.current_time.isoformat()}:{label}")
            return BoundaryResult()

        return apply

    later = START + timedelta(hours=2)
    earlier = START + timedelta(hours=1)
    controller.register_boundary(later, BoundaryPriority.MOVEMENT, handler("later"))
    controller.register_boundary(earlier, BoundaryPriority.EXPIRY, handler("expiry"))
    controller.register_boundary(
        earlier, BoundaryPriority.PROPOSAL, handler("proposal")
    )
    controller.register_boundary(earlier, BoundaryPriority.PROPOSAL, handler("second"))
    controller.resume()
    source.advance(3)

    controller.pump()

    assert [call.rsplit(":", 1)[1] for call in calls] == [
        "proposal",
        "second",
        "expiry",
        "later",
    ]
    assert controller.clock.current_time == START + timedelta(hours=3)


def test_auto_pause_stops_exactly_at_proposal_and_preserves_event_order() -> None:
    controller, source, sink = make_controller(speed=3600)
    proposal_at = START + timedelta(hours=1)
    later_at = START + timedelta(hours=2)
    calls: list[str] = []

    def proposal(editor: object, clock: SimulationClock) -> BoundaryResult:
        del editor, clock
        calls.append("proposal")
        return BoundaryResult(request_auto_pause=True)

    def later(editor: object, clock: SimulationClock) -> BoundaryResult:
        del editor, clock
        calls.append("later")
        return BoundaryResult()

    controller.register_boundary(proposal_at, BoundaryPriority.PROPOSAL, proposal)
    controller.register_boundary(later_at, BoundaryPriority.MOVEMENT, later)
    controller.resume()
    source.advance(3)

    clock = controller.pump()

    assert clock.current_time == proposal_at
    assert clock.status is ClockStatus.PAUSED
    assert calls == ["proposal"]
    assert sink.events()[-1].type is EventType.SIMULATION_STATE_CHANGED
    assert state_reasons(sink)[-1] is StateChangeReason.AUTO_PAUSE_PROPOSAL

    source.advance(10)
    controller.resume()
    source.advance(1)
    controller.pump()
    assert calls == ["proposal", "later"]
    assert controller.clock.current_time == proposal_at + timedelta(hours=1)


def test_disabling_auto_pause_allows_progress_past_proposal() -> None:
    controller, source, _ = make_controller(speed=3600, auto_pause=False)
    calls: list[str] = []

    def proposal(editor: object, clock: SimulationClock) -> BoundaryResult:
        del editor, clock
        calls.append("proposal")
        return BoundaryResult(request_auto_pause=True)

    controller.register_boundary(
        START + timedelta(hours=1), BoundaryPriority.PROPOSAL, proposal
    )
    controller.resume()
    source.advance(2)

    assert controller.pump().current_time == START + timedelta(hours=2)
    assert calls == ["proposal"]
    assert controller.clock.status is ClockStatus.RUNNING


def test_maximum_clamps_and_pauses_without_a_stopped_state() -> None:
    maximum = START + timedelta(seconds=10)
    controller, source, sink = make_controller(maximum=maximum, speed=60)
    controller.resume()
    source.advance(1)

    clock = controller.pump()

    assert clock.current_time == maximum
    assert clock.status is ClockStatus.PAUSED
    assert state_reasons(sink)[-1] is StateChangeReason.PAUSED
    event_count = len(sink.events())
    assert controller.resume() == clock
    source.advance(100)
    assert controller.pump() == clock
    assert len(sink.events()) == event_count


def test_elapsed_arithmetic_handles_historical_fall_back() -> None:
    first_one_thirty = datetime(
        2025, 11, 2, 1, 30, tzinfo=timezone(-timedelta(hours=7))
    )
    maximum = datetime(2025, 11, 3, 1, 30, tzinfo=timezone(-timedelta(hours=8)))
    controller, source, _ = make_controller(start=first_one_thirty, maximum=maximum)
    controller.resume()
    source.advance(3600)

    clock = controller.pump()

    assert clock.current_time.hour == 1
    assert clock.current_time.minute == 30
    assert clock.current_time.utcoffset() == -timedelta(hours=8)
    assert clock.current_time.astimezone(UTC) == first_one_thirty.astimezone(
        UTC
    ) + timedelta(hours=1)


def test_boundary_can_target_second_repeated_hour() -> None:
    first_one_thirty = datetime(
        2025, 11, 2, 1, 30, tzinfo=timezone(-timedelta(hours=7))
    )
    second_one_fifteen = datetime(
        2025, 11, 2, 1, 15, tzinfo=timezone(-timedelta(hours=8))
    )
    maximum = datetime(2025, 11, 3, 1, 30, tzinfo=timezone(-timedelta(hours=8)))
    controller, source, _ = make_controller(start=first_one_thirty, maximum=maximum)
    calls: list[datetime] = []

    def repeated_hour(editor: object, clock: SimulationClock) -> BoundaryResult:
        del editor
        calls.append(clock.current_time)
        return BoundaryResult(request_auto_pause=True)

    controller.register_boundary(
        second_one_fifteen, BoundaryPriority.PROPOSAL, repeated_hour
    )
    controller.resume()
    source.advance(3600)

    clock = controller.pump()

    assert calls == [second_one_fifteen]
    assert clock.current_time == second_one_fifteen
    assert clock.status is ClockStatus.PAUSED


def test_elapsed_arithmetic_skips_historical_nonexistent_hour() -> None:
    before_spring_forward = datetime(
        2026, 3, 8, 1, 30, tzinfo=timezone(-timedelta(hours=8))
    )
    maximum = datetime(2026, 3, 9, 1, 30, tzinfo=PACIFIC)
    controller, source, _ = make_controller(
        start=before_spring_forward, maximum=maximum
    )
    controller.resume()
    source.advance(3600)

    clock = controller.pump()

    assert (clock.current_time.hour, clock.current_time.minute) == (3, 30)
    assert clock.current_time.utcoffset() == -timedelta(hours=7)


def test_elapsed_arithmetic_uses_permanent_pacific_time() -> None:
    before_obsolete_fall_back = datetime(2026, 11, 1, 1, 30, tzinfo=PACIFIC)
    controller, source, _ = make_controller(start=before_obsolete_fall_back)
    controller.resume()
    source.advance(3600)

    clock = controller.pump()

    assert (clock.current_time.hour, clock.current_time.minute) == (2, 30)
    assert clock.current_time.utcoffset() == -timedelta(hours=7)
