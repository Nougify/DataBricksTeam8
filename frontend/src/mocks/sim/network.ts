// MockSim's stand-in for the backend's GTFS index, fleet config and recommendation mapper (backend/app/transit,
// backend/app/fleet.py). Routes come from the bundled GTFS snapshots (src/data/routes*.json), the fleet mirrors
// backend/config/fleet.json, and feed rows resolve the way RecommendationMapper resolves them, with the rules
// in DECISIONS.md "2a answers": a recommendation is dispatchable only on a bus-mode route that serves the hub,
// and its destination stop is the route stop nearest the destination's dim_origin centroid, downstream of the hub.
import { HUBS, hubConfig } from "@/config/hubs";
import { feedManifest, type FeedEvent, type FeedRecommendation } from "@/data/feed";
import { originCentroid, originName, routeByLineKey, seedRoutes, type SeedRoute } from "@/data/index";
import type {
  Bus,
  DispatchEvent,
  EventRecommendation,
  EventStatus,
  GeoPoint,
  RecommendationCandidate,
  RouteListItem,
  RouteRef,
} from "@/lib/api/schemas";
import { dayTypeOf, toVancouverIso, vancouverToMs } from "@/lib/time";
import { distanceKm, type Coord } from "./geo";

// ---------- routes ----------

export function routeRef(r: SeedRoute): RouteRef {
  return {
    route_id: r.route_id,
    line_key: r.line_key,
    short_name: r.short_name,
    long_name: r.long_name,
    mode: r.mode,
    color: r.color,
    text_color: r.text_color,
  };
}

/** GET /routes: every snapshot route, or those serving a hub (any mode, like the backend's patterns_serving_hub). */
export function listRoutes(hubId: string | null, includeShape: boolean): RouteListItem[] {
  return seedRoutes
    .filter((r) => hubId === null || (r.serves_hub_ids as string[]).includes(hubId))
    .map((r) => (includeShape ? { ...routeRef(r), shape: r.shape.coordinates.length >= 2 ? r.shape : null } : routeRef(r)));
}

export function routeDetail(routeId: string) {
  const r = seedRoutes.find((x) => x.route_id === routeId);
  return r ? { ...routeRef(r), shape: r.shape.coordinates.length >= 2 ? r.shape : null } : undefined;
}

// ---------- fleet (mirrors backend/config/fleet.json) ----------

export interface FleetBus {
  id: string;
  capacity: number;
  initial_location_id: string;
  home_location_id: string;
}

export const FLEET: readonly FleetBus[] = [
  { id: "bus-01", capacity: 50, initial_location_id: "ubc", home_location_id: "ubc" },
  { id: "bus-02", capacity: 50, initial_location_id: "ubc", home_location_id: "ubc" },
  { id: "bus-03", capacity: 50, initial_location_id: "waterfront", home_location_id: "ubc" },
];
export const MAX_BUSES_PER_EVENT = 3;
export const FLEET_SOURCE = "backend/config/fleet.json (mirrored in mock mode)";

export interface BusRecord {
  bus: Bus;
  home: GeoPoint;
}

export function initialFleet(): BusRecord[] {
  return FLEET.map((b): BusRecord => {
    const initial = hubConfig(b.initial_location_id)!;
    const home = hubConfig(b.home_location_id)!;
    return {
      bus: {
        id: b.id,
        status: "AVAILABLE",
        location: { ...initial.location },
        heading_deg: null,
        capacity: b.capacity,
        source: { type: "DEPOT", route: null, depot_name: initial.location_name },
        assigned_trip_id: null,
        proposed_trip_id: null,
      },
      home: { ...home.location },
    };
  }).sort((a, b) => a.bus.id.localeCompare(b.bus.id));
}

// ---------- recommendation mapping ----------

/** The backend's representative fall 2026 service dates per day type (backend/app/config.py). */
const FEED_SERVICE_DATES = { mf: "2026-10-14", sat: "2026-10-17", sun_hol: "2026-10-18" } as const;

