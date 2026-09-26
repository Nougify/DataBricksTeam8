from __future__ import annotations

from datetime import datetime
from typing import Protocol

from app.data.models import (
    ActualDemand,
    AnalyticalRecord,
    Baseline,
    DataSnapshot,
    EvaluationArtifact,
    HubDimension,
    OriginDemand,
    OriginDimension,
    RouteLoad,
    SnapshotMetadata,
)
from app.domain.models import ForecastBucket, ForecastVintage
from app.domain.types import HubId


class DataReader(Protocol):
    @property
    def metadata(self) -> SnapshotMetadata: ...

    def forecast(
        self, hub_id: HubId, as_of: datetime
    ) -> tuple[ForecastVintage, tuple[ForecastBucket, ...]] | None: ...

    def actuals(
        self, hub_id: HubId, start: datetime, end: datetime, as_of: datetime
    ) -> tuple[ActualDemand, ...]: ...

    def baseline(
        self, hub_id: HubId, target_hour: datetime, issued_at: datetime
    ) -> Baseline | None: ...

    def origins(
        self, hub_id: HubId, hour: datetime, as_of: datetime
    ) -> tuple[OriginDemand, ...]: ...

    def hubs(self) -> tuple[HubDimension, ...]: ...

    def origin_dimensions(self) -> tuple[OriginDimension, ...]: ...

    def route_loads(
        self, hub_id: HubId, day_type: str, hour: int
    ) -> tuple[RouteLoad, ...]: ...

    def analytical_view(self, view: str) -> tuple[AnalyticalRecord, ...]: ...

    def evaluation(self, name: str) -> EvaluationArtifact | None: ...


class SnapshotReader:
    def __init__(self, snapshot: DataSnapshot) -> None:
        self._snapshot = snapshot
        self._cache: dict[tuple[object, ...], object] = {}

    @property
    def metadata(self) -> SnapshotMetadata:
        return self._snapshot.metadata

    def forecast(
        self, hub_id: HubId, as_of: datetime
    ) -> tuple[ForecastVintage, tuple[ForecastBucket, ...]] | None:
        key = self._key("forecast", hub_id, as_of)
        if key not in self._cache:
            available = [
                vintage
                for vintage in self._snapshot.forecast_vintages
                if vintage.issued_at <= as_of
                and vintage.model_version == self.metadata.model_version
                and vintage.source_version == self.metadata.source_version
            ]
            if not available:
                self._cache[key] = None
            else:
                vintage = max(available, key=lambda row: row.issued_at)
                buckets = tuple(
                    sorted(
                        (
                            bucket
                            for bucket in self._snapshot.forecast_buckets
                            if bucket.vintage_id == vintage.id
                            and bucket.hub_id == hub_id
                        ),
                        key=lambda row: row.target_hour,
                    )
                )
                self._cache[key] = (vintage, buckets)
        result = self._cache[key]
        return result if isinstance(result, tuple) else None

    def actuals(
        self, hub_id: HubId, start: datetime, end: datetime, as_of: datetime
    ) -> tuple[ActualDemand, ...]:
        key = self._key("actuals", hub_id, start, end, as_of)
        if key not in self._cache:
            self._cache[key] = tuple(
                row
                for row in self._snapshot.actuals
                if row.hub_id == hub_id
                and start <= row.hour < end
                and row.available_at <= as_of
                and row.hour < as_of.replace(minute=0, second=0, microsecond=0)
            )
        return _typed_tuple(self._cache[key], ActualDemand)

    def baseline(
        self, hub_id: HubId, target_hour: datetime, issued_at: datetime
    ) -> Baseline | None:
        key = self._key("baseline", hub_id, target_hour, issued_at)
        if key not in self._cache:
            self._cache[key] = next(
                (
                    row
                    for row in self._snapshot.baselines
                    if row.hub_id == hub_id
                    and row.target_hour == target_hour
                    and row.issued_at == issued_at
                ),
                None,
            )
        result = self._cache[key]
        return result if isinstance(result, Baseline) else None

    def origins(
        self, hub_id: HubId, hour: datetime, as_of: datetime
    ) -> tuple[OriginDemand, ...]:
        key = self._key("origins", hub_id, hour, as_of)
        if key not in self._cache:
            hour_closed = hour < as_of.replace(minute=0, second=0, microsecond=0)
            self._cache[key] = tuple(
                row
                for row in self._snapshot.origins
                if row.hub_id == hub_id
                and row.hour == hour
                and row.available_at <= as_of
                and hour_closed
            )
        return _typed_tuple(self._cache[key], OriginDemand)

    def hubs(self) -> tuple[HubDimension, ...]:
        return self._snapshot.hubs

    def origin_dimensions(self) -> tuple[OriginDimension, ...]:
        return self._snapshot.origin_dimensions

    def route_loads(
        self, hub_id: HubId, day_type: str, hour: int
    ) -> tuple[RouteLoad, ...]:
        key = self._key("route_loads", hub_id, day_type, hour)
        if key not in self._cache:
            self._cache[key] = tuple(
                row
                for row in self._snapshot.route_loads
                if row.hub_id == hub_id
                and row.day_type == day_type
                and row.hour == hour
            )
        return _typed_tuple(self._cache[key], RouteLoad)

    def analytical_view(self, view: str) -> tuple[AnalyticalRecord, ...]:
        key = self._key("analytical", view)
        if key not in self._cache:
            self._cache[key] = tuple(
                row for row in self._snapshot.analytical_records if row.view == view
            )
        return _typed_tuple(self._cache[key], AnalyticalRecord)

    def evaluation(self, name: str) -> EvaluationArtifact | None:
        key = self._key("evaluation", name)
        if key not in self._cache:
            self._cache[key] = next(
                (row for row in self._snapshot.evaluations if row.name == name), None
            )
        result = self._cache[key]
        return result if isinstance(result, EvaluationArtifact) else None

    def _key(self, operation: str, *parameters: object) -> tuple[object, ...]:
        return (
            self.metadata.source_version,
            self.metadata.model_version,
            operation,
            *parameters,
        )


def _typed_tuple[T](value: object, item_type: type[T]) -> tuple[T, ...]:
    if not isinstance(value, tuple) or not all(
        isinstance(item, item_type) for item in value
    ):
        raise TypeError("invalid cached value")
    return value
