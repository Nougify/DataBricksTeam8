from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import Settings, get_settings
from app.data.adapters import build_snapshot_source
from app.data.fixtures import fixture_now
from app.data.store import SnapshotStore
from app.errors import install_error_handlers
from app.runtime import RuntimeOwner
from app.services.coordinator import MutationCoordinator
from app.services.events import InMemoryEventSink


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
        events = InMemoryEventSink()
        coordinator = MutationCoordinator(events)
        application.state.runtime = RuntimeOwner(
            settings=resolved_settings,
            data=data,
            coordinator=coordinator,
            events=events,
        )
        yield

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
