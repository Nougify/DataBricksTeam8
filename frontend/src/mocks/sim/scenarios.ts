// Scripted surge scenarios and the spare fleet for MockSim (frontend/DECISIONS.md "Scenarios", "Fleet").
// Timings and index curves come from scenarioTimeline.ts; routes, stops, loads and origins come from the
// real Databricks snapshots in mocks/data. Everything here is static and deterministic; per-run state
// (statuses, expiry, retiming) lives in mockSim.ts.
//
// Choices (runtime semantics are summarised in ARCHITECTURE.md's change log):
// - UBC A: a route 25 bus parked 11.4 km along route 25 from UBC Exchange (by King Edward Station) deadheads
//   west along route 25's stops to UBC and runs an extra 99 eastbound along the 99's stops to Commercial-Broadway.
// - UBC B: a route 14 bus parked 7 km along route 14 (W 4th Ave) deadheads back along route 14 to UBC and runs
//   an extra R4 eastbound along 41st Ave to Joyce Station.
// - Park Royal: a depot bus from North Vancouver Transit Centre runs to Park Royal along Marine Dr (the R2's
//   stops), then an extra R2 eastbound to Phibbs Exchange (stop 12902, which is on the R2's representative trip).
// - Waterfront: target = the Waterfront bus route with the highest TSPR 2025 Saturday PM-peak (15-18) load,
//   donor = the lowest, among bus routes with >= 100 weekly trips at the hub (see rankWaterfrontRoutes()).
import type { Bus, DriverType, Evidence, LatLon, RouteRef, RouteWithLoad, Severity } from "@/lib/api/schemas";
import { MINUTE_MS, vancouverToMs } from "@/lib/time";
import {
  hubById,
  originsFor,
  peakloadFor,
  routeByLineKey,
  routesForHub,
  tsprHourRange,
  type SeedRoute,
  type SeedRouteStop,
} from "@/mocks/data";
import { bearingDeg, dedupe, distanceKm, nearestVertex, pathLengthKm, pointAtKm, walk, type Coord } from "./geo";
import { SCENARIO_TIMELINES, type ScenarioTimeline } from "./scenarioTimeline";
import type { MockHubId } from "./types";

export const BUS_CAPACITY = 77;
export const PROPOSAL_TTL_MS = 45 * MINUTE_MS;
export const SEVERITY_BANDS = { LOW: 1.25, MEDIUM: 1.5, HIGH: 1.75 } as const;
/** Planning speeds (km/h). UBC A's scripted 11.4 km in 20 min sets the deadhead speed. */
const DEADHEAD_KMH = 34;
const SERVICE_KMH = 16;
const RETURN_KMH = 18;
/** An extra trip adds one bus to an hourly service of about this many buses (104% → 91% for the 99). */
const BUSES_PER_HOUR = 7;

export function severityFor(index: number): Severity {
  if (index >= SEVERITY_BANDS.HIGH) return "HIGH";
  if (index >= SEVERITY_BANDS.MEDIUM) return "MEDIUM";
  return "LOW";
}

/** Load on the target route once one more bus runs in the hour. */
export const loadAfterAdding = (pct: number) => Math.round((pct * BUSES_PER_HOUR) / (BUSES_PER_HOUR + 1));
/** Load on the donor route once one of its buses leaves (48% → 55% for route 25). */
export const loadAfterRemoving = (pct: number) => Math.round((pct * (BUSES_PER_HOUR + 1)) / BUSES_PER_HOUR);

const round1 = (n: number) => Math.round(n * 10 + 1e-9) / 10;
const pad2 = (n: number) => String(n).padStart(2, "0");
const hhmm = (h: number) => `${pad2(h)}:00`;
const toLatLon = (c: Coord): LatLon => ({ lat: c[1], lon: c[0] });
const stopCoords = (stops: readonly SeedRouteStop[]): Coord[] => stops.map((s) => [s.lon, s.lat]);

function mustRoute(lineKey: string): SeedRoute {
  const r = routeByLineKey(lineKey);
  if (!r) throw new Error(`MockSim: route ${lineKey} missing from mocks/data/routes.json`);
  return r;
}

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

