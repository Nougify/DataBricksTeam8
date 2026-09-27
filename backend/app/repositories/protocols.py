from typing import Protocol


class ReadRepository[IdT, EntityT](Protocol):
    def get(self, entity_id: IdT) -> EntityT | None: ...

    def list(self) -> tuple[EntityT, ...]: ...
