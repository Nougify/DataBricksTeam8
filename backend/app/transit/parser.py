from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import defaultdict
from collections.abc import Callable, Mapping
from datetime import date, datetime
from pathlib import Path

from app.domain.models import (
    DayType,
    GeoJsonLineString,
    GeoPoint,
    RouteRef,
    ScheduledStopTime,
    ServicePattern,
    Stop,
    TransitMode,
)
from app.transit.index import TransitDataError, TransitIndex
from app.transit.models import (
    CalendarException,
    CalendarRule,
    HubCatchment,
    TripTemplate,
)

_REQUIRED_COLUMNS = {
    "routes.txt": {
        "route_id",
        "route_short_name",
        "route_long_name",
        "route_type",
        "route_color",
        "route_text_color",
    },
    "stops.txt": {"stop_id", "stop_name", "stop_lat", "stop_lon"},
    "trips.txt": {
        "route_id",
        "service_id",
        "trip_id",
        "trip_headsign",
        "direction_id",
        "shape_id",
    },
    "stop_times.txt": {
        "trip_id",
        "arrival_time",
        "departure_time",
        "stop_id",
        "stop_sequence",
    },
    "shapes.txt": {
        "shape_id",
        "shape_pt_lat",
        "shape_pt_lon",
        "shape_pt_sequence",
    },
    "calendar.txt": {
        "service_id",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
        "start_date",
        "end_date",
    },
    "calendar_dates.txt": {"service_id", "date", "exception_type"},
}

_ROUTE_TYPES = {
    "1": TransitMode.SKYTRAIN,
    "2": TransitMode.WEST_COAST_EXPRESS,
    "3": TransitMode.BUS,
    "4": TransitMode.SEABUS,
}

_SERVICE_TIME = re.compile(r"^(\d+):([0-5]\d):([0-5]\d)$")


class GtfsLoadError(TransitDataError):
    pass


def parse_service_time(value: str) -> int:
    match = _SERVICE_TIME.fullmatch(value.strip())
    if match is None:
        raise GtfsLoadError(f"invalid GTFS service time: {value!r}")
    hours, minutes, seconds = (int(part) for part in match.groups())
    return hours * 3600 + minutes * 60 + seconds


def load_gtfs_directory(
    root: Path,
    *,
    feed_version: str,
    representative_dates: Mapping[DayType, date],
    hubs: tuple[HubCatchment, ...],
) -> TransitIndex:
    if not root.is_dir():
        raise GtfsLoadError(f"GTFS source is not a directory: {root}")
    rows = {
        filename: _read_csv(root / filename, columns)
        for filename, columns in _REQUIRED_COLUMNS.items()
    }
    return _build_index(
        rows,
        feed_version=feed_version,
        representative_dates=representative_dates,
        hubs=hubs,
    )


def _read_csv(path: Path, required_columns: set[str]) -> tuple[dict[str, str], ...]:
    if not path.is_file():
        raise GtfsLoadError(f"missing required GTFS file: {path.name}")
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            columns = set(reader.fieldnames or ())
            missing = sorted(required_columns - columns)
            if missing:
                raise GtfsLoadError(
                    f"{path.name} missing required columns: {', '.join(missing)}"
                )
            return tuple(
                {key: value or "" for key, value in row.items() if key is not None}
                for row in reader
            )
    except OSError as exc:
        raise GtfsLoadError(f"could not read {path.name}: {exc}") from exc


