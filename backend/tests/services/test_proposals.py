from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.config import Settings
from app.data.adapters import EventSource, FixtureEventSource
from app.data.reader import EventReader
from app.data.store import EventWindowStore
from app.domain.decisions import HumanDecisionAction
from app.domain.events import EventType
from app.domain.models import (
    AdditionalTrip,
    AdditionalTripStatus,
    BusStatus,
    EventStatus,
    SimulationClock,
)
from app.domain.types import DispatchEventId
from app.fleet import load_fleet
from app.repositories import StateEditor, entities_from
from app.routing import ItineraryComposer, StraightLineRoutingService
from app.services import (
    DeterministicSeekService,
    EventActivationService,
    FakeMonotonicTimeSource,
    InMemoryEventSink,
    MovementLifecycleService,
    Mutation,
    MutationCoordinator,
    ProposalService,
    SimulationClockController,
    initial_clock,
)
from app.transit import RecommendationMapper, TransitIndex, build_fixture_transit_index

PACIFIC = timezone(-timedelta(hours=7))
START = datetime(2026, 7, 10, 9, tzinfo=PACIFIC)
END = datetime(2026, 7, 10, 15, tzinfo=PACIFIC)


@dataclass(frozen=True)
class ProposalRuntime:
    settings: Settings
    transit: TransitIndex
    data: EventWindowStore
    coordinator: MutationCoordinator
    clock: SimulationClockController
    time_source: FakeMonotonicTimeSource
    sink: InMemoryEventSink
    movement: MovementLifecycleService
    proposals: ProposalService
    replay: DeterministicSeekService


def make_runtime(
    settings: Settings | None = None,
    *,
    source: EventSource | None = None,
    window_start: datetime = START,
    window_end: datetime = END,
) -> ProposalRuntime:
    settings = settings or Settings(simulation_speed=3600)
    transit = build_fixture_transit_index(
        settings.gtfs_feed_version, settings.gtfs_service_day_mapping
    )
    data = EventWindowStore(source or FixtureEventSource("test-v1"))
    data.refresh_window(window_start, window_end)
    mapper = RecommendationMapper(transit, settings)
    resolved = data.install(mapper.resolve_window(data.reader().window))
    fleet = load_fleet(settings, transit)
    sink = InMemoryEventSink()
    coordinator = MutationCoordinator(
        sink,
        initial_clock(settings, coverage_start=window_start, coverage_end=window_end),
        entities_from(buses=fleet.buses),
    )
    time_source = FakeMonotonicTimeSource()
    clock = SimulationClockController(
        coordinator,
        time_source,
        seek_min_time=settings.simulation_min_time,
        seek_max_time=settings.simulation_max_time,
    )
    itinerary = ItineraryComposer(
        transit,
        StraightLineRoutingService(settings.routing_speed_kph),
        settings.proactive_lateness_tolerance_seconds,
    )
    movement = MovementLifecycleService(coordinator)
    proposals = ProposalService(coordinator, itinerary, settings, clock, movement)
    activation = EventActivationService(
        EventReader(resolved.window), coordinator, clock, proposals
    )
    activation.start(install_seek_handler=False)
    replay = DeterministicSeekService(
        settings, data, mapper, coordinator, clock, activation, proposals
    )
    replay.start()
    return ProposalRuntime(
        settings,
        transit,
        data,
        coordinator,
        clock,
        time_source,
        sink,
        movement,
        proposals,
        replay,
    )


def activate_first_event(runtime: ProposalRuntime) -> None:
    runtime.clock.resume()
    runtime.time_source.advance(0.5)
    runtime.clock.pump()


