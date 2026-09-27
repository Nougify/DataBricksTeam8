from __future__ import annotations

import asyncio
from collections.abc import Callable
from contextlib import suppress
from threading import RLock
from typing import Protocol

from app.domain.events import SequencedEvent


class EventSink(Protocol):
    def publish(self, events: tuple[SequencedEvent, ...]) -> None:
        """Atomically accept an ordered event batch or raise without accepting it."""
        ...


class EventSubscriptionClosed(RuntimeError):
    pass


class EventSubscription:
    def __init__(
        self,
        loop: asyncio.AbstractEventLoop,
        on_close: Callable[[EventSubscription], None],
        *,
        max_pending_batches: int,
    ) -> None:
        self._loop = loop
        self._on_close = on_close
        self._max_pending_batches = max_pending_batches
        self._queue: asyncio.Queue[tuple[SequencedEvent, ...] | None] = asyncio.Queue()
        self._pending_batches = 0
        self._closed = False
        self._lock = RLock()

    async def receive(self) -> tuple[SequencedEvent, ...]:
        events = await self._queue.get()
        if events is None:
            raise EventSubscriptionClosed
        with self._lock:
            self._pending_batches -= 1
        return events

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            with suppress(RuntimeError):
                self._loop.call_soon_threadsafe(self._queue.put_nowait, None)
        self._on_close(self)

    def enqueue(self, events: tuple[SequencedEvent, ...]) -> None:
        if not events:
            return
        with self._lock:
            if self._closed:
                return
            if self._pending_batches >= self._max_pending_batches:
                self._closed = True
                overflowed = True
            else:
                self._pending_batches += 1
                overflowed = False
                try:
                    self._loop.call_soon_threadsafe(self._queue.put_nowait, events)
                except RuntimeError:
                    self._pending_batches -= 1
                    self._closed = True
                    overflowed = True
        if overflowed:
            self._on_close(self)
            with suppress(RuntimeError):
                self._loop.call_soon_threadsafe(self._queue.put_nowait, None)


class SubscribableEventSink(EventSink, Protocol):
    def subscribe(self) -> EventSubscription: ...


class InMemoryEventSink:
    def __init__(self, *, max_pending_batches: int = 256) -> None:
        if max_pending_batches < 1:
            raise ValueError("max_pending_batches must be positive")
        self._events: tuple[SequencedEvent, ...] = ()
        self._subscriptions: set[EventSubscription] = set()
        self._max_pending_batches = max_pending_batches
        self._lock = RLock()

    def publish(self, events: tuple[SequencedEvent, ...]) -> None:
        with self._lock:
            self._events += events
            subscriptions = tuple(self._subscriptions)
        for subscription in subscriptions:
            subscription.enqueue(events)

    def subscribe(self) -> EventSubscription:
        subscription = EventSubscription(
            asyncio.get_running_loop(),
            self._remove_subscription,
            max_pending_batches=self._max_pending_batches,
        )
        with self._lock:
            self._subscriptions.add(subscription)
        return subscription

    def events(self) -> tuple[SequencedEvent, ...]:
        with self._lock:
            return self._events

    def subscription_count(self) -> int:
        with self._lock:
            return len(self._subscriptions)

    def _remove_subscription(self, subscription: EventSubscription) -> None:
        with self._lock:
            self._subscriptions.discard(subscription)
