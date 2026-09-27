from __future__ import annotations

import asyncio
import heapq
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import IntEnum
from threading import RLock
from typing import Protocol

from app.config import AllowedSimulationSpeed, Settings
from app.domain.events import (
    EventType,
    PendingEvent,
    StateChangedData,
    StateChangeReason,
)
from app.domain.models import ClockStatus, SimulationClock
from app.domain.types import (
    PERMANENT_PACIFIC,
    PERMANENT_PACIFIC_START,
    VANCOUVER,
    VancouverDateTime,
)
from app.repositories.memory import StateEditor
from app.services.coordinator import Mutation, MutationCoordinator


class MonotonicTimeSource(Protocol):
    def now(self) -> float: ...


class SystemMonotonicTimeSource:
    def now(self) -> float:
        return time.monotonic()


class FakeMonotonicTimeSource:
    def __init__(self, initial: float = 0.0) -> None:
        self._value = initial

    def now(self) -> float:
        return self._value

    def advance(self, seconds: float) -> None:
        if seconds < 0:
            raise ValueError("monotonic time cannot move backward")
        self._value += seconds


class BoundaryPriority(IntEnum):
    ISSUANCE = 10
    PROPOSAL = 20
    EXPIRY = 30
    MOVEMENT = 40
    HOURLY_DEMAND = 50


@dataclass(frozen=True)
class BoundaryResult:
    events: tuple[PendingEvent, ...] = ()
    request_auto_pause: bool = False


BoundaryHandler = Callable[[StateEditor, SimulationClock], BoundaryResult]


@dataclass(order=True)
class _Boundary:
    at_utc: datetime
    priority: BoundaryPriority
    registration_order: int
    at: VancouverDateTime = field(compare=False)
    handler: BoundaryHandler = field(compare=False)


def initial_clock(settings: Settings) -> SimulationClock:
    return SimulationClock(
        current_time=settings.simulation_start_time,
        local_date=settings.simulation_start_time.date(),
        hour=settings.simulation_start_time.hour,
        speed=settings.simulation_speed,
        status=ClockStatus.PAUSED,
        min_time=settings.simulation_min_time,
        max_time=settings.simulation_max_time,
        approval_mode=settings.approval_mode,
        auto_pause_on_proposal=settings.auto_pause_on_proposal,
        epoch=0,
    )


def _from_utc(value: datetime) -> VancouverDateTime:
    zone = PERMANENT_PACIFIC if value >= PERMANENT_PACIFIC_START else VANCOUVER
    return value.astimezone(zone)


def _advance_instant(value: VancouverDateTime, seconds: float) -> VancouverDateTime:
    return _from_utc(value.astimezone(UTC) + timedelta(seconds=seconds))


def _clock_at(
    clock: SimulationClock,
    at: VancouverDateTime,
    *,
    status: ClockStatus | None = None,
) -> SimulationClock:
    return clock.model_copy(
        update={
            "current_time": at,
            "local_date": at.date(),
            "hour": at.hour,
            "status": status or clock.status,
        }
    )


def _state_event(clock: SimulationClock, reason: StateChangeReason) -> PendingEvent:
    return PendingEvent(
        type=EventType.CLOCK_UPDATED,
        simulation_time=clock.current_time,
        data=StateChangedData(**clock.model_dump(), reason=reason),
    )


