from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from threading import RLock

from app.data.adapters import SnapshotSource
from app.data.reader import SnapshotReader


class IntegrationStatus(StrEnum):
    READY = "ready"
    DEGRADED = "degraded"
    NOT_READY = "not_ready"


class DataUnavailableError(RuntimeError):
    pass


class SnapshotStore:
    """Owns atomic installation and retention of validated immutable snapshots."""

    def __init__(self, source: SnapshotSource) -> None:
        self._source = source
        self._reader: SnapshotReader | None = None
        self._status = IntegrationStatus.NOT_READY
        self._last_error: str | None = None
        self._lock = RLock()

    @property
    def status(self) -> IntegrationStatus:
        with self._lock:
            return self._status

    @property
    def last_error(self) -> str | None:
        with self._lock:
            return self._last_error

    def reader(self) -> SnapshotReader:
        with self._lock:
            if self._reader is None:
                raise DataUnavailableError("no validated data snapshot is available")
            return self._reader

    def refresh(self, now: datetime) -> SnapshotReader:
        try:
            snapshot = self._source.load()
            if snapshot.metadata.source_mode is not self._source.mode:
                raise ValueError("snapshot source mode does not match selected adapter")
            if snapshot.metadata.generated_at > now:
                raise ValueError("snapshot generation time is in the future")
            if snapshot.metadata.fresh_through < now:
                raise ValueError("snapshot is stale")
            candidate = SnapshotReader(snapshot)
        except Exception as exc:
            with self._lock:
                self._last_error = str(exc)
                has_reader = self._reader is not None
                self._status = (
                    IntegrationStatus.DEGRADED
                    if has_reader
                    else IntegrationStatus.NOT_READY
                )
            if not has_reader:
                raise DataUnavailableError(
                    "no validated data snapshot is available"
                ) from exc
            raise

        with self._lock:
            self._reader = candidate
            self._last_error = None
            self._status = IntegrationStatus.READY
            return candidate
