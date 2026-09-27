from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from threading import RLock

from app.domain.events import EventType, PendingEvent, SequencedEvent, StateResetData
from app.domain.models import ClockStatus, SimulationClock
from app.domain.types import Epoch, SequenceNumber, VancouverDateTime
from app.repositories.memory import SimulationEntities, StateEditor
from app.services.events import EventSink


class EpochConflictError(RuntimeError):
    pass


@dataclass(frozen=True)
class Mutation[ResultT]:
    value: ResultT
    events: tuple[PendingEvent, ...] = ()
    clock: SimulationClock | None = None


@dataclass(frozen=True)
class CoordinatorSnapshot:
    epoch: Epoch
    last_seq: SequenceNumber
    clock: SimulationClock
    entities: SimulationEntities


class MutationCoordinator:
    """The sole authority for simulation state, epoch, and event ordering."""

    def __init__(
        self,
        event_sink: EventSink,
        initial_clock: SimulationClock,
        initial_state: SimulationEntities | None = None,
    ) -> None:
        self._event_sink = event_sink
        self._initial_entities = StateEditor(
            initial_state or SimulationEntities.empty()
        ).freeze()
        self._entities = self._initial_entities
        self._epoch: Epoch = 0
        if initial_clock.epoch != self._epoch:
            raise ValueError("initial clock epoch must be zero")
        self._clock = initial_clock
        self._last_seq: SequenceNumber = 0
        self._lock = RLock()

    def snapshot(self) -> CoordinatorSnapshot:
        with self._lock:
            return CoordinatorSnapshot(
                epoch=self._epoch,
                last_seq=self._last_seq,
                clock=self._clock,
                entities=self._entities,
            )

    def mutate[ResultT](
        self,
        operation: Callable[[StateEditor], Mutation[ResultT]],
        *,
        expected_epoch: Epoch | None = None,
    ) -> ResultT:
        return self.transact(
            lambda editor, clock: operation(editor),
            expected_epoch=expected_epoch,
        )

    def transact[ResultT](
        self,
        operation: Callable[[StateEditor, SimulationClock], Mutation[ResultT]],
        *,
        expected_epoch: Epoch | None = None,
    ) -> ResultT:
        with self._lock:
            self._check_epoch(expected_epoch)
            editor = StateEditor(self._entities)
            mutation = operation(editor, self._clock)
            candidate = editor.freeze()
            candidate_clock = mutation.clock or self._clock
            SimulationClock.model_validate(candidate_clock.model_dump())
            if candidate_clock.epoch != self._epoch:
                raise ValueError("candidate clock epoch must match coordinator epoch")
            sequenced = self._sequence(mutation.events, self._epoch)

            previous_entities = self._entities
            previous_clock = self._clock
            self._entities = candidate
            self._clock = candidate_clock
            try:
                self._event_sink.publish(sequenced)
            except Exception:
                self._entities = previous_entities
                self._clock = previous_clock
                raise
            if sequenced:
                self._last_seq = sequenced[-1].seq
            return mutation.value

    def replace_state(
        self,
        candidate: SimulationEntities,
        *,
        simulation_time: VancouverDateTime,
        expected_epoch: Epoch | None = None,
    ) -> CoordinatorSnapshot:
        StateEditor(candidate).freeze()
        with self._lock:
            self._check_epoch(expected_epoch)
            next_epoch: Epoch = self._epoch + 1
            candidate_clock = self._clock.model_copy(
                update={
                    "current_time": simulation_time,
                    "local_date": simulation_time.date(),
                    "hour": simulation_time.hour,
                    "epoch": next_epoch,
                    "status": ClockStatus.PAUSED,
                }
            )
            SimulationClock.model_validate(candidate_clock.model_dump())
            reset = PendingEvent(
                type=EventType.SYSTEM_RESET,
                simulation_time=simulation_time,
                data=StateResetData(epoch=next_epoch),
            )
            sequenced = self._sequence((reset,), next_epoch)
            previous_entities = self._entities
            previous_clock = self._clock
            self._entities = candidate
            self._clock = candidate_clock
            try:
                self._event_sink.publish(sequenced)
            except Exception:
                self._entities = previous_entities
                self._clock = previous_clock
                raise
            self._epoch = next_epoch
            self._last_seq = sequenced[-1].seq
            return CoordinatorSnapshot(
                epoch=self._epoch,
                last_seq=self._last_seq,
                clock=self._clock,
                entities=self._entities,
            )

    def reset(self, simulation_time: VancouverDateTime) -> CoordinatorSnapshot:
        return self.replace_state(
            self._initial_entities,
            simulation_time=simulation_time,
            expected_epoch=self._epoch,
        )

    def _check_epoch(self, expected_epoch: Epoch | None) -> None:
        if expected_epoch is not None and expected_epoch != self._epoch:
            raise EpochConflictError(
                f"expected epoch {expected_epoch}, current epoch is {self._epoch}"
            )

    def _sequence(
        self, events: tuple[PendingEvent, ...], epoch: Epoch
    ) -> tuple[SequencedEvent, ...]:
        return tuple(
            SequencedEvent(
                type=event.type,
                simulation_time=event.simulation_time,
                data=event.data,
                seq=self._last_seq + offset,
                epoch=epoch,
            )
            for offset, event in enumerate(events, start=1)
        )
