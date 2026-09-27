from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, model_validator

from app.config import Settings
from app.domain.models import Bus, BusSource, BusSourceType, BusStatus
from app.domain.types import HubId
from app.transit.index import TransitIndex
from app.transit.models import HubCatchment


class FleetConfigError(ValueError):
    pass


class FleetBusConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    id: Annotated[StrictStr, Field(min_length=1)]
    capacity: Annotated[StrictInt, Field(gt=0)]
    initial_location_id: Annotated[StrictStr, Field(min_length=1)]
    home_location_id: Annotated[StrictStr, Field(min_length=1)]

    @model_validator(mode="after")
    def normalize_identifiers(self) -> FleetBusConfig:
        values = (self.id, self.initial_location_id, self.home_location_id)
        if any(value != value.strip() for value in values):
            raise ValueError("fleet identifiers must not have surrounding whitespace")
        return self


class FleetConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    buses: tuple[FleetBusConfig, ...]

    @model_validator(mode="after")
    def unique_bus_ids(self) -> FleetConfig:
        ids = [bus.id for bus in self.buses]
        if len(ids) != len(set(ids)):
            raise ValueError("fleet bus IDs must be unique")
        return self


@dataclass(frozen=True)
class FleetDefinition:
    buses: tuple[Bus, ...]
    source: str

    @property
    def size(self) -> int:
        return len(self.buses)

    @property
    def total_capacity(self) -> int:
        return sum(bus.capacity for bus in self.buses)


def load_fleet(settings: Settings, transit: TransitIndex) -> FleetDefinition:
    if settings.fleet_config_path is None:
        return _generated_fleet(settings, transit)
    path = settings.fleet_config_path
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise FleetConfigError(f"cannot read fleet config {path}: {exc}") from exc
    try:
        config = FleetConfig.model_validate_json(raw)
    except ValueError as exc:
        raise FleetConfigError(f"invalid fleet config {path}: {exc}") from exc
    return FleetDefinition(
        buses=_build_buses(config.buses, transit),
        source=str(path),
    )


def available_buses(buses: Iterable[Bus]) -> tuple[Bus, ...]:
    return tuple(
        sorted(
            (
                bus
                for bus in buses
                if bus.status is BusStatus.AVAILABLE
                and bus.assigned_trip_id is None
                and bus.proposed_trip_id is None
            ),
            key=lambda bus: str(bus.id),
        )
    )


def _generated_fleet(settings: Settings, transit: TransitIndex) -> FleetDefinition:
    if settings.fleet_size == 0:
        return FleetDefinition(buses=(), source="generated")
    location = transit.hub(HubId(settings.default_fleet_location_id))
    if location is None:
        raise FleetConfigError(
            "default_fleet_location_id references unknown hub: "
            f"{settings.default_fleet_location_id}"
        )
    buses = tuple(
        _bus(
            bus_id=f"bus-{number:02d}",
            capacity=settings.default_bus_capacity,
            initial=location,
            home=location,
        )
        for number in range(1, settings.fleet_size + 1)
    )
    return FleetDefinition(buses=buses, source="generated")


def _build_buses(
    configs: tuple[FleetBusConfig, ...], transit: TransitIndex
) -> tuple[Bus, ...]:
    buses: list[Bus] = []
    for config in configs:
        initial = transit.hub(HubId(config.initial_location_id))
        if initial is None:
            raise FleetConfigError(
                f"bus {config.id} has unknown initial location: "
                f"{config.initial_location_id}"
            )
        home = transit.hub(HubId(config.home_location_id))
        if home is None:
            raise FleetConfigError(
                f"bus {config.id} has unknown home location: {config.home_location_id}"
            )
        buses.append(
            _bus(
                bus_id=config.id,
                capacity=config.capacity,
                initial=initial,
                home=home,
            )
        )
    return tuple(sorted(buses, key=lambda bus: str(bus.id)))


def _bus(bus_id: str, capacity: int, initial: HubCatchment, home: HubCatchment) -> Bus:
    return Bus(
        id=bus_id,
        status=BusStatus.AVAILABLE,
        location=initial.location,
        heading_deg=None,
        capacity=capacity,
        source=BusSource(
            type=BusSourceType.DEPOT,
            route=None,
            depot_name=initial.location_name,
        ),
        assigned_trip_id=None,
        proposed_trip_id=None,
        home_location=home.location,
    )
