from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime

from app.domain.events import EventType, PendingEvent
from app.domain.models import (
    AdditionalTrip,
    AdditionalTripStatus,
    Bus,
    BusStatus,
    DispatchEvent,
    GeoJsonLineString,
    GeoPoint,
    MovementLeg,
    SimulationClock,
)
from app.domain.types import AdditionalTripId, BusId, DispatchEventId, VancouverDateTime
from app.repositories.memory import StateEditor
from app.routing import great_circle_distance_m
from app.services.clock import BoundaryPriority, BoundaryRegistration, BoundaryResult
from app.services.coordinator import Mutation, MutationCoordinator
from app.services.trip_status import aggregate_dispatch_event

MOVEMENT_BOUNDARY_NAMESPACE = "movement"


class MovementConflictError(RuntimeError):
    pass


@dataclass(frozen=True)
class MovementUpdate:
    trip: AdditionalTrip
    events: tuple[PendingEvent, ...] = ()
    registrations: tuple[BoundaryRegistration, ...] = ()


class MovementLifecycleService:
    def __init__(self, coordinator: MutationCoordinator) -> None:
        self._coordinator = coordinator

    def start_approved(
        self,
        editor: StateEditor,
        clock: SimulationClock,
        trip: AdditionalTrip,
    ) -> MovementUpdate:
        if trip.status is not AdditionalTripStatus.APPROVED:
            raise MovementConflictError("movement requires an approved trip")
        if trip.movement_plan is None:
            raise MovementConflictError("approved trip has no movement plan")
        if trip.movement_plan.estimated_return_time > clock.max_time:
            raise MovementConflictError("movement plan exceeds simulation bounds")
        return self.advance(editor, clock, trip.id)

    def cancel(self, trip_id: AdditionalTripId) -> AdditionalTrip:
        return self._coordinator.transact(
            lambda editor, clock: self._cancel(editor, clock, trip_id)
        )

    def _cancel(
        self,
        editor: StateEditor,
        clock: SimulationClock,
        trip_id: AdditionalTripId,
    ) -> Mutation[AdditionalTrip]:
        trip = editor.trip(trip_id)
        if trip is None:
            raise MovementConflictError("trip not found")
        if trip.status is AdditionalTripStatus.CANCELLED:
            return Mutation(trip)
        bus = editor.bus(BusId(trip.bus_id))
        event = editor.dispatch_event(DispatchEventId(trip.dispatch_event_id))
        if (
            bus is None
            or event is None
            or bus.assigned_trip_id != trip.id
            or trip.status
            not in {
                AdditionalTripStatus.APPROVED,
                AdditionalTripStatus.BUS_EN_ROUTE,
                AdditionalTripStatus.IN_SERVICE,
                AdditionalTripStatus.COMPLETED,
            }
        ):
            raise MovementConflictError("trip is not actively assigned")
        projected = project_bus(bus, trip, clock.current_time)
        cancelled = trip.model_copy(update={"status": AdditionalTripStatus.CANCELLED})
        released = projected.model_copy(
            update={
                "status": BusStatus.AVAILABLE,
                "assigned_trip_id": None,
                "proposed_trip_id": None,
                "heading_deg": None,
            }
        )
        editor.put_trip(cancelled)
        editor.put_bus(released)
        updated_event = aggregate_dispatch_event(editor, event)
        editor.put_dispatch_event(updated_event)
        return Mutation(
            cancelled,
            (
                _trip_event(cancelled, clock),
                _bus_event(released, clock),
                _event_event(updated_event, clock),
            ),
        )

    def advance(
        self,
        editor: StateEditor,
        clock: SimulationClock,
        trip_id: AdditionalTripId,
    ) -> MovementUpdate:
        trip = editor.trip(trip_id)
        if trip is None or trip.movement_plan is None:
            return (
                MovementUpdate(trip) if trip is not None else _missing_update(trip_id)
            )
        bus = editor.bus(BusId(trip.bus_id))
        if bus is None or bus.assigned_trip_id != trip.id:
            return MovementUpdate(trip)

        plan = trip.movement_plan
        events: list[PendingEvent] = []
        now = clock.current_time

        if trip.status is AdditionalTripStatus.APPROVED and plan.dispatch_time <= now:
            trip = trip.model_copy(update={"status": AdditionalTripStatus.BUS_EN_ROUTE})
            bus = _bus_at_leg_start(bus, BusStatus.DEADHEADING, plan.deadhead)
            editor.put_trip(trip)
            editor.put_bus(bus)
            events.extend((_trip_event(trip, clock), _bus_event(bus, clock)))

        if (
            trip.status is AdditionalTripStatus.BUS_EN_ROUTE
            and bus.status is BusStatus.DEADHEADING
            and plan.estimated_arrival_time <= now
        ):
            bus = _bus_at_leg_end(bus, BusStatus.WAITING, plan.deadhead)
            editor.put_bus(bus)
            if plan.service_departure_time > now:
                events.append(_bus_event(bus, clock))

        if (
            trip.status is AdditionalTripStatus.BUS_EN_ROUTE
            and plan.service_departure_time <= now
        ):
            trip = trip.model_copy(update={"status": AdditionalTripStatus.IN_SERVICE})
            bus = _bus_at_leg_start(bus, BusStatus.IN_SERVICE, plan.service)
            editor.put_trip(trip)
            editor.put_bus(bus)
            events.extend((_trip_event(trip, clock), _bus_event(bus, clock)))

        if (
            trip.status is AdditionalTripStatus.IN_SERVICE
            and plan.estimated_completion_time <= now
        ):
            trip = trip.model_copy(update={"status": AdditionalTripStatus.COMPLETED})
            bus = _bus_at_leg_start(
                _bus_at_leg_end(bus, BusStatus.RETURNING, plan.service),
                BusStatus.RETURNING,
                plan.return_leg,
            )
            editor.put_trip(trip)
            editor.put_bus(bus)
            event = editor.dispatch_event(DispatchEventId(trip.dispatch_event_id))
            events.extend((_trip_event(trip, clock), _bus_event(bus, clock)))
            if event is not None:
                updated_event = aggregate_dispatch_event(editor, event)
                editor.put_dispatch_event(updated_event)
                events.append(_event_event(updated_event, clock))

        if (
            trip.status is AdditionalTripStatus.COMPLETED
            and bus.assigned_trip_id == trip.id
            and plan.estimated_return_time <= now
        ):
            bus = _bus_at_leg_end(bus, BusStatus.AVAILABLE, plan.return_leg).model_copy(
                update={
                    "assigned_trip_id": None,
                    "heading_deg": None,
                    "location": bus.home_location,
                }
            )
            editor.put_bus(bus)
            events.append(_bus_event(bus, clock))

        registration = self._next_registration(trip, bus, clock)
        return MovementUpdate(
            trip,
            tuple(events),
            (registration,) if registration is not None else (),
        )

    def _next_registration(
        self, trip: AdditionalTrip, bus: Bus, clock: SimulationClock
    ) -> BoundaryRegistration | None:
        if trip.movement_plan is None or bus.assigned_trip_id != trip.id:
            return None
        plan = trip.movement_plan
        if trip.status is AdditionalTripStatus.APPROVED:
            name, at, priority = (
                "dispatch",
                plan.dispatch_time,
                BoundaryPriority.DISPATCH,
            )
        elif (
            trip.status is AdditionalTripStatus.BUS_EN_ROUTE
            and bus.status is BusStatus.DEADHEADING
        ):
            name, at, priority = (
                "arrival",
                plan.estimated_arrival_time,
                BoundaryPriority.MOVEMENT,
            )
        elif trip.status is AdditionalTripStatus.BUS_EN_ROUTE:
            name, at, priority = (
                "departure",
                plan.service_departure_time,
                BoundaryPriority.MOVEMENT,
            )
        elif trip.status is AdditionalTripStatus.IN_SERVICE:
            name, at, priority = (
                "completion",
                plan.estimated_completion_time,
                BoundaryPriority.COMPLETION,
            )
        elif trip.status is AdditionalTripStatus.COMPLETED:
            name, at, priority = (
                "return",
                plan.estimated_return_time,
                BoundaryPriority.RETURN,
            )
        else:
            return None
        if at <= clock.current_time:
            raise MovementConflictError("movement milestone did not advance")

        def advance(editor: StateEditor, current: SimulationClock) -> BoundaryResult:
            update = self.advance(editor, current, trip.id)
            return BoundaryResult(
                events=update.events, registrations=update.registrations
            )

        return BoundaryRegistration(
            at=at,
            priority=priority,
            handler=advance,
            key=(MOVEMENT_BOUNDARY_NAMESPACE, f"{name}:{trip.id}"),
        )