const INVALID_SOURCE_CODES = new Set(["UNKNOWN_HUB", "UNKNOWN_ROUTE", "AMBIGUOUS_ROUTE", "UNKNOWN_DESTINATION", "UNKNOWN_DIRECTION"]);

const toCoord = (p: { lat: number; lon: number }): Coord => [p.lon, p.lat];

function nearestStopIndex(route: SeedRoute, p: Coord): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  route.stops.forEach((s, i) => {
    const d = distanceKm([s.lon, s.lat], p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** A resolved recommendation's candidate, plus the geometry MockSim needs to plan the service leg. */
export interface MockCandidate extends RecommendationCandidate {
  /** Stops of the pattern in travel order (the representative trip, reversed when travelling the other way). */
  stops: { id: string; lat: number; lon: number }[];
  /** Representative shape in travel order. */
  shape: Coord[];
}

const candidates = new Map<string, MockCandidate>();

/** The candidate a trip's selected_candidate refers to (kept outside the wire object). */
export function candidateGeometry(c: RecommendationCandidate): MockCandidate | undefined {
  return candidates.get(`${c.pattern_id}|${c.source_stop_id}|${c.destination_stop_id}|${c.requested_service_date}`);
}

function resolveRecommendation(
  rec: FeedRecommendation,
  hubId: string | null,
  eventDate: string,
): EventRecommendation {
  const base: EventRecommendation = {
    destination: rec.destination,
    destination_share: rec.destination_share,
    route_id: null,
    source_route: rec.route,
    extra_bus_trips_est: rec.extra_bus_trips_est,
    priority_score: rec.priority_score,
    scheduled_trips_that_hour: null,
    extra_people_on_route: null,
    avg_daily_boardings: null,
    pct_trips_overcrowded: null,
    mapping_status: "UNRESOLVED",
    failure_code: null,
    failure_reason: null,
    candidates: [],
  };
  const fail = (code: string, reason: string, routeId: string | null = null): EventRecommendation => ({
    ...base,
    route_id: routeId,
    mapping_status: "INVALID",
    failure_code: code,
    failure_reason: reason,
  });

  const hub = hubConfig(hubId);
  if (!hub) return fail("UNKNOWN_HUB", `unknown source hub: ${hubId}`);
  const route = routeByLineKey(rec.route);
  if (!route) return fail("UNKNOWN_ROUTE", `unknown source route: ${rec.route}`);
  const destination = originName(rec.destination);
  const centroid = destination ? originCentroid(destination) : null;
  if (!destination || !centroid) {
    return fail("UNKNOWN_DESTINATION", `unknown destination: ${rec.destination}`, route.route_id);
  }
  if (route.mode !== "Bus" || route.shape.coordinates.length < 2 || route.stops.length < 2) {
    return fail("NO_DISPATCH_ELIGIBLE_PATTERN", `route ${route.route_id} has no dispatch-eligible pattern`, route.route_id);
  }
  if (!(route.serves_hub_ids as string[]).includes(hub.id)) {
    return fail("ROUTE_NOT_SERVING_HUB", `route ${route.route_id} does not serve hub ${hub.id}`, route.route_id);
  }
  const hubIdx = nearestStopIndex(route, toCoord(hub.location));
  const destIdx = nearestStopIndex(route, toCoord(centroid));
  if (hubIdx === destIdx) {
    return fail("DESTINATION_NOT_ON_ROUTE", `destination ${rec.destination} is not downstream of hub`, route.route_id);
  }

  const forward = destIdx > hubIdx;
  const stops = forward ? route.stops : [...route.stops].reverse();
  const shape = (forward ? route.shape.coordinates : [...route.shape.coordinates].reverse()) as Coord[];
  const n = route.stops.length;
  const src = forward ? hubIdx : n - 1 - hubIdx;
  const dst = forward ? destIdx : n - 1 - destIdx;
  const repDirection = route.rep_direction_id ?? 0;
  const candidate: MockCandidate = {
    route_id: route.route_id,
    pattern_id: `${route.route_id}:${forward ? "rep" : "rep-reverse"}`,
    source_stop_id: stops[src].id,
    destination_stop_id: stops[dst].id,
    source_stop_sequence: src + 1,
    destination_stop_sequence: dst + 1,
    direction_id: forward ? repDirection : 1 - repDirection,
    requested_service_date: eventDate,
    feed_service_date: FEED_SERVICE_DATES[dayTypeOf(eventDate)],
    representative_service: true,
    scheduled_trip_ids: [`${eventDate}:${route.rep_trip_id ?? route.route_id}`],
    stops: stops.slice(src, dst + 1).map((s) => ({ id: s.id, lat: s.lat, lon: s.lon })),
    shape,
  };
  candidates.set(
    `${candidate.pattern_id}|${candidate.source_stop_id}|${candidate.destination_stop_id}|${candidate.requested_service_date}`,
    candidate,
  );
  // The wire candidate carries only RecommendationCandidate fields; the geometry stays in `candidates`.
  const wire: RecommendationCandidate = {
    route_id: candidate.route_id,
    pattern_id: candidate.pattern_id,
    source_stop_id: candidate.source_stop_id,
    destination_stop_id: candidate.destination_stop_id,
    source_stop_sequence: candidate.source_stop_sequence,
    destination_stop_sequence: candidate.destination_stop_sequence,
    direction_id: candidate.direction_id,
    requested_service_date: candidate.requested_service_date,
    feed_service_date: candidate.feed_service_date,
    representative_service: candidate.representative_service,
    scheduled_trip_ids: candidate.scheduled_trip_ids,
  };
  return {
    ...base,
    route_id: route.route_id,
    mapping_status: "RESOLVED",
    candidates: [wire],
  };
}

/** "YYYY-MM-DDTHH:mm" Vancouver wall time -> epoch ms. */
export function wallToMs(wall: string): number {
  return vancouverToMs(wall.slice(0, 10), Number(wall.slice(11, 13)), Number(wall.slice(14, 16)));
}

/** The feed row as the backend would publish it after RecommendationMapper.resolve_event. */
export function resolveFeedEvent(f: FeedEvent): DispatchEvent {
  const hub = hubConfig(f.surge_location);
  const eventDate = f.event_time.slice(0, 10);
  const recs = [...f.recommendations]
    .sort(
      (a, b) =>
        b.priority_score - a.priority_score ||
        a.route.localeCompare(b.route) ||
        a.destination.localeCompare(b.destination),
    )
    .map((r) => resolveRecommendation(r, hub?.id ?? null, eventDate));
  const resolved = recs.find((r) => r.mapping_status === "RESOLVED");
  const first = recs[0];
  const status: EventStatus = resolved
    ? "PENDING"
    : first && INVALID_SOURCE_CODES.has(first.failure_code ?? "")
      ? "INVALID_SOURCE"
      : "NO_MATCHING_ROUTE";
  const eventMs = wallToMs(f.event_time);
  const availableMs = f.available_at ? wallToMs(f.available_at) : null;
  const proactive = availableMs !== null && availableMs < eventMs;
  return {
    id: f.event_id,
    hub_id: hub?.id ?? null,
    source_location: f.surge_location,
    location: hub ? { ...hub.location } : null,
    available_at: availableMs === null ? null : toVancouverIso(availableMs),
    actionable_at: toVancouverIso(availableMs ?? eventMs),
    event_time: toVancouverIso(eventMs),
    mode: proactive ? "PROACTIVE" : "REACTIVE",
    surge_type: null,
    predicted_people: f.predicted_people,
    normal_people: f.normal_people,
    surge_ratio: f.normal_people > 0 ? f.predicted_people / f.normal_people : null,
    suggested_extra_buses: Math.ceil((resolved ?? first)?.extra_bus_trips_est ?? 0),
    priority_score: (resolved ?? first)?.priority_score ?? 0,
    recommendations: recs,
    status,
    additional_trip_ids: [],
    source: { split: null, direction: null, link: null, version: feedManifest.source_version, generated_at: null },
  };
}

export const HUB_LIST = HUBS;