const withLoad = (r: SeedRoute, before: number, after: number): RouteWithLoad => ({
  ...routeRef(r),
  load_before_pct: before,
  load_after_pct: after,
});

/**
 * Where buses meet the surge: UBC Exchange for UBC (the hub centroid is ~750 m south of it), else the hub point.
 * Paths are cut at the route stop nearest this anchor.
 */
function hubAnchor(hubId: string): Coord {
  if (hubId === "ubc") {
    const exchange = mustRoute("99").stops.find((s) => s.name.startsWith("UBC Exchange"));
    if (exchange) return [exchange.lon, exchange.lat];
  }
  const h = hubById(hubId);
  if (!h) throw new Error(`MockSim: hub ${hubId} missing`);
  return [h.lon, h.lat];
}

// ---------- TSPR loads ----------

export interface TsprLoad {
  line: string;
  direction: string;
  pct: number;
  period: string;
}

/** Highest TSPR 2025 fall peak load across directions for a line, day type and TSPR period. */
export function tsprLoad(tsprLine: string, dayType: string, hourRange: number): TsprLoad | null {
  let best: TsprLoad | null = null;
  for (const row of peakloadFor(tsprLine)) {
    if (row.day_type !== dayType || row.season !== "Fall" || row.hour_range !== hourRange) continue;
    if (row.peak_load_factor === null) continue;
    if (!best || row.peak_load_factor > best.pct) {
      best = { line: tsprLine, direction: row.direction, pct: Math.round(row.peak_load_factor), period: row.time_period };
    }
  }
  return best;
}

/** One TSPR direction's load (e.g. R2 EAST) for a line, day type and period. */
function tsprLoadDir(tsprLine: string, dayType: string, hourRange: number, direction: string): TsprLoad | null {
  const row = peakloadFor(tsprLine).find(
    (r) => r.day_type === dayType && r.season === "Fall" && r.hour_range === hourRange && r.direction === direction,
  );
  if (!row || row.peak_load_factor === null) return null;
  return { line: tsprLine, direction, pct: Math.round(row.peak_load_factor), period: row.time_period };
}

export interface RankedRoute {
  route: SeedRoute;
  load: TsprLoad;
}

/**
 * Waterfront bus routes with >= 100 weekly trips at the hub, ranked by their busiest-direction TSPR 2025 load
 * on Saturdays in the period of the scenario's peak hour (15:00 → "15-18 PM peak"), most crowded first.
 */
export function rankWaterfrontRoutes(peakHour: number): RankedRoute[] {
  const period = tsprHourRange(peakHour);
  const out: RankedRoute[] = [];
  for (const route of routesForHub("waterfront")) {
    if (route.mode !== "Bus" || !route.tspr_line) continue;
    if ((route.weekly_trips_at_hub.waterfront ?? 0) < 100) continue;
    const load = tsprLoad(route.tspr_line, "sat", period);
    if (load) out.push({ route, load });
  }
  return out.sort((a, b) => b.load.pct - a.load.pct || a.route.line_key.localeCompare(b.route.line_key));
}

// ---------- paths ----------

export interface ServicePath {
  coords: Coord[];
  stops: { id: string; km: number }[];
}

/**
 * The extra trip's service path: the route's own stops from the stop nearest the hub, running in `heading`
 * ("EAST" = whichever way ends further east, and so on), optionally cut at the first stop matching `stopAt`.
 */
