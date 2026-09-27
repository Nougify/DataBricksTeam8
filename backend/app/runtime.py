from dataclasses import dataclass

from app.config import Settings
from app.data.store import EventWindowStore
from app.fleet import FleetDefinition
from app.routing import ItineraryComposer, RoutingService
from app.services.activation import EventActivationService
from app.services.clock import SimulationClockController
from app.services.coordinator import MutationCoordinator
from app.services.events import EventSink
from app.services.movement import MovementLifecycleService
from app.services.proposals import ProposalService
from app.transit.index import TransitIndex


@dataclass(frozen=True)
class RuntimeOwner:
    """Process-local owner for data and authoritative simulation mutation."""

    settings: Settings
    data: EventWindowStore
    transit: TransitIndex
    fleet: FleetDefinition
    routing: RoutingService
    itinerary: ItineraryComposer
    coordinator: MutationCoordinator
    clock: SimulationClockController
    activation: EventActivationService
    movement: MovementLifecycleService
    proposals: ProposalService
    events: EventSink