def _build_index(
    rows: Mapping[str, tuple[dict[str, str], ...]],
    *,
    feed_version: str,
    representative_dates: Mapping[DayType, date],
    hubs: tuple[HubCatchment, ...],
) -> TransitIndex:
    routes = _routes(rows["routes.txt"])
    stops = _stops(rows["stops.txt"])
    route_by_id = _by_id(routes, lambda item: str(item.route_id), "route")
    stop_by_id = _by_id(stops, lambda item: str(item.id), "stop")
    shapes = _shapes(rows["shapes.txt"])
    calendars = _calendars(rows["calendar.txt"])
    exceptions = _exceptions(rows["calendar_dates.txt"])
    known_services = {rule.service_id for rule in calendars} | {
        item.service_id for item in exceptions
    }

    trip_rows = _unique_rows(rows["trips.txt"], "trip_id", "trip")
    stop_times_by_trip: dict[str, list[dict[str, str]]] = defaultdict(list)
    seen_sequences: set[tuple[str, int]] = set()
    for row in rows["stop_times.txt"]:
        trip_id = _required(row, "trip_id", "stop_times.txt")
        sequence = _nonnegative_int(row["stop_sequence"], "stop_sequence")
        key = (trip_id, sequence)
        if key in seen_sequences:
            raise GtfsLoadError(
                f"duplicate stop_sequence {sequence} for trip {trip_id}"
            )
        seen_sequences.add(key)
        stop_times_by_trip[trip_id].append(row)

    patterns_by_id: dict[str, ServicePattern] = {}
    templates: list[TripTemplate] = []
    for trip_id, row in trip_rows.items():
        route_id = _required(row, "route_id", "trips.txt")
        service_id = _required(row, "service_id", "trips.txt")
        shape_id = row["shape_id"].strip()
        if route_id not in route_by_id:
            raise GtfsLoadError(f"trip {trip_id} references unknown route {route_id}")
        if service_id not in known_services:
            raise GtfsLoadError(
                f"trip {trip_id} references unknown service {service_id}"
            )
        if shape_id and shape_id not in shapes:
            raise GtfsLoadError(f"trip {trip_id} references unknown shape {shape_id}")
        trip_stop_rows = sorted(
            stop_times_by_trip.pop(trip_id, ()),
            key=lambda item: _nonnegative_int(item["stop_sequence"], "stop_sequence"),
        )
        if len(trip_stop_rows) < 2:
            raise GtfsLoadError(f"trip {trip_id} must contain at least two stops")

        absolute: list[tuple[Stop, int, int, int]] = []
        for stop_row in trip_stop_rows:
            stop_id = _required(stop_row, "stop_id", "stop_times.txt")
            if stop_id not in stop_by_id:
                raise GtfsLoadError(f"trip {trip_id} references unknown stop {stop_id}")
            arrival = parse_service_time(stop_row["arrival_time"])
            departure = parse_service_time(stop_row["departure_time"])
            if departure < arrival:
                raise GtfsLoadError(
                    f"trip {trip_id} departure precedes arrival at {stop_id}"
                )
            absolute.append(
                (
                    stop_by_id[stop_id],
                    _nonnegative_int(stop_row["stop_sequence"], "stop_sequence"),
                    arrival,
                    departure,
                )
            )
        if any(
            current[3] > following[2]
            for current, following in zip(absolute, absolute[1:], strict=False)
        ):
            raise GtfsLoadError(f"trip {trip_id} stop times are not chronological")

        first_arrival = absolute[0][2]
        pattern_stops = tuple(
            ScheduledStopTime(
                stop=stop,
                sequence=sequence,
                arrival_offset_seconds=arrival - first_arrival,
                departure_offset_seconds=departure - first_arrival,
            )
            for stop, sequence, arrival, departure in absolute
        )
        direction = _optional_direction(row["direction_id"])
        headsign = row["trip_headsign"].strip() or None
        pattern_id = _pattern_id(
            route_id,
            direction,
            headsign,
            shape_id,
            pattern_stops,
        )
        pattern = ServicePattern(
            id=pattern_id,
            route=route_by_id[route_id],
            direction_id=direction,
            headsign=headsign,
            stops=pattern_stops,
            shape=shapes.get(shape_id),
        )
        existing = patterns_by_id.get(pattern_id)
        if existing is not None and existing != pattern:
            raise GtfsLoadError(f"pattern hash collision: {pattern_id}")
        patterns_by_id[pattern_id] = pattern
        templates.append(
            TripTemplate(
                gtfs_trip_id=trip_id,
                service_id=service_id,
                route_id=route_id,
                pattern_id=pattern.id,
                first_arrival_seconds=first_arrival,
                first_departure_seconds=absolute[0][3],
                arrival_seconds=tuple(item[2] for item in absolute),
                departure_seconds=tuple(item[3] for item in absolute),
            )
        )
    if stop_times_by_trip:
        unknown = min(stop_times_by_trip)
        raise GtfsLoadError(f"stop_times references unknown trip {unknown}")

    return TransitIndex(
        feed_version=feed_version,
        routes=routes,
        stops=stops,
        patterns=tuple(patterns_by_id.values()),
        templates=tuple(templates),
        calendars=calendars,
        exceptions=exceptions,
        representative_dates=representative_dates,
        hubs=hubs,
    )


