from dataclasses import dataclass

from app.config import Settings
from app.data.store import SnapshotStore


@dataclass(frozen=True)
class RuntimeOwner:
    """Process-local owner for data and the future mutation coordinator."""

    settings: Settings
    data: SnapshotStore