function servicePath(route: SeedRoute, hub: Coord, heading: string, stopAt?: (s: SeedRouteStop) => boolean): ServicePath {
  const stops = route.stops;
  const i = nearestVertex(stopCoords(stops), hub);
  const forward = stops.slice(i);
  const backward = stops.slice(0, i + 1).reverse();
  const end = (s: SeedRouteStop[]) => s[s.length - 1];
  let pick: SeedRouteStop[];
  if (forward.length < 2) pick = backward;
  else if (backward.length < 2) pick = forward;
  else {
    const f = end(forward);
    const b = end(backward);
    const score = (s: SeedRouteStop) =>
      heading === "EAST" ? s.lon : heading === "WEST" ? -s.lon : heading === "NORTH" ? s.lat : -s.lat;
    pick = score(f) >= score(b) ? forward : backward;
  }
  if (stopAt) {
    const cut = pick.findIndex((s, idx) => idx > 0 && stopAt(s));
    if (cut > 0) pick = pick.slice(0, cut + 1);
  }
  const coords: Coord[] = [];
  const out: { id: string; km: number }[] = [];
  let km = 0;
  for (const s of pick) {
    const c: Coord = [s.lon, s.lat];
    if (coords.length > 0) {
      const d = distanceKm(coords[coords.length - 1], c);
      if (d < 0.001) continue;
      km += d;
    }
    coords.push(c);
    out.push({ id: s.id, km });
  }
  return { coords: dedupe(coords), stops: out };
}

export interface HomeOnRoute {
  home: Coord;
  heading: number;
  /** Home → the route's stop nearest the hub, along the route's stops. */
  toHub: Coord[];
  /** The route's stops, used to find the way back home after a trip. */
  line: Coord[];
}

/** A parking point `km` along the route from the stop nearest the hub, on the longer side of the route. */
function homeOnRoute(route: SeedRoute, hub: Coord, km: number): HomeOnRoute {
  const line = stopCoords(route.stops);
  const i = nearestVertex(line, hub);
  const ahead = pathLengthKm(line.slice(i));
  const behind = pathLengthKm(line.slice(0, i + 1));
  const outbound = walk(line, i, ahead >= behind ? 1 : -1, km);
  const toHub = [...outbound].reverse();
  const home = toHub[0];
  return { home, heading: bearingDeg(toHub[0], toHub[1] ?? toHub[0]), toHub, line };
}

/** Way back home: an L-shaped hop (north/south, then east/west) to the nearest point of the home line, then along it. */
export function returnPath(from: Coord, homeLine: readonly Coord[], home: Coord): Coord[] {
  const j = nearestVertex(homeLine, from);
  const h = nearestVertex(homeLine, home);
  const along = j <= h ? homeLine.slice(j, h + 1) : homeLine.slice(h, j + 1).reverse();
  const target = along[0];
  return dedupe([from, [from[0], target[1]], ...along, home]);
}

// ---------- fleet ----------

export interface BusDef {
  id: string;
  source: Bus["source"];
  home: Coord;
  heading: number;
  /** Line a returning bus rejoins: the donor route's stops, or the depot's access path. */
  homeLine: Coord[];
}

export const DEPOT_NVTC = "North Vancouver Transit Centre";
export const DEPOT_VTC = "Vancouver Transit Centre";
/** Approximate yard locations (not in GTFS). */
const NVTC: Coord = [-123.0935, 49.3175];
const VTC: Coord = [-123.134, 49.2063];

// ---------- scenario definitions ----------

export interface TripTemplate {
  id: string;
  busId: string;
  route: RouteWithLoad;
  donor: RouteWithLoad | null;
  deadheadPath: Coord[];
  servicePath: Coord[];
  serviceStops: { id: string; km: number }[];
  returnPath: Coord[];
  deadheadKm: number;
  deadheadMin: number;
  serviceMin: number;
  returnMin: number;
  dispatchMs: number;
  arrivalMs: number;
  departureMs: number;
  completionMs: number;
  surgeLocation: LatLon;
  rationale: string;
  evidence: Evidence[];
  replacesTripId: string | null;
}

export interface DestinationDef {
  origin: string;
  location: LatLon | null;
  share_pct: number;
}

export interface ScenarioDef {
  timeline: ScenarioTimeline;
  id: string;
  surgeId: string;
  hubId: MockHubId | null;
  locationName: string;
  location: LatLon;
  localDate: string;
  detectedMs: number;
  windowStartMs: number;
  windowEndMs: number;
  peakPredictedHour: number;
  predictedIndex: number;
  peakActualHour: number;
  actualIndexMax: number;
  severity: Severity;
  drivers: { type: DriverType; label: string; event_id: string | null }[];
  destinations: DestinationDef[];
  /** trips[0] is proposed at detection; later entries are alternatives proposed when the previous one fails. */
  trips: TripTemplate[];
}

