from datetime import UTC, datetime, timedelta, timezone
from typing import Annotated, Literal, NewType
from zoneinfo import ZoneInfo

from pydantic import (
    AfterValidator,
    BeforeValidator,
    Field,
    PlainSerializer,
    StringConstraints,
)

VANCOUVER = ZoneInfo("America/Vancouver")
# B.C. moved to permanent Pacific time after the final spring transition in 2026.
# Local tzdata may still contain the superseded November rollback.
PERMANENT_PACIFIC_START = datetime(2026, 3, 8, 10, tzinfo=UTC)
PERMANENT_PACIFIC = timezone(timedelta(hours=-7), name="America/Vancouver")

HubId = NewType("HubId", str)
BusId = NewType("BusId", str)
SurgeId = NewType("SurgeId", str)
AdditionalTripId = NewType("AdditionalTripId", str)
RouteId = NewType("RouteId", str)
LineKey = NewType("LineKey", str)
ServicePatternId = NewType("ServicePatternId", str)
StopId = NewType("StopId", str)
ScheduledTripId = NewType("ScheduledTripId", str)
ForecastVintageId = NewType("ForecastVintageId", str)
ForecastBucketId = NewType("ForecastBucketId", str)

NonEmptyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
NonEmptyHubId = Annotated[HubId, StringConstraints(strip_whitespace=True, min_length=1)]
NonEmptyBusId = Annotated[BusId, StringConstraints(strip_whitespace=True, min_length=1)]
NonEmptySurgeId = Annotated[
    SurgeId, StringConstraints(strip_whitespace=True, min_length=1)
]
NonEmptyAdditionalTripId = Annotated[
    AdditionalTripId, StringConstraints(strip_whitespace=True, min_length=1)
]
NonEmptyRouteId = Annotated[
    RouteId, StringConstraints(strip_whitespace=True, min_length=1)
]
NonEmptyLineKey = Annotated[
    LineKey, StringConstraints(strip_whitespace=True, min_length=1)
]
NonEmptyServicePatternId = Annotated[
    ServicePatternId, StringConstraints(strip_whitespace=True, min_length=1)
]
NonEmptyStopId = Annotated[
    StopId, StringConstraints(strip_whitespace=True, min_length=1)
]
NonEmptyScheduledTripId = Annotated[
    ScheduledTripId, StringConstraints(strip_whitespace=True, min_length=1)
]
NonEmptyForecastVintageId = Annotated[
    ForecastVintageId, StringConstraints(strip_whitespace=True, min_length=1)
]
NonEmptyForecastBucketId = Annotated[
    ForecastBucketId, StringConstraints(strip_whitespace=True, min_length=1)
]

Latitude = Annotated[float, Field(ge=-90, le=90)]
Longitude = Annotated[float, Field(ge=-180, le=180)]
NonNegativeFloat = Annotated[float, Field(ge=0)]
NonNegativeInt = Annotated[int, Field(ge=0)]
PositiveInt = Annotated[int, Field(gt=0)]
Percentage = Annotated[float, Field(ge=0, le=100)]
LoadPercentage = Annotated[float, Field(ge=0)]
UnitInterval = Annotated[float, Field(ge=0, le=1)]
Hour = Annotated[int, Field(ge=0, le=23)]
Heading = Annotated[float, Field(ge=0, lt=360)]
Epoch = Annotated[int, Field(ge=0)]
SequenceNumber = Annotated[int, Field(ge=0)]
GeoJsonPosition = tuple[Longitude, Latitude]
GeoJsonType = Literal["LineString"]
MultiGeoJsonType = Literal["MultiLineString"]


def _parse_vancouver_datetime(value: object) -> object:
    if isinstance(value, str):
        if not (value.endswith("Z") or "+" in value[10:] or "-" in value[10:]):
            raise ValueError("timestamp must include an explicit UTC offset")
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("timestamp must be valid ISO 8601") from exc
    return value


def _validate_vancouver_datetime(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamp must include an explicit UTC offset")

    utc_value = value.astimezone(UTC)
    zone = PERMANENT_PACIFIC if utc_value >= PERMANENT_PACIFIC_START else VANCOUVER
    local = value.astimezone(zone)
    if value.utcoffset() != local.utcoffset():
        raise ValueError("timestamp offset is not valid for America/Vancouver")
    if value.replace(tzinfo=None) != local.replace(tzinfo=None):
        raise ValueError("timestamp is not a valid America/Vancouver local time")
    return local


def _serialize_vancouver_datetime(value: datetime) -> str:
    utc_value = value.astimezone(UTC)
    zone = PERMANENT_PACIFIC if utc_value >= PERMANENT_PACIFIC_START else VANCOUVER
    return value.astimezone(zone).isoformat()


VancouverDateTime = Annotated[
    datetime,
    BeforeValidator(_parse_vancouver_datetime),
    AfterValidator(_validate_vancouver_datetime),
    PlainSerializer(_serialize_vancouver_datetime, return_type=str, when_used="json"),
]
