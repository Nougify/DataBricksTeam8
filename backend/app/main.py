import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated, Literal, cast

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import DataMode, Settings, get_settings
from app.data.adapters import build_event_source
from app.data.models import EventWindow
from app.data.store import EventWindowStore
from app.domain.events import EventType, PendingEvent
from app.domain.models import (
    AdditionalTrip,
    AdditionalTripStatus,
    Bus,
    BusSource,
    BusSourceType,
    BusStatus,
    DispatchEvent,
    EventStatus,
)
from app.domain.types import (
    AdditionalTripId,
    BusId,
    DispatchEventId,
    HubId,
    RouteId,
)
from app.errors import install_error_handlers
from app.repositories.memory import StateEditor, entities_from
from app.routing import build_routing_service
from app.runtime import RuntimeOwner
from app.services.clock import (
    SimulationClockController,
    SystemMonotonicTimeSource,
    initial_clock,
)
from app.services.coordinator import Mutation, MutationCoordinator
from app.services.events import InMemoryEventSink
from app.transit import (
    build_fixture_transit_index,
    default_hub_catchments,
    load_gtfs_directory,
)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class ClockSpeedRequest(BaseModel):
    speed: Literal[1, 60, 300, 900, 3600]


class ClockSeekRequest(BaseModel):
    time: datetime