def _routes(rows: tuple[dict[str, str], ...]) -> tuple[RouteRef, ...]:
    result: list[RouteRef] = []
    seen: set[str] = set()
    for row in rows:
        route_id = _required(row, "route_id", "routes.txt")
        if route_id in seen:
            raise GtfsLoadError(f"duplicate route id: {route_id}")
        seen.add(route_id)
        route_type = row["route_type"].strip()
        if route_type not in _ROUTE_TYPES:
            raise GtfsLoadError(f"unsupported GTFS route_type: {route_type}")
        short_name = row["route_short_name"].strip()
        long_name = row["route_long_name"].strip()
        display_name = short_name or long_name
        if not display_name:
            raise GtfsLoadError(f"route {route_id} has no display name")
        line_key = display_name.lstrip("0") or "0"
        result.append(
            RouteRef(
                route_id=route_id,
                line_key=line_key,
                short_name=display_name,
                long_name=long_name or None,
                mode=_ROUTE_TYPES[route_type],
                color=row["route_color"].strip() or None,
                text_color=row["route_text_color"].strip() or None,
            )
        )
    return tuple(result)


def _stops(rows: tuple[dict[str, str], ...]) -> tuple[Stop, ...]:
    result: list[Stop] = []
    seen: set[str] = set()
    for row in rows:
        stop_id = _required(row, "stop_id", "stops.txt")
        if stop_id in seen:
            raise GtfsLoadError(f"duplicate stop id: {stop_id}")
        seen.add(stop_id)
        try:
            location = GeoPoint(lat=float(row["stop_lat"]), lon=float(row["stop_lon"]))
        except ValueError as exc:
            raise GtfsLoadError(f"stop {stop_id} has invalid coordinates") from exc
        result.append(
            Stop(
                id=stop_id,
                name=_required(row, "stop_name", "stops.txt"),
                location=location,
            )
        )
    return tuple(result)


def _shapes(
    rows: tuple[dict[str, str], ...],
) -> dict[str, GeoJsonLineString]:
    points: dict[str, list[tuple[int, tuple[float, float]]]] = defaultdict(list)
    seen: set[tuple[str, int]] = set()
    for row in rows:
        shape_id = _required(row, "shape_id", "shapes.txt")
        sequence = _nonnegative_int(row["shape_pt_sequence"], "shape_pt_sequence")
        key = (shape_id, sequence)
        if key in seen:
            raise GtfsLoadError(
                f"duplicate shape_pt_sequence {sequence} for shape {shape_id}"
            )
        seen.add(key)
        try:
            position = (float(row["shape_pt_lon"]), float(row["shape_pt_lat"]))
        except ValueError as exc:
            raise GtfsLoadError(f"shape {shape_id} has invalid coordinates") from exc
        points[shape_id].append((sequence, position))
    result: dict[str, GeoJsonLineString] = {}
    for shape_id, values in points.items():
        if len(values) < 2:
            raise GtfsLoadError(f"shape {shape_id} must contain at least two points")
        try:
            result[shape_id] = GeoJsonLineString(
                coordinates=tuple(position for _, position in sorted(values))
            )
        except ValueError as exc:
            raise GtfsLoadError(f"shape {shape_id} has invalid geometry") from exc
    return result