export interface MockWorld {
  scenarios: ScenarioDef[];
  fleet: BusDef[];
  /** How the Waterfront target and donor were chosen (for docs and tests). */
  waterfrontRanking: RankedRoute[];
}

function peakHour(curve: readonly number[], from: number, to: number): number {
  let best = from;
  for (let h = from; h < to; h++) if ((curve[h] ?? 0) > (curve[best] ?? 0)) best = h;
  return best;
}

function destinationsFor(hubId: string, transferOnly: boolean): DestinationDef[] {
  return originsFor(hubId)
    .filter((o) => o.share_of_local_pct !== null && o.access_type !== "LOCAL" && o.access_type !== "VISITOR")
    .filter((o) => !transferOnly || o.access_type === "TRANSFER_REQUIRED")
    .sort((a, b) => (b.share_of_local_pct ?? 0) - (a.share_of_local_pct ?? 0))
    .slice(0, 4)
    .map((o) => ({
      origin: o.origin,
      location: o.lat !== null && o.lon !== null ? { lat: o.lat, lon: o.lon } : null,
      share_pct: round1(o.share_of_local_pct ?? 0),
    }));
}

function transferSharePct(hubId: string): number {
  return round1(
    originsFor(hubId)
      .filter((o) => o.access_type === "TRANSFER_REQUIRED")
      .reduce((s, o) => s + (o.share_of_local_pct ?? 0), 0),
  );
}

interface TripInput {
  id: string;
  bus: BusDef;
  toHub: Coord[];
  route: SeedRoute;
  loads: { target: [number, number]; donor: [number, number] | null };
  service: ServicePath;
  arrivalMs: number;
  departureMs: number;
  /** Scripted overrides (UBC A). */
  fixed?: { dispatchMs: number; completionMs: number; deadheadMin: number; deadheadKm: number; returnMin: number };
  donorRoute: SeedRoute | null;
  rationale: string;
  evidence: Evidence[];
  replacesTripId: string | null;
}

function makeTrip(t: TripInput): TripTemplate {
  const serviceStart = t.service.coords[0];
  const deadheadPath = dedupe([...t.toHub, serviceStart]);
  const deadheadKm = t.fixed?.deadheadKm ?? round1(pathLengthKm(deadheadPath));
  const deadheadMin = t.fixed?.deadheadMin ?? Math.max(5, Math.round((pathLengthKm(deadheadPath) / DEADHEAD_KMH) * 60));
  const serviceKm = pathLengthKm(t.service.coords);
  const serviceMin = t.fixed
    ? Math.round((t.fixed.completionMs - t.departureMs) / MINUTE_MS)
    : Math.max(10, Math.round((serviceKm / SERVICE_KMH) * 60));
  const back = returnPath(t.service.coords[t.service.coords.length - 1], t.bus.homeLine, t.bus.home);
  const returnMin = t.fixed?.returnMin ?? Math.max(5, Math.round((pathLengthKm(back) / RETURN_KMH) * 60));
  const dispatchMs = t.fixed?.dispatchMs ?? t.arrivalMs - deadheadMin * MINUTE_MS;
  return {
    id: t.id,
    busId: t.bus.id,
    route: withLoad(t.route, t.loads.target[0], t.loads.target[1]),
    donor: t.donorRoute && t.loads.donor ? withLoad(t.donorRoute, t.loads.donor[0], t.loads.donor[1]) : null,
    deadheadPath,
    servicePath: t.service.coords,
    serviceStops: t.service.stops,
    returnPath: back,
    deadheadKm,
    deadheadMin,
    serviceMin,
    returnMin,
    dispatchMs,
    arrivalMs: t.arrivalMs,
    departureMs: t.departureMs,
    completionMs: t.departureMs + serviceMin * MINUTE_MS,
    surgeLocation: toLatLon(serviceStart),
    rationale: t.rationale,
    evidence: t.evidence,
    replacesTripId: t.replacesTripId,
  };
}

