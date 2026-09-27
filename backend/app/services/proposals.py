from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, timedelta
from math import ceil

from app.config import Settings
from app.domain.decisions import HumanDecisionAction, pending_decision
from app.domain.events import EventType, PendingEvent
from app.domain.models import (
    AdditionalTrip,
    AdditionalTripStatus,
    Bus,
    BusStatus,
    DispatchEvent,
    EventRecommendation,
    EventStatus,
    MovementPlan,
    RecommendationCandidate,
    RecommendationMappingStatus,
    SimulationClock,
)
from app.domain.types import (
    AdditionalTripId,
    BusId,
    DispatchEventId,
    VancouverDateTime,
)
from app.fleet import available_buses
from app.repositories.memory import StateEditor
from app.routing import ItineraryComposer, MovementPlanFailure
from app.services.clock import (
    BoundaryPriority,
    BoundaryRegistration,
    BoundaryResult,
    SimulationClockController,
)
from app.services.coordinator import Mutation, MutationCoordinator
from app.services.movement import MovementLifecycleService
from app.services.trip_status import aggregate_dispatch_event

PROPOSAL_BOUNDARY_NAMESPACE = "proposal"


class ProposalNotFoundError(LookupError):
    pass


class ProposalConflictError(RuntimeError):
    pass


@dataclass(frozen=True)
class ProposalCreation:
    events: tuple[PendingEvent, ...]
    registrations: tuple[BoundaryRegistration, ...]
    request_auto_pause: bool


@dataclass(frozen=True)
class ProposalDecision:
    trip: AdditionalTrip
    conflict_reason: str | None = None
    registrations: tuple[BoundaryRegistration, ...] = ()


@dataclass(frozen=True)
class _Choice:
    recommendation: EventRecommendation
    candidate: RecommendationCandidate
    bus: Bus
    plan: MovementPlan


