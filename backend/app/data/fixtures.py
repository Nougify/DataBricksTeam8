from datetime import datetime

from app.config import DataMode
from app.data.models import DataSnapshot


def build_fixture_snapshot(source_version: str, model_version: str) -> DataSnapshot:
    """Build the explicit, deterministic development dataset."""
    issued_at = "2026-07-10T10:00:00-07:00"
    vintage_id = "fixture-vintage-20260710T10"
    payload = {
        "metadata": {
            "source_mode": DataMode.FIXTURE,
            "source_version": source_version,
            "model_version": model_version,
            "generated_at": "2026-07-10T10:00:00-07:00",
            "fresh_through": "2027-01-01T00:00:00-07:00",
            "coverage_start": "2026-07-10T08:00:00-07:00",
            "coverage_end": "2026-07-10T15:00:00-07:00",
            "provenance": (
                "Explicit deterministic fixture; not observed production data"
            ),
        },
        "forecast_vintages": [
            {
                "id": vintage_id,
                "issued_at": issued_at,
                "trained_through": "2026-07-10T09:00:00-07:00",
                "model_name": "fixture-hourly",
                "model_version": model_version,
                "source_version": source_version,
                "normalization_policy": "fixture Vancouver hourly buckets",
            }
        ],
        "forecast_buckets": [
            {
                "id": f"fixture-bucket-{hour}",
                "vintage_id": vintage_id,
                "hub_id": "ubc",
                "target_hour": f"2026-07-10T{hour:02d}:00:00-07:00",
                "lead_h": hour - 10,
                "forecast": forecast,
                "lower_80": lower,
                "upper_80": upper,
                "typical_pings": 100,
            }
            for hour, forecast, lower, upper in (
                (11, 102, 90, 115),
                (12, 175, 145, 205),
                (13, 140, 115, 165),
                (14, 98, 85, 112),
            )
        ],
        "actuals": [
            {
                "hub_id": "ubc",
                "hour": "2026-07-10T08:00:00-07:00",
                "pings": 96,
                "available_at": "2026-07-10T09:00:00-07:00",
            },
            {
                "hub_id": "ubc",
                "hour": "2026-07-10T09:00:00-07:00",
                "pings": 101,
                "available_at": "2026-07-10T10:00:00-07:00",
            },
            {
                "hub_id": "ubc",
                "hour": "2026-07-10T10:00:00-07:00",
                "pings": 104,
                "available_at": "2026-07-10T11:00:00-07:00",
            },
            {
                "hub_id": "ubc",
                "hour": "2026-07-10T11:00:00-07:00",
                "pings": 180,
                "available_at": "2026-07-10T12:00:00-07:00",
            },
            # 12:00 is deliberately absent to exercise explicit missing data.
            {
                "hub_id": "ubc",
                "hour": "2026-07-10T13:00:00-07:00",
                "pings": 99,
                "available_at": "2026-07-10T14:00:00-07:00",
            },
        ],
        "baselines": [
            {
                "hub_id": "ubc",
                "target_hour": f"2026-07-10T{hour:02d}:00:00-07:00",
                "issued_at": issued_at,
                "typical_pings": 100,
                "sample_count": 8,
                "lookback_start": "2026-05-15T00:00:00-07:00",
                "lookback_end": "2026-07-03T23:00:00-07:00",
                "basis": "same hub/day type/hour; trailing eight fixture weeks",
            }
            for hour in (11, 12, 13, 14)
        ],
        "origins": [
            {
                "hub_id": "ubc",
                "hour": "2026-07-10T11:00:00-07:00",
                "origin_id": origin_id,
                "pings": pings,
                "share_pct": share,
                "available_at": "2026-07-10T12:00:00-07:00",
            }
            for origin_id, pings, share in (
                ("kitsilano", 81, 45),
                ("downtown", 63, 35),
                ("other", 36, 20),
            )
        ],
        "hubs": [
            {
                "hub_id": "ubc",
                "name": "UBC Exchange",
                "location": {"lat": 49.2676, "lon": -123.2479},
                "catchment": "UBC campus fixture catchment",
            }
        ],
        "origin_dimensions": [
            {
                "origin_id": "kitsilano",
                "name": "Kitsilano",
                "centroid": {"lat": 49.2684, "lon": -123.1683},
            },
            {
                "origin_id": "downtown",
                "name": "Downtown Vancouver",
                "centroid": {"lat": 49.2827, "lon": -123.1207},
            },
            {"origin_id": "other", "name": "Other", "centroid": None},
        ],
        "route_loads": [
            {
                "hub_id": "ubc",
                "route_id": "99",
                "day_type": "mf",
                "hour": 11,
                "load_pct": 112,
                "observed_period": "TSPR 2025 fixture reference",
                "load_basis": "representative fixed scenario, not live load",
            },
            {
                "hub_id": "ubc",
                "route_id": "44",
                "day_type": "mf",
                "hour": 11,
                "load_pct": 68,
                "observed_period": "TSPR 2025 fixture reference",
                "load_basis": "representative fixed scenario, not live load",
            },
        ],
        "analytical_records": [
            {
                "view": "timeline",
                "key": "ubc-2026-07-10",
                "period_start": "2026-07-10",
                "period_end": "2026-07-10",
                "source_label": "fixture retrospective view",
                "values": {"hub_id": "ubc", "peak_pings": 180},
            }
        ],
        "evaluations": [],
    }
    # Validation is intentionally identical to external snapshots.
    return DataSnapshot.model_validate(payload)


def fixture_now() -> datetime:
    return datetime.fromisoformat("2026-09-26T12:00:00-07:00")
