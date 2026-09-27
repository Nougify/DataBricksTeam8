from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from math import ceil
from typing import Self

from pydantic import AliasChoices, Field, field_validator, model_validator

from app.domain.models import DomainModel, GeoPoint
from app.domain.types import NonEmptyText, NonNegativeFloat, VancouverDateTime


class EventMode(StrEnum):
    REACTIVE = "REACTIVE"
    PROACTIVE = "PROACTIVE"


class EventStatus(StrEnum):
    PENDING = "PENDING"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    DISPATCHED = "DISPATCHED"
    COMPLETED = "COMPLETED"
    NO_MATCHING_ROUTE = "NO_MATCHING_ROUTE"
    NO_BUS_AVAILABLE = "NO_BUS_AVAILABLE"
    EXPIRED = "EXPIRED"
    INVALID_SOURCE = "INVALID_SOURCE"


class DispatchEventRow(DomainModel):
    event_id: NonEmptyText
    event_time: VancouverDateTime
    available_at: VancouverDateTime | None = None
    source_location: NonEmptyText = Field(
        validation_alias=AliasChoices("surge_location", "source_location", "hub_id")
    )
    hub_id: NonEmptyText | None = None
    predicted_people: NonNegativeFloat
    normal_people: NonNegativeFloat
    destination: NonEmptyText
    destination_share: float = Field(
        ge=0,
        le=100,
        validation_alias=AliasChoices("destination_share", "destination_share_pct"),
    )
    source_route: NonEmptyText = Field(
        validation_alias=AliasChoices("route", "source_route", "route_key")
    )
    route_id: NonEmptyText | None = None
    extra_bus_trips_est: NonNegativeFloat
    priority_score: NonNegativeFloat
    surge_type: NonEmptyText | None = None
    split: NonEmptyText | None = None
    direction: NonEmptyText | None = None
    link: NonEmptyText | None = None
    scheduled_trips_that_hour: int | None = Field(default=None, ge=0)
    extra_people_on_route: NonNegativeFloat | None = None
    avg_daily_boardings: NonNegativeFloat | None = None
    pct_trips_overcrowded: NonNegativeFloat | None = None
    source_version: NonEmptyText | None = None
    generated_at: VancouverDateTime | None = None
    # Accepted only for first-migration exports. v3 keys by route/destination.
    recommendation_id: NonEmptyText | None = Field(default=None, exclude=True)

    @field_validator("event_time", "available_at", "generated_at", mode="before")
    @classmethod
    def require_aware_vancouver_instant(cls, value: object) -> object:
        if value is None:
            return value
        if isinstance(value, str):
            value = datetime.fromisoformat(value)
        if isinstance(value, datetime) and value.tzinfo is None:
            raise ValueError("timestamps must include an offset")
        return value

    @model_validator(mode="after")
    def valid_availability(self) -> Self:
        if self.available_at is not None and self.available_at > self.event_time:
            raise ValueError("available_at must not be after event_time")
        return self

    @property
    def destination_share_pct(self) -> float:
        return self.destination_share

    @property
    def route_key(self) -> str:
        return self.source_route


class EventRecommendation(DomainModel):
    destination: NonEmptyText
    destination_share: float = Field(ge=0, le=100)
    route_id: NonEmptyText | None
    source_route: NonEmptyText
    extra_bus_trips_est: NonNegativeFloat
    priority_score: NonNegativeFloat
    scheduled_trips_that_hour: int | None = Field(default=None, ge=0)
    extra_people_on_route: NonNegativeFloat | None = None
    avg_daily_boardings: NonNegativeFloat | None = None
    pct_trips_overcrowded: NonNegativeFloat | None = None
    recommendation_id: NonEmptyText | None = Field(default=None, exclude=True)

    @property
    def destination_share_pct(self) -> float:
        return self.destination_share

    @property
    def route_key(self) -> str:
        return self.source_route


class EventSourceMetadata(DomainModel):
    split: NonEmptyText | None = None
    direction: NonEmptyText | None = None
    link: NonEmptyText | None = None
    version: NonEmptyText | None = None
    generated_at: VancouverDateTime | None = None


class DispatchEvent(DomainModel):
    id: NonEmptyText
    hub_id: NonEmptyText | None
    source_location: NonEmptyText
    location: GeoPoint | None = None
    available_at: VancouverDateTime | None
    actionable_at: VancouverDateTime
    event_time: VancouverDateTime
    mode: EventMode
    surge_type: NonEmptyText | None
    predicted_people: NonNegativeFloat
    normal_people: NonNegativeFloat
    surge_ratio: NonNegativeFloat | None
    suggested_extra_buses: int = Field(ge=0)
    priority_score: NonNegativeFloat
    recommendations: tuple[EventRecommendation, ...] = Field(min_length=1)
    status: EventStatus = EventStatus.PENDING
    additional_trip_ids: tuple[NonEmptyText, ...] = ()
    source: EventSourceMetadata
    invalid_source_reason: str | None = Field(default=None, exclude=True)

    @property
    def event_id(self) -> str:
        return self.id

    @property
    def source_version(self) -> str | None:
        return self.source.version

    @property
    def generated_at(self) -> datetime | None:
        return self.source.generated_at

    @model_validator(mode="after")
    def valid_event(self) -> Self:
        expected = tuple(
            sorted(
                self.recommendations,
                key=lambda row: (
                    -row.priority_score,
                    row.source_route,
                    row.destination,
                ),
            )
        )
        if self.recommendations != expected:
            raise ValueError("recommendations must be ordered by priority")
        expected_actionable = self.available_at or self.event_time
        expected_mode = (
            EventMode.PROACTIVE
            if self.available_at is not None and self.available_at < self.event_time
            else EventMode.REACTIVE
        )
        if self.actionable_at != expected_actionable or self.mode is not expected_mode:
            raise ValueError("event availability fields are inconsistent")
        if (
            self.invalid_source_reason is not None
            and self.status is not EventStatus.INVALID_SOURCE
        ):
            raise ValueError("invalid source events must have INVALID_SOURCE status")
        return self


