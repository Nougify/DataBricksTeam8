from collections.abc import Callable
from datetime import datetime
from enum import StrEnum
from threading import RLock

from app.data.adapters import EventSource
from app.data.models import EventWindow
from app.data.reader import EventReader


class IntegrationStatus(StrEnum):
    READY = "ready"
    DEGRADED = "degraded"
    NOT_READY = "not_ready"


class DataUnavailableError(RuntimeError):
    pass


class DataWindowConflictError(RuntimeError):
    pass


class EventWindowStore:
    def __init__(self, source: EventSource) -> None:
        self._source = source
        self._reader: EventReader | None = None
        self._status = IntegrationStatus.NOT_READY
        self._last_error: str | None = None
        self._revision = 0
        self._lock = RLock()

    @property
    def status(self) -> IntegrationStatus:
        with self._lock:
            return self._status

    @property
    def last_error(self) -> str | None:
        with self._lock:
            return self._last_error

    def reader(self) -> EventReader:
        with self._lock:
            if self._reader is None:
                raise DataUnavailableError("no validated event window is available")
            return self._reader

    def reader_snapshot(self) -> tuple[EventReader, int]:
        with self._lock:
            if self._reader is None:
                raise DataUnavailableError("no validated event window is available")
            return self._reader, self._revision

    def refresh_window(self, start: datetime, end: datetime) -> EventReader:
        with self._lock:
            expected_revision = self._revision
        try:
            candidate = EventReader(self._source.load_window(start, end))
        except Exception as exc:
            with self._lock:
                self._last_error = str(exc)
                self._status = (
                    IntegrationStatus.DEGRADED
                    if self._reader
                    else IntegrationStatus.NOT_READY
                )
            if self._reader is None:
                raise DataUnavailableError(
                    "no validated event window is available"
                ) from exc
            raise
        with self._lock:
            if self._revision != expected_revision:
                raise DataWindowConflictError(
                    "event window changed while refresh was loading"
                )
            self._reader = candidate
            self._last_error = None
            self._status = IntegrationStatus.READY
            self._revision += 1
            return candidate

    def prepare_window(self, start: datetime, end: datetime) -> EventReader:
        """Load and validate a candidate without replacing the active window."""
        return EventReader(self._source.load_window(start, end))

    def install_reader(self, reader: EventReader) -> EventReader:
        with self._lock:
            self._reader = reader
            self._last_error = None
            self._status = IntegrationStatus.READY
            self._revision += 1
            return reader

    def install_reader_after[ResultT](
        self,
        reader: EventReader,
        *,
        expected_revision: int,
        commit: Callable[[], ResultT],
    ) -> ResultT:
        with self._lock:
            if self._revision != expected_revision:
                raise DataWindowConflictError("event window changed during replay")
            result = commit()
            self._reader = reader
            self._last_error = None
            self._status = IntegrationStatus.READY
            self._revision += 1
            return result

    def record_failure(self, error: Exception) -> None:
        with self._lock:
            self._last_error = str(error)
            self._status = (
                IntegrationStatus.DEGRADED
                if self._reader is not None
                else IntegrationStatus.NOT_READY
            )

    def install(self, window: EventWindow) -> EventReader:
        """Atomically install a fully validated, backend-resolved event window."""
        candidate = EventReader(window)
        with self._lock:
            self._reader = candidate
            self._last_error = None
            self._status = IntegrationStatus.READY
            self._revision += 1
            return candidate
