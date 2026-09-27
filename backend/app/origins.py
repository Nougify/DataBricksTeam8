from collections.abc import Collection


def is_websocket_origin_allowed(
    origin: str | None, allowed_origins: Collection[str]
) -> bool:
    if origin is None:
        return False
    return origin.rstrip("/") in allowed_origins