function routeBus(id: string, route: SeedRoute, hub: Coord, km: number): { bus: BusDef; toHub: Coord[] } {
  const h = homeOnRoute(route, hub, km);
  return {
    bus: {
      id,
      source: { type: "ROUTE", route: routeRef(route), depot_name: null },
      home: h.home,
      heading: h.heading,
      homeLine: h.line,
    },
    toHub: h.toHub,
  };
}

function timelineFor(id: string): ScenarioTimeline {
  const t = SCENARIO_TIMELINES.find((s) => s.id === id);
  if (!t) throw new Error(`MockSim: scenario ${id} missing from scenarioTimeline.ts`);
  return t;
}

function baseScenario(tl: ScenarioTimeline, destinations: DestinationDef[]): Omit<ScenarioDef, "trips"> {
  const hub = hubById(tl.hubId);
  if (!hub) throw new Error(`MockSim: hub ${tl.hubId} missing`);
  const peakPredictedHour = peakHour(tl.predictedIndex, tl.windowStartHour, tl.windowEndHour);
  const peakActualHour = peakHour(tl.actualIndex, tl.windowStartHour, tl.windowEndHour);
  const predictedIndex = tl.predictedIndex[peakPredictedHour] ?? 1;
  return {
    timeline: tl,
    id: tl.id,
    surgeId: tl.surgeId,
    hubId: tl.hubId,
    locationName: tl.locationName,
    location: { lat: hub.lat, lon: hub.lon },
    localDate: tl.localDate,
    detectedMs: vancouverToMs(tl.localDate, tl.detectedHour),
    windowStartMs: vancouverToMs(tl.localDate, tl.windowStartHour),
    windowEndMs: vancouverToMs(tl.localDate, tl.windowEndHour),
    peakPredictedHour,
    predictedIndex,
    peakActualHour,
    actualIndexMax: tl.actualIndex[peakActualHour] ?? 1,
    severity: severityFor(predictedIndex),
    drivers: tl.drivers.map((d) => ({ ...d })),
    destinations,
  };
}

const at = (localDate: string, hour: number, minute = 0) => vancouverToMs(localDate, hour, minute);
const windowLabel = (tl: ScenarioTimeline) => `${hhmm(tl.windowStartHour)}–${hhmm(tl.windowEndHour)}`;
const fmtX = (n: number) => `${n.toFixed(2)}×`;

