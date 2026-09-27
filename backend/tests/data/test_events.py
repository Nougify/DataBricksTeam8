from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta, timezone
from typing import Any, NoReturn

import pytest

from app.config import DataMode
from app.data.adapters import DatabricksEventSource, FixtureEventSource
from app.data.fixtures import build_fixture_rows
from app.data.models import DispatchEventRow, group_event_rows
from app.data.store import EventWindowStore

PACIFIC = timezone(timedelta(hours=-7))
START = datetime(2026, 7, 10, 9, tzinfo=PACIFIC)
END = datetime(2026, 7, 10, 15, tzinfo=PACIFIC)


def test_fixture_filters_window_and_orders_recommendations() -> None:
    window = FixtureEventSource("test-v1").load_window(START, END)

    assert [event.event_id for event in window.events] == [
        "valid-event",
        "unknown-route",
        "too-many-buses",
        "same-time-a",
        "same-time-b",
    ]
    assert [row.recommendation_id for row in window.events[0].recommendations] == [
        "r1",
        "r2",
    ]


def test_rows_reject_conflicting_duplicate_recommendation() -> None:
    rows = build_fixture_rows("test-v1")[:2]
    rows[1] = rows[1].model_copy(update={"recommendation_id": "r1"})
    with pytest.raises(ValueError, match="conflicting duplicate"):
        group_event_rows(rows, START, END)


def test_row_validates_percentage_and_timestamp() -> None:
    payload = build_fixture_rows("test-v1")[0].model_dump()
    payload["destination_share_pct"] = 101
    with pytest.raises(ValueError, match="destination_share_pct"):
        DispatchEventRow.model_validate(payload)
    payload["destination_share_pct"] = 50
    payload["event_time"] = "2026-07-10T10:00:00"
    with pytest.raises(ValueError, match="offset"):
        DispatchEventRow.model_validate(payload)


class FailingSource:
    mode = DataMode.FIXTURE

    def load_window(self, start: datetime, end: datetime) -> NoReturn:
        raise RuntimeError("unavailable")


def test_failed_refresh_retains_previous_window() -> None:
    store = EventWindowStore(FixtureEventSource("test-v1"))
    original = store.refresh_window(START, END)
    store._source = FailingSource()

    with pytest.raises(RuntimeError, match="unavailable"):
        store.refresh_window(START, END)
    assert store.reader() is original
    assert store.status.value == "degraded"


def test_databricks_uses_one_parameterized_query() -> None:
    class Executor:
        def __init__(self) -> None:
            self.calls: list[tuple[str, Mapping[str, str]]] = []

        def query(
            self, statement: str, parameters: Mapping[str, str]
        ) -> Sequence[Mapping[str, Any]]:
            self.calls.append((statement, parameters))
            return [
                row.model_dump(mode="json") for row in build_fixture_rows("test-v1")[:2]
            ]

    executor = Executor()
    source = DatabricksEventSource(
        executor, "catalog", "schema", "dispatch_events", "test-v1"
    )
    source.load_window(START, END)
    statement, parameters = executor.calls[0]
    assert "`catalog`.`schema`.`dispatch_events`" in statement
    assert ":source_version" in statement
    assert parameters["source_version"] == "test-v1"
