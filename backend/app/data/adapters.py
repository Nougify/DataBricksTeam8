from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Protocol

from pydantic import ValidationError

from app.config import DataMode, Settings
from app.data.fixtures import build_fixture_snapshot
from app.data.models import DataSnapshot


class SnapshotSource(Protocol):
    mode: DataMode

    def load(self) -> DataSnapshot: ...


class QueryExecutor(Protocol):
    def query(
        self, statement: str, parameters: Mapping[str, str]
    ) -> Sequence[Mapping[str, Any]]: ...


class FixtureSnapshotAdapter:
    mode = DataMode.FIXTURE

    def __init__(self, source_version: str, model_version: str) -> None:
        self._source_version = source_version
        self._model_version = model_version

    def load(self) -> DataSnapshot:
        return build_fixture_snapshot(self._source_version, self._model_version)


class ExportedSnapshotAdapter:
    mode = DataMode.EXPORTED_SNAPSHOT

    def __init__(
        self, path: Path, expected_source_version: str, expected_model_version: str
    ) -> None:
        self._path = path
        self._expected_source_version = expected_source_version
        self._expected_model_version = expected_model_version

    def load(self) -> DataSnapshot:
        try:
            snapshot = DataSnapshot.model_validate_json(self._path.read_text("utf-8"))
        except (OSError, UnicodeError, ValidationError, ValueError) as exc:
            raise SnapshotLoadError(
                f"cannot load exported snapshot: {self._path}"
            ) from exc
        _require_versions(
            snapshot, self._expected_source_version, self._expected_model_version
        )
        if snapshot.metadata.source_mode is not self.mode:
            raise SnapshotLoadError(
                "export metadata must declare exported_snapshot mode"
            )
        return snapshot


class DatabricksSnapshotAdapter:
    mode = DataMode.DATABRICKS
    _TABLES = (
        "forecast_vintages",
        "forecast_buckets",
        "actuals",
        "baselines",
        "origins",
        "hubs",
        "origin_dimensions",
        "route_loads",
        "analytical_records",
        "evaluations",
    )

    def __init__(
        self,
        executor: QueryExecutor,
        catalog: str,
        schema: str,
        source_version: str,
        model_version: str,
    ) -> None:
        self._executor = executor
        self._catalog = _safe_identifier(catalog)
        self._schema = _safe_identifier(schema)
        self._source_version = source_version
        self._model_version = model_version

    def load(self) -> DataSnapshot:
        parameters = {
            "source_version": self._source_version,
            "model_version": self._model_version,
        }
        payload: dict[str, object] = {}
        payload["metadata"] = self._single_row("snapshot_metadata", parameters)
        for table in self._TABLES:
            payload[table] = list(self._query(table, parameters))
        try:
            snapshot = DataSnapshot.model_validate(payload)
        except ValidationError as exc:
            raise SnapshotLoadError("Databricks returned an invalid snapshot") from exc
        _require_versions(snapshot, self._source_version, self._model_version)
        if snapshot.metadata.source_mode is not self.mode:
            raise SnapshotLoadError("Databricks metadata must declare databricks mode")
        return snapshot

    def _single_row(
        self, table: str, parameters: Mapping[str, str]
    ) -> Mapping[str, Any]:
        rows = self._query(table, parameters)
        if len(rows) != 1:
            raise SnapshotLoadError(f"{table} must return exactly one row")
        return rows[0]

    def _query(
        self, table: str, parameters: Mapping[str, str]
    ) -> Sequence[Mapping[str, Any]]:
        statement = (
            f"SELECT * FROM `{self._catalog}`.`{self._schema}`.`{table}` "
            "WHERE source_version = :source_version "
            "AND model_version = :model_version"
        )
        try:
            return self._executor.query(statement, parameters)
        except Exception as exc:
            raise SnapshotLoadError(f"Databricks query failed for {table}") from exc


class SnapshotLoadError(RuntimeError):
    pass


def build_snapshot_source(
    settings: Settings, executor: QueryExecutor | None = None
) -> SnapshotSource:
    if settings.data_mode is DataMode.FIXTURE:
        return FixtureSnapshotAdapter(
            settings.data_snapshot_version, settings.forecast_model_version
        )
    if settings.data_mode is DataMode.EXPORTED_SNAPSHOT:
        if settings.exported_snapshot_path is None:
            raise SnapshotLoadError("exported snapshot path is not configured")
        return ExportedSnapshotAdapter(
            settings.exported_snapshot_path,
            settings.data_snapshot_version,
            settings.forecast_model_version,
        )
    if executor is None:
        raise SnapshotLoadError("Databricks query executor is not configured")
    if settings.data_catalog is None or settings.data_schema is None:
        raise SnapshotLoadError("Databricks catalog and schema are not configured")
    return DatabricksSnapshotAdapter(
        executor,
        settings.data_catalog,
        settings.data_schema,
        settings.data_snapshot_version,
        settings.forecast_model_version,
    )


def _safe_identifier(value: str) -> str:
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value) is None:
        raise SnapshotLoadError(f"invalid Databricks identifier: {value}")
    return value


def _require_versions(
    snapshot: DataSnapshot, source_version: str, model_version: str
) -> None:
    if snapshot.metadata.source_version != source_version:
        raise SnapshotLoadError("snapshot source version does not match configuration")
    if snapshot.metadata.model_version != model_version:
        raise SnapshotLoadError("snapshot model version does not match configuration")
