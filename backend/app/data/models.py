from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Self

from pydantic import Field, model_validator

from app.config import DataMode
from app.domain.models import DomainModel, ForecastBucket, ForecastVintage, GeoPoint
from app.domain.types import (
    LoadPercentage,
    NonEmptyHubId,
    NonEmptyRouteId,
    NonEmptyText,
    NonNegativeFloat,
    NonNegativeInt,
    Percentage,
    VancouverDateTime,
)


class SnapshotMetadata(DomainModel):
    source_mode: DataMode
    source_version: NonEmptyText
    model_version: NonEmptyText
    generated_at: VancouverDateTime
    fresh_through: VancouverDateTime
    coverage_start: VancouverDateTime
    coverage_end: VancouverDateTime
    provenance: NonEmptyText

    @model_validator(mode="after")
    def valid_periods(self) -> Self:
        if self.coverage_end <= self.coverage_start:
            raise ValueError("coverage_end must be after coverage_start")
        if self.fresh_through < self.generated_at:
            raise ValueError("fresh_through must not precede generated_at")
        return self


class ActualDemand(DomainModel):
    hub_id: NonEmptyHubId
    hour: VancouverDateTime
    pings: NonNegativeInt
    available_at: VancouverDateTime
    source_granularity: NonEmptyText = "hour"

    @model_validator(mode="after")
    def valid_hour(self) -> Self:
        _require_hour(self.hour, "actual hour")
        if self.available_at < self.hour:
            raise ValueError("actual cannot be available before its hour")
        return self


class Baseline(DomainModel):
    hub_id: NonEmptyHubId
    target_hour: VancouverDateTime
    issued_at: VancouverDateTime
    typical_pings: NonNegativeFloat | None
    sample_count: NonNegativeInt
    lookback_start: VancouverDateTime | None
    lookback_end: VancouverDateTime | None
    basis: NonEmptyText

    @model_validator(mode="after")
    def valid_baseline(self) -> Self:
        _require_hour(self.target_hour, "baseline target_hour")
        if self.sample_count == 0:
            if self.typical_pings is not None:
                raise ValueError(
                    "baseline without samples must have null typical_pings"
                )
            if self.lookback_start is not None or self.lookback_end is not None:
                raise ValueError(
                    "baseline without samples must have no lookback period"
                )
        elif (
            self.typical_pings is None
            or self.lookback_start is None
            or self.lookback_end is None
        ):
            raise ValueError("sampled baseline requires value and lookback period")
        elif not self.lookback_start <= self.lookback_end < self.issued_at:
            raise ValueError("baseline lookback must be ordered and before issuance")
        return self


class OriginDemand(DomainModel):
    hub_id: NonEmptyHubId
    hour: VancouverDateTime
    origin_id: NonEmptyText
    pings: NonNegativeFloat
    share_pct: Percentage
    available_at: VancouverDateTime

    @model_validator(mode="after")
    def valid_hour(self) -> Self:
        _require_hour(self.hour, "origin hour")
        if self.available_at < self.hour:
            raise ValueError("origin data cannot be available before its hour")
        return self


class HubDimension(DomainModel):
    hub_id: NonEmptyHubId
    name: NonEmptyText
    location: GeoPoint
    catchment: NonEmptyText


class OriginDimension(DomainModel):
    origin_id: NonEmptyText
    name: NonEmptyText
    centroid: GeoPoint | None


class RouteLoad(DomainModel):
    hub_id: NonEmptyHubId
    route_id: NonEmptyRouteId
    day_type: NonEmptyText
    hour: Annotated[int, Field(ge=0, le=23)]
    load_pct: LoadPercentage
    observed_period: NonEmptyText
    load_basis: NonEmptyText


class AnalyticalRecord(DomainModel):
    view: NonEmptyText
    key: NonEmptyText
    period_start: date
    period_end: date
    source_label: NonEmptyText
    values: dict[str, Any]

    @model_validator(mode="after")
    def ordered_period(self) -> Self:
        if self.period_end < self.period_start:
            raise ValueError("analytical period_end must not precede period_start")
        return self


class EvaluationArtifact(DomainModel):
    name: NonEmptyText
    method: NonEmptyText
    input_version: NonEmptyText
    model_version: NonEmptyText
    period_start: date
    period_end: date
    metrics: dict[str, float | int | None]

    @model_validator(mode="after")
    def ordered_period(self) -> Self:
        if self.period_end < self.period_start:
            raise ValueError("evaluation period_end must not precede period_start")
        return self


