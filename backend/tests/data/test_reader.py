from datetime import datetime

from app.data.fixtures import build_fixture_snapshot
from app.data.reader import DataReader, SnapshotReader
from app.domain.types import HubId


def accepts_reader(_reader: DataReader) -> None:
    pass


def test_snapshot_reader_satisfies_typed_interface() -> None:
    reader = SnapshotReader(build_fixture_snapshot("source-v1", "model-v1"))
    accepts_reader(reader)


def test_operational_reads_are_isolated_by_as_of_time() -> None:
    reader = SnapshotReader(build_fixture_snapshot("source-v1", "model-v1"))
    hub_id = HubId("ubc")
    start = datetime.fromisoformat("2026-07-10T08:00:00-07:00")
    end = datetime.fromisoformat("2026-07-10T14:00:00-07:00")

    before_close = reader.actuals(
        hub_id, start, end, datetime.fromisoformat("2026-07-10T11:30:00-07:00")
    )
    after_close = reader.actuals(
        hub_id, start, end, datetime.fromisoformat("2026-07-10T12:30:00-07:00")
    )

    assert [row.hour.hour for row in before_close] == [8, 9, 10]
    assert [row.hour.hour for row in after_close] == [8, 9, 10, 11]
    assert (
        reader.origins(
            hub_id,
            datetime.fromisoformat("2026-07-10T11:00:00-07:00"),
            datetime.fromisoformat("2026-07-10T11:59:00-07:00"),
        )
        == ()
    )
    assert (
        len(
            reader.origins(
                hub_id,
                datetime.fromisoformat("2026-07-10T11:00:00-07:00"),
                datetime.fromisoformat("2026-07-10T12:01:00-07:00"),
            )
        )
        == 3
    )


def test_reader_returns_exact_vintage_and_explicit_missing_artifact() -> None:
    reader = SnapshotReader(build_fixture_snapshot("source-v1", "model-v1"))
    hub_id = HubId("ubc")

    assert (
        reader.forecast(hub_id, datetime.fromisoformat("2026-07-10T09:59:00-07:00"))
        is None
    )
    forecast = reader.forecast(
        hub_id, datetime.fromisoformat("2026-07-10T10:30:00-07:00")
    )
    assert forecast is not None
    vintage, buckets = forecast
    assert vintage.issued_at.hour == 10
    assert [row.target_hour.hour for row in buckets] == [11, 12, 13, 14]
    assert reader.evaluation("backtest") is None
