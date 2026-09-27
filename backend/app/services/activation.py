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
    BoundaryRegistration,
    BoundaryResult,
    SimulationClockController,
)
from app.services.coordinator import Mutation, MutationCoordinator
from app.services.movement import MOVEMENT_BOUNDARY_NAMESPACE
from app.services.proposals import PROPOSAL_BOUNDARY_NAMESPACE, ProposalService

EVENT_BOUNDARY_NAMESPACE = "dispatch-event"


class EventActivationService:
    """Moves loaded source events into runtime state at deterministic boundaries."""

    def __init__(
        self,
        reader: EventReader,
        coordinator: MutationCoordinator,
        clock: SimulationClockController,
        proposals: ProposalService | None = None,
    ) -> None:
        self._reader = reader
        self._coordinator = coordinator
        self._clock = clock
        self._proposals = proposals

    def start(self) -> None:
        self._clock.set_seek_handler(self.rebuild_at)
        current_time = self._clock.clock.current_time
        self._activate_through(current_time)
        self._schedule_after(current_time)

    def rebuild_at(self, at: VancouverDateTime) -> SimulationClock:
        self._coordinator.reset(at)
        self._clock.clear_boundaries(EVENT_BOUNDARY_NAMESPACE)
        self._clock.clear_boundaries(PROPOSAL_BOUNDARY_NAMESPACE)
        self._clock.clear_boundaries(MOVEMENT_BOUNDARY_NAMESPACE)
        self._activate_through(at)
        self._schedule_after(at)
        return self._clock.clock

    def _activate_through(self, at: VancouverDateTime) -> None:
        eligible = self._reader.actionable_events(at)
        if not eligible:
            return

        def activate(
            editor: StateEditor, clock: SimulationClock
        ) -> Mutation[tuple[BoundaryRegistration, ...]]:
            events: list[PendingEvent] = []
            registrations: list[BoundaryRegistration] = []
            for event in eligible:
                outcome = self._activate(editor, clock, event)
                events.extend(outcome.events)
                registrations.extend(outcome.registrations)
            return Mutation(tuple(registrations), tuple(events))

        registrations = self._coordinator.transact(activate)
        for registration in registrations:
            self._clock.register_boundary(
                registration.at,
                registration.priority,
                registration.handler,
                key=registration.key,
            )

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
            return self._activate(editor, clock, event)

        return activate

    @staticmethod
    def _target_handler(editor: StateEditor, clock: SimulationClock) -> BoundaryResult:
        del editor, clock
        return BoundaryResult()

    def _activate(
        self, editor: StateEditor, clock: SimulationClock, event: DispatchEvent
    ) -> BoundaryResult:
        if editor.dispatch_event(DispatchEventId(event.id)) is not None:
            return BoundaryResult()
        editor.put_dispatch_event(event)
        if self._proposals is not None:
            created = self._proposals.create_for_event(editor, clock, event)
            return BoundaryResult(
                events=created.events,
                request_auto_pause=created.request_auto_pause,
                registrations=created.registrations,
            )
        return BoundaryResult(
            events=(
                PendingEvent(
                    type=EventType.DISPATCH_EVENT_UPDATED,
                    simulation_time=clock.current_time,
                    data=event,
                ),
            )
        )