def test_activation_creates_capped_proposals_and_reserves_buses_atomically() -> None:
    runtime = make_runtime(Settings(simulation_speed=3600, max_buses_per_event=1))

    activate_first_event(runtime)
    snapshot = runtime.coordinator.snapshot()
    event = snapshot.entities.dispatch_events.get(DispatchEventId("valid-event"))
    trips = snapshot.entities.trips.list()

    assert event is not None
    assert event.status is EventStatus.AWAITING_APPROVAL
    assert len(trips) == 1
    assert trips[0].status is AdditionalTripStatus.PROPOSED
    assert trips[0].selected_candidate is not None
    assert trips[0].movement_plan is not None
    assert trips[0].destination == "Downtown"
    bus = snapshot.entities.buses.get(trips[0].bus_id)
    assert bus is not None and bus.status is BusStatus.RESERVED
    assert runtime.clock.clock.status.value == "PAUSED"
    assert [event.type for event in runtime.sink.events() if event.seq >= 2] == [
        EventType.PROPOSAL_CREATED,
        EventType.BUS_UPDATED,
        EventType.DISPATCH_EVENT_UPDATED,
        EventType.CLOCK_UPDATED,
    ]


def test_fractional_suggestion_is_capped_by_available_fleet() -> None:
    runtime = make_runtime(
        Settings(simulation_speed=3600, fleet_size=1, max_buses_per_event=3)
    )

    activate_first_event(runtime)

    assert len(runtime.coordinator.snapshot().entities.trips.list()) == 1


def test_zero_suggestion_creates_no_proposal() -> None:
    runtime = make_runtime()
    reader = runtime.coordinator
    del reader
    event_window = FixtureEventSource("test-v1").load_window(START, END)
    event = event_window.events[0]
    zero = event.recommendations[0].model_copy(update={"extra_bus_trips_est": 0.0})
    event = event.model_copy(update={"recommendations": (zero,)})
    mapped = RecommendationMapper(runtime.transit, runtime.settings).resolve_event(
        event
    )

    def activate(editor: StateEditor, clock: SimulationClock) -> Mutation[object]:
        editor.put_dispatch_event(mapped)
        created = runtime.proposals.create_for_event(editor, clock, mapped)
        return Mutation(created, created.events)

    runtime.coordinator.transact(activate)
    snapshot = runtime.coordinator.snapshot()

    assert snapshot.entities.trips.list() == ()
    stored = snapshot.entities.dispatch_events.get(mapped.id)
    assert stored is not None
    assert stored.status is EventStatus.NO_ACTION_REQUIRED


def test_itinerary_failure_falls_back_to_lower_recommendation() -> None:
    runtime = make_runtime()
    source = FixtureEventSource("test-v1").load_window(START, END).events[0]
    mapped = RecommendationMapper(runtime.transit, runtime.settings).resolve_event(
        source
    )
    primary = mapped.recommendations[0]
    bad_candidate = primary.candidates[0].model_copy(update={"pattern_id": "missing"})
    bad_primary = primary.model_copy(update={"candidates": (bad_candidate,)})
    fallback = primary.model_copy(
        update={"destination": "Broadway", "priority_score": 0.5}
    )
    event = mapped.model_copy(update={"recommendations": (bad_primary, fallback)})

    def activate(editor: StateEditor, clock: SimulationClock) -> Mutation[object]:
        editor.put_dispatch_event(event)
        created = runtime.proposals.create_for_event(editor, clock, event)
        return Mutation(created, created.events)

    runtime.coordinator.transact(activate)

    assert {
        trip.destination
        for trip in runtime.coordinator.snapshot().entities.trips.list()
    } == {"Broadway"}


def test_automatic_mode_approves_immediately_without_auto_pause() -> None:
    runtime = make_runtime(Settings(simulation_speed=3600, approval_mode="AUTOMATIC"))

    activate_first_event(runtime)
    snapshot = runtime.coordinator.snapshot()

    event = snapshot.entities.dispatch_events.get(DispatchEventId("valid-event"))
    assert event is not None
    assert event.status is EventStatus.DISPATCHED
    assert {trip.status for trip in snapshot.entities.trips.list()} == {
        AdditionalTripStatus.BUS_EN_ROUTE
    }
    assert all(
        bus.assigned_trip_id is not None
        for bus in snapshot.entities.buses.list()
        if bus.status is BusStatus.WAITING
    )
    assert runtime.clock.clock.status.value == "RUNNING"
    assert snapshot.decisions == ()


