from __future__ import annotations

import json
import re
import time
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol, cast
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import ValidationError

from app.config import DataMode, Settings
from app.data.fixtures import build_fixture_rows
from app.data.models import DispatchEventRow, EventWindow, group_event_rows
from app.domain.types import PERMANENT_PACIFIC, PERMANENT_PACIFIC_START, VANCOUVER


class EventSource(Protocol):
    mode: DataMode

    def load_window(self, start: datetime, end: datetime) -> EventWindow: ...


class QueryExecutor(Protocol):
    def query(
        self, statement: str, parameters: Mapping[str, str]
    ) -> Sequence[Mapping[str, Any]]: ...


class SqlWarehouseQueryExecutor:
    """Small synchronous executor for the Databricks SQL Statement Execution API."""

    def __init__(self, host: str, http_path: str, token: str) -> None:
        self._url = f"{host.rstrip('/')}/api/2.0/sql/statements"
        self._http_path = http_path
        self._token = token

    def query(
        self, statement: str, parameters: Mapping[str, str]
    ) -> Sequence[Mapping[str, Any]]:
        payload = {
            "statement": statement,
            "warehouse_id": self._http_path.rsplit("/", 1)[-1],
            "parameters": [
                {"name": key, "value": value, "type": "STRING"}
                for key, value in parameters.items()
            ],
            "wait_timeout": "10s",
        }
        result = self._request(self._url, payload)
        while result["status"]["state"] in {"PENDING", "RUNNING"}:
            time.sleep(0.2)
            result = self._request(f"{self._url}/{result['statement_id']}")
        if result["status"]["state"] != "SUCCEEDED":
            raise EventLoadError(
                result["status"]
                .get("error", {})
                .get("message", "Databricks query failed")
            )
        manifest = result.get("manifest", {}).get("schema", {}).get("columns", [])
        names = [column["name"] for column in manifest]
        return [
            dict(zip(names, row, strict=True))
            for row in result.get("result", {}).get("data_array", [])
        ]

    def _request(
        self, url: str, payload: Mapping[str, Any] | None = None
    ) -> Mapping[str, Any]:
        data = json.dumps(payload).encode() if payload is not None else None
        request = Request(
            url,
            data=data,
            method="POST" if data else "GET",
            headers={
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urlopen(request, timeout=30) as response:  # noqa: S310
                return cast(Mapping[str, Any], json.loads(response.read()))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise EventLoadError("Databricks SQL request failed") from exc


class FixtureEventSource:
    mode = DataMode.FIXTURE

    def __init__(self, source_version: str) -> None:
        self._source_version = source_version

    def load_window(self, start: datetime, end: datetime) -> EventWindow:
        return _window_from_rows(
            build_fixture_rows(self._source_version),
            start,
            end,
            source_identity="fixture",
            source_version=self._source_version,
            provenance="bundled deterministic fixture",
        )


class ExportedEventSource:
    mode = DataMode.EXPORTED_EVENTS

    def __init__(self, path: Path, source_version: str) -> None:
        self._path = path
        self._source_version = source_version

    def load_window(self, start: datetime, end: datetime) -> EventWindow:
        try:
            payload = json.loads(self._path.read_text("utf-8"))
            rows = [DispatchEventRow.model_validate(row) for row in payload]
        except (OSError, UnicodeError, json.JSONDecodeError, ValidationError) as exc:
            raise EventLoadError(f"cannot load exported events: {self._path}") from exc
        if any(
            row.source_version is not None
            and row.source_version != self._source_version
            for row in rows
        ):
            raise EventLoadError("event source version does not match configuration")
        return _window_from_rows(
            rows,
            start,
            end,
            source_identity=str(self._path),
            source_version=self._source_version,
            provenance="versioned exported event file",
        )


class DatabricksEventSource:
    mode = DataMode.DATABRICKS

    def __init__(
        self,
        executor: QueryExecutor,
        catalog: str,
        schema: str,
        table: str,
        source_version: str,
    ) -> None:
        self._executor = executor
        self._catalog = _safe_identifier(catalog)
        self._schema = _safe_identifier(schema)
        self._table = _safe_identifier(table)
        self._source_version = source_version

    def load_window(self, start: datetime, end: datetime) -> EventWindow:
        statement = (
            "SELECT event_id, event_time, available_at, hub_id AS surge_location, "
            "predicted_people, normal_people, destination, "
            "destination_share_pct AS destination_share, route_key AS route, "
            "extra_bus_trips_est, priority_score, CAST(NULL AS STRING) AS surge_type, "
            "CAST(NULL AS STRING) AS split, CAST(NULL AS STRING) AS direction, "
            "CAST(NULL AS STRING) AS link, "
            "CAST(NULL AS INT) AS scheduled_trips_that_hour, "
            "CAST(NULL AS DOUBLE) AS extra_people_on_route, "
            "CAST(NULL AS DOUBLE) AS avg_daily_boardings, "
            "CAST(NULL AS DOUBLE) AS pct_trips_overcrowded, source_version, "
            "CAST(NULL AS TIMESTAMP) AS generated_at "
            f"FROM `{self._catalog}`.`{self._schema}`.`{self._table}` "
            "WHERE source_version = :source_version "
            "AND event_time >= :window_start AND event_time < :window_end "
            "ORDER BY event_time, event_id, priority_score DESC, route, destination"
        )
        try:
            result = self._executor.query(
                statement,
                {
                    "source_version": self._source_version,
                    "window_start": start.isoformat(),
                    "window_end": end.isoformat(),
                },
            )
            rows = [
                DispatchEventRow.model_validate(_normalize_databricks_timestamps(row))
                for row in result
            ]
        except (ValidationError, EventLoadError) as exc:
            raise EventLoadError("Databricks returned invalid dispatch events") from exc
        except Exception as exc:
            raise EventLoadError("Databricks dispatch event query failed") from exc
        return _window_from_rows(
            rows,
            start,
            end,
            source_identity=f"{self._catalog}.{self._schema}.{self._table}",
            source_version=self._source_version,
            provenance="Databricks SQL bounded parameterized query",
        )


class EventLoadError(RuntimeError):
    pass


def build_event_source(
    settings: Settings, executor: QueryExecutor | None = None
) -> EventSource:
    if settings.data_mode is DataMode.FIXTURE:
        return FixtureEventSource(settings.data_source_version)
    if settings.data_mode is DataMode.EXPORTED_EVENTS:
        if settings.exported_events_path is None:
            raise EventLoadError("exported events path is not configured")
        return ExportedEventSource(
            settings.exported_events_path, settings.data_source_version
        )
    if executor is None:
        if not all(
            (
                settings.databricks_host,
                settings.databricks_http_path,
                settings.databricks_token,
            )
        ):
            raise EventLoadError("Databricks query executor is not configured")
        assert settings.databricks_http_path is not None
        assert settings.databricks_token is not None
        executor = SqlWarehouseQueryExecutor(
            str(settings.databricks_host),
            settings.databricks_http_path,
            settings.databricks_token.get_secret_value(),
        )
    if not all(
        (settings.data_catalog, settings.data_schema, settings.dispatch_events_table)
    ):
        raise EventLoadError(
            "Databricks catalog, schema, and dispatch table are required"
        )
    assert settings.data_catalog is not None
    assert settings.data_schema is not None
    assert settings.dispatch_events_table is not None
    return DatabricksEventSource(
        executor,
        settings.data_catalog,
        settings.data_schema,
        settings.dispatch_events_table,
        settings.data_source_version,
    )


def _window_from_rows(
    rows: list[DispatchEventRow],
    start: datetime,
    end: datetime,
    *,
    source_identity: str,
    source_version: str | None,
    provenance: str,
) -> EventWindow:
    filtered = [row for row in rows if start <= row.event_time < end]
    return group_event_rows(
        filtered,
        start,
        end,
        source_identity=source_identity,
        source_version=source_version,
        provenance=provenance,
    )


def _safe_identifier(value: str) -> str:
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value) is None:
        raise EventLoadError(f"invalid Databricks identifier: {value}")
    return value


def _normalize_databricks_timestamps(row: Mapping[str, Any]) -> dict[str, Any]:
    normalized = dict(row)
    for field in ("event_time", "available_at", "generated_at"):
        value = normalized.get(field)
        if isinstance(value, str):
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if isinstance(value, datetime) and value.tzinfo is not None:
            utc_value = value.astimezone(UTC)
            zone = (
                PERMANENT_PACIFIC
                if utc_value >= PERMANENT_PACIFIC_START
                else VANCOUVER
            )
            normalized[field] = value.astimezone(zone)
    return normalized
