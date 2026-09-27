import pytest
from pydantic import ValidationError

from app.domain.events import EventType, PendingEvent, StateChangeReason
from app.domain.models import Bus, DispatchEvent
from tests.domain.test_models import bus_payload, dispatch_event_payload


def test_v3_event_vocabulary_and_state_reasons_are_exact() -> None:
    assert {event.value for event in EventType} == {
        "clock.updated",
        "dispatch_event.updated",
        "proposal.created",
        "proposal.updated",
        "trip.updated",
        "bus.updated",
        "system.reset",
        "system.error",
    }
    assert {reason.value for reason in StateChangeReason} == {
        "PAUSED",
        "RESUMED",
        "SPEED",
        "SETTINGS",
        "AUTO_PAUSE_PROPOSAL",
    }


def test_event_type_rejects_an_incompatible_typed_payload() -> None:
    with pytest.raises(ValidationError, match="incompatible payload"):
        PendingEvent(
            type=EventType.DISPATCH_EVENT_UPDATED,
            simulation_time="2026-07-01T10:00:00-07:00",
            data=Bus.model_validate(bus_payload()),
        )


def test_event_rejects_non_vancouver_simulation_time() -> None:
    with pytest.raises(ValidationError, match="offset"):
        PendingEvent(
            type=EventType.DISPATCH_EVENT_UPDATED,
            simulation_time="2026-07-01T10:00:00Z",
            data=DispatchEvent.model_validate(dispatch_event_payload()),
        )
