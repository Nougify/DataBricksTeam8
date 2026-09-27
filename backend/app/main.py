import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Literal, cast

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import DataMode, Settings, get_settings
from app.data.adapters import build_event_source
from app.data.store import EventWindowStore
from app.errors import install_error_handlers
from app.routing import build_routing_service
from app.runtime import RuntimeOwner
from app.services.clock import (
    SimulationClockController,
    SystemMonotonicTimeSource,
    initial_clock,
)
from app.services.coordinator import MutationCoordinator
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
    event_id: str
    source_version: str
    event_time: datetime
    hub_id: str
    surge_type: str
    predicted_people: float
    normal_people: float
    generated_at: datetime
    recommendations: tuple[dict[str, object], ...]
    invalid_source_reason: str | None


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
        events = InMemoryEventSink()
        coordinator = MutationCoordinator(events, initial_clock(resolved_settings))
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
        title="Surge Bus API",
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
            "source_version": runtime.settings.data_source_version,
            "integration_status": runtime.data.status,
            "event_window": runtime.data.reader().window.metadata.model_dump(
                mode="json"
            ),
        }

    @application.get("/api/v1/state")
    async def state() -> dict[str, object]:
        runtime: RuntimeOwner = application.state.runtime
        snapshot = runtime.coordinator.snapshot()
        return {
            "epoch": snapshot.epoch,
            "last_seq": snapshot.last_seq,
            "simulation": snapshot.clock.model_dump(mode="json"),
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
    async def dispatch_events() -> list[DispatchEventResponse]:
        runtime: RuntimeOwner = application.state.runtime
        return [_event_response(event) for event in runtime.data.reader().window.events]

    @application.get(
        "/api/v1/dispatch-events/{event_id}", response_model=DispatchEventResponse
    )
    async def dispatch_event(event_id: str) -> DispatchEventResponse:
        runtime: RuntimeOwner = application.state.runtime
        event = runtime.data.reader().event(event_id)
        if event is None:
            raise HTTPException(status_code=404, detail="dispatch event not found")
        return _event_response(event)

    @application.get("/api/v1/buses")
    async def buses() -> list[dict[str, object]]:
        runtime: RuntimeOwner = application.state.runtime
        return [
            bus.model_dump(mode="json")
            for bus in runtime.coordinator.snapshot().entities.buses.list()
        ]

    @application.get("/api/v1/additional-trips")
    async def additional_trips() -> list[dict[str, object]]:
        runtime: RuntimeOwner = application.state.runtime
        return [
            trip.model_dump(mode="json")
            for trip in runtime.coordinator.snapshot().entities.trips.list()
        ]

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
    async def approve_additional_trip(trip_id: str) -> None:
        del trip_id
        raise HTTPException(status_code=404, detail="additional trip not found")

    @application.post("/api/v1/additional-trips/{trip_id}/reject")
    async def reject_additional_trip(trip_id: str) -> None:
        del trip_id
        raise HTTPException(status_code=404, detail="additional trip not found")

    return application


app = create_app()


def _event_response(event: object) -> DispatchEventResponse:
    from app.data.models import DispatchEvent

    assert isinstance(event, DispatchEvent)
    return DispatchEventResponse(
        **event.model_dump(exclude={"recommendations"}),
        recommendations=tuple(item.model_dump() for item in event.recommendations),
    )