function buildWorld(): MockWorld {
  const ubcHub = hubAnchor("ubc");
  const prHub = hubAnchor("park-royal");
  const wfHub = hubAnchor("waterfront");
  const r25 = mustRoute("25");
  const r14 = mustRoute("14");
  const r99 = mustRoute("99");
  const rR4 = mustRoute("R4");
  const rR2 = mustRoute("R2");
  const r68 = mustRoute("68");
  const r252 = mustRoute("252");

  // ---- Waterfront choice from real TSPR data ----
  const wfTl = timelineFor("waterfront-jul-25");
  const wfPeak = peakHour(wfTl.predictedIndex, wfTl.windowStartHour, wfTl.windowEndHour);
  const waterfrontRanking = rankWaterfrontRoutes(wfPeak);
  const wfTarget = waterfrontRanking[0];
  const wfDonor = waterfrontRanking[waterfrontRanking.length - 1];
  const wfSpare = waterfrontRanking[waterfrontRanking.length - 2];
  if (!wfTarget || !wfDonor || !wfSpare || wfTarget === wfDonor) throw new Error("MockSim: not enough Waterfront TSPR rows");

  // ---- fleet: 6 buses on low-load routes, 2 at depots ----
  const b1 = routeBus("bus-1", r25, ubcHub, 11.36); // King Edward Station
  const b2 = routeBus("bus-2", r14, ubcHub, 7.0); // W 4th Ave
  const b3 = routeBus("bus-3", wfDonor.route, wfHub, 4.5);
  const b4 = routeBus("bus-4", r68, ubcHub, 1.2);
  const b5 = routeBus("bus-5", r252, prHub, 3.0);
  const b6 = routeBus("bus-6", wfSpare.route, wfHub, 3.0);
  // NVTC → Marine Dr @ Bewicke → west along the R2's Marine Dr stops → Park Royal.
  const r2Line = stopCoords(rR2.stops);
  const bewicke = rR2.stops.findIndex((s) => s.name.includes("Bewicke"));
  const nvtcToPr = dedupe([NVTC, ...r2Line.slice(0, Math.max(1, bewicke) + 1).reverse()]);
  const b7: BusDef = {
    id: "bus-7",
    source: { type: "DEPOT", route: null, depot_name: DEPOT_NVTC },
    home: NVTC,
    heading: bearingDeg(nvtcToPr[0], nvtcToPr[1]),
    homeLine: nvtcToPr,
  };
  const b8: BusDef = {
    id: "bus-8",
    source: { type: "DEPOT", route: null, depot_name: DEPOT_VTC },
    home: VTC,
    heading: 0,
    homeLine: [VTC],
  };
  const fleet = [b1.bus, b2.bus, b3.bus, b4.bus, b5.bus, b6.bus, b7, b8];

  // ---- UBC exam weekend ----
  const ubcTl = timelineFor("ubc-exams");
  const ubcBase = baseScenario(ubcTl, destinationsFor("ubc", true));
  const d = ubcTl.localDate;
  const ubcForecast: Evidence = {
    label: `Forecast surge index, UBC ${windowLabel(ubcTl)}`,
    value: fmtX(ubcBase.predictedIndex),
    source: "gold_hub_forecast_hourly",
  };
  const ubcDriver: Evidence = { label: "Driver", value: "UBC December exam period", source: "UBC academic calendar" };
  const ubcTransfer: Evidence = {
    label: "Regional pings from areas with no one-seat ride to UBC",
    value: `${transferSharePct("ubc")}%`,
    source: "gold_origin_access",
  };
  const aService = servicePath(r99, ubcHub, "EAST");
  const tripA = makeTrip({
    id: "trip-ubc-2025-12-06-a",
    bus: b1.bus,
    toHub: b1.toHub,
    route: r99,
    donorRoute: r25,
    loads: { target: [104, loadAfterAdding(104)], donor: [48, loadAfterRemoving(48)] },
    service: aService,
    arrivalMs: at(d, 12, 40),
    departureMs: at(d, 12, 55),
    fixed: { dispatchMs: at(d, 12, 20), completionMs: at(d, 13, 45), deadheadMin: 20, deadheadKm: 11.4, returnMin: 25 },
    rationale: `UBC is forecast at ${fmtX(ubcBase.predictedIndex).replace("×", "x")} typical ${windowLabel(ubcTl)}; route 25 runs at 48% then, so one bus can move without crowding it.`,
    evidence: [
      ubcForecast,
      { label: "Route 99 peak load, 09-15 Midday", value: "104%", source: "TransLink TSPR 2025" },
      { label: "Route 25 load, 09-15 Midday", value: "48%", source: "TransLink TSPR 2025" },
      ubcDriver,
      ubcTransfer,
      { label: "Deadhead, route 25 at King Edward Station → UBC Exchange", value: "20 min / 11.4 km", source: "TransLink GTFS static (route 25 stops)" },
    ],
    replacesTripId: null,
  });
  const bService = servicePath(rR4, ubcHub, "EAST");
  const tripBDraft = makeTrip({
    id: "trip-ubc-2025-12-06-b",
    bus: b2.bus,
    toHub: b2.toHub,
    route: rR4,
    donorRoute: r14,
    loads: { target: [98, loadAfterAdding(98)], donor: [51, loadAfterRemoving(51)] },
    service: bService,
    arrivalMs: at(d, 12, 40),
    departureMs: at(d, 12, 55),
    rationale: "",
    evidence: [],
    replacesTripId: tripA.id,
  });
  const tripB: TripTemplate = {
    ...tripBDraft,
    rationale: `Alternative to the route 25 move: route 14 runs at 51% midday, so one of its buses can add an R4 trip east along 41st Ave, where the R4 is at 98%.`,
    evidence: [
      ubcForecast,
      { label: "Route R4 peak load, 09-15 Midday", value: "98%", source: "TransLink TSPR 2025" },
      { label: "Route 14 load, 09-15 Midday", value: "51%", source: "TransLink TSPR 2025" },
      ubcDriver,
      ubcTransfer,
      {
        label: "Deadhead, route 14 on W 4th Ave → UBC Exchange",
        value: `${tripBDraft.deadheadMin} min / ${tripBDraft.deadheadKm} km`,
        source: "TransLink GTFS static (route 14 stops)",
      },
    ],
  };
  const ubc: ScenarioDef = { ...ubcBase, trips: [tripA, tripB] };

  // ---- Park Royal Boxing Day ----
  const prTl = timelineFor("park-royal-boxing-day");
  const prBase = baseScenario(prTl, destinationsFor("park-royal", false));
  const prDate = prTl.localDate;
  const prPeriod = tsprHourRange(prBase.peakPredictedHour);
  const r2Load = tsprLoadDir("R2", "sun_hol", prPeriod, "EAST") ?? tsprLoad("R2", "sun_hol", prPeriod);
  const r2Pct = r2Load?.pct ?? 25;
  const prService = servicePath(rR2, prHub, "EAST", (s) => s.name.includes("Phibbs Exchange"));
  const prDraft = makeTrip({
    id: "trip-park-royal-2025-12-26-a",
    bus: b7,
    toHub: nvtcToPr,
    route: rR2,
    donorRoute: null,
    loads: { target: [r2Pct, loadAfterAdding(r2Pct)], donor: null },
    service: prService,
    arrivalMs: at(prDate, 11, 55),
    departureMs: at(prDate, 12, 10),
    rationale: "",
    evidence: [],
    replacesTripId: null,
  });
  const northVan = prBase.destinations.find((x) => x.origin === "North Vancouver");
  const park: ScenarioDef = {
    ...prBase,
    trips: [
      {
        ...prDraft,
        rationale: `Park Royal is forecast at ${fmtX(prBase.predictedIndex).replace("×", "x")} typical ${windowLabel(prTl)} on Boxing Day; a depot bus adds an R2 trip east to Phibbs Exchange, the one-seat ride to North Vancouver${northVan ? ` (${northVan.share_pct}% of regional pings)` : ""}, without pulling a bus off any route.`,
        evidence: [
          { label: `Forecast surge index, Park Royal ${windowLabel(prTl)}`, value: fmtX(prBase.predictedIndex), source: "gold_hub_forecast_hourly" },
          { label: `Route R2 eastbound load, ${r2Load?.period ?? "09-15 Midday"} (Sun/holiday)`, value: `${r2Pct}%`, source: "TransLink TSPR 2025" },
          { label: "Bus source", value: `Depot: ${DEPOT_NVTC} (no route loses a bus)`, source: "Mock spare fleet" },
          { label: "Driver", value: "Boxing Day", source: "BC statutory holidays" },
          ...(northVan
            ? [{ label: "North Vancouver share of regional pings at Park Royal", value: `${northVan.share_pct}%`, source: "gold_origin_access" }]
            : []),
          { label: `Deadhead, ${DEPOT_NVTC} → Park Royal`, value: `${prDraft.deadheadMin} min / ${prDraft.deadheadKm} km`, source: "TransLink GTFS static (R2 stops)" },
        ],
      },
    ],
  };

  // ---- Waterfront Jul 25 ----
  const wfBase = baseScenario(wfTl, destinationsFor("waterfront", false));
  const wfDate = wfTl.localDate;
  const wfService = servicePath(wfTarget.route, wfHub, wfTarget.load.direction);
  const wfDraft = makeTrip({
    id: "trip-waterfront-2026-07-25-a",
    bus: b3.bus,
    toHub: b3.toHub,
    route: wfTarget.route,
    donorRoute: wfDonor.route,
    loads: {
      target: [wfTarget.load.pct, loadAfterAdding(wfTarget.load.pct)],
      donor: [wfDonor.load.pct, loadAfterRemoving(wfDonor.load.pct)],
    },
    service: wfService,
    arrivalMs: at(wfDate, wfTl.windowStartHour - 1, 40),
    departureMs: at(wfDate, wfTl.windowStartHour - 1, 55),
    rationale: "",
    evidence: [],
    replacesTripId: null,
  });
  const tName = wfTarget.route.short_name;
  const dName = wfDonor.route.short_name;
  const waterfront: ScenarioDef = {
    ...wfBase,
    trips: [
      {
        ...wfDraft,
        rationale: `Waterfront is forecast at ${fmtX(wfBase.predictedIndex).replace("×", "x")} typical ${windowLabel(wfTl)} with no known driver; route ${tName} runs at ${wfTarget.load.pct}% (${wfTarget.load.direction.toLowerCase()}bound) in the Saturday PM peak while route ${dName} runs at ${wfDonor.load.pct}%, so one bus can move.`,
        evidence: [
          { label: `Forecast surge index, Waterfront ${windowLabel(wfTl)}`, value: fmtX(wfBase.predictedIndex), source: "gold_hub_forecast_hourly" },
          { label: `Route ${tName} peak load, ${wfTarget.load.period} (Sat, ${wfTarget.load.direction})`, value: `${wfTarget.load.pct}%`, source: "TransLink TSPR 2025" },
          { label: `Route ${dName} peak load, ${wfDonor.load.period} (Sat)`, value: `${wfDonor.load.pct}%`, source: "TransLink TSPR 2025" },
          { label: "Driver", value: "No known driver", source: "Events calendar" },
          { label: `Deadhead, route ${dName} → Waterfront Station`, value: `${wfDraft.deadheadMin} min / ${wfDraft.deadheadKm} km`, source: `TransLink GTFS static (route ${dName} stops)` },
        ],
      },
    ],
  };

  return { scenarios: [ubc, park, waterfront], fleet, waterfrontRanking };
}