def test_manual_approval_and_rejection_update_event_and_release_once() -> None:
    runtime = make_runtime()
    activate_first_event(runtime)
    trips = runtime.coordinator.snapshot().entities.trips.list()

    approved = runtime.proposals.approve(trips[0].id).trip
    repeated_approval = runtime.proposals.approve(trips[0].id).trip
    rejected = runtime.proposals.reject(trips[1].id).trip
    repeated = runtime.proposals.reject(trips[1].id).trip
    snapshot = runtime.coordinator.snapshot()

    assert approved.status is AdditionalTripStatus.BUS_EN_ROUTE
    assert repeated_approval == approved
    assert rejected.status is AdditionalTripStatus.REJECTED
    assert repeated == rejected
    event = snapshot.entities.dispatch_events.get(DispatchEventId("valid-event"))
    assert event is not None
    assert event.status is EventStatus.DISPATCHED
    approved_bus = snapshot.entities.buses.get(approved.bus_id)
    rejected_bus = snapshot.entities.buses.get(rejected.bus_id)
    assert approved_bus is not None and approved_bus.assigned_trip_id == approved.id
    assert rejected_bus is not None and rejected_bus.status is BusStatus.AVAILABLE
    assert [decision.action for decision in snapshot.decisions] == [
        HumanDecisionAction.APPROVE,
        HumanDecisionAction.REJECT,
    ]


def test_late_proactive_approval_cancels_and_releases_reservation() -> None:
    runtime = make_runtime(Settings(simulation_speed=3600, approval_timeout_minutes=60))
    activate_first_event(runtime)
    proposed = runtime.coordinator.snapshot().entities.trips.list()[0]
    runtime.clock.resume()
    runtime.time_source.advance(31 / 60)
    runtime.clock.pump()

    decision = runtime.proposals.approve(proposed.id)
    snapshot = runtime.coordinator.snapshot()
    bus = snapshot.entities.buses.get(proposed.bus_id)

    assert decision.trip.status is AdditionalTripStatus.CANCELLED
    assert decision.conflict_reason is not None
    assert bus is not None and bus.status is BusStatus.AVAILABLE
    assert [item.action for item in snapshot.decisions] == [HumanDecisionAction.APPROVE]


def test_high_speed_expiry_releases_pending_buses_exactly_once() -> None:
    runtime = make_runtime(Settings(simulation_speed=3600, approval_timeout_minutes=5))
    activate_first_event(runtime)
    trip_ids = tuple(
        trip.id for trip in runtime.coordinator.snapshot().entities.trips.list()
    )
    runtime.clock.resume()
    runtime.time_source.advance(1)

    runtime.clock.pump()
    snapshot = runtime.coordinator.snapshot()

    expired: list[AdditionalTrip] = []
    for trip_id in trip_ids:
        trip = snapshot.entities.trips.get(trip_id)
        assert trip is not None
        expired.append(trip)
    event = snapshot.entities.dispatch_events.get(DispatchEventId("valid-event"))
    assert event is not None
    assert {trip.status for trip in expired} == {AdditionalTripStatus.EXPIRED}
    assert event.status is EventStatus.EXPIRED
    assert all(
        bus.status is BusStatus.AVAILABLE for bus in snapshot.entities.buses.list()
    )


def test_stable_ids_repeat_for_identical_inputs() -> None:
    first = make_runtime()
    second = make_runtime()
    activate_first_event(first)
    activate_first_event(second)

    assert [trip.id for trip in first.coordinator.snapshot().entities.trips.list()] == [
        trip.id for trip in second.coordinator.snapshot().entities.trips.list()
    ]