class DispatchEventResponse(BaseModel):
    id: str
    hub_id: str | None
    source_location: str
    location: dict[str, float] | None
    available_at: datetime | None
    actionable_at: datetime
    event_time: datetime
    mode: Literal["REACTIVE", "PROACTIVE"]
    surge_type: str | None
    predicted_people: float
    normal_people: float
    surge_ratio: float | None
    suggested_extra_buses: int
    priority_score: float
    recommendations: tuple[dict[str, object], ...]
    status: EventStatus
    additional_trip_ids: tuple[str, ...]
    source: dict[str, object]


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        source = build_event_source(resolved_settings)
        data = EventWindowStore(source)
        data.refresh_window(
            resolved_settings.event_window_start,
            resolved_settings.event_window_end,
        )
        transit = (
            build_fixture_transit_index(
                resolved_settings.gtfs_feed_version,
                resolved_settings.gtfs_service_day_mapping,
            )
            if resolved_settings.data_mode is DataMode.FIXTURE
            else load_gtfs_directory(
                resolved_settings.gtfs_source,
                feed_version=resolved_settings.gtfs_feed_version,
                representative_dates=resolved_settings.gtfs_service_day_mapping,
                hubs=default_hub_catchments(),
            )
        )
        data.install(
            _resolve_event_window(data.reader().window, transit, resolved_settings)
        )
        events = InMemoryEventSink()
        first_hub = transit.hubs()[0]
        fleet = tuple(
            Bus(
                id=f"bus-{number:02d}",
                status=BusStatus.AVAILABLE,
                location=first_hub.location,
                heading_deg=None,
                capacity=resolved_settings.default_bus_capacity,
                source=BusSource(
                    type=BusSourceType.DEPOT,
                    route=None,
                    depot_name=first_hub.location_name,
                ),
                assigned_trip_id=None,
                proposed_trip_id=None,
                home_location=first_hub.location,
            )
            for number in range(1, resolved_settings.fleet_size + 1)
        )
        coordinator = MutationCoordinator(
            events,
            initial_clock(resolved_settings),
            entities_from(
                buses=fleet,
                dispatch_events=data.reader().window.events,
            ),
        )
        clock = SimulationClockController(coordinator, SystemMonotonicTimeSource())
        routing = build_routing_service(
            resolved_settings.routing_provider,
            resolved_settings.routing_speed_kph,
        )
        application.state.runtime = RuntimeOwner(
            settings=resolved_settings,
            data=data,
            transit=transit,
            routing=routing,
            coordinator=coordinator,
            clock=clock,
            events=events,
        )
        clock_task = asyncio.create_task(clock.run())
        try:
            yield
        finally:
            clock.stop()
            await clock_task

    application = FastAPI(
        title="Pulse Dispatch API",
        version="0.2.0",
        lifespan=lifespan,
    )
    application.state.settings = resolved_settings
    application.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.cors_origin_strings,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(application)

    @application.get("/healthz", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse()

    @application.get("/api/v1/meta")
    async def meta() -> dict[str, object]:
        runtime: RuntimeOwner = application.state.runtime
        return {
            "data_mode": runtime.settings.data_mode,
            "source_identity": runtime.data.reader().window.metadata.source_identity,
            "source_version": runtime.data.reader().window.metadata.source_version,
            "integration_status": runtime.data.status,
            "integration_error": runtime.data.last_error,
            "event_window": runtime.data.reader().window.metadata.model_dump(
                mode="json"
            ),
            "simulation_bounds": {
                "min_time": runtime.clock.clock.min_time.isoformat(),
                "max_time": runtime.clock.clock.max_time.isoformat(),
            },
            "supported_speeds": [1, 60, 300, 900, 3600],
            "gtfs_version": runtime.transit.feed_version,
            "fleet": {
                "size": runtime.settings.fleet_size,
                "total_capacity": runtime.settings.fleet_size
                * runtime.settings.default_bus_capacity,
                "max_buses_per_event": runtime.settings.max_buses_per_event,
            },
            "approval_mode": runtime.settings.approval_mode,
        }

    @application.get("/api/v1/state")
    async def state() -> dict[str, object]:
        runtime: RuntimeOwner = application.state.runtime
        snapshot = runtime.coordinator.snapshot()
        visible_events = tuple(
            event
            for event in snapshot.entities.dispatch_events.list()
            if event.actionable_at <= snapshot.clock.current_time
        )
        return {
            "epoch": snapshot.epoch,
            "last_seq": snapshot.last_seq,
            "simulation": snapshot.clock.model_dump(mode="json"),
            "dispatch_events": [
                event.model_dump(mode="json") for event in visible_events
            ],
            "buses": [
                bus.model_dump(mode="json") for bus in snapshot.entities.buses.list()
            ],
            "additional_trips": [
                trip.model_dump(mode="json") for trip in snapshot.entities.trips.list()
            ],
        }

    @application.get(
        "/api/v1/dispatch-events", response_model=list[DispatchEventResponse]
    )
    async def dispatch_events(
        from_time: Annotated[datetime | None, Query(alias="from")] = None,
        to_time: Annotated[datetime | None, Query(alias="to")] = None,
        hub_id: str | None = None,
        status: EventStatus | None = None,
        at: datetime | None = None,
    ) -> list[DispatchEventResponse]:
        runtime: RuntimeOwner = application.state.runtime
        captured_at = at or runtime.coordinator.snapshot().clock.current_time
        events = tuple(
            event
            for event in runtime.coordinator.snapshot().entities.dispatch_events.list()
            if event.actionable_at <= captured_at
        )
        return [
            _event_response(event)
            for event in events
            if (from_time is None or event.event_time >= from_time)
            and (to_time is None or event.event_time < to_time)
            and (hub_id is None or event.hub_id == hub_id)
            and (status is None or event.status is status)
        ]

    @application.get(
        "/api/v1/dispatch-events/{event_id}", response_model=DispatchEventResponse
    )
    async def dispatch_event(event_id: str) -> DispatchEventResponse:
        runtime: RuntimeOwner = application.state.runtime
        event = runtime.coordinator.snapshot().entities.dispatch_events.get(
            DispatchEventId(event_id)
        )
        if (
            event is None
            or event.actionable_at > runtime.coordinator.snapshot().clock.current_time
        ):
            raise HTTPException(status_code=404, detail="dispatch event not found")
        return _event_response(event)

    @application.get("/api/v1/buses")
    async def buses() -> list[dict[str, object]]:
        runtime: RuntimeOwner = application.state.runtime
        return [
            bus.model_dump(mode="json")
            for bus in runtime.coordinator.snapshot().entities.buses.list()
        ]

    @application.get("/api/v1/buses/{bus_id}")
    async def bus(bus_id: str) -> dict[str, object]:
        runtime: RuntimeOwner = application.state.runtime
        item = runtime.coordinator.snapshot().entities.buses.get(BusId(bus_id))
        if item is None:
            raise HTTPException(status_code=404, detail="bus not found")
        return cast(dict[str, object], item.model_dump(mode="json"))

    @application.get("/api/v1/additional-trips")
    async def additional_trips() -> list[dict[str, object]]:
        runtime: RuntimeOwner = application.state.runtime
        return [
            trip.model_dump(mode="json")
            for trip in runtime.coordinator.snapshot().entities.trips.list()
        ]

    @application.get("/api/v1/additional-trips/{trip_id}")
    async def additional_trip(trip_id: str) -> dict[str, object]:
        runtime: RuntimeOwner = application.state.runtime
        item = runtime.coordinator.snapshot().entities.trips.get(
            AdditionalTripId(trip_id)
        )
        if item is None:
            raise HTTPException(status_code=404, detail="additional trip not found")
        return cast(dict[str, object], item.model_dump(mode="json"))

    @application.get("/api/v1/routes")
    async def routes(
        hub_id: str | None = None, include_shape: bool = False
    ) -> list[dict[str, object]]:
        runtime: RuntimeOwner = application.state.runtime
        selected = (
            tuple(
                pattern.route
                for pattern in runtime.transit.patterns_serving_hub(HubId(hub_id))
            )
            if hub_id is not None
            else runtime.transit.routes()
        )
        unique = {str(route.route_id): route for route in selected}
        return [
            {
                **route.model_dump(mode="json"),
                **(
                    {
                        "shape": (
                            shape.model_dump(mode="json") if shape is not None else None
                        )
                    }
                    if include_shape
                    and (shape := runtime.transit.route_shape(route.route_id))
                    else {}
                ),
            }
            for route in unique.values()
        ]

    @application.get("/api/v1/routes/{route_id}")
    async def route(route_id: str) -> dict[str, object]:
        runtime: RuntimeOwner = application.state.runtime
        item = runtime.transit.route(RouteId(route_id))
        if item is None:
            raise HTTPException(status_code=404, detail="route not found")
        shape = runtime.transit.route_shape(item.route_id)
        return {
            **item.model_dump(mode="json"),
            "shape": shape.model_dump(mode="json") if shape is not None else None,
        }

    @application.post("/api/v1/clock/pause")
    async def pause_clock() -> dict[str, object]:
        return cast(
            dict[str, object],
            application.state.runtime.clock.pause().model_dump(mode="json"),
        )

    @application.post("/api/v1/clock/resume")
    async def resume_clock() -> dict[str, object]:
        return cast(
            dict[str, object],
            application.state.runtime.clock.resume().model_dump(mode="json"),
        )

    @application.post("/api/v1/clock/speed")
    async def set_clock_speed(request: ClockSpeedRequest) -> dict[str, object]:
        return cast(
            dict[str, object],
            application.state.runtime.clock.set_speed(request.speed).model_dump(
                mode="json"
            ),
        )

    @application.post("/api/v1/clock/seek")
    async def seek_clock(request: ClockSeekRequest) -> dict[str, object]:
        return cast(
            dict[str, object],
            application.state.runtime.clock.seek(request.time).model_dump(mode="json"),
        )

    @application.post("/api/v1/additional-trips/{trip_id}/approve")
    async def approve_additional_trip(trip_id: str) -> dict[str, object]:
        runtime: RuntimeOwner = application.state.runtime

        def approve(editor: StateEditor) -> Mutation[AdditionalTrip]:
            trip = editor.trip(AdditionalTripId(trip_id))
            if trip is None:
                raise HTTPException(status_code=404, detail="additional trip not found")
            if trip.status is AdditionalTripStatus.APPROVED:
                return Mutation(trip)
            if trip.status is not AdditionalTripStatus.PROPOSED:
                raise HTTPException(status_code=409, detail="trip is not proposed")
            bus = editor.bus(BusId(trip.bus_id))
            if bus is None or bus.proposed_trip_id != trip.id:
                raise HTTPException(
                    status_code=409, detail="bus reservation is missing"
                )
            updated_trip = trip.model_copy(
                update={"status": AdditionalTripStatus.APPROVED}
            )
            updated_bus = bus.model_copy(
                update={
                    "assigned_trip_id": trip.id,
                    "proposed_trip_id": None,
                    "status": BusStatus.RESERVED,
                }
            )
            editor.put_trip(updated_trip)
            editor.put_bus(updated_bus)
            return Mutation(
                updated_trip,
                (
                    PendingEvent(
                        type=EventType.PROPOSAL_UPDATED,
                        simulation_time=runtime.clock.clock.current_time,
                        data=updated_trip,
                    ),
                    PendingEvent(
                        type=EventType.BUS_UPDATED,
                        simulation_time=runtime.clock.clock.current_time,
                        data=updated_bus,
                    ),
                ),
            )

        result = runtime.coordinator.mutate(approve)
        return cast(dict[str, object], result.model_dump(mode="json"))

    @application.post("/api/v1/additional-trips/{trip_id}/reject")
    async def reject_additional_trip(trip_id: str) -> dict[str, object]:
        runtime: RuntimeOwner = application.state.runtime

        def reject(editor: StateEditor) -> Mutation[AdditionalTrip]:
            trip = editor.trip(AdditionalTripId(trip_id))
            if trip is None:
                raise HTTPException(status_code=404, detail="additional trip not found")
            if trip.status is AdditionalTripStatus.REJECTED:
                return Mutation(trip)
            if trip.status is not AdditionalTripStatus.PROPOSED:
                raise HTTPException(status_code=409, detail="trip is not proposed")
            bus = editor.bus(BusId(trip.bus_id))
            if bus is None or bus.proposed_trip_id != trip.id:
                raise HTTPException(
                    status_code=409, detail="bus reservation is missing"
                )
            updated_trip = trip.model_copy(
                update={"status": AdditionalTripStatus.REJECTED}
            )
            updated_bus = bus.model_copy(
                update={
                    "assigned_trip_id": None,
                    "proposed_trip_id": None,
                    "status": BusStatus.AVAILABLE,
                }
            )
            editor.put_trip(updated_trip)
            editor.put_bus(updated_bus)
            return Mutation(
                updated_trip,
                (
                    PendingEvent(
                        type=EventType.PROPOSAL_UPDATED,
                        simulation_time=runtime.clock.clock.current_time,
                        data=updated_trip,
                    ),
                    PendingEvent(
                        type=EventType.BUS_UPDATED,
                        simulation_time=runtime.clock.clock.current_time,
                        data=updated_bus,
                    ),
                ),
            )

        result = runtime.coordinator.mutate(reject)
        return cast(dict[str, object], result.model_dump(mode="json"))

    return application


app = create_app()


def _event_response(event: object) -> DispatchEventResponse:
    assert isinstance(event, DispatchEvent)
    return DispatchEventResponse.model_validate(event.model_dump(mode="json"))


def _resolve_event_window(
    window: EventWindow, transit: object, settings: Settings
) -> EventWindow:
    from app.transit.index import TransitIndex

    assert isinstance(transit, TransitIndex)
    hubs = {str(hub.hub_id): hub for hub in transit.hubs()}
    routes = {str(route.route_id): route for route in transit.routes()}
    line_routes = {str(route.line_key): route for route in transit.routes()}
    events: list[DispatchEvent] = []
    for event in window.events:
        mapped_hub_id = event.hub_id or settings.hub_aliases.get(
            event.source_location, event.source_location
        )
        hub = hubs.get(str(mapped_hub_id))
        recommendations = tuple(
            recommendation.model_copy(
                update={
                    "route_id": (
                        route.route_id
                        if (
                            route := routes.get(
                                settings.route_aliases.get(
                                    recommendation.source_route,
                                    recommendation.source_route,
                                )
                            )
                            or line_routes.get(recommendation.source_route)
                        )
                        else None
                    )
                }
            )
            for recommendation in event.recommendations
        )
        invalid_reason = None
        if hub is None:
            invalid_reason = f"unknown source location: {event.source_location}"
        elif not any(item.route_id is not None for item in recommendations):
            invalid_reason = "no recommendation maps to a GTFS route"
        events.append(
            event.model_copy(
                update={
                    "hub_id": str(hub.hub_id) if hub is not None else None,
                    "location": hub.location if hub is not None else None,
                    "recommendations": recommendations,
                    "status": (
                        EventStatus.INVALID_SOURCE
                        if invalid_reason is not None
                        else EventStatus.PENDING
                    ),
                    "invalid_source_reason": invalid_reason,
                }
            )
        )
    return window.model_copy(update={"events": tuple(events)})
