from dataclasses import dataclass

from app.config import Settings
from app.data.store import SnapshotStore
from app.services.clock import SimulationClockController
from app.services.coordinator import MutationCoordinator
from app.services.events import EventSink
from app.transit.index import TransitIndex


@dataclass(frozen=True)
class RuntimeOwner:
    """Process-local owner for data and authoritative simulation mutation."""

    settings: Settings
    data: SnapshotStore
    transit: TransitIndex
    coordinator: MutationCoordinator
    clock: SimulationClockController
    events: EventSink