class ProposalService:
    def __init__(
        self,
        coordinator: MutationCoordinator,
        itinerary: ItineraryComposer,
        settings: Settings,
        clock: SimulationClockController,
        movement: MovementLifecycleService,
    ) -> None:
        self._coordinator = coordinator
        self._itinerary = itinerary
        self._settings = settings
        self._clock = clock
        self._movement = movement

    def create_for_event(
        self,
        editor: StateEditor,
        clock: SimulationClock,
        event: DispatchEvent,
    ) -> ProposalCreation:
        if event.additional_trip_ids:
            return ProposalCreation((), (), False)
        if event.status in {EventStatus.INVALID_SOURCE, EventStatus.NO_MATCHING_ROUTE}:
            return ProposalCreation((self._event_update(event, clock),), (), False)

        buses = available_buses(editor.buses())
        selected: tuple[_Choice, ...] | None = None
        selected_recommendation: EventRecommendation | None = None
        for recommendation in event.recommendations:
            if (
                recommendation.mapping_status
                is not RecommendationMappingStatus.RESOLVED
            ):
                continue
            requested = ceil(recommendation.extra_bus_trips_est)
            if requested == 0:
                updated = event.model_copy(
                    update={
                        "status": EventStatus.NO_ACTION_REQUIRED,
                        "suggested_extra_buses": 0,
                        "priority_score": recommendation.priority_score,
                    }
                )
                editor.put_dispatch_event(updated)
                return ProposalCreation(
                    (self._event_update(updated, clock),), (), False
                )
            choices = self._rank_choices(event, recommendation, buses, clock)
            if choices:
                selected = choices
                selected_recommendation = recommendation
                break

        if selected is None or selected_recommendation is None:
            updated = event.model_copy(update={"status": EventStatus.NO_BUS_AVAILABLE})
            editor.put_dispatch_event(updated)
            return ProposalCreation((self._event_update(updated, clock),), (), False)

        count = min(
            ceil(selected_recommendation.extra_bus_trips_est),
            self._settings.max_buses_per_event,
            len(selected),
        )
        choices = selected[:count]
        expires_at = clock.current_time + timedelta(
            minutes=self._settings.approval_timeout_minutes
        )
        manual = self._settings.approval_mode == "MANUAL"
        if manual and expires_at > clock.max_time:
            expires_at = clock.max_time
        if manual and expires_at <= clock.current_time:
            updated = event.model_copy(update={"status": EventStatus.EXPIRED})
            editor.put_dispatch_event(updated)
            return ProposalCreation((self._event_update(updated, clock),), (), False)

        trips: list[AdditionalTrip] = []
        pending: list[PendingEvent] = []
        registrations: list[BoundaryRegistration] = []
        for choice in choices:
            trip = self._build_trip(
                event,
                choice,
                clock,
                expires_at,
                manual=manual,
            )
            current_bus = editor.bus(BusId(choice.bus.id))
            if (
                current_bus is None
                or current_bus.status is not BusStatus.AVAILABLE
                or current_bus.proposed_trip_id is not None
                or current_bus.assigned_trip_id is not None
            ):
                raise ProposalConflictError(
                    f"bus is no longer available: {choice.bus.id}"
                )
            updated_bus = current_bus.model_copy(
                update={
                    "status": BusStatus.RESERVED,
                    "proposed_trip_id": trip.id if manual else None,
                    "assigned_trip_id": None if manual else trip.id,
                }
            )
            editor.put_trip(trip)
            editor.put_bus(updated_bus)
            trips.append(trip)
            pending.extend(
                (
                    PendingEvent(
                        type=EventType.PROPOSAL_CREATED,
                        simulation_time=clock.current_time,
                        data=trip,
                    ),
                    PendingEvent(
                        type=EventType.BUS_UPDATED,
                        simulation_time=clock.current_time,
                        data=updated_bus,
                    ),
                )
            )
            if manual:
                registrations.append(self._expiry_registration(trip))

        updated_event = event.model_copy(
            update={
                "status": (
                    EventStatus.AWAITING_APPROVAL if manual else EventStatus.DISPATCHED
                ),
                "additional_trip_ids": tuple(trip.id for trip in trips),
                "suggested_extra_buses": ceil(
                    selected_recommendation.extra_bus_trips_est
                ),
                "priority_score": selected_recommendation.priority_score,
            }
        )
        editor.put_dispatch_event(updated_event)
        pending.append(self._event_update(updated_event, clock))
        if not manual:
            for trip in trips:
                movement = self._movement.start_approved(editor, clock, trip)
                pending.extend(movement.events)
                registrations.extend(movement.registrations)
        return ProposalCreation(
            tuple(pending),
            tuple(registrations),
            request_auto_pause=manual and bool(trips),
        )

    def approve(self, trip_id: AdditionalTripId) -> ProposalDecision:
        return self._clock.transact_with_boundaries(
            lambda editor, clock: self.approve_transition(
                editor, clock, trip_id, record_decision=True
            ),
            lambda decision: decision.registrations,
        )

    def reject(self, trip_id: AdditionalTripId) -> ProposalDecision:
        return self._clock.transact_with_boundaries(
            lambda editor, clock: self.reject_transition(
                editor, clock, trip_id, record_decision=True
            ),
            lambda decision: decision.registrations,
        )

    def approve_transition(
        self,
        editor: StateEditor,
        clock: SimulationClock,
        trip_id: AdditionalTripId,
        *,
        record_decision: bool = False,
    ) -> Mutation[ProposalDecision]:
        trip = editor.trip(trip_id)
        if trip is None:
            raise ProposalNotFoundError(str(trip_id))
        if trip.status in {
            AdditionalTripStatus.APPROVED,
            AdditionalTripStatus.BUS_EN_ROUTE,
            AdditionalTripStatus.IN_SERVICE,
            AdditionalTripStatus.COMPLETED,
        }:
            return Mutation(ProposalDecision(trip))
        if trip.status is not AdditionalTripStatus.PROPOSED:
            raise ProposalConflictError("trip is not proposed")
        if clock.current_time >= trip.approval_expires_at:
            raise ProposalConflictError("proposal has expired")
        bus = editor.bus(BusId(trip.bus_id))
        event = editor.dispatch_event(DispatchEventId(trip.dispatch_event_id))
        if bus is None or bus.proposed_trip_id != trip.id or event is None:
            raise ProposalConflictError("proposal reservation is inconsistent")
        if trip.selected_candidate is None:
            raise ProposalConflictError("proposal candidate is missing")
        planned = self._itinerary.compose(
            event, trip.selected_candidate, bus, clock.current_time
        )
        if isinstance(planned, MovementPlanFailure):
            cancelled, events = self._finish_proposal(
                editor, clock, trip, AdditionalTripStatus.CANCELLED
            )
            mutation = Mutation(
                ProposalDecision(cancelled, planned.reason),
                events,
            )
            return self._record_decision(
                mutation,
                trip,
                HumanDecisionAction.APPROVE,
                clock,
                record_decision,
            )
        if planned.estimated_return_time > clock.max_time:
            cancelled, events = self._finish_proposal(
                editor, clock, trip, AdditionalTripStatus.CANCELLED
            )
            mutation = Mutation(
                ProposalDecision(cancelled, "movement plan exceeds simulation bounds"),
                events,
            )
            return self._record_decision(
                mutation,
                trip,
                HumanDecisionAction.APPROVE,
                clock,
                record_decision,
            )
        approved = trip.model_copy(
            update={
                "status": AdditionalTripStatus.APPROVED,
                "dispatch_time": planned.dispatch_time,
                "estimated_arrival_time": planned.estimated_arrival_time,
                "service_departure_time": planned.service_departure_time,
                "estimated_completion_time": planned.estimated_completion_time,
                "movement_plan": planned,
            }
        )
        updated_bus = bus.model_copy(
            update={
                "proposed_trip_id": None,
                "assigned_trip_id": trip.id,
                "status": BusStatus.RESERVED,
            }
        )
        editor.put_trip(approved)
        editor.put_bus(updated_bus)
        updated_event = self._aggregate_event(editor, event)
        editor.put_dispatch_event(updated_event)
        movement = self._movement.start_approved(editor, clock, approved)
        mutation = Mutation(
            ProposalDecision(movement.trip, registrations=movement.registrations),
            (
                self._proposal_update(approved, clock),
                self._bus_update(updated_bus, clock),
                self._event_update(updated_event, clock),
            )
            + movement.events,
        )
        return self._record_decision(
            mutation,
            trip,
            HumanDecisionAction.APPROVE,
            clock,
            record_decision,
        )

    def reject_transition(
        self,
        editor: StateEditor,
        clock: SimulationClock,
        trip_id: AdditionalTripId,
        *,
        record_decision: bool = False,
    ) -> Mutation[ProposalDecision]:
        trip = editor.trip(trip_id)
        if trip is None:
            raise ProposalNotFoundError(str(trip_id))
        if trip.status is AdditionalTripStatus.REJECTED:
            return Mutation(ProposalDecision(trip))
        if trip.status is not AdditionalTripStatus.PROPOSED:
            raise ProposalConflictError("trip is not proposed")
        rejected, events = self._finish_proposal(
            editor, clock, trip, AdditionalTripStatus.REJECTED
        )
        mutation = Mutation(ProposalDecision(rejected), events)
        return self._record_decision(
            mutation,
            trip,
            HumanDecisionAction.REJECT,
            clock,
            record_decision,
        )

    @staticmethod
    def _record_decision(
        mutation: Mutation[ProposalDecision],
        trip: AdditionalTrip,
        action: HumanDecisionAction,
        clock: SimulationClock,
        enabled: bool,
    ) -> Mutation[ProposalDecision]:
        if not enabled:
            return mutation
        decision = pending_decision(
            trip_id=trip.id,
            dispatch_event_id=trip.dispatch_event_id,
            bus_id=trip.bus_id,
            action=action,
            decided_at=clock.current_time,
        )
        return Mutation(
            mutation.value,
            mutation.events,
            mutation.clock,
            (decision,),
        )

    def _expiry_registration(self, trip: AdditionalTrip) -> BoundaryRegistration:
        def expire(editor: StateEditor, clock: SimulationClock) -> BoundaryResult:
            current = editor.trip(AdditionalTripId(trip.id))
            if current is None or current.status is not AdditionalTripStatus.PROPOSED:
                return BoundaryResult()
            _, events = self._finish_proposal(
                editor, clock, current, AdditionalTripStatus.EXPIRED
            )
            return BoundaryResult(events=events)

        return BoundaryRegistration(
            at=trip.approval_expires_at,
            priority=BoundaryPriority.PROPOSAL_EXPIRY,
            handler=expire,
            key=(PROPOSAL_BOUNDARY_NAMESPACE, f"expire:{trip.id}"),
        )

    def _finish_proposal(
        self,
        editor: StateEditor,
        clock: SimulationClock,
        trip: AdditionalTrip,
        status: AdditionalTripStatus,
    ) -> tuple[AdditionalTrip, tuple[PendingEvent, ...]]:
        bus = editor.bus(BusId(trip.bus_id))
        event = editor.dispatch_event(DispatchEventId(trip.dispatch_event_id))
        if bus is None or event is None or bus.proposed_trip_id != trip.id:
            raise ProposalConflictError("proposal reservation is inconsistent")
        finished = trip.model_copy(update={"status": status})
        released = bus.model_copy(
            update={
                "status": BusStatus.AVAILABLE,
                "proposed_trip_id": None,
                "assigned_trip_id": None,
            }
        )
        editor.put_trip(finished)
        editor.put_bus(released)
        updated_event = self._aggregate_event(editor, event)
        editor.put_dispatch_event(updated_event)
        return finished, (
            self._proposal_update(finished, clock),
            self._bus_update(released, clock),
            self._event_update(updated_event, clock),
        )

    def _aggregate_event(
        self, editor: StateEditor, event: DispatchEvent
    ) -> DispatchEvent:
        return aggregate_dispatch_event(editor, event)

    def _rank_choices(
        self,
        event: DispatchEvent,
        recommendation: EventRecommendation,
        buses: tuple[Bus, ...],
        clock: SimulationClock,
    ) -> tuple[_Choice, ...]:
        choices: list[_Choice] = []
        for candidate in recommendation.candidates:
            for bus in buses:
                plan = self._itinerary.compose(
                    event, candidate, bus, clock.current_time
                )
                if isinstance(plan, MovementPlanFailure):
                    continue
                if plan.estimated_return_time > clock.max_time:
                    continue
                choices.append(_Choice(recommendation, candidate, bus, plan))
        choices.sort(
            key=lambda choice: (
                choice.plan.estimated_arrival_time.astimezone(UTC),
                choice.plan.deadhead.distance_m,
                str(choice.candidate.route_id),
                str(choice.candidate.pattern_id),
                str(choice.bus.id),
                str(choice.candidate.source_stop_id),
                str(choice.candidate.destination_stop_id),
                choice.candidate.requested_service_date,
                str(choice.plan.reference_scheduled_trip_id),
            )
        )
        unique: list[_Choice] = []
        used_buses: set[str] = set()
        for choice in choices:
            bus_id = str(choice.bus.id)
            if bus_id not in used_buses:
                used_buses.add(bus_id)
                unique.append(choice)
        return tuple(unique)

    def _build_trip(
        self,
        event: DispatchEvent,
        choice: _Choice,
        clock: SimulationClock,
        expires_at: VancouverDateTime,
        *,
        manual: bool,
    ) -> AdditionalTrip:
        trip_id = _stable_trip_id(
            event, choice.recommendation, choice.candidate, choice.bus
        )
        return AdditionalTrip(
            id=trip_id,
            dispatch_event_id=event.id,
            bus_id=choice.bus.id,
            route_id=choice.candidate.route_id,
            status=(
                AdditionalTripStatus.PROPOSED
                if manual
                else AdditionalTripStatus.APPROVED
            ),
            proposed_at=clock.current_time,
            approval_expires_at=expires_at,
            dispatch_time=None if manual else choice.plan.dispatch_time,
            target_event_time=event.event_time,
            estimated_arrival_time=choice.plan.estimated_arrival_time,
            service_departure_time=choice.plan.service_departure_time,
            estimated_completion_time=choice.plan.estimated_completion_time,
            added_capacity=choice.bus.capacity,
            rationale=(
                "Selected first feasible recommendation; ranked by arrival, "
                "deadhead distance, route, pattern, and bus."
            ),
            source_priority=choice.recommendation.priority_score,
            source_route=choice.recommendation.source_route,
            destination=choice.recommendation.destination,
            selected_candidate=choice.candidate,
            movement_plan=choice.plan,
        )

    @staticmethod
    def _proposal_update(trip: AdditionalTrip, clock: SimulationClock) -> PendingEvent:
        return PendingEvent(
            type=EventType.PROPOSAL_UPDATED,
            simulation_time=clock.current_time,
            data=trip,
        )

    @staticmethod
    def _bus_update(bus: Bus, clock: SimulationClock) -> PendingEvent:
        return PendingEvent(
            type=EventType.BUS_UPDATED,
            simulation_time=clock.current_time,
            data=bus,
        )

    @staticmethod
    def _event_update(event: DispatchEvent, clock: SimulationClock) -> PendingEvent:
        return PendingEvent(
            type=EventType.DISPATCH_EVENT_UPDATED,
            simulation_time=clock.current_time,
            data=event,
        )


def _stable_trip_id(
    event: DispatchEvent,
    recommendation: EventRecommendation,
    candidate: RecommendationCandidate,
    bus: Bus,
) -> str:
    identity = "|".join(
        (
            "v1",
            str(event.id),
            recommendation.source_route,
            recommendation.destination,
            str(candidate.route_id),
            str(candidate.pattern_id),
            str(candidate.source_stop_id),
            str(candidate.destination_stop_id),
            str(bus.id),
        )
    )
    return f"trip-{hashlib.sha256(identity.encode()).hexdigest()[:20]}"
