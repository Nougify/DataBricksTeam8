from datetime import UTC

import pytest

from app.api.serializers import serialize_bus
from app.domain.events import EventType
from app.domain.models import (
    AdditionalTrip,
    AdditionalTripStatus,
    Bus,
    BusStatus,
    EventStatus,
    SimulationClock,
)
from app.domain.types import BusId, DispatchEventId, StopId
from app.repositories import StateEditor
from app.services import Mutation
from tests.services.test_proposals import (
    ProposalRuntime,
    activate_first_event,
    make_runtime,
)


def advance_seconds(runtime: ProposalRuntime, seconds: float) -> None:
    runtime.time_source.advance(seconds / runtime.clock.clock.speed)
    runtime.clock.pump()


def approve_one(runtime: ProposalRuntime) -> AdditionalTrip:
    trips = runtime.coordinator.snapshot().entities.trips.list()
    approved = runtime.proposals.approve(trips[0].id).trip
    runtime.proposals.reject(trips[1].id)
    return approved


def test_proactive_trip_waits_then_completes_service_and_returns() -> None:
    runtime = make_runtime()
    activate_first_event(runtime)
    trip = approve_one(runtime)
    snapshot = runtime.coordinator.snapshot()
    bus = snapshot.entities.buses.get(trip.bus_id)

    assert trip.status is AdditionalTripStatus.BUS_EN_ROUTE
    assert bus is not None and bus.status is BusStatus.DEADHEADING
    assert trip.movement_plan is not None

    runtime.clock.resume()
    arrival_seconds = (
        trip.movement_plan.estimated_arrival_time.astimezone(UTC)
        - snapshot.clock.current_time.astimezone(UTC)
    ).total_seconds()
    advance_seconds(runtime, arrival_seconds)
    snapshot = runtime.coordinator.snapshot()
    waiting_bus = snapshot.entities.buses.get(trip.bus_id)
    assert waiting_bus is not None and waiting_bus.status is BusStatus.WAITING
    assert (
        waiting_bus.location.lat == trip.movement_plan.deadhead.path.coordinates[-1][1]
    )

    departure_seconds = (
        trip.movement_plan.service_departure_time.astimezone(UTC)
        - snapshot.clock.current_time.astimezone(UTC)
    ).total_seconds()
    advance_seconds(runtime, departure_seconds)
    snapshot = runtime.coordinator.snapshot()
    current_trip = snapshot.entities.trips.get(trip.id)
    assert current_trip is not None
    bus = snapshot.entities.buses.get(current_trip.bus_id)
    assert current_trip.status is AdditionalTripStatus.IN_SERVICE
    assert bus is not None and bus.status is BusStatus.IN_SERVICE

    advance_seconds(runtime, 20 * 60)
    snapshot = runtime.coordinator.snapshot()
    current_trip = snapshot.entities.trips.get(trip.id)
    assert current_trip is not None and current_trip.movement_plan is not None
    bus = snapshot.entities.buses.get(current_trip.bus_id)
    event = snapshot.entities.dispatch_events.get(DispatchEventId("valid-event"))
    assert current_trip.status is AdditionalTripStatus.COMPLETED
    assert bus is not None and bus.status is BusStatus.RETURNING
    assert bus.assigned_trip_id == current_trip.id
    assert event is not None and event.status is EventStatus.COMPLETED

    return_seconds = (
        current_trip.movement_plan.estimated_return_time.astimezone(UTC)
        - snapshot.clock.current_time.astimezone(UTC)
    ).total_seconds()
    advance_seconds(runtime, return_seconds)
    snapshot = runtime.coordinator.snapshot()
    bus = snapshot.entities.buses.get(current_trip.bus_id)
    assert bus is not None and bus.status is BusStatus.AVAILABLE
    assert bus.assigned_trip_id is None
    assert bus.location == bus.home_location


def test_bus_reads_interpolate_service_path_without_mutating_state() -> None:
    runtime = make_runtime()
    activate_first_event(runtime)
    trip = approve_one(runtime)
    runtime.clock.resume()
    advance_seconds(runtime, 40 * 60)
    snapshot = runtime.coordinator.snapshot()
    stored_bus = snapshot.entities.buses.get(trip.bus_id)
    current_trip = snapshot.entities.trips.get(trip.id)

    assert stored_bus is not None and current_trip is not None
    assert current_trip.movement_plan is not None
    projected = serialize_bus(stored_bus, current_trip, snapshot.clock.current_time)
    start = current_trip.movement_plan.service.path.coordinates[0]
    end = current_trip.movement_plan.service.path.coordinates[-1]

    assert stored_bus.location.lon == start[0]
    assert projected.location.lon == pytest.approx((start[0] + end[0]) / 2)
    assert projected.location.lat == pytest.approx((start[1] + end[1]) / 2)
    assert projected.heading_deg is not None
    assert runtime.coordinator.snapshot().entities.buses.get(trip.bus_id) == stored_bus