def project_bus(bus: Bus, trip: AdditionalTrip | None, at: VancouverDateTime) -> Bus:
    if trip is None or trip.movement_plan is None or bus.assigned_trip_id != trip.id:
        return bus
    plan = trip.movement_plan
    if bus.status is BusStatus.DEADHEADING:
        return _project_leg(
            bus, plan.deadhead, plan.dispatch_time, plan.estimated_arrival_time, at
        )
    if bus.status is BusStatus.WAITING:
        return _bus_at_leg_end(bus, BusStatus.WAITING, plan.deadhead)
    if bus.status is BusStatus.IN_SERVICE:
        return _project_leg(
            bus,
            plan.service,
            plan.service_departure_time,
            plan.estimated_completion_time,
            at,
        )
    if bus.status is BusStatus.RETURNING:
        return _project_leg(
            bus,
            plan.return_leg,
            plan.estimated_completion_time,
            plan.estimated_return_time,
            at,
        )
    return bus


def _project_leg(
    bus: Bus,
    leg: MovementLeg,
    start: VancouverDateTime,
    end: VancouverDateTime,
    at: VancouverDateTime,
) -> Bus:
    duration = _seconds_between(start, end)
    elapsed = _seconds_between(start, at)
    fraction = 1.0 if duration <= 0 else min(1.0, max(0.0, elapsed / duration))
    location, heading = _interpolate_path(leg.path, fraction)
    return bus.model_copy(update={"location": location, "heading_deg": heading})


