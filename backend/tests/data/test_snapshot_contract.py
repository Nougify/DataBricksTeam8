from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.data.fixtures import build_fixture_snapshot
from app.data.models import DataSnapshot


def fixture_payload() -> dict[str, object]:
    return build_fixture_snapshot("source-v1", "model-v1").model_dump(mode="json")


@pytest.mark.parametrize(
    ("collection", "duplicate_index", "message"),
    [
        ("actuals", 0, "duplicate actual key"),
        ("forecast_buckets", 0, "duplicate bucket id"),
        ("origins", 0, "duplicate origin key"),
    ],
)
def test_snapshot_rejects_duplicate_keys(
    collection: str, duplicate_index: int, message: str
) -> None:
    payload = fixture_payload()
    rows = payload[collection]
    assert isinstance(rows, list)
    rows.append(deepcopy(rows[duplicate_index]))

    with pytest.raises(ValidationError, match=message):
        DataSnapshot.model_validate(payload)


def test_snapshot_rejects_bad_hour_and_forecast_lead() -> None:
    payload = fixture_payload()
    buckets = payload["forecast_buckets"]
    assert isinstance(buckets, list)
    assert isinstance(buckets[0], dict)
    buckets[0]["target_hour"] = "2026-07-10T11:30:00-07:00"

    with pytest.raises(ValidationError, match="aligned to an hour"):
        DataSnapshot.model_validate(payload)

    payload = fixture_payload()
    buckets = payload["forecast_buckets"]
    assert isinstance(buckets, list)
    assert isinstance(buckets[0], dict)
    buckets[0]["lead_h"] = 4
    with pytest.raises(ValidationError, match="lead_h"):
        DataSnapshot.model_validate(payload)


def test_snapshot_rejects_invalid_provenance_and_coverage() -> None:
    payload = fixture_payload()
    metadata = payload["metadata"]
    assert isinstance(metadata, dict)
    metadata["provenance"] = ""
    with pytest.raises(ValidationError, match="at least 1 character"):
        DataSnapshot.model_validate(payload)

    payload = fixture_payload()
    metadata = payload["metadata"]
    assert isinstance(metadata, dict)
    metadata["coverage_end"] = "2026-07-10T10:00:00-07:00"
    with pytest.raises(ValidationError, match="outside declared coverage"):
        DataSnapshot.model_validate(payload)

    payload = fixture_payload()
    payload["actuals"] = []
    payload["baselines"] = []
    payload["origins"] = []
    payload["forecast_buckets"] = []
    with pytest.raises(ValidationError, match="no usable operational coverage"):
        DataSnapshot.model_validate(payload)


def test_fixture_is_labeled_and_covers_required_scenarios() -> None:
    snapshot = build_fixture_snapshot("source-v1", "model-v1")

    assert snapshot.metadata.source_mode.value == "fixture"
    assert "fixture" in snapshot.metadata.provenance.lower()
    assert max(row.pings for row in snapshot.actuals) >= 175
    assert any(row.pings < 110 for row in snapshot.actuals)
    assert not any(row.hour.hour == 12 for row in snapshot.actuals)
    assert len({row.origin_id for row in snapshot.origins}) >= 3
    assert any(row.load_pct > 100 for row in snapshot.route_loads)
