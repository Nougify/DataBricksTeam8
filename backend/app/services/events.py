from __future__ import annotations

from threading import RLock
from typing import Protocol

from app.domain.events import SequencedEvent


class EventSink(Protocol):
    def publish(self, events: tuple[SequencedEvent, ...]) -> None:
        """Atomically accept an ordered event batch or raise without accepting it."""
        ...


class InMemoryEventSink:
    def __init__(self) -> None:
        self._events: tuple[SequencedEvent, ...] = ()
        self._lock = RLock()

    def publish(self, events: tuple[SequencedEvent, ...]) -> None:
        with self._lock:
            self._events += events

    def events(self) -> tuple[SequencedEvent, ...]:
        with self._lock:
            return self._events
