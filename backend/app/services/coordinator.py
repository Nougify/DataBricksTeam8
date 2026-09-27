from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from threading import RLock

from app.domain.events import PendingEvent, SequencedEvent, StateResetData
from app.domain.types import Epoch, SequenceNumber, VancouverDateTime
from app.repositories.memory import SimulationEntities, StateEditor
from app.services.events import EventSink


class EpochConflictError(RuntimeError):
    pass


@dataclass(frozen=True)
class Mutation[ResultT]:
    value: ResultT
    events: tuple[PendingEvent, ...] = ()


@dataclass(frozen=True)
class CoordinatorSnapshot:
    epoch: Epoch
    last_seq: SequenceNumber
    entities: SimulationEntities


class MutationCoordinator:
    """The sole authority for simulation state, epoch, and event ordering."""

    def __init__(
        self,
        event_sink: EventSink,
        initial_state: SimulationEntities | None = None,
    ) -> None:
        self._event_sink = event_sink
        self._entities = StateEditor(
            initial_state or SimulationEntities.empty()
        ).freeze()
        self._epoch: Epoch = 0
        self._last_seq: SequenceNumber = 0
        self._lock = RLock()

    def snapshot(self) -> CoordinatorSnapshot:
        with self._lock:
            return CoordinatorSnapshot(
                epoch=self._epoch,
                last_seq=self._last_seq,
                entities=self._entities,
            )

    def mutate[ResultT](
        self,
        operation: Callable[[StateEditor], Mutation[ResultT]],
        *,
        expected_epoch: Epoch | None = None,
    ) -> ResultT:
        with self._lock:
            self._check_epoch(expected_epoch)
            editor = StateEditor(self._entities)
            mutation = operation(editor)
            candidate = editor.freeze()
            sequenced = self._sequence(mutation.events, self._epoch)

            previous = self._entities
            self._entities = candidate
            try:
                self._event_sink.publish(sequenced)
            except Exception:
                self._entities = previous
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
            reset = PendingEvent(
                type="state.reset",
                simulation_time=simulation_time,
                data=StateResetData(epoch=next_epoch),
            )
            sequenced = self._sequence((reset,), next_epoch)
            previous = self._entities
            self._entities = candidate
            try:
                self._event_sink.publish(sequenced)
            except Exception:
                self._entities = previous
                raise
            self._epoch = next_epoch
            self._last_seq = sequenced[-1].seq
            return CoordinatorSnapshot(
                epoch=self._epoch,
                last_seq=self._last_seq,
                entities=self._entities,
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
