from datetime import datetime

import pytest

from app.config import DataMode
from app.data.adapters import SnapshotSource
from app.data.fixtures import build_fixture_snapshot, fixture_now
from app.data.models import DataSnapshot
from app.data.store import (
    DataUnavailableError,
    IntegrationStatus,
    SnapshotStore,
)


class MutableSource:
    mode = DataMode.FIXTURE

    def __init__(self) -> None:
        self.fail = False

    def load(self) -> DataSnapshot:
        if self.fail:
            raise RuntimeError("source offline")
        return build_fixture_snapshot("source-v1", "model-v1")


def accepts_source(_source: SnapshotSource) -> None:
    pass


def test_failed_refresh_retains_previous_snapshot() -> None:
    source = MutableSource()
    accepts_source(source)
    store = SnapshotStore(source)
    original = store.refresh(fixture_now())
    source.fail = True

    with pytest.raises(RuntimeError, match="source offline"):
        store.refresh(fixture_now())

    assert store.reader() is original
    assert store.status is IntegrationStatus.DEGRADED
    assert store.last_error == "source offline"


def test_initial_failure_has_no_fixture_fallback() -> None:
    source = MutableSource()
    source.fail = True
    store = SnapshotStore(source)

    with pytest.raises(DataUnavailableError, match="no validated"):
        store.refresh(fixture_now())
    with pytest.raises(DataUnavailableError, match="no validated"):
        store.reader()
    assert store.status is IntegrationStatus.NOT_READY


def test_stale_snapshot_is_not_installed() -> None:
    store = SnapshotStore(MutableSource())
    future = datetime.fromisoformat("2027-02-01T00:00:00-07:00")

    with pytest.raises(DataUnavailableError, match="no validated"):
        store.refresh(future)
    assert store.last_error == "snapshot is stale"