def _interpolate_path(
    path: GeoJsonLineString, fraction: float
) -> tuple[GeoPoint, float | None]:
    coordinates = path.coordinates
    lengths = tuple(
        great_circle_distance_m(_point(start), _point(end))
        for start, end in zip(coordinates, coordinates[1:], strict=False)
    )
    total = sum(lengths)
    if total <= 0:
        return _point(coordinates[-1]), None
    target = min(1.0, max(0.0, fraction)) * total
    traversed = 0.0
    for index, length in enumerate(lengths):
        if length <= 0:
            continue
        if target <= traversed + length or index == len(lengths) - 1:
            local = min(1.0, max(0.0, (target - traversed) / length))
            start = coordinates[index]
            end = coordinates[index + 1]
            location = GeoPoint(
                lon=start[0] + (end[0] - start[0]) * local,
                lat=start[1] + (end[1] - start[1]) * local,
            )
            return location, _bearing(start, end)
        traversed += length
    return _point(coordinates[-1]), None


def _bearing(start: tuple[float, float], end: tuple[float, float]) -> float | None:
    if start == end:
        return None
    lon1, lat1 = map(math.radians, start)
    lon2, lat2 = map(math.radians, end)
    delta_lon = lon2 - lon1
    x = math.sin(delta_lon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(
        delta_lon
    )
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _bus_at_leg_start(bus: Bus, status: BusStatus, leg: MovementLeg) -> Bus:
    location, heading = _interpolate_path(leg.path, 0)
    return bus.model_copy(
        update={"status": status, "location": location, "heading_deg": heading}
    )


def _bus_at_leg_end(bus: Bus, status: BusStatus, leg: MovementLeg) -> Bus:
    return bus.model_copy(
        update={
            "status": status,
            "location": _point(leg.path.coordinates[-1]),
            "heading_deg": None,
        }
    )


def _point(position: tuple[float, float]) -> GeoPoint:
    return GeoPoint(lon=position[0], lat=position[1])


def _seconds_between(start: datetime, end: datetime) -> float:
    return (end.astimezone(UTC) - start.astimezone(UTC)).total_seconds()


def _trip_event(trip: AdditionalTrip, clock: SimulationClock) -> PendingEvent:
    return PendingEvent(
        type=EventType.TRIP_UPDATED,
        simulation_time=clock.current_time,
        data=trip,
    )


def _bus_event(bus: Bus, clock: SimulationClock) -> PendingEvent:
    return PendingEvent(
        type=EventType.BUS_UPDATED,
        simulation_time=clock.current_time,
        data=bus,
    )


def _event_event(event: DispatchEvent, clock: SimulationClock) -> PendingEvent:
    return PendingEvent(
        type=EventType.DISPATCH_EVENT_UPDATED,
        simulation_time=clock.current_time,
        data=event,
    )


def _missing_update(trip_id: AdditionalTripId) -> MovementUpdate:
    raise MovementConflictError(f"trip not found: {trip_id}")
