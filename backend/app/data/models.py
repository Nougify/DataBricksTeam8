from __future__ import annotations

from datetime import datetime
from typing import Self

from pydantic import Field, field_validator, model_validator

from app.domain.models import DomainModel
from app.domain.types import NonEmptyText, NonNegativeFloat, VancouverDateTime


class DispatchEventRow(DomainModel):
    event_id: NonEmptyText
    recommendation_id: NonEmptyText
    source_version: NonEmptyText
    event_time: VancouverDateTime
    hub_id: NonEmptyText
    surge_type: NonEmptyText
    predicted_people: NonNegativeFloat
    normal_people: NonNegativeFloat
    destination: NonEmptyText
    destination_share_pct: float = Field(ge=0, le=100)
    route_key: NonEmptyText
    extra_bus_trips_est: NonNegativeFloat
    priority_score: float
    generated_at: VancouverDateTime

    @field_validator("event_time", "generated_at", mode="before")
    @classmethod
    def require_aware_vancouver_instant(cls, value: object) -> object:
        if isinstance(value, str):
            value = datetime.fromisoformat(value)
        if isinstance(value, datetime) and value.tzinfo is None:
            raise ValueError("timestamps must include an offset")
        return value


class EventRecommendation(DomainModel):
    recommendation_id: NonEmptyText
    destination: NonEmptyText
    destination_share_pct: float = Field(ge=0, le=100)
    route_key: NonEmptyText
    extra_bus_trips_est: NonNegativeFloat
    priority_score: float


class DispatchEvent(DomainModel):
    event_id: NonEmptyText
    source_version: NonEmptyText
    event_time: VancouverDateTime
    hub_id: NonEmptyText
    surge_type: NonEmptyText
    predicted_people: NonNegativeFloat
    normal_people: NonNegativeFloat
    generated_at: VancouverDateTime
    recommendations: tuple[EventRecommendation, ...] = Field(min_length=1)
    invalid_source_reason: str | None = None

    @model_validator(mode="after")
    def ordered_recommendations(self) -> Self:
        expected = tuple(
            sorted(
                self.recommendations,
                key=lambda row: (-row.priority_score, row.recommendation_id),
            )
        )
        if self.recommendations != expected:
            raise ValueError("recommendations must be ordered by priority")
        return self


class EventWindowMetadata(DomainModel):
    source_version: NonEmptyText
    window_start: VancouverDateTime
    window_end: VancouverDateTime
    loaded_at: VancouverDateTime

    @model_validator(mode="after")
    def valid_window(self) -> Self:
        if self.window_end <= self.window_start:
            raise ValueError("window_end must be after window_start")
        return self


class EventWindow(DomainModel):
    metadata: EventWindowMetadata
    events: tuple[DispatchEvent, ...]

    @model_validator(mode="after")
    def valid_events(self) -> Self:
        ids = [event.event_id for event in self.events]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate event_id")
        if any(
            event.source_version != self.metadata.source_version
            or not self.metadata.window_start
            <= event.event_time
            < self.metadata.window_end
            for event in self.events
        ):
            raise ValueError("event is outside window or has wrong source version")
        return self


def group_event_rows(
    rows: list[DispatchEventRow], start: datetime, end: datetime
) -> EventWindow:
    if end <= start:
        raise ValueError("window end must be after start")
    source_versions = {row.source_version for row in rows}
    if len(source_versions) > 1:
        raise ValueError("window rows must have one source_version")
    source_version = next(iter(source_versions), "empty")
    groups: dict[str, list[DispatchEventRow]] = {}
    for row in rows:
        if not start <= row.event_time < end:
            raise ValueError(f"event {row.event_id} is outside requested window")
        groups.setdefault(row.event_id, []).append(row)

    events: list[DispatchEvent] = []
    fields = (
        "source_version",
        "event_time",
        "hub_id",
        "surge_type",
        "predicted_people",
        "normal_people",
        "generated_at",
    )
    for event_id, group in groups.items():
        first = group[0]
        if any(
            any(getattr(row, field) != getattr(first, field) for field in fields)
            for row in group[1:]
        ):
            raise ValueError(f"event-level fields conflict for {event_id}")
        recommendations: dict[str, EventRecommendation] = {}
        for row in group:
            recommendation = EventRecommendation(
                recommendation_id=row.recommendation_id,
                destination=row.destination,
                destination_share_pct=row.destination_share_pct,
                route_key=row.route_key,
                extra_bus_trips_est=row.extra_bus_trips_est,
                priority_score=row.priority_score,
            )
            existing = recommendations.get(row.recommendation_id)
            if existing is not None and existing != recommendation:
                raise ValueError(
                    f"conflicting duplicate recommendation_id: {row.recommendation_id}"
                )
            recommendations[row.recommendation_id] = recommendation
        events.append(
            DispatchEvent(
                event_id=event_id,
                source_version=first.source_version,
                event_time=first.event_time,
                hub_id=first.hub_id,
                surge_type=first.surge_type,
                predicted_people=first.predicted_people,
                normal_people=first.normal_people,
                generated_at=first.generated_at,
                recommendations=tuple(
                    sorted(
                        recommendations.values(),
                        key=lambda row: (-row.priority_score, row.recommendation_id),
                    )
                ),
            )
        )
    return EventWindow(
        metadata=EventWindowMetadata(
            source_version=source_version,
            window_start=start,
            window_end=end,
            loaded_at=datetime.now(start.tzinfo),
        ),
        events=tuple(
            sorted(events, key=lambda event: (event.event_time, event.event_id))
        ),
    )
