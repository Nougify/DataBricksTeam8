from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import pytest

from app.config import DataMode, Settings
from app.data.adapters import (
    DatabricksSnapshotAdapter,
    ExportedSnapshotAdapter,
    FixtureSnapshotAdapter,
    SnapshotLoadError,
    build_snapshot_source,
)
from app.data.fixtures import build_fixture_snapshot


class RecordingExecutor:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.calls: list[tuple[str, Mapping[str, str]]] = []

    def query(
        self, statement: str, parameters: Mapping[str, str]
    ) -> Sequence[Mapping[str, Any]]:
        self.calls.append((statement, parameters))
        table = statement.split("`")[-2]
        value = self.payload[table]
        if isinstance(value, list):
            return value
        assert isinstance(value, dict)
        return [value]


def exported_file(tmp_path: Path) -> Path:
    snapshot = build_fixture_snapshot("source-v1", "model-v1")
    payload = snapshot.model_dump(mode="json")
    payload["metadata"]["source_mode"] = DataMode.EXPORTED_SNAPSHOT
    path = tmp_path / "snapshot.json"
    path.write_text(snapshot.model_validate(payload).model_dump_json(), "utf-8")
    return path


def test_mode_selection_is_explicit(tmp_path: Path) -> None:
    assert isinstance(build_snapshot_source(Settings()), FixtureSnapshotAdapter)

    path = exported_file(tmp_path)
    settings = Settings(
        data_mode=DataMode.EXPORTED_SNAPSHOT,
        exported_snapshot_path=path,
        data_snapshot_version="source-v1",
        forecast_model_version="model-v1",
    )
    assert isinstance(build_snapshot_source(settings), ExportedSnapshotAdapter)


def test_export_rejects_malformed_or_wrong_version(tmp_path: Path) -> None:
    malformed = tmp_path / "bad.json"
    malformed.write_text("not-json", "utf-8")
    with pytest.raises(SnapshotLoadError, match="cannot load"):
        ExportedSnapshotAdapter(malformed, "source-v1", "model-v1").load()

    with pytest.raises(SnapshotLoadError, match="source version"):
        ExportedSnapshotAdapter(exported_file(tmp_path), "source-v2", "model-v1").load()


def test_databricks_uses_fixed_queries_parameters_and_schema_mapping() -> None:
    snapshot = build_fixture_snapshot("source-v1", "model-v1")
    payload = snapshot.model_dump(mode="json")
    payload["metadata"]["source_mode"] = DataMode.DATABRICKS
    payload["snapshot_metadata"] = payload.pop("metadata")
    executor = RecordingExecutor(payload)
    adapter = DatabricksSnapshotAdapter(
        executor, "catalog", "schema", "source-v1", "model-v1"
    )

    loaded = adapter.load()

    assert loaded.metadata.source_mode is DataMode.DATABRICKS
    assert len(executor.calls) == 11
    for statement, parameters in executor.calls:
        assert statement.startswith("SELECT * FROM `catalog`.`schema`.")
        assert ":source_version" in statement and ":model_version" in statement
        assert parameters == {
            "source_version": "source-v1",
            "model_version": "model-v1",
        }


def test_databricks_rejects_unsafe_identifiers() -> None:
    with pytest.raises(SnapshotLoadError, match="identifier"):
        DatabricksSnapshotAdapter(
            RecordingExecutor({}),
            "catalog; DROP TABLE x",
            "schema",
            "source-v1",
            "model-v1",
        )
