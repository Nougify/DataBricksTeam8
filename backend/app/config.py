from datetime import date, datetime
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import (
    AnyHttpUrl,
    AwareDatetime,
    Field,
    SecretStr,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.domain.models import DayType
from app.routing import RoutingProvider

AllowedSimulationSpeed = Literal[1, 60, 300, 900, 3600]
ApprovalMode = Literal["MANUAL"]
NonEmptyString = Annotated[str, StringConstraints(min_length=1)]
PositiveFloat = Annotated[float, Field(gt=0, allow_inf_nan=False)]
PositiveInt = Annotated[int, Field(gt=0)]
UnitWeight = Annotated[float, Field(ge=0, le=1)]


class AppEnvironment(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


class DataMode(StrEnum):
    DATABRICKS = "databricks"
    EXPORTED_SNAPSHOT = "exported_snapshot"
    FIXTURE = "fixture"


class ReturnPolicy(StrEnum):
    HOME = "home"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: AppEnvironment = AppEnvironment.DEVELOPMENT
    cors_origins: list[AnyHttpUrl] = Field(
        default_factory=lambda: [
            AnyHttpUrl("http://localhost:3001"),
            AnyHttpUrl("http://127.0.0.1:3001"),
        ]
    )

    simulation_min_time: Annotated[datetime, AwareDatetime] = datetime.fromisoformat(
        "2025-11-01T00:00:00-07:00"
    )
    simulation_start_time: Annotated[datetime, AwareDatetime] = datetime.fromisoformat(
        "2025-12-06T10:00:00-08:00"
    )
    simulation_max_time: Annotated[datetime, AwareDatetime] = datetime.fromisoformat(
        "2026-08-31T23:00:00-07:00"
    )
    simulation_speed: AllowedSimulationSpeed = 1
    approval_mode: ApprovalMode = "MANUAL"
    auto_pause_on_proposal: bool = True
    approval_timeout_minutes: PositiveInt = 30

    data_mode: DataMode = DataMode.FIXTURE
    data_snapshot_version: NonEmptyString = "development-fixture-v1"
    forecast_model_version: NonEmptyString = "development-fixture-v1"
    gtfs_feed_version: NonEmptyString = "fall-2026"
    exported_snapshot_path: Path | None = None
    databricks_host: AnyHttpUrl | None = None
    databricks_http_path: NonEmptyString | None = None
    databricks_token: SecretStr | None = None
    data_catalog: NonEmptyString | None = None
    data_schema: NonEmptyString | None = None

    fleet_size: Annotated[int, Field(ge=0)] = 3
    default_bus_capacity: PositiveInt = 50
    fleet_config_path: Path | None = None

    dispatch_lookahead_minutes: PositiveInt = 120
    max_proposals_per_surge: PositiveInt = 2
    origin_stop_radius_meters: PositiveFloat = 500
    destination_stop_radius_meters: PositiveFloat = 1500
    min_schedule_separation_seconds: PositiveInt = 900
    max_surge_departure_deviation_seconds: PositiveInt = 3600
    route_score_origin_proximity_weight: UnitWeight = 0.30
    route_score_destination_coverage_weight: UnitWeight = 0.30
    route_score_schedule_gap_weight: UnitWeight = 0.25
    route_score_deadhead_time_weight: UnitWeight = 0.15

    routing_provider: RoutingProvider = RoutingProvider.STRAIGHT_LINE
    routing_speed_kph: PositiveFloat = 30
    return_policy: ReturnPolicy = ReturnPolicy.HOME
    gtfs_source: Path = Path("data/gtfs")
    gtfs_service_day_mapping: dict[DayType, date] = Field(
        default_factory=lambda: {
            DayType.MF: date(2026, 10, 14),
            DayType.SAT: date(2026, 10, 17),
            DayType.SUN_HOL: date(2026, 10, 18),
        }
    )

    @field_validator("simulation_speed", mode="before")
    @classmethod
    def parse_simulation_speed(cls, value: object) -> object:
        if isinstance(value, str) and value.isdecimal():
            return int(value)
        return value

    @property
    def cors_origin_strings(self) -> list[str]:
        return [str(origin).rstrip("/") for origin in self.cors_origins]

    @model_validator(mode="after")
    def validate_configuration(self) -> Self:
        if not self.cors_origins:
            raise ValueError("cors_origins must contain at least one origin")

        for origin in self.cors_origins:
            if origin.path not in {None, "/"} or origin.query or origin.fragment:
                raise ValueError(
                    "cors_origins entries must not contain paths or queries"
                )

        if not (
            self.simulation_min_time
            <= self.simulation_start_time
            <= self.simulation_max_time
        ):
            raise ValueError(
                "simulation_start_time must be within the simulation bounds"
            )

        required_day_types = {DayType.MF, DayType.SAT, DayType.SUN_HOL}
        if set(self.gtfs_service_day_mapping) != required_day_types:
            raise ValueError(
                "gtfs_service_day_mapping must define mf, sat, and sun_hol"
            )
        expected_weekdays = {
            DayType.MF: set(range(5)),
            DayType.SAT: {5},
            DayType.SUN_HOL: {6},
        }
        for day_type, service_date in self.gtfs_service_day_mapping.items():
            if service_date.weekday() not in expected_weekdays[day_type]:
                raise ValueError(
                    f"representative date for {day_type.value} has wrong weekday"
                )

        score_weight_total = (
            self.route_score_origin_proximity_weight
            + self.route_score_destination_coverage_weight
            + self.route_score_schedule_gap_weight
            + self.route_score_deadhead_time_weight
        )
        if abs(score_weight_total - 1.0) > 1e-9:
            raise ValueError("route scoring weights must sum to 1")

        if (
            self.data_mode is DataMode.EXPORTED_SNAPSHOT
            and self.exported_snapshot_path is None
        ):
            raise ValueError(
                "exported_snapshot_path is required in exported_snapshot mode"
            )

        if self.data_mode is DataMode.DATABRICKS:
            required_databricks_values = (
                self.databricks_host,
                self.databricks_http_path,
                self.databricks_token,
                self.data_catalog,
                self.data_schema,
            )
            if any(value is None for value in required_databricks_values):
                raise ValueError(
                    "Databricks host, HTTP path, token, catalog, and schema are "
                    "required in databricks mode"
                )

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
