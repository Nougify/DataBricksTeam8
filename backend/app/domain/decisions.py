from enum import StrEnum

from app.domain.models import DomainModel
from app.domain.types import (
    AdditionalTripId,
    BusId,
    DispatchEventId,
    NonEmptyAdditionalTripId,
    NonEmptyBusId,
    NonEmptyDispatchEventId,
    VancouverDateTime,
)


class HumanDecisionAction(StrEnum):
    APPROVE = "APPROVE"
    REJECT = "REJECT"


class PendingHumanDecision(DomainModel):
    trip_id: NonEmptyAdditionalTripId
    dispatch_event_id: NonEmptyDispatchEventId
    bus_id: NonEmptyBusId
    action: HumanDecisionAction
    decided_at: VancouverDateTime


class HumanDecision(PendingHumanDecision):
    order: int


def pending_decision(
    *,
    trip_id: AdditionalTripId,
    dispatch_event_id: DispatchEventId,
    bus_id: BusId,
    action: HumanDecisionAction,
    decided_at: VancouverDateTime,
) -> PendingHumanDecision:
    return PendingHumanDecision(
        trip_id=trip_id,
        dispatch_event_id=dispatch_event_id,
        bus_id=bus_id,
        action=action,
        decided_at=decided_at,
    )
