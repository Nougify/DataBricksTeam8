from __future__ import annotations

import heapq
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.config import Settings
from app.data.reader import EventReader
from app.data.store import DataWindowConflictError, EventWindowStore
from app.domain.decisions import HumanDecision, HumanDecisionAction
from app.domain.models import ClockStatus, DispatchEvent, SimulationClock
from app.domain.types import AdditionalTripId, VancouverDateTime
from app.repositories.memory import SimulationEntities, StateEditor
from app.services.activation import EVENT_BOUNDARY_NAMESPACE, EventActivationService
from app.services.clock import (
    BoundaryPriority,
    BoundaryRegistration,
    BoundaryResult,
    SimulationClockController,
)
from app.services.coordinator import MutationCoordinator
from app.services.proposals import (
    ProposalConflictError,
    ProposalNotFoundError,
    ProposalService,
)
from app.transit.recommendations import RecommendationMapper


class ReplayConflictError(RuntimeError):
    pass


class ReplayDataError(RuntimeError):
    pass


@dataclass(order=True)
class _ReplayBoundary:
    at_utc: datetime
    priority: BoundaryPriority
    order: int
    registration: BoundaryRegistration = field(compare=False)


class DeterministicSeekService:
    def __init__(
        self,
        settings: Settings,
        data: EventWindowStore,
        mapper: RecommendationMapper,
        coordinator: MutationCoordinator,
        clock: SimulationClockController,
        activation: EventActivationService,
        proposals: ProposalService,
    ) -> None:
        self._settings = settings
        self._data = data
        self._mapper = mapper
        self._coordinator = coordinator
        self._clock = clock
        self._activation = activation
        self._proposals = proposals

    def start(self) -> None:
        self._clock.set_seek_handler(self.seek)

    def seek(self, target: VancouverDateTime) -> SimulationClock:
        snapshot = self._coordinator.snapshot()
        reader, data_revision = self._reader_for(target)
        replay_clock = self._replay_clock(snapshot.clock, reader, target)
        retained_decisions = tuple(
            decision for decision in snapshot.decisions if decision.decided_at <= target
        )
        entities, future = self._replay(
            reader, replay_clock, target, retained_decisions
        )
        final_clock = _clock_at(replay_clock, target)
        self._clock.validate_boundary_replacement(
            future,
            current_time=target,
            max_time=final_clock.max_time,
        )

        try:
            committed = self._data.install_reader_after(
                reader,
                expected_revision=data_revision,
                commit=lambda: self._coordinator.replace_state(
                    entities,
                    simulation_time=target,
                    expected_epoch=snapshot.epoch,
                    expected_revision=snapshot.revision,
                    clock_template=final_clock,
                    decisions=retained_decisions,
                ),
            )
        except DataWindowConflictError as exc:
            raise ReplayConflictError("event window changed during replay") from exc
        self._activation.set_reader(reader)
        self._clock.replace_boundaries(
            future,
            current_time=target,
            max_time=committed.clock.max_time,
        )
        return committed.clock

    def _reader_for(self, target: VancouverDateTime) -> tuple[EventReader, int]:
        current, revision = self._data.reader_snapshot()
        metadata = current.window.metadata
        if (
            metadata.window_start <= self._settings.simulation_min_time
            and target < metadata.window_end
        ):
            return current, revision
        try:
            raw = self._data.prepare_window(
                self._settings.event_window_start,
                self._settings.event_window_end,
            )
            candidate = EventReader(self._mapper.resolve_window(raw.window))
        except Exception as exc:
            self._data.record_failure(exc)
            raise ReplayDataError("event window reload failed") from exc
        metadata = candidate.window.metadata
        if not metadata.window_start <= target < metadata.window_end:
            error = ReplayDataError("loaded event window does not cover seek target")
            self._data.record_failure(error)
            raise error
        return candidate, revision

    def _replay_clock(
        self,
        current: SimulationClock,
        reader: EventReader,
        target: VancouverDateTime,
    ) -> SimulationClock:
        metadata = reader.window.metadata
        minimum = max(self._settings.simulation_min_time, metadata.window_start)
        maximum = min(self._settings.simulation_max_time, metadata.window_end)
        if not minimum <= target < metadata.window_end or target > maximum:
            raise ReplayDataError("seek target is outside validated event coverage")
        return current.model_copy(
            update={
                "current_time": minimum,
                "local_date": minimum.date(),
                "hour": minimum.hour,
                "status": ClockStatus.PAUSED,
                "min_time": minimum,
                "max_time": maximum,
            }
        )

    def _replay(
        self,
        reader: EventReader,
        initial_clock: SimulationClock,
        target: VancouverDateTime,
        decisions: tuple[HumanDecision, ...],
    ) -> tuple[SimulationEntities, tuple[BoundaryRegistration, ...]]:
        editor = StateEditor(self._coordinator.initial_entities())
        heap: list[_ReplayBoundary] = []
        keys: set[tuple[str, str]] = set()
        next_order = 0

        def enqueue(registration: BoundaryRegistration) -> None:
            nonlocal next_order
            if registration.at > initial_clock.max_time:
                raise ReplayConflictError("replay boundary exceeds simulation bounds")
            if registration.key is not None:
                if registration.key in keys:
                    raise ReplayConflictError("replay generated a duplicate boundary")
                keys.add(registration.key)
            next_order += 1
            heapq.heappush(
                heap,
                _ReplayBoundary(
                    registration.at.astimezone(UTC),
                    registration.priority,
                    next_order,
                    registration,
                ),
            )

        for event in reader.window.events:
            activation_time = max(event.actionable_at, initial_clock.min_time)
            if activation_time <= initial_clock.max_time:
                enqueue(self._activation_registration(event, activation_time))
            if initial_clock.min_time <= event.event_time <= initial_clock.max_time:
                enqueue(self._target_registration(event))
        for decision in decisions:
            if decision.decided_at < initial_clock.min_time:
                raise ReplayConflictError("decision predates replay coverage")
            enqueue(self._decision_registration(decision))

        replay_clock = initial_clock
        target_utc = target.astimezone(UTC)
        while heap and heap[0].registration.at.astimezone(UTC) <= target_utc:
            first = heapq.heappop(heap)
            due = [first]
            while heap and heap[0].at_utc == first.at_utc:
                due.append(heapq.heappop(heap))
            for item in due:
                if item.registration.key is not None:
                    keys.discard(item.registration.key)
            replay_clock = _clock_at(replay_clock, first.registration.at)
            for item in due:
                try:
                    outcome = item.registration.handler(editor, replay_clock)
                except ReplayConflictError:
                    raise
                except Exception as exc:
                    raise ReplayConflictError(
                        "recorded lifecycle could not be replayed"
                    ) from exc
                for registration in outcome.registrations:
                    if registration.at <= replay_clock.current_time:
                        raise ReplayConflictError(
                            "replay generated a non-future boundary"
                        )
                    enqueue(registration)
            editor.freeze()

        future = tuple(item.registration for item in sorted(heap))
        return editor.freeze(), future

    def _activation_registration(
        self, event: DispatchEvent, at: VancouverDateTime
    ) -> BoundaryRegistration:
        def activate(editor: StateEditor, clock: SimulationClock) -> BoundaryResult:
            return self._activation.activate_event(editor, clock, event)

        return BoundaryRegistration(
            at=at,
            priority=BoundaryPriority.EVENT_ACTIVATION,
            handler=activate,
            key=(EVENT_BOUNDARY_NAMESPACE, f"activate:{event.id}"),
        )

    @staticmethod
    def _target_registration(event: DispatchEvent) -> BoundaryRegistration:
        def target(editor: StateEditor, clock: SimulationClock) -> BoundaryResult:
            del editor, clock
            return BoundaryResult()

        return BoundaryRegistration(
            at=event.event_time,
            priority=BoundaryPriority.EVENT_TARGET,
            handler=target,
            key=(EVENT_BOUNDARY_NAMESPACE, f"target:{event.id}"),
        )

    def _decision_registration(self, decision: HumanDecision) -> BoundaryRegistration:
        def decide(editor: StateEditor, clock: SimulationClock) -> BoundaryResult:
            trip = editor.trip(AdditionalTripId(decision.trip_id))
            if (
                trip is None
                or trip.dispatch_event_id != decision.dispatch_event_id
                or trip.bus_id != decision.bus_id
            ):
                raise ReplayConflictError(
                    f"recorded decision does not match trip {decision.trip_id}"
                )
            try:
                if decision.action is HumanDecisionAction.APPROVE:
                    mutation = self._proposals.approve_transition(
                        editor, clock, trip.id
                    )
                else:
                    mutation = self._proposals.reject_transition(editor, clock, trip.id)
            except (ProposalConflictError, ProposalNotFoundError) as exc:
                raise ReplayConflictError(
                    f"recorded decision cannot be applied: {decision.trip_id}"
                ) from exc
            return BoundaryResult(
                events=mutation.events,
                registrations=mutation.value.registrations,
            )

        return BoundaryRegistration(
            at=decision.decided_at,
            priority=BoundaryPriority.PROPOSAL,
            handler=decide,
            key=("decision", str(decision.order)),
        )


def _clock_at(clock: SimulationClock, at: VancouverDateTime) -> SimulationClock:
    return clock.model_copy(
        update={
            "current_time": at,
            "local_date": at.date(),
            "hour": at.hour,
            "status": ClockStatus.PAUSED,
        }
    )