class EventWindowMetadata(DomainModel):
    source_identity: NonEmptyText
    source_version: NonEmptyText | None
    window_start: VancouverDateTime
    window_end: VancouverDateTime
    loaded_at: VancouverDateTime
    row_count: int = Field(ge=0)
    provenance: NonEmptyText

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
        ids = [event.id for event in self.events]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate event_id")
        if any(
            not self.metadata.window_start
            <= event.event_time
            < self.metadata.window_end
            for event in self.events
        ):
            raise ValueError("event is outside window")
        return self


def group_event_rows(
    rows: list[DispatchEventRow],
    start: datetime,
    end: datetime,
    *,
    source_identity: str = "unknown",
    source_version: str | None = None,
    provenance: str = "event source",
) -> EventWindow:
    if end <= start:
        raise ValueError("window end must be after start")
    row_versions = {
        row.source_version for row in rows if row.source_version is not None
    }
    if source_version is not None:
        row_versions.add(source_version)
    if len(row_versions) > 1:
        raise ValueError("window rows must have one source_version")
    resolved_version = next(iter(row_versions), None)
    groups: dict[str, list[DispatchEventRow]] = {}
    for row in rows:
        if not start <= row.event_time < end:
            raise ValueError(f"event {row.event_id} is outside requested window")
        groups.setdefault(row.event_id, []).append(row)

    events: list[DispatchEvent] = []
    event_fields = (
        "event_time",
        "available_at",
        "source_location",
        "hub_id",
        "surge_type",
        "predicted_people",
        "normal_people",
        "split",
        "direction",
        "link",
        "generated_at",
    )
    for event_id, group in groups.items():
        first = group[0]
        if any(
            any(getattr(row, field) != getattr(first, field) for field in event_fields)
            for row in group[1:]
        ):
            raise ValueError(f"event-level fields conflict for {event_id}")

        recommendations: dict[tuple[str, str], EventRecommendation] = {}
        legacy_ids: dict[str, EventRecommendation] = {}
        for row in group:
            recommendation = EventRecommendation(
                recommendation_id=row.recommendation_id,
                destination=row.destination,
                destination_share=row.destination_share,
                route_id=row.route_id,
                source_route=row.source_route,
                extra_bus_trips_est=row.extra_bus_trips_est,
                priority_score=row.priority_score,
                scheduled_trips_that_hour=row.scheduled_trips_that_hour,
                extra_people_on_route=row.extra_people_on_route,
                avg_daily_boardings=row.avg_daily_boardings,
                pct_trips_overcrowded=row.pct_trips_overcrowded,
            )
            key = (row.source_route, row.destination)
            existing = recommendations.get(key)
            if existing is not None and existing != recommendation:
                raise ValueError(f"conflicting duplicate recommendation: {key}")
            if row.recommendation_id is not None:
                legacy = legacy_ids.get(row.recommendation_id)
                if legacy is not None and legacy != recommendation:
                    raise ValueError(
                        "conflicting duplicate recommendation_id: "
                        f"{row.recommendation_id}"
                    )
                legacy_ids[row.recommendation_id] = recommendation
            recommendations[key] = recommendation

        ordered = tuple(
            sorted(
                recommendations.values(),
                key=lambda row: (
                    -row.priority_score,
                    row.source_route,
                    row.destination,
                ),
            )
        )
        top = ordered[0]
        available_at = first.available_at
        invalid_reason = None if first.hub_id is not None else "unknown source location"
        events.append(
            DispatchEvent(
                id=event_id,
                hub_id=first.hub_id,
                source_location=first.source_location,
                available_at=available_at,
                actionable_at=available_at or first.event_time,
                event_time=first.event_time,
                mode=(
                    EventMode.PROACTIVE
                    if available_at is not None and available_at < first.event_time
                    else EventMode.REACTIVE
                ),
                surge_type=first.surge_type,
                predicted_people=first.predicted_people,
                normal_people=first.normal_people,
                surge_ratio=(
                    first.predicted_people / first.normal_people
                    if first.normal_people
                    else None
                ),
                suggested_extra_buses=ceil(top.extra_bus_trips_est),
                priority_score=top.priority_score,
                recommendations=ordered,
                status=(
                    EventStatus.PENDING
                    if invalid_reason is None
                    else EventStatus.INVALID_SOURCE
                ),
                source=EventSourceMetadata(
                    split=first.split,
                    direction=first.direction,
                    link=first.link,
                    version=resolved_version,
                    generated_at=first.generated_at,
                ),
                invalid_source_reason=invalid_reason,
            )
        )
    return EventWindow(
        metadata=EventWindowMetadata(
            source_identity=source_identity,
            source_version=resolved_version,
            window_start=start,
            window_end=end,
            loaded_at=datetime.now(start.tzinfo),
            row_count=len(rows),
            provenance=provenance,
        ),
        events=tuple(
            sorted(
                events,
                key=lambda event: (
                    event.actionable_at,
                    event.event_time,
                    -event.priority_score,
                    event.id,
                ),
            )
        ),
    )