class SimulationClockController:
    """Advances one coordinator-owned clock across registered semantic boundaries."""

    def __init__(
        self,
        coordinator: MutationCoordinator,
        time_source: MonotonicTimeSource,
        *,
        poll_interval_seconds: float = 0.25,
    ) -> None:
        if poll_interval_seconds < 0.25:
            raise ValueError(
                "poll interval must limit ticks to at most four per second"
            )
        self._coordinator = coordinator
        self._time_source = time_source
        self._poll_interval_seconds = poll_interval_seconds
        self._anchor = time_source.now()
        self._boundaries: list[_Boundary] = []
        self._next_registration = 0
        self._lock = RLock()
        self._stop = asyncio.Event()

    @property
    def clock(self) -> SimulationClock:
        return self._coordinator.snapshot().clock

    def register_boundary(
        self,
        at: VancouverDateTime,
        priority: BoundaryPriority,
        handler: BoundaryHandler,
    ) -> None:
        with self._lock:
            clock = self.clock
            current_utc = clock.current_time.astimezone(UTC)
            boundary_utc = at.astimezone(UTC)
            maximum_utc = clock.max_time.astimezone(UTC)
            if not current_utc < boundary_utc <= maximum_utc:
                raise ValueError(
                    "boundary must be after current_time and within bounds"
                )
            self._next_registration += 1
            heapq.heappush(
                self._boundaries,
                _Boundary(
                    at_utc=boundary_utc,
                    priority=priority,
                    registration_order=self._next_registration,
                    at=at,
                    handler=handler,
                ),
            )

    def resume(self) -> SimulationClock:
        with self._lock:
            clock = self.clock
            if (
                clock.status is ClockStatus.RUNNING
                or clock.current_time == clock.max_time
            ):
                return clock
            updated = _clock_at(clock, clock.current_time, status=ClockStatus.RUNNING)
            self._commit_clock(
                updated, (_state_event(updated, StateChangeReason.RESUMED),)
            )
            self._anchor = self._time_source.now()
            return updated

    def pause(self) -> SimulationClock:
        with self._lock:
            self.pump()
            clock = self.clock
            if clock.status is ClockStatus.PAUSED:
                return clock
            updated = _clock_at(clock, clock.current_time, status=ClockStatus.PAUSED)
            self._commit_clock(
                updated, (_state_event(updated, StateChangeReason.PAUSED),)
            )
            self._anchor = self._time_source.now()
            return updated

    def set_speed(self, speed: AllowedSimulationSpeed) -> SimulationClock:
        with self._lock:
            if speed not in (1, 60, 300, 900, 3600):
                raise ValueError("unsupported simulation speed")
            self.pump()
            clock = self.clock
            if clock.speed == speed:
                return clock
            updated = clock.model_copy(update={"speed": speed})
            self._commit_clock(
                updated, (_state_event(updated, StateChangeReason.SPEED),)
            )
            self._anchor = self._time_source.now()
            return updated

    def seek(self, at: VancouverDateTime) -> SimulationClock:
        with self._lock:
            clock = self.clock
            if not clock.min_time <= at <= clock.max_time:
                raise ValueError("seek time must be within simulation bounds")
            updated = self._coordinator.reset(at).clock
            self._anchor = self._time_source.now()
            return updated

    def set_auto_pause_on_proposal(self, enabled: bool) -> SimulationClock:
        with self._lock:
            self.pump()
            clock = self.clock
            if clock.auto_pause_on_proposal is enabled:
                return clock
            updated = clock.model_copy(update={"auto_pause_on_proposal": enabled})
            self._commit_clock(
                updated, (_state_event(updated, StateChangeReason.SETTINGS),)
            )
            self._anchor = self._time_source.now()
            return updated

    def pump(self) -> SimulationClock:
        with self._lock:
            wall_now = self._time_source.now()
            elapsed = max(0.0, wall_now - self._anchor)
            self._anchor = wall_now
            clock = self.clock
            if clock.status is ClockStatus.PAUSED or elapsed == 0:
                return clock

            advanced_target = _advance_instant(
                clock.current_time, elapsed * clock.speed
            )
            target = (
                clock.max_time
                if advanced_target.astimezone(UTC) >= clock.max_time.astimezone(UTC)
                else advanced_target
            )
            while self._boundaries and self._boundaries[0].at_utc <= target.astimezone(
                UTC
            ):
                due = self._pop_same_time_boundaries()
                clock = self._process_boundaries(due)
                if clock.status is ClockStatus.PAUSED:
                    self._anchor = self._time_source.now()
                    return clock

            final_status = (
                ClockStatus.PAUSED if target == clock.max_time else ClockStatus.RUNNING
            )
            updated = _clock_at(clock, target, status=final_status)
            events: list[PendingEvent] = [
                PendingEvent(
                    type=EventType.CLOCK_UPDATED,
                    simulation_time=target,
                    data=StateChangedData(**updated.model_dump()),
                )
            ]
            if final_status is ClockStatus.PAUSED:
                events.append(_state_event(updated, StateChangeReason.PAUSED))
            self._commit_clock(updated, tuple(events))
            return updated

    async def run(self) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(
                    self._stop.wait(), timeout=self._poll_interval_seconds
                )
            except TimeoutError:
                self.pump()

    def stop(self) -> None:
        self._stop.set()

    def _pop_same_time_boundaries(self) -> list[_Boundary]:
        first = heapq.heappop(self._boundaries)
        due = [first]
        while self._boundaries and self._boundaries[0].at_utc == first.at_utc:
            due.append(heapq.heappop(self._boundaries))
        return due

    def _process_boundaries(self, due: list[_Boundary]) -> SimulationClock:
        boundary_time = due[0].at

        def apply(editor: StateEditor, clock: SimulationClock) -> Mutation[None]:
            advanced = _clock_at(clock, boundary_time)
            events: list[PendingEvent] = []
            auto_pause = False
            for boundary in due:
                outcome = boundary.handler(editor, advanced)
                events.extend(outcome.events)
                auto_pause = auto_pause or outcome.request_auto_pause
            if auto_pause and advanced.auto_pause_on_proposal:
                advanced = _clock_at(advanced, boundary_time, status=ClockStatus.PAUSED)
                events.append(
                    _state_event(advanced, StateChangeReason.AUTO_PAUSE_PROPOSAL)
                )
            return Mutation(None, tuple(events), advanced)

        try:
            self._coordinator.transact(apply)
        except Exception:
            for boundary in due:
                heapq.heappush(self._boundaries, boundary)
            raise
        return self.clock

    def _commit_clock(
        self, clock: SimulationClock, events: tuple[PendingEvent, ...]
    ) -> None:
        self._coordinator.transact(
            lambda editor, current: Mutation(None, events, clock)
        )
