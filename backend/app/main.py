import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import DataMode, Settings, get_settings
from app.data.adapters import build_snapshot_source
from app.data.fixtures import fixture_now
from app.data.store import SnapshotStore
from app.errors import install_error_handlers
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


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        source = build_snapshot_source(resolved_settings)
        data = SnapshotStore(source)
        now = (
            fixture_now()
            if resolved_settings.data_mode.value == "fixture"
            else datetime.now().astimezone()
        )
        data.refresh(now)
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
        application.state.runtime = RuntimeOwner(
            settings=resolved_settings,
            data=data,
            transit=transit,
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

    return application


app = create_app()
