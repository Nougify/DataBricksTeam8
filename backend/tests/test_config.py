from datetime import datetime

import pytest
from pydantic import AnyHttpUrl, ValidationError
from pytest import MonkeyPatch

from app.config import AppEnvironment, DataMode, Settings, TransitDataMode
from app.domain.models import DayType
from app.routing import RoutingProvider


def test_settings_have_v2_defaults() -> None:
    settings = Settings()

    assert settings.cors_origin_strings == [
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]
    assert settings.simulation_speed == 1
    assert settings.approval_mode == "MANUAL"
    assert settings.auto_pause_on_proposal is True
    assert settings.approval_timeout_minutes == 30
    assert settings.data_mode is DataMode.FIXTURE
    assert settings.transit_data_mode is TransitDataMode.FIXTURE
    assert settings.routing_provider is RoutingProvider.STRAIGHT_LINE
    assert settings.routing_speed_kph == 30
    assert settings.proactive_lateness_tolerance_seconds == 0


def test_settings_read_environment(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", '["https://example.com"]')
    monkeypatch.setenv("SIMULATION_SPEED", "300")
    monkeypatch.setenv("TRANSIT_DATA_MODE", "gtfs")

    settings = Settings()

    assert settings.app_env is AppEnvironment.TEST
    assert settings.cors_origin_strings == ["https://example.com"]
    assert settings.simulation_speed == 300
    assert settings.transit_data_mode is TransitDataMode.GTFS


@pytest.mark.parametrize("speed", [0, 2, 59, 3601])
def test_settings_reject_unsupported_simulation_speed(speed: int) -> None:
    with pytest.raises(ValidationError):
        Settings(simulation_speed=speed)


def test_settings_reject_negative_proactive_lateness_tolerance() -> None:
    with pytest.raises(ValidationError):
        Settings(proactive_lateness_tolerance_seconds=-1)


def test_settings_reject_start_outside_bounds() -> None:
    with pytest.raises(ValidationError, match="simulation_start_time"):
        Settings(
            simulation_min_time=datetime.fromisoformat("2026-01-01T00:00:00-08:00"),
            simulation_start_time=datetime.fromisoformat("2025-12-31T23:00:00-08:00"),
            simulation_max_time=datetime.fromisoformat("2026-01-02T00:00:00-08:00"),
        )


def test_settings_reject_origin_with_path() -> None:
    with pytest.raises(ValidationError, match="must not contain paths"):
        Settings(
            cors_origins=[AnyHttpUrl("https://example.com/application")],
        )


def test_settings_require_export_path_for_export_mode() -> None:
    with pytest.raises(ValidationError, match="exported_events_path"):
        Settings(data_mode=DataMode.EXPORTED_EVENTS)


def test_settings_require_databricks_connection_for_databricks_mode() -> None:
    with pytest.raises(ValidationError, match="Databricks host"):
        Settings(data_mode=DataMode.DATABRICKS)


def test_settings_reject_invalid_event_window() -> None:
    with pytest.raises(ValidationError, match="event_window_end"):
        Settings(event_window_end="2026-07-10T08:00:00-07:00")


def test_settings_validate_representative_service_dates() -> None:
    with pytest.raises(ValidationError, match="mf, sat, and sun_hol"):
        Settings(gtfs_service_day_mapping={DayType.MF: "2026-10-14"})

    with pytest.raises(ValidationError, match="wrong weekday"):
        Settings(
            gtfs_service_day_mapping={
                DayType.MF: "2026-10-17",
                DayType.SAT: "2026-10-14",
                DayType.SUN_HOL: "2026-10-18",
            }
        )


@pytest.mark.parametrize("speed", [0, -1, float("inf"), float("nan")])
def test_settings_reject_invalid_routing_speed(speed: float) -> None:
    with pytest.raises(ValidationError):
        Settings(routing_speed_kph=speed)
