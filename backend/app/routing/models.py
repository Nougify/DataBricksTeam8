from typing import Annotated

from pydantic import Field

from app.domain.models import DomainModel, GeoJsonLineString
from app.domain.types import NonEmptyText, NonNegativeFloat


class RoutingProvenance(DomainModel):
    provider: NonEmptyText
    is_approximation: bool
    method: NonEmptyText
    speed_kph: Annotated[float, Field(gt=0)] | None


class RoutingResult(DomainModel):
    path: GeoJsonLineString
    distance_m: NonNegativeFloat
    duration_seconds: NonNegativeFloat
    provenance: RoutingProvenance
