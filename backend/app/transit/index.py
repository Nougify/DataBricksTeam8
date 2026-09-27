from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Iterable, Mapping
from datetime import UTC, date, datetime, time, timedelta
from types import MappingProxyType

from app.domain.models import (
    DayType,
    GeoJsonLineString,
    GeoJsonMultiLineString,
    RouteRef,
    RouteShape,
    ScheduledTrip,
    ServicePattern,
    Stop,
    TransitMode,
)
from app.domain.types import (
    PERMANENT_PACIFIC,
    PERMANENT_PACIFIC_START,
    VANCOUVER,
    HubId,
    RouteId,
    ServicePatternId,
    StopId,
)
from app.transit.models import (
    CalendarException,
    CalendarRule,
    HubCatchment,
    ScheduledDeparture,
    ServiceDateResolution,
    TripTemplate,
)


class TransitDataError(ValueError):
    pass


class TransitIndex:
    """Immutable GTFS lookups and dated schedule expansion."""

    def __init__(
        self,
        *,
        feed_version: str,
        routes: tuple[RouteRef, ...],
        stops: tuple[Stop, ...],
        patterns: tuple[ServicePattern, ...],
        templates: tuple[TripTemplate, ...],
        calendars: tuple[CalendarRule, ...],
        exceptions: tuple[CalendarException, ...],
        representative_dates: Mapping[DayType, date],
        hubs: tuple[HubCatchment, ...],
    ) -> None:
        self._feed_version = feed_version
        self._routes = tuple(
            sorted(routes, key=lambda item: (item.line_key, item.route_id))
        )
        self._stops = tuple(sorted(stops, key=lambda item: item.id))
        self._patterns = tuple(sorted(patterns, key=lambda item: item.id))
        self._templates = tuple(sorted(templates, key=lambda item: item.gtfs_trip_id))
        self._calendars = calendars
        self._exceptions = exceptions
        self._representative_dates = MappingProxyType(dict(representative_dates))
        self._hubs = tuple(sorted(hubs, key=lambda item: item.hub_id))
        self._hub_by_id: Mapping[str, HubCatchment] = self._unique_map(
            ((str(hub.hub_id), hub) for hub in self._hubs), "hub"
        )

        self._route_by_id: Mapping[str, RouteRef] = self._unique_map(
            ((str(route.route_id), route) for route in self._routes), "route"
        )
        self._stop_by_id: Mapping[str, Stop] = self._unique_map(
            ((str(stop.id), stop) for stop in self._stops), "stop"
        )
        self._pattern_by_id: Mapping[str, ServicePattern] = self._unique_map(
            ((str(pattern.id), pattern) for pattern in self._patterns), "pattern"
        )
        self._validate_references()

        patterns_by_route: dict[str, list[ServicePattern]] = defaultdict(list)
        templates_by_route: dict[str, list[TripTemplate]] = defaultdict(list)
        templates_by_pattern: dict[str, list[TripTemplate]] = defaultdict(list)
        for pattern in self._patterns:
            patterns_by_route[str(pattern.route.route_id)].append(pattern)
        for template in self._templates:
            templates_by_route[template.route_id].append(template)
            templates_by_pattern[str(template.pattern_id)].append(template)
        self._patterns_by_route = MappingProxyType(
            {key: tuple(value) for key, value in patterns_by_route.items()}
        )
        self._templates_by_route = MappingProxyType(
            {key: tuple(value) for key, value in templates_by_route.items()}
        )
        self._templates_by_pattern = MappingProxyType(
            {key: tuple(value) for key, value in templates_by_pattern.items()}
        )

        hub_stops: dict[str, tuple[StopId, ...]] = {}
        for hub in self._hubs:
            hub_stops[str(hub.hub_id)] = tuple(
                stop.id
                for stop in self._stops
                if _distance_m(
                    hub.location.lat,
                    hub.location.lon,
                    stop.location.lat,
                    stop.location.lon,
                )
                <= hub.catchment_m
            )
        self._hub_stops = MappingProxyType(hub_stops)

        coverage_dates = [
            item for rule in calendars for item in (rule.start_date, rule.end_date)
        ] + [exception.service_date for exception in exceptions]
        if not coverage_dates:
            raise TransitDataError("GTFS calendar has no coverage")
        self._coverage_start = min(coverage_dates)
        self._coverage_end = max(coverage_dates)
        for day_type, service_date in self._representative_dates.items():
            if not self.coverage_start <= service_date <= self.coverage_end:
                raise TransitDataError(
                    f"representative date for {day_type.value} is outside feed coverage"
                )
            if not self._active_services_on(service_date):
                raise TransitDataError(
                    f"representative date for {day_type.value} has no active service"
                )

    @property
    def feed_version(self) -> str:
        return self._feed_version

    @property
    def coverage_start(self) -> date:
        return self._coverage_start

    @property
    def coverage_end(self) -> date:
        return self._coverage_end

    @staticmethod
    def _unique_map[ValueT](
        items: Iterable[tuple[str, ValueT]], label: str
    ) -> Mapping[str, ValueT]:
        result: dict[str, ValueT] = {}
        for key, value in items:
            if key in result:
                raise TransitDataError(f"duplicate {label} id: {key}")
            result[key] = value
        return MappingProxyType(result)

    def _validate_references(self) -> None:
        for pattern in self._patterns:
            route_id = str(pattern.route.route_id)
            if route_id not in self._route_by_id:
                raise TransitDataError(f"pattern references unknown route: {route_id}")
            if self._route_by_id[route_id] != pattern.route:
                raise TransitDataError(
                    f"pattern route differs from route index: {route_id}"
                )
            for stop_time in pattern.stops:
                stop_id = str(stop_time.stop.id)
                if stop_id not in self._stop_by_id:
                    raise TransitDataError(
                        f"pattern references unknown stop: {stop_id}"
                    )
        for template in self._templates:
            if template.route_id not in self._route_by_id:
                raise TransitDataError(
                    f"trip {template.gtfs_trip_id} references unknown route"
                )
            linked_pattern = self._pattern_by_id.get(str(template.pattern_id))
            if linked_pattern is None:
                raise TransitDataError(
                    f"trip {template.gtfs_trip_id} references unknown pattern"
                )
            if len(template.arrival_seconds) != len(linked_pattern.stops):
                raise TransitDataError(
                    f"trip {template.gtfs_trip_id} stop count differs from pattern"
                )
            if len(template.departure_seconds) != len(linked_pattern.stops):
                raise TransitDataError(
                    f"trip {template.gtfs_trip_id} departure count differs from pattern"
                )

    def routes(self) -> tuple[RouteRef, ...]:
        return self._routes

    def route(self, route_id: RouteId) -> RouteRef | None:
        return self._route_by_id.get(str(route_id))

    def stop(self, stop_id: StopId) -> Stop | None:
        return self._stop_by_id.get(str(stop_id))

    def stops(self) -> tuple[Stop, ...]:
        return self._stops

    def pattern(self, pattern_id: ServicePatternId) -> ServicePattern | None:
        return self._pattern_by_id.get(str(pattern_id))

    def trip_template_count(self, pattern_id: ServicePatternId) -> int:
        return len(self._templates_by_pattern.get(str(pattern_id), ()))

    def hubs(self) -> tuple[HubCatchment, ...]:
        return self._hubs

    def hub(self, hub_id: HubId) -> HubCatchment | None:
        return self._hub_by_id.get(str(hub_id))

    def hub_stop_ids(self, hub_id: HubId) -> tuple[StopId, ...]:
        if str(hub_id) not in self._hub_stops:
            raise KeyError(f"unknown hub: {hub_id}")
        return self._hub_stops[str(hub_id)]

    def patterns_for_route(
        self, route_id: RouteId, *, dispatch_eligible_only: bool = False
    ) -> tuple[ServicePattern, ...]:
        patterns = self._patterns_by_route.get(str(route_id), ())
        if dispatch_eligible_only:
            return tuple(
                pattern
                for pattern in patterns
                if pattern.route.mode is TransitMode.BUS and pattern.shape is not None
            )
        return patterns

    def patterns_serving_hub(
        self, hub_id: HubId, *, dispatch_eligible_only: bool = False
    ) -> tuple[ServicePattern, ...]:
        stop_ids = set(self.hub_stop_ids(hub_id))
        return tuple(
            pattern
            for pattern in self._patterns
            if (
                not dispatch_eligible_only
                or (pattern.route.mode is TransitMode.BUS and pattern.shape is not None)
            )
            and any(stop_time.stop.id in stop_ids for stop_time in pattern.stops)
        )

    def route_shape(self, route_id: RouteId) -> RouteShape | None:
        lines = tuple(
            line
            for pattern in self.patterns_for_route(route_id)
            if pattern.shape is not None
            for line in (
                (pattern.shape.coordinates,)
                if isinstance(pattern.shape, GeoJsonLineString)
                else pattern.shape.coordinates
            )
        )
        unique = tuple(dict.fromkeys(lines))
        if not unique:
            return None
        if len(unique) == 1:
            return GeoJsonLineString(coordinates=unique[0])
        return GeoJsonMultiLineString(coordinates=unique)

    def service_date_resolution(self, requested_date: date) -> ServiceDateResolution:
        day_type = _day_type(requested_date)
        if self.coverage_start <= requested_date <= self.coverage_end:
            return ServiceDateResolution(
                requested_date=requested_date,
                service_date=requested_date,
                day_type=day_type,
                is_representative=False,
                feed_version=self.feed_version,
                reason="requested date is within GTFS feed coverage",
            )
        service_date = self._representative_dates.get(day_type)
        if service_date is None:
            raise TransitDataError(f"no representative date for {day_type}")
        return ServiceDateResolution(
            requested_date=requested_date,
            service_date=service_date,
            day_type=day_type,
            is_representative=True,
            feed_version=self.feed_version,
            reason=f"{day_type.value} mapped outside feed coverage",
        )

    def active_service_ids(self, requested_date: date) -> frozenset[str]:
        resolution = self.service_date_resolution(requested_date)
        return self._active_services_on(resolution.service_date)

    def _active_services_on(self, service_date: date) -> frozenset[str]:
        active = {
            rule.service_id
            for rule in self._calendars
            if rule.start_date <= service_date <= rule.end_date
            and rule.weekdays[service_date.weekday()]
        }
        for exception in self._exceptions:
            if exception.service_date != service_date:
                continue
            if exception.added:
                active.add(exception.service_id)
            else:
                active.discard(exception.service_id)
        return frozenset(active)

    def scheduled_trips(
        self, route_id: RouteId, requested_date: date
    ) -> tuple[ScheduledTrip, ...]:
        active = self.active_service_ids(requested_date)
        trips = [
            self._schedule(template, requested_date)
            for template in self._templates_by_route.get(str(route_id), ())
            if template.service_id in active
        ]
        return tuple(sorted(trips, key=lambda item: (item.start_time, item.id)))

    def scheduled_trips_for_pattern(
        self, pattern_id: ServicePatternId, requested_date: date
    ) -> tuple[ScheduledTrip, ...]:
        active = self.active_service_ids(requested_date)
        trips = [
            self._schedule(template, requested_date)
            for template in self._templates_by_pattern.get(str(pattern_id), ())
            if template.service_id in active
        ]
        return tuple(sorted(trips, key=lambda item: (item.start_time, item.id)))

    def departures(
        self, route_id: RouteId, requested_date: date
    ) -> tuple[ScheduledDeparture, ...]:
        departures: list[ScheduledDeparture] = []
        active = self.active_service_ids(requested_date)
        templates = {
            template.gtfs_trip_id: template
            for template in self._templates_by_route.get(str(route_id), ())
            if template.service_id in active
        }
        catchment_stop_ids = {
            stop_id for stop_ids in self._hub_stops.values() for stop_id in stop_ids
        }
        for trip in self.scheduled_trips(route_id, requested_date):
            pattern = self._pattern_by_id[str(trip.service_pattern_id)]
            template = templates[trip.gtfs_trip_id]
            catchment_index = next(
                (
                    index
                    for index, stop_time in enumerate(pattern.stops)
                    if stop_time.stop.id in catchment_stop_ids
                ),
                None,
            )
            departure_index = catchment_index if catchment_index is not None else 0
            departures.append(
                ScheduledDeparture(
                    trip_id=trip.id,
                    gtfs_trip_id=trip.gtfs_trip_id,
                    route_id=str(route_id),
                    pattern_id=trip.service_pattern_id,
                    service_date=trip.service_date,
                    departure_time_seconds=template.departure_seconds[departure_index],
                    stop_id=(
                        str(pattern.stops[departure_index].stop.id)
                        if catchment_index is not None
                        else None
                    ),
                )
            )
        return tuple(
            sorted(
                departures,
                key=lambda item: (item.departure_time_seconds, item.trip_id),
            )
        )

    def _schedule(self, template: TripTemplate, requested_date: date) -> ScheduledTrip:
        midnight = _service_midnight(requested_date)
        stop_times = tuple(
            _localize_elapsed(midnight, seconds) for seconds in template.arrival_seconds
        )
        return ScheduledTrip(
            id=f"{requested_date.isoformat()}:{template.gtfs_trip_id}",
            gtfs_trip_id=template.gtfs_trip_id,
            service_pattern_id=template.pattern_id,
            service_date=requested_date,
            start_time=stop_times[0],
            stop_times=stop_times,
        )


