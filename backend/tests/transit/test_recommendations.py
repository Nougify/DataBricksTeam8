from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.config import Settings
from app.data.adapters import FixtureEventSource
from app.domain.models import (
    DispatchEvent,
    EventStatus,
    RecommendationFailureCode,
    RecommendationMappingStatus,
)
from app.transit import (
    RecommendationMapper,
    TransitDataError,
    build_fixture_transit_index,
)
from app.transit.mappings import (
    DispatchPathMapping,
    RecommendationMappingArtifact,
)

PACIFIC = timezone(-timedelta(hours=7))
START = datetime(2026, 7, 10, 9, tzinfo=PACIFIC)
END = datetime(2026, 7, 10, 15, tzinfo=PACIFIC)


def fixture_event() -> DispatchEvent:
    return FixtureEventSource("test-v1").load_window(START, END).events[0]


def fixture_mapper(settings: Settings | None = None) -> RecommendationMapper:
    resolved = settings or Settings()
    return RecommendationMapper(
        build_fixture_transit_index(
            resolved.gtfs_feed_version,
            resolved.gtfs_service_day_mapping,
        ),
        resolved,
    )


def test_mapper_resolves_first_feasible_recommendation_and_preserves_fallback() -> None:
    event = fixture_mapper().resolve_event(fixture_event())

    primary, fallback = event.recommendations
    assert event.status is EventStatus.PENDING
    assert event.suggested_extra_buses == 2
    assert primary.mapping_status is RecommendationMappingStatus.RESOLVED
    assert primary.route_id == "fixture-99"
    assert primary.candidates[0].pattern_id == "fixture-pattern-99"
    assert primary.candidates[0].source_stop_id == "UBC1"
    assert primary.candidates[0].destination_stop_id == "ALMA"
    assert fallback.mapping_status is RecommendationMappingStatus.INVALID
    assert fallback.failure_code is RecommendationFailureCode.UNKNOWN_ROUTE


def test_unknown_destination_falls_back_to_route_terminal() -> None:
    event = fixture_event()
    unknown_destination = event.model_copy(
        update={
            "recommendations": (
                event.recommendations[0].model_copy(
                    update={"destination": "Not a GTFS stop"}
                ),
            )
        }
    )

    destination_result = fixture_mapper().resolve_event(unknown_destination)

    recommendation = destination_result.recommendations[0]
    assert destination_result.status is EventStatus.PENDING
    assert recommendation.destination == "Not a GTFS stop"
    assert recommendation.mapping_status is RecommendationMappingStatus.RESOLVED
    assert recommendation.candidates[0].destination_stop_id == "ALMA"


def test_saved_dispatch_path_is_used_before_runtime_mapping(tmp_path: Path) -> None:
    mapping_path = tmp_path / "recommendation-mappings.json"
    mapping_path.write_text(
        RecommendationMappingArtifact(
            gtfs_feed_version="fall-2026",
            mappings=(
                DispatchPathMapping(
                    hub_id="ubc",
                    route_key="Saved route",
                    route_id="fixture-99",
                    pattern_id="fixture-pattern-99",
                    source_stop_id="UBC1",
                    source_stop_sequence=1,
                    destination_stop_id="ALMA",
                    destination_stop_sequence=2,
                ),
            ),
        ).model_dump_json(),
        encoding="utf-8",
    )
    event = fixture_event()
    recommendation = event.recommendations[0].model_copy(
        update={"source_route": "Saved route", "destination": "Unmapped area"}
    )
    event = event.model_copy(update={"recommendations": (recommendation,)})
    settings = Settings(recommendation_mappings_path=mapping_path)

    result = fixture_mapper(settings).resolve_event(event).recommendations[0]

    assert result.mapping_status is RecommendationMappingStatus.RESOLVED
    assert result.route_id == "fixture-99"
    assert result.candidates[0].pattern_id == "fixture-pattern-99"
    assert result.candidates[0].destination_stop_id == "ALMA"


def test_incompatible_direction_is_typed() -> None:
    event = fixture_event()
    directed = event.model_copy(
        update={"source": event.source.model_copy(update={"direction": "1"})}
    )
    direction_result = fixture_mapper().resolve_event(directed)

    assert direction_result.status is EventStatus.NO_MATCHING_ROUTE
    assert (
        direction_result.recommendations[0].failure_code
        is RecommendationFailureCode.INCOMPATIBLE_DIRECTION
    )


def test_route_must_serve_hub_and_destination_must_be_downstream() -> None:
    event = fixture_event()
    other_hub = event.model_copy(update={"hub_id": "waterfront"})
    origin_destination = event.model_copy(
        update={
            "recommendations": (
                event.recommendations[0].model_copy(update={"destination": "Origin"}),
            )
        }
    )
    settings = Settings(destination_aliases={"Origin": ("UBC1",)})

    hub_result = fixture_mapper().resolve_event(other_hub)
    destination_result = fixture_mapper(settings).resolve_event(origin_destination)

    assert (
        hub_result.recommendations[0].failure_code
        is RecommendationFailureCode.ROUTE_NOT_SERVING_HUB
    )
    assert (
        destination_result.recommendations[0].failure_code
        is RecommendationFailureCode.DESTINATION_NOT_ON_ROUTE
    )


def test_out_of_coverage_date_records_representative_service_date() -> None:
    event = fixture_event().model_copy(
        update={"event_time": datetime(2025, 12, 3, 10, tzinfo=PACIFIC)}
    )

    result = fixture_mapper().resolve_event(event)
    candidate = result.recommendations[0].candidates[0]

    assert candidate.requested_service_date.isoformat() == "2025-12-03"
    assert candidate.feed_service_date.isoformat() == "2026-10-14"
    assert candidate.representative_service is True


def test_alias_targets_are_validated_at_startup() -> None:
    settings = Settings(destination_aliases={"Downtown": ("missing-stop",)})

    with pytest.raises(TransitDataError, match="unknown stop"):
        fixture_mapper(settings)
