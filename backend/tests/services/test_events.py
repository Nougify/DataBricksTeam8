import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest

from app.domain.events import EventType, SequencedEvent, StateResetData
from app.services.events import EventSubscriptionClosed, InMemoryEventSink

NOW = datetime(2026, 7, 1, 10, tzinfo=timezone(-timedelta(hours=7)))


def event(seq: int) -> SequencedEvent:
    return SequencedEvent(
        type=EventType.SYSTEM_RESET,
        simulation_time=NOW,
        data=StateResetData(epoch=0),
        seq=seq,
        epoch=0,
    )


def test_subscription_receives_ordered_batches_without_history() -> None:
    async def exercise() -> None:
        sink = InMemoryEventSink()
        sink.publish((event(1),))
        first = sink.subscribe()
        second = sink.subscribe()

        sink.publish((event(2), event(3)))

        assert [item.seq for item in await first.receive()] == [2, 3]
        assert [item.seq for item in await second.receive()] == [2, 3]
        assert [item.seq for item in sink.events()] == [1, 2, 3]
        first.close()
        second.close()
        assert sink.subscription_count() == 0

    asyncio.run(exercise())


def test_subscription_accepts_publication_from_another_thread() -> None:
    async def exercise() -> None:
        sink = InMemoryEventSink()
        subscription = sink.subscribe()

        with ThreadPoolExecutor(max_workers=1) as executor:
            await asyncio.get_running_loop().run_in_executor(
                executor, sink.publish, (event(1),)
            )

        assert (await subscription.receive())[0].seq == 1
        subscription.close()

    asyncio.run(exercise())


def test_slow_subscription_closes_instead_of_dropping_a_gap() -> None:
    async def exercise() -> None:
        sink = InMemoryEventSink(max_pending_batches=1)
        subscription = sink.subscribe()

        sink.publish((event(1),))
        sink.publish((event(2),))

        assert (await subscription.receive())[0].seq == 1
        with pytest.raises(EventSubscriptionClosed):
            await subscription.receive()
        assert sink.subscription_count() == 0

    asyncio.run(exercise())