def _day_type(value: date) -> DayType:
    if _is_bc_holiday(value):
        return DayType.SUN_HOL
    if value.weekday() < 5:
        return DayType.MF
    if value.weekday() == 5:
        return DayType.SAT
    return DayType.SUN_HOL


def _is_bc_holiday(value: date) -> bool:
    fixed = {(1, 1), (7, 1), (9, 30), (11, 11), (12, 25), (12, 26)}
    if (value.month, value.day) in fixed:
        return True
    if value.month == 2 and value.weekday() == 0 and 15 <= value.day <= 21:
        return True
    if value.month == 5 and value.weekday() == 0 and 18 <= value.day <= 24:
        return True
    if value.month == 8 and value.weekday() == 0 and value.day <= 7:
        return True
    if value.month == 9 and value.weekday() == 0 and value.day <= 7:
        return True
    if value.month == 10 and value.weekday() == 0 and 8 <= value.day <= 14:
        return True
    good_friday = _good_friday(value.year)
    return value in {good_friday, good_friday + timedelta(days=3)}


def _good_friday(year: int) -> date:
    # Gregorian computus, followed by the two-day offset to Good Friday.
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    ell = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ell) // 451
    month = (h + ell - 7 * m + 114) // 31
    day = (h + ell - 7 * m + 114) % 31 + 1
    return date(year, month, day) - timedelta(days=2)


def _service_midnight(value: date) -> datetime:
    candidate = datetime.combine(value, time.min, tzinfo=VANCOUVER)
    if candidate.astimezone(UTC) >= PERMANENT_PACIFIC_START:
        return datetime.combine(value, time.min, tzinfo=PERMANENT_PACIFIC)
    return candidate


def _localize_elapsed(midnight: datetime, seconds: int) -> datetime:
    instant = midnight.astimezone(UTC) + timedelta(seconds=seconds)
    zone = PERMANENT_PACIFIC if instant >= PERMANENT_PACIFIC_START else VANCOUVER
    return instant.astimezone(zone)


def _distance_m(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    radius_m = 6_371_000.0
    lat1 = math.radians(lat_a)
    lat2 = math.radians(lat_b)
    delta_lat = math.radians(lat_b - lat_a)
    delta_lon = math.radians(lon_b - lon_a)
    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * radius_m * math.asin(math.sqrt(haversine))
