from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from pydantic import Field

from app.domain.models import DayType, DomainModel, GeoPoint
from app.domain.types import (
    NonEmptyHubId,
    NonEmptyScheduledTripId,
    NonEmptyServicePatternId,
    NonEmptyText,
)


class HubCatchment(DomainModel):
    hub_id: NonEmptyHubId
    name: NonEmptyText
    location_name: NonEmptyText
    location: GeoPoint
    catchment_m: int = Field(gt=0)
    description: NonEmptyText


class ServiceDateResolution(DomainModel):
    requested_date: date
    service_date: date
    day_type: DayType
    is_representative: bool
    feed_version: NonEmptyText
    reason: NonEmptyText


@dataclass(frozen=True)
class CalendarRule:
    service_id: str
    start_date: date
    end_date: date
    weekdays: tuple[bool, bool, bool, bool, bool, bool, bool]


@dataclass(frozen=True)
class CalendarException:
    service_id: str
    service_date: date
    added: bool


@dataclass(frozen=True)
class TripTemplate:
    gtfs_trip_id: str
    service_id: str
    route_id: str
    pattern_id: NonEmptyServicePatternId
    first_arrival_seconds: int
    first_departure_seconds: int
    arrival_seconds: tuple[int, ...]
    departure_seconds: tuple[int, ...]


@dataclass(frozen=True)
class ScheduledDeparture:
    trip_id: NonEmptyScheduledTripId
    gtfs_trip_id: str
    route_id: str
    pattern_id: NonEmptyServicePatternId
    service_date: date
    departure_time_seconds: int
    stop_id: str | None
