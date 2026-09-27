from datetime import datetime

from app.data.models import EventWindow
from app.domain.models import DispatchEvent


class EventReader:
    def __init__(self, window: EventWindow) -> None:
        self._window = window
        self._by_id = {event.event_id: event for event in window.events}

    @property
    def window(self) -> EventWindow:
        return self._window

    def events_between(
        self, start: datetime, end: datetime
    ) -> tuple[DispatchEvent, ...]:
        return tuple(
            event for event in self._window.events if start <= event.event_time < end
        )

    def actionable_events(self, at: datetime) -> tuple[DispatchEvent, ...]:
        return tuple(
            event for event in self._window.events if event.actionable_at <= at
        )

    def event(self, event_id: str) -> DispatchEvent | None:
        return self._by_id.get(event_id)

    def window_covers(self, at: datetime) -> bool:
        metadata = self._window.metadata
        return metadata.window_start <= at < metadata.window_end
