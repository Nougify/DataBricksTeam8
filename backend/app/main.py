from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from app.config import get_settings


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(title="Surge Bus API", version="0.1.0")
    application.state.settings = settings

    @application.get("/healthz", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse()

    @application.get("/api/health", response_model=HealthResponse, deprecated=True)
    async def legacy_health() -> HealthResponse:
        return HealthResponse()

    return application


app = create_app()
