from dataclasses import dataclass

from app.config import Settings


@dataclass(frozen=True)
class RuntimeOwner:
    """Process-local owner for the future simulation and mutation coordinator."""

    settings: Settings