let world: MockWorld | null = null;

/** The static scenario + fleet definitions (built once from the seed data). */
export function getWorld(): MockWorld {
  world ??= buildWorld();
  return world;
}

// ---------- dev-only non-hub surge ----------

export const NONHUB_LOCATION: LatLon = { lat: 49.2634, lon: -123.1145 };
export const NONHUB_NAME = "Broadway-City Hall";

// ---------- dev-only moving buses (?mock_buses=N) ----------

export interface LooperDef {
  id: string;
  route: SeedRoute;
  coords: Coord[];
  lengthKm: number;
  offsetKm: number;
}

/** N extra buses looping (there and back) along real route stops, for the 3600x smoothness test. */
export function loopingBuses(n: number): LooperDef[] {
  const routes = [
    ...routesForHub("ubc"),
    ...routesForHub("waterfront"),
    ...routesForHub("park-royal"),
  ].filter((r, i, all) => r.mode === "Bus" && r.stops.length >= 5 && all.findIndex((x) => x.route_id === r.route_id) === i);
  const out: LooperDef[] = [];
  for (let i = 0; i < n && routes.length > 0; i++) {
    const route = routes[i % routes.length];
    const coords = dedupe(stopCoords(route.stops));
    const lengthKm = pathLengthKm(coords);
    out.push({ id: `bus-x${i + 1}`, route, coords, lengthKm, offsetKm: (lengthKm * ((i * 37) % 100)) / 100 });
  }
  return out;
}

/** Position of a looping bus at sim time `ms` (25 km/h, back and forth). */
export function looperPosition(l: LooperDef, ms: number): { coord: Coord; heading: number } {
  const period = 2 * l.lengthKm;
  const km = ((((ms / 3_600_000) * 25 + l.offsetKm) % period) + period) % period;
  if (km <= l.lengthKm) {
    const p = pointAtKm(l.coords, km);
    return { coord: p.coord, heading: p.heading };
  }
  const rev = [...l.coords].reverse();
  const p = pointAtKm(rev, km - l.lengthKm);
  return { coord: p.coord, heading: p.heading };
}