def _calendars(rows: tuple[dict[str, str], ...]) -> tuple[CalendarRule, ...]:
    result: list[CalendarRule] = []
    seen: set[str] = set()
    weekday_columns = (
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    )
    for row in rows:
        service_id = _required(row, "service_id", "calendar.txt")
        if service_id in seen:
            raise GtfsLoadError(f"duplicate calendar service id: {service_id}")
        seen.add(service_id)
        flags: list[bool] = []
        for column in weekday_columns:
            if row[column] not in {"0", "1"}:
                raise GtfsLoadError(f"{column} must be 0 or 1 for {service_id}")
            flags.append(row[column] == "1")
        start = _gtfs_date(row["start_date"], "start_date")
        end = _gtfs_date(row["end_date"], "end_date")
        if end < start:
            raise GtfsLoadError(f"calendar range is reversed for {service_id}")
        result.append(
            CalendarRule(
                service_id,
                start,
                end,
                (
                    flags[0],
                    flags[1],
                    flags[2],
                    flags[3],
                    flags[4],
                    flags[5],
                    flags[6],
                ),
            )
        )
    return tuple(result)


def _exceptions(
    rows: tuple[dict[str, str], ...],
) -> tuple[CalendarException, ...]:
    result: list[CalendarException] = []
    seen: set[tuple[str, date]] = set()
    for row in rows:
        service_id = _required(row, "service_id", "calendar_dates.txt")
        service_date = _gtfs_date(row["date"], "date")
        key = (service_id, service_date)
        if key in seen:
            raise GtfsLoadError(
                f"duplicate calendar exception for {service_id} on {service_date}"
            )
        seen.add(key)
        if row["exception_type"] not in {"1", "2"}:
            raise GtfsLoadError("exception_type must be 1 or 2")
        result.append(
            CalendarException(
                service_id=service_id,
                service_date=service_date,
                added=row["exception_type"] == "1",
            )
        )
    return tuple(result)


def _pattern_id(
    route_id: str,
    direction: int | None,
    headsign: str | None,
    shape_id: str,
    stops: tuple[ScheduledStopTime, ...],
) -> str:
    canonical = json.dumps(
        {
            "route_id": route_id,
            "direction": direction,
            "headsign": headsign,
            "shape_id": shape_id,
            "stops": [
                (
                    str(item.stop.id),
                    item.sequence,
                    item.arrival_offset_seconds,
                    item.departure_offset_seconds,
                )
                for item in stops
            ],
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    return f"pattern-{hashlib.sha256(canonical.encode()).hexdigest()[:20]}"


def _by_id[ValueT](
    values: tuple[ValueT, ...], key: Callable[[ValueT], str], label: str
) -> dict[str, ValueT]:
    result: dict[str, ValueT] = {}
    for value in values:
        identifier = key(value)
        if identifier in result:
            raise GtfsLoadError(f"duplicate {label} id: {identifier}")
        result[identifier] = value
    return result


def _unique_rows(
    rows: tuple[dict[str, str], ...], key: str, label: str
) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for row in rows:
        identifier = _required(row, key, f"{label}s.txt")
        if identifier in result:
            raise GtfsLoadError(f"duplicate {label} id: {identifier}")
        result[identifier] = row
    return result


def _required(row: Mapping[str, str], key: str, filename: str) -> str:
    value = row[key].strip()
    if not value:
        raise GtfsLoadError(f"{filename} contains blank {key}")
    return value


def _nonnegative_int(value: str, label: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise GtfsLoadError(f"{label} must be an integer") from exc
    if parsed < 0:
        raise GtfsLoadError(f"{label} must be nonnegative")
    return parsed


def _optional_direction(value: str) -> int | None:
    if not value.strip():
        return None
    if value not in {"0", "1"}:
        raise GtfsLoadError("direction_id must be 0, 1, or blank")
    return int(value)


def _gtfs_date(value: str, label: str) -> date:
    try:
        return datetime.strptime(value, "%Y%m%d").date()
    except ValueError as exc:
        raise GtfsLoadError(f"{label} must use YYYYMMDD") from exc
