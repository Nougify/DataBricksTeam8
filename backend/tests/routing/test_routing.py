import math

import pytest
from pydantic import ValidationError

from app.domain.models import GeoPoint
from app.routing import (
    RoutingProvider,
    RoutingService,
    StraightLineRoutingService,
    build_routing_service,
    great_circle_distance_m,
)


def test_straight_line_route_preserves_geometry_order_and_units() -> None:
    start = GeoPoint(lat=49.2827, lon=-123.1207)
    end = GeoPoint(lat=49.2676, lon=-123.2524)
    service = StraightLineRoutingService(speed_kph=30)

    result = service.route(start, end)

    assert result.path.type == "LineString"
    assert result.path.coordinates == (
        (start.lon, start.lat),
        (end.lon, end.lat),
    )
    assert result.distance_m == pytest.approx(9_750, rel=0.05)
    assert result.duration_seconds == pytest.approx(result.distance_m / (30 / 3.6))
    assert result.provenance.provider == "straight_line"
    assert result.provenance.is_approximation is True
    assert result.provenance.speed_kph == 30


def test_coincident_endpoints_return_valid_nonempty_path() -> None:
    point = GeoPoint(lat=49.2606, lon=-123.2460)

    result = StraightLineRoutingService(speed_kph=25).route(point, point)

    assert result.path.coordinates == (
        (point.lon, point.lat),
        (point.lon, point.lat),
    )
    assert result.distance_m == 0
    assert result.duration_seconds == 0


def test_great_circle_distance_is_symmetric() -> None:
    first = GeoPoint(lat=49.2827, lon=-123.1207)
    second = GeoPoint(lat=49.2676, lon=-123.2524)

    assert great_circle_distance_m(first, second) == pytest.approx(
        great_circle_distance_m(second, first)
    )


@pytest.mark.parametrize("speed", [0, -1, math.inf, -math.inf, math.nan])
def test_straight_line_service_rejects_invalid_speed(speed: float) -> None:
    with pytest.raises(ValueError, match="finite and positive"):
        StraightLineRoutingService(speed_kph=speed)


@pytest.mark.parametrize(
    ("lat", "lon"),
    [(91, 0), (-91, 0), (0, 181), (0, -181), (math.inf, 0), (0, math.nan)],
)
def test_geo_point_rejects_invalid_routing_coordinates(lat: float, lon: float) -> None:
    with pytest.raises(ValidationError):
        GeoPoint(lat=lat, lon=lon)


def test_factory_returns_provider_neutral_service() -> None:
    service: RoutingService = build_routing_service(
        RoutingProvider.STRAIGHT_LINE, speed_kph=40
    )

    result = service.route(
        GeoPoint(lat=49.2827, lon=-123.1207),
        GeoPoint(lat=49.2828, lon=-123.1208),
    )

    assert isinstance(service, StraightLineRoutingService)
    assert result.provenance.provider == RoutingProvider.STRAIGHT_LINE.value