class DataSnapshot(DomainModel):
    metadata: SnapshotMetadata
    forecast_vintages: tuple[ForecastVintage, ...]
    forecast_buckets: tuple[ForecastBucket, ...]
    actuals: tuple[ActualDemand, ...]
    baselines: tuple[Baseline, ...]
    origins: tuple[OriginDemand, ...]
    hubs: tuple[HubDimension, ...]
    origin_dimensions: tuple[OriginDimension, ...]
    route_loads: tuple[RouteLoad, ...]
    analytical_records: tuple[AnalyticalRecord, ...]
    evaluations: tuple[EvaluationArtifact, ...]

    @model_validator(mode="after")
    def validate_contract(self) -> Self:
        _require_unique(
            (vintage.id for vintage in self.forecast_vintages), "vintage id"
        )
        _require_unique((bucket.id for bucket in self.forecast_buckets), "bucket id")
        _require_unique(
            (
                (bucket.hub_id, bucket.vintage_id, bucket.target_hour)
                for bucket in self.forecast_buckets
            ),
            "forecast vintage key",
        )
        _require_unique(((row.hub_id, row.hour) for row in self.actuals), "actual key")
        _require_unique(
            ((row.hub_id, row.target_hour, row.issued_at) for row in self.baselines),
            "baseline key",
        )
        _require_unique(
            ((row.hub_id, row.hour, row.origin_id) for row in self.origins),
            "origin key",
        )
        _require_unique((row.hub_id for row in self.hubs), "hub id")
        _require_unique(
            (row.origin_id for row in self.origin_dimensions), "origin dimension id"
        )
        _require_unique(
            (
                (row.hub_id, row.route_id, row.day_type, row.hour)
                for row in self.route_loads
            ),
            "route load key",
        )
        _require_unique(
            ((row.view, row.key) for row in self.analytical_records),
            "analytical key",
        )
        _require_unique((row.name for row in self.evaluations), "evaluation name")

        vintages = {vintage.id: vintage for vintage in self.forecast_vintages}
        hubs = {hub.hub_id for hub in self.hubs}
        origins = {origin.origin_id for origin in self.origin_dimensions}
        for bucket in self.forecast_buckets:
            _require_hour(bucket.target_hour, "forecast target_hour")
            vintage = vintages.get(bucket.vintage_id)
            if vintage is None:
                raise ValueError(f"unknown forecast vintage: {bucket.vintage_id}")
            elapsed_hours = (
                bucket.target_hour - vintage.issued_at
            ).total_seconds() / 3600
            if elapsed_hours < 0 or abs(bucket.lead_h - elapsed_hours) > 1e-9:
                raise ValueError(
                    "forecast lead_h must equal elapsed hours from issuance"
                )
            if bucket.hub_id not in hubs:
                raise ValueError(f"unknown forecast hub: {bucket.hub_id}")
        if any(row.hub_id not in hubs for row in self.actuals):
            raise ValueError("actual references unknown hub")
        if any(row.hub_id not in hubs for row in self.baselines):
            raise ValueError("baseline references unknown hub")
        if any(
            row.hub_id not in hubs or row.origin_id not in origins
            for row in self.origins
        ):
            raise ValueError("origin demand references unknown dimension")
        if any(row.hub_id not in hubs for row in self.route_loads):
            raise ValueError("route load references unknown hub")

        timestamps = [
            *(row.hour for row in self.actuals),
            *(row.target_hour for row in self.baselines),
            *(row.hour for row in self.origins),
            *(row.target_hour for row in self.forecast_buckets),
        ]
        if not hubs or not timestamps:
            raise ValueError("snapshot has no usable operational coverage")
        if (
            min(timestamps) < self.metadata.coverage_start
            or max(timestamps) > self.metadata.coverage_end
        ):
            raise ValueError("data lies outside declared coverage")
        return self


def _require_hour(value: Any, label: str) -> None:
    if value.minute or value.second or value.microsecond:
        raise ValueError(f"{label} must be aligned to an hour")


def _require_unique(values: Any, label: str) -> None:
    seen: set[Any] = set()
    for value in values:
        if value in seen:
            raise ValueError(f"duplicate {label}: {value}")
        seen.add(value)
