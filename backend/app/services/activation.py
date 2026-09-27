from __future__ import annotations

from datetime import UTC

from app.data.reader import EventReader
from app.domain.events import EventType, PendingEvent
from app.domain.models import DispatchEvent, SimulationClock
from app.domain.types import DispatchEventId, VancouverDateTime
from app.repositories.memory import StateEditor
from app.services.clock import (
    BoundaryHandler,
    BoundaryPriority,
    BoundaryResult,
    SimulationClockController,
)
from app.services.coordinator import Mutation, MutationCoordinator

EVENT_BOUNDARY_NAMESPACE = "dispatch-event"


class EventActivationService:
    """Moves loaded source events into runtime state at deterministic boundaries."""

    def __init__(
        self,
        reader: EventReader,
        coordinator: MutationCoordinator,
        clock: SimulationClockController,
    ) -> None:
        self._reader = reader
        self._coordinator = coordinator
        self._clock = clock

    def start(self) -> None:
        self._clock.set_seek_handler(self.rebuild_at)
        current_time = self._clock.clock.current_time
        self._activate_through(current_time)
        self._schedule_after(current_time)

    def rebuild_at(self, at: VancouverDateTime) -> SimulationClock:
        self._coordinator.reset(at)
        self._clock.clear_boundaries(EVENT_BOUNDARY_NAMESPACE)
        self._activate_through(at)
        self._schedule_after(at)
        return self._clock.clock

    def _activate_through(self, at: VancouverDateTime) -> None:
        eligible = self._reader.actionable_events(at)
        if not eligible:
            return

        def activate(editor: StateEditor, clock: SimulationClock) -> Mutation[None]:
            events: list[PendingEvent] = []
            for event in eligible:
                pending = self._activate(editor, clock, event)
                if pending is not None:
                    events.append(pending)
            return Mutation(None, tuple(events))

        self._coordinator.transact(activate)

    def _schedule_after(self, at: VancouverDateTime) -> None:
        maximum = self._clock.clock.max_time.astimezone(UTC)
        for event in self._reader.window.events:
            if event.actionable_at > at:
                self._clock.register_boundary(
                    event.actionable_at,
                    BoundaryPriority.EVENT_ACTIVATION,
                    self._activation_handler(event),
                    key=(EVENT_BOUNDARY_NAMESPACE, f"activate:{event.id}"),
                )
            if at < event.event_time and event.event_time.astimezone(UTC) <= maximum:
                self._clock.register_boundary(
                    event.event_time,
                    BoundaryPriority.EVENT_TARGET,
                    self._target_handler,
                    key=(EVENT_BOUNDARY_NAMESPACE, f"target:{event.id}"),
                )

    def _activation_handler(self, event: DispatchEvent) -> BoundaryHandler:
        def activate(editor: StateEditor, clock: SimulationClock) -> BoundaryResult:
            pending = self._activate(editor, clock, event)
            return BoundaryResult(events=(pending,) if pending is not None else ())

        return activate

    @staticmethod
    def _target_handler(editor: StateEditor, clock: SimulationClock) -> BoundaryResult:
        del editor, clock
        return BoundaryResult()

    @staticmethod
    def _activate(
        editor: StateEditor, clock: SimulationClock, event: DispatchEvent
    ) -> PendingEvent | None:
        if editor.dispatch_event(DispatchEventId(event.id)) is not None:
            return None
        editor.put_dispatch_event(event)
        return PendingEvent(
            type=EventType.DISPATCH_EVENT_UPDATED,
            simulation_time=clock.current_time,
            data=event,
        )