def test_cancellation_releases_at_interpolated_location_and_is_idempotent() -> None:
    runtime = make_runtime()
    activate_first_event(runtime)
    trip = approve_one(runtime)
    runtime.clock.resume()
    advance_seconds(runtime, 40 * 60)
    before = runtime.coordinator.snapshot()
    stored_bus = before.entities.buses.get(trip.bus_id)
    active_trip = before.entities.trips.get(trip.id)
    assert stored_bus is not None and active_trip is not None
    projected = serialize_bus(stored_bus, active_trip, before.clock.current_time)

    cancelled = runtime.movement.cancel(trip.id)
    repeated = runtime.movement.cancel(trip.id)
    snapshot = runtime.coordinator.snapshot()
    bus = snapshot.entities.buses.get(trip.bus_id)

    assert cancelled.status is AdditionalTripStatus.CANCELLED
    assert repeated == cancelled
    assert bus is not None and bus.status is BusStatus.AVAILABLE
    assert bus.assigned_trip_id is None
    assert bus.location == projected.location

    bus_event_count = sum(
        isinstance(event.data, Bus) and event.data.id == trip.bus_id
        for event in runtime.sink.events()
    )
    advance_seconds(runtime, 60 * 60)
    assert (
        sum(
            isinstance(event.data, Bus) and event.data.id == trip.bus_id
            for event in runtime.sink.events()
        )
        == bus_event_count
    )
    final_bus = runtime.coordinator.snapshot().entities.buses.get(trip.bus_id)
    assert final_bus == bus


def test_high_speed_pump_crosses_every_movement_boundary() -> None:
    runtime = make_runtime()
    activate_first_event(runtime)
    trip = approve_one(runtime)
    runtime.clock.resume()

    advance_seconds(runtime, 2 * 60 * 60)
    snapshot = runtime.coordinator.snapshot()
    completed = snapshot.entities.trips.get(trip.id)
    bus = snapshot.entities.buses.get(trip.bus_id)

    assert completed is not None
    assert completed.status is AdditionalTripStatus.COMPLETED
    assert bus is not None and bus.status is BusStatus.AVAILABLE
    assert bus.assigned_trip_id is None
    trip_updates = [
        event.data.status
        for event in runtime.sink.events()
        if event.type is EventType.TRIP_UPDATED
        and isinstance(event.data, AdditionalTrip)
        and event.data.id == trip.id
    ]
    assert trip_updates == [
        AdditionalTripStatus.BUS_EN_ROUTE,
        AdditionalTripStatus.IN_SERVICE,
        AdditionalTripStatus.COMPLETED,
    ]


def test_zero_duration_return_releases_in_completion_transaction() -> None:
    runtime = make_runtime()
    activate_first_event(runtime)
    proposed = runtime.coordinator.snapshot().entities.trips.list()[0]
    assert proposed.selected_candidate is not None
    destination = runtime.transit.stop(
        StopId(proposed.selected_candidate.destination_stop_id)
    )
    assert destination is not None

    def move_home(editor: StateEditor, clock: SimulationClock) -> Mutation[None]:
        del clock
        bus = editor.bus(BusId(proposed.bus_id))
        assert bus is not None
        editor.put_bus(bus.model_copy(update={"home_location": destination.location}))
        return Mutation(None)

    runtime.coordinator.transact(move_home)
    trip = runtime.proposals.approve(proposed.id).trip
    runtime.proposals.reject(runtime.coordinator.snapshot().entities.trips.list()[1].id)
    assert trip.movement_plan is not None
    assert trip.movement_plan.return_leg.duration_seconds == 0
    runtime.clock.resume()
    completion_seconds = (
        trip.movement_plan.estimated_completion_time.astimezone(UTC)
        - runtime.clock.clock.current_time.astimezone(UTC)
    ).total_seconds()

    advance_seconds(runtime, completion_seconds)
    snapshot = runtime.coordinator.snapshot()
    completed = snapshot.entities.trips.get(trip.id)
    bus = snapshot.entities.buses.get(trip.bus_id)

    assert completed is not None
    assert completed.status is AdditionalTripStatus.COMPLETED
    assert bus is not None and bus.status is BusStatus.AVAILABLE
    assert bus.assigned_trip_id is None
    final_bus_updates = [
        event.data.status
        for event in runtime.sink.events()
        if event.type is EventType.BUS_UPDATED
        and isinstance(event.data, Bus)
        and event.data.id == trip.bus_id
    ]
    assert final_bus_updates[-2:] == [BusStatus.RETURNING, BusStatus.AVAILABLE]
