from datetime import datetime

from app.data.models import DispatchEventRow


def build_fixture_rows(source_version: str) -> list[DispatchEventRow]:
    common = {
        "source_version": source_version,
        "generated_at": "2026-07-10T09:00:00-07:00",
        "source_location": "ubc",
        "hub_id": "ubc",
        "surge_type": "EVENT",
        "direction": "0",
        "predicted_people": 250.0,
        "normal_people": 100.0,
    }
    return [
        DispatchEventRow(
            event_id="valid-event",
            recommendation_id="r1",
            event_time="2026-07-10T10:00:00-07:00",
            available_at="2026-07-10T09:30:00-07:00",
            destination="Commercial-Broadway Station",
            destination_share=60,
            source_route="99",
            extra_bus_trips_est=1.2,
            priority_score=0.9,
            **common,
        ),
        DispatchEventRow(
            event_id="valid-event",
            recommendation_id="r2",
            event_time="2026-07-10T10:00:00-07:00",
            available_at="2026-07-10T09:30:00-07:00",
            destination="Downtown",
            destination_share=40,
            source_route="44",
            extra_bus_trips_est=0.5,
            priority_score=0.6,
            **common,
        ),
        DispatchEventRow(
            event_id="too-many-buses",
            recommendation_id="r1",
            event_time="2026-07-10T12:00:00-07:00",
            destination="Commercial-Broadway Station",
            destination_share=100,
            source_route="99",
            extra_bus_trips_est=9.1,
            priority_score=1,
            **common,
        ),
        DispatchEventRow(
            event_id="same-time-a",
            recommendation_id="r1",
            event_time="2026-07-10T13:00:00-07:00",
            destination="Commercial-Broadway Station",
            destination_share=100,
            source_route="99",
            extra_bus_trips_est=1,
            priority_score=1,
            **common,
        ),
        DispatchEventRow(
            event_id="same-time-b",
            recommendation_id="r1",
            event_time="2026-07-10T13:00:00-07:00",
            destination="Downtown",
            destination_share=100,
            source_route="44",
            extra_bus_trips_est=1,
            priority_score=1,
            **common,
        ),
        DispatchEventRow(
            event_id="outside-window",
            recommendation_id="r1",
            event_time="2026-07-11T10:00:00-07:00",
            destination="Commercial-Broadway Station",
            destination_share=100,
            source_route="99",
            extra_bus_trips_est=1,
            priority_score=1,
            **common,
        ),
    ]


def fixture_now() -> datetime:
    return datetime.fromisoformat("2026-07-10T09:00:00-07:00")
