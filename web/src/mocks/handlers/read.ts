// MSW handlers for the read endpoints (message.txt §6, §7, §13-§28). Responses are contract-exact: the shapes
// the zod schemas in lib/api/schemas.ts accept, with explicit nulls. Data comes from the real Databricks snapshots
// in mocks/data and the deterministic hourly synthesis in mocks/sim/synth.ts. Time-dependent endpoints take
// `?at=` (default: the MockSim clock) and never return actuals for hours after `at`.
import { delay, http, HttpResponse, type JsonBodyType } from "msw";
import { ENV } from "@/config/env";
import type {
  Backtest,
  Event,
  Findings,
  Forecast,
  ForecastRow,
  Hub,
  HourlyProfile,
  HourlyProfileRow,
  Kpi,
  LateNight,
  LateNightHour,
  Meta,
  OriginRow,
  Origins,
  Overview,
  Recommendation,
  RecommendationLink,
  RouteCrowdingRow,
  RouteDetail,
  RouteListItem,
  RouteLoad,
  RouteRef,
  Timeline,
  TimelineDay,
  Validation,
  HubStatus,
  DayType,
} from "@/lib/api/schemas";
import { DayType as DayTypeSchema } from "@/lib/api/schemas";
import {
  addDays,
  BC_HOLIDAYS,
  HOUR_MS,
  startOfVancouverHour,
  toVancouverIso,
  vancouverParts,
  vancouverToMs,
} from "@/lib/time";
import {
  hourlyProfile,
  hubById,
  lateNightLines,
  nightPingsFor,
  originHourly,
  originsFor,
  overviewFor,
  peakloadFor,
  recommendationsFor,
  routeById,
  routeByLineKey,
  routesForHub,
  routeStressFor,
  seedDaily,
  seedHubs,
  seedRoutes,
  seedRouteStress,
  seedValidation,
  tsprHourRange,
  type SeedHub,
  type SeedRoute,
} from "@/mocks/data";
import { mockStateFor, type MockStateView } from "@/mocks/devFlags";
import { getMockSim } from "@/mocks/sim/instance";
import { symmetric, uniform } from "@/mocks/sim/rng";
import { scenarioFor } from "@/mocks/sim/scenarioTimeline";
import { SURGE_THRESHOLD, synth } from "@/mocks/sim/synth";

// ---------- constants ----------

const BASE = ENV.apiBaseUrl.replace(/\/+$/, "");
const api = (path: string) => `${BASE}${path}`;

/** Fallback clock when MockSim isn't running (e.g. an MSW handler hit before startMocks finished). */
const DEFAULT_START_TIME = "2026-02-11T13:00:00-08:00";
const PIPELINE_REFRESHED_AT = "2026-09-26T16:02:00-07:00";
const OVERCROWDED_PCT = 85;
const SPARE_PCT = 60;
const LOW_SAMPLE = 200;
const DATASET_PERIOD = "Nov 2025 - Aug 2026";
const TYPICAL_BASIS = "Mean pings for the same day type and hour over the 8 weeks before issued_at";
const TIMELINE_NOTE = "daily_surge_index is retrospective (centred +/-4 weeks); context only, not a forecast";
const DEPARTURES_BASIS = "Typical fall 2026 GTFS timetable for this day type";
const SEASON_LABEL = "Fall (pings Sep-May) vs fall 2026 GTFS timetable";
const TSPR = "TransLink TSPR 2025";
const TYPICAL_WEEKDAY = "2026-02-11";
const SATURDAY_NIGHT = "2026-02-15";
/** Origins the UBC exam-surge crowd heads to (DECISIONS "Scenarios"). */
const UBC_SURGE_ORIGINS = new Set(["Surrey", "Richmond", "New Westminster", "North Vancouver"]);

const UBC_CALENDAR = { name: "UBC academic calendar", url: "https://vancouver.calendar.ubc.ca/dates-and-deadlines" };
const BC_HOLIDAY_SOURCE = {
  name: "BC statutory holidays",
  url: "https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/statutory-holidays",
};
const HOLIDAY_LABELS: Record<string, string> = {
  "2025-11-11": "Remembrance Day",
  "2025-12-25": "Christmas Day",
  "2025-12-26": "Boxing Day",
  "2026-01-01": "New Year's Day",
  "2026-02-16": "Family Day",
  "2026-04-03": "Good Friday",
  "2026-04-06": "Easter Monday",
  "2026-05-18": "Victoria Day",
  "2026-07-01": "Canada Day",
  "2026-08-03": "British Columbia Day",
};

// ---------- helpers ----------

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const pad2 = (n: number) => String(n).padStart(2, "0");

function errorResponse(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status });
}

/** Applies `?mock_state=<view>:...` (dev only). Returns a response to send, or null to carry on normally. */
async function forcedState(view: MockStateView, empty: () => JsonBodyType): Promise<Response | null> {
  const kind = mockStateFor(view);
  if (!kind) return null;
  if (kind === "loading") {
    await delay("infinite");
    return null;
  }
  if (kind === "error") return errorResponse(500, "MOCK_FORCED_ERROR", `Forced error for ${view} (mock_state).`);
  return HttpResponse.json(empty());
}

function simNowMs(): number {
  try {
    const ms = getMockSim().nowMs();
    if (Number.isFinite(ms)) return ms;
  } catch {
    // MockSim not started; fall back to the default start time.
  }
  return Date.parse(DEFAULT_START_TIME);
}

/** `?at=` as epoch ms, defaulting to the sim clock. */
function atFrom(url: URL): number {
  const raw = url.searchParams.get("at");
  if (raw) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
  }
  return simNowMs();
}

function intParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function hubOr404(id: string | readonly string[] | undefined): SeedHub | Response {
  const hub = typeof id === "string" ? hubById(id) : undefined;
  return hub ?? errorResponse(404, "HUB_NOT_FOUND", `Unknown hub "${String(id)}".`);
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

function isoAt(localDate: string, hour: number, minute = 0): string {
  return toVancouverIso(vancouverToMs(localDate, hour, minute));
}

/** Whether (localDate, hour) is a real wall-clock hour (false for 02:00 on the spring-forward day). */
function hourExists(localDate: string, hour: number): boolean {
  const p = vancouverParts(vancouverToMs(localDate, hour));
  return p.local_date === localDate && p.hour === hour;
}

const surgeIndex = (value: number, typical: number) => (typical > 0 ? round2(value / typical) : null);

// ---------- /meta ----------

function buildMeta(): Meta {
  return {
    timezone: "America/Vancouver",
    data_start: "2025-11-01",
    data_end: "2026-08-31",
    default_start_time: DEFAULT_START_TIME,
    allowed_speeds: [1, 60, 300, 900, 3600],
    forecast_horizons_hours: [3, 6, 12, 24],
    surge_threshold: SURGE_THRESHOLD,
    severity_bands: { LOW: 1.25, MEDIUM: 1.5, HIGH: 1.75 },
    late_night: { start_hour: 0, end_hour_exclusive: 5 },
    route_load_thresholds: { overcrowded_pct: OVERCROWDED_PCT, spare_pct: SPARE_PCT },
    day_types: [
      { id: "mf", label: "Weekday" },
      { id: "sat", label: "Saturday" },
      { id: "sun_hol", label: "Sunday / holiday" },
    ],
    presets: [
      { id: "ubc-exams", label: "UBC exam weekend", hub_id: "ubc", time: "2025-12-06T09:00:00-08:00", description: "Exam-weekend surge, 1.72x a normal Saturday" },
      { id: "park-royal-boxing-day", label: "Boxing Day at Park Royal", hub_id: "park-royal", time: "2025-12-26T08:00:00-08:00", description: "Boxing Day shopping, 1.47x" },
      { id: "waterfront-jul-25", label: "Waterfront, Jul 25", hub_id: "waterfront", time: "2026-07-25T10:00:00-07:00", description: "Biggest Waterfront day, 1.83x" },
      { id: "normal-weekday", label: "Normal weekday 13:00", hub_id: null, time: DEFAULT_START_TIME, description: "Baseline midday" },
      { id: "saturday-night", label: "Saturday late night", hub_id: null, time: "2026-02-14T22:00:00-08:00", description: "Nightlife and late-night gaps" },
    ],
    sources: [
      { name: "Rogers synthetic cell-tower pings", url: null, used_for: "Demand, origins, surges" },
      { name: "TransLink GTFS static (fall 2026)", url: "https://gtfs-static.translink.ca/gtfs/google_transit.zip", used_for: "Routes, stops, scheduled departures" },
      { name: "TransLink TSPR 2025", url: "https://www.translink.ca/plans-and-projects/managing-the-transit-network", used_for: "Route crowding, peak load, SkyTrain validation" },
      { name: UBC_CALENDAR.name, url: UBC_CALENDAR.url, used_for: "Exam periods" },
      { name: BC_HOLIDAY_SOURCE.name, url: BC_HOLIDAY_SOURCE.url, used_for: "Holidays and day types" },
    ],
    pipeline_refreshed_at: PIPELINE_REFRESHED_AT,
  };
}

// ---------- /hubs ----------

function hubDto(h: SeedHub): Hub {
  return {
    id: h.id,
    name: h.name,
    location_name: h.location_name,
    location: { lat: h.lat, lon: h.lon },
    catchment_m: h.catchment_m,
    description: h.description,
    lines_serving: h.lines_serving,
  };
}

function hubStatusExtra(hubId: string): Pick<HubStatus, "next_surge" | "active_trip_count" | "pending_proposal_count"> {
  try {
    const sim = getMockSim();
    const trips = sim.listTrips().filter((t) => t.hub_id === hubId);
    const upcoming = sim
      .listSurges()
      .filter((s) => s.hub_id === hubId && s.phase === "UPCOMING")
      .sort((a, b) => Date.parse(a.predicted_window.start) - Date.parse(b.predicted_window.start))[0];
    return {
      next_surge: upcoming
        ? {
            surge_id: upcoming.id,
            window_start: upcoming.predicted_window.start,
            surge_index: upcoming.magnitude.surge_index,
            severity: upcoming.severity,
          }
        : null,
      active_trip_count: trips.filter((t) => ["APPROVED", "BUS_EN_ROUTE", "IN_SERVICE"].includes(t.status)).length,
      pending_proposal_count: trips.filter((t) => t.status === "PROPOSED").length,
    };
  } catch {
    return { next_surge: null, active_trip_count: 0, pending_proposal_count: 0 };
  }
}

// ---------- forecast ----------

export function buildForecast(hubId: string, atMs: number, horizon: number, history: number): Forecast {
  const hourStart = startOfVancouverHour(atMs);
  const fraction = Math.min(1, Math.max(0, (atMs - hourStart) / HOUR_MS));
  const rows: ForecastRow[] = [];

  const base = (ms: number) => {
    const p = vancouverParts(ms);
    return { p, time: toVancouverIso(ms), typical: synth.typicalPings(hubId, p.local_date, p.hour) };
  };

  for (let k = history; k >= 1; k--) {
    const ms = hourStart - k * HOUR_MS;
    const { p, time, typical } = base(ms);
    const issuedMs = ms - horizon * HOUR_MS;
    const actual = synth.actualPings(hubId, p.local_date, p.hour);
    const f = synth.forecastFor(hubId, issuedMs, p.local_date, p.hour);
    const idx = surgeIndex(actual, typical);
    rows.push({
      time,
      local_date: p.local_date,
      hour: p.hour,
      kind: "HISTORY",
      actual_pings: actual,
      forecast_pings: f.forecast,
      forecast_issued_at: toVancouverIso(issuedMs),
      lower_80: f.lower_80,
      upper_80: f.upper_80,
      typical_pings: typical,
      surge_index: idx,
      is_surge: idx !== null && idx >= SURGE_THRESHOLD,
    });
  }

  {
    const { p, time, typical } = base(hourStart);
    const issuedMs = hourStart - horizon * HOUR_MS;
    const f = synth.forecastFor(hubId, issuedMs, p.local_date, p.hour);
    const idx = surgeIndex(f.forecast, typical);
    rows.push({
      time,
      local_date: p.local_date,
      hour: p.hour,
      kind: "CURRENT",
      actual_pings: Math.round(synth.actualPings(hubId, p.local_date, p.hour) * fraction),
      hour_complete: false,
      forecast_pings: f.forecast,
      forecast_issued_at: toVancouverIso(issuedMs),
      lower_80: f.lower_80,
      upper_80: f.upper_80,
      typical_pings: typical,
      surge_index: idx,
      is_surge: idx !== null && idx >= SURGE_THRESHOLD,
    });
  }

  for (let k = 1; k <= horizon; k++) {
    const ms = hourStart + k * HOUR_MS;
    const { p, time, typical } = base(ms);
    const f = synth.forecastFor(hubId, hourStart, p.local_date, p.hour);
    const idx = surgeIndex(f.forecast, typical);
    rows.push({
      time,
      local_date: p.local_date,
      hour: p.hour,
      kind: "FORECAST",
      actual_pings: null,
      forecast_pings: f.forecast,
      forecast_issued_at: toVancouverIso(hourStart),
      lower_80: f.lower_80,
      upper_80: f.upper_80,
      typical_pings: typical,
      surge_index: idx,
      is_surge: idx !== null && idx >= SURGE_THRESHOLD,
    });
  }

  return {
    hub_id: hubId,
    issued_at: toVancouverIso(hourStart),
    horizon_hours: horizon,
    surge_threshold: SURGE_THRESHOLD,
    typical_basis: TYPICAL_BASIS,
    model: { name: "hourly forecast (mock)", trained_through: toVancouverIso(hourStart - HOUR_MS), granularity: "hour" },
    rows,
  };
}

// ---------- origins ----------

export function buildOrigins(hubId: string, atMs: number, basis: "actual" | "typical"): Origins {
  const end = startOfVancouverHour(atMs);
  const start = end - HOUR_MS;
  const { local_date: date, hour } = vancouverParts(start);
  const dayType = synth.dayTypeFor(date);
  const total = basis === "actual" ? synth.actualPings(hubId, date, hour) : synth.typicalPings(hubId, date, hour);

  const mix = new Map(originHourly(hubId, dayType, hour).map((o) => [o.origin, o.avg_pings]));
  const scenario = hubId === "ubc" && basis === "actual" ? scenarioFor(hubId, date) : undefined;
  let tilt = 1;
  if (scenario && hour >= scenario.detectedHour && hour < scenario.windowEndHour) {
    const idx = scenario.actualIndex[hour] ?? 1;
    tilt = hour < scenario.windowStartHour ? 1.4 : 1 + 1.2 * Math.max(0, idx - 1);
  }

  const seeds = originsFor(hubId);
  const weights = seeds.map((o) => {
    let w = mix.get(o.origin) ?? 0;
    if (basis === "actual") w *= 1 + 0.15 * symmetric(`origin|${hubId}|${date}|${hour}|${o.origin}`);
    if (UBC_SURGE_ORIGINS.has(o.origin)) w *= tilt;
    return Math.max(0, w);
  });
  const wSum = weights.reduce((a, b) => a + b, 0);
  const pings = weights.map((w) => (wSum > 0 ? Math.round((total * w) / wSum) : 0));
  const totalPings = pings.reduce((a, b) => a + b, 0);
  const isRegional = (t: string) => t === "ONE_SEAT_RIDE" || t === "TRANSFER_REQUIRED";
  const regionalTotal = seeds.reduce((a, o, i) => a + (isRegional(o.access_type) ? pings[i] : 0), 0);

  const origins: OriginRow[] = seeds.map((o, i) => ({
    origin: o.origin,
    region: o.region,
    location: o.lat !== null && o.lon !== null ? { lat: o.lat, lon: o.lon } : null,
    pings: pings[i],
    share_pct: totalPings > 0 ? round2((pings[i] / totalPings) * 100) : 0,
    share_of_local_pct: isRegional(o.access_type) ? (regionalTotal > 0 ? round2((pings[i] / regionalTotal) * 100) : 0) : null,
    avg_dwell_min: o.avg_dwell_min,
    access_type: o.access_type,
    direct_lines: [...o.direct_lines],
    n_direct_lines: o.n_direct_lines,
  }));
  origins.sort((a, b) => b.pings - a.pings || a.origin.localeCompare(b.origin));

  return {
    hub_id: hubId,
    basis,
    window: { start: toVancouverIso(start), end: toVancouverIso(end) },
    day_type: dayType,
    total_pings: totalPings,
    low_sample: totalPings < LOW_SAMPLE,
    origins,
  };
}

// ---------- late night ----------

function lateNightRefs(hubId: string, dayType: DayType, hour: number) {
  const lines = lateNightLines(hubId, dayType, hour);
  const refs: RouteRef[] = [];
  for (const l of lines) {
    const r = routeById(l.route_id) ?? routeByLineKey(l.line_key);
    if (r && !refs.some((x) => x.route_id === r.route_id)) refs.push(routeRef(r));
  }
  return { departures: lines.reduce((a, l) => a + l.departures, 0), lines: refs };
}

export function buildLateNight(hubId: string, atMs: number): LateNight {
  const at = vancouverParts(atMs);
  const night = at.hour < 5 ? at.local_date : addDays(at.local_date, 1);
  const dayType = synth.dayTypeFor(night);
  const issued = startOfVancouverHour(atMs);

  /** Actual if the hour finished before `at`, else the forecast issued at the current hour. */
  const valueFor = (hour: number) => {
    const ms = vancouverToMs(night, hour);
    const known = ms + HOUR_MS <= atMs;
    return {
      actual: known ? synth.actualPings(hubId, night, hour) : null,
      forecast: known ? null : synth.forecastFor(hubId, issued, night, hour).forecast,
    };
  };

  let dayTotal = 0;
  for (let h = 0; h < 24; h++) {
    if (!hourExists(night, h)) continue;
    const v = valueFor(h);
    dayTotal += v.actual ?? v.forecast ?? 0;
  }

  const hours: LateNightHour[] = [];
  let nightTotal = 0;
  for (let h = 0; h < 5; h++) {
    if (!hourExists(night, h)) continue;
    const v = valueFor(h);
    const value = v.actual ?? v.forecast ?? 0;
    nightTotal += value;
    const { departures, lines } = lateNightRefs(hubId, dayType, h);
    hours.push({
      local_date: night,
      hour: h,
      actual_pings: v.actual,
      forecast_pings: v.forecast,
      typical_pings: synth.typicalPings(hubId, night, h),
      share_of_daily_pct: dayTotal > 0 ? round2((value / dayTotal) * 100) : null,
      departures_typical: departures,
      lines_running: lines.length,
      lines,
    });
  }

  const nights = nightPingsFor(hubId);
  const meanByType = new Map<string, number>();
  for (const t of ["mf", "sat", "sun_hol"] as const) {
    const rows = nights.filter((n) => n.day_type === t);
    meanByType.set(t, rows.length ? rows.reduce((a, n) => a + n.pings_00_05, 0) / rows.length : 0);
  }
  const top_nights = [...nights]
    .sort((a, b) => b.pings_00_05 - a.pings_00_05 || a.night_date.localeCompare(b.night_date))
    .slice(0, 5)
    .map((n) => {
      let departures = 0;
      for (let h = 0; h < 5; h++) departures += lateNightRefs(hubId, n.day_type, h).departures;
      const mean = meanByType.get(n.day_type) ?? 0;
      return {
        night_date: n.night_date,
        pings_00_05: n.pings_00_05,
        departures_typical: departures,
        surge_index: mean > 0 ? round2(n.pings_00_05 / mean) : null,
      };
    });

  return {
    hub_id: hubId,
    night_date: night,
    window: { start: isoAt(night, 0), end: isoAt(night, 5) },
    hours,
    share_of_daily_pct: dayTotal > 0 ? round2((nightTotal / dayTotal) * 100) : null,
    departures_basis: DEPARTURES_BASIS,
    top_nights,
  };
}

// ---------- hourly profile ----------

function buildHourlyProfile(hubId: string, dayType: DayType): HourlyProfile {
  const byHour = new Map(hourlyProfile(hubId, dayType).map((r) => [r.hour, r]));
  const rows: HourlyProfileRow[] = [];
  for (let h = 0; h < 24; h++) {
    const r = byHour.get(h);
    rows.push(
      r
        ? {
            hour: h,
            avg_pings: r.avg_pings,
            departures: r.departures,
            bus_departures: r.bus_departures,
            skytrain_departures: r.skytrain_departures,
            seabus_departures: r.seabus_departures,
            lines_running: r.lines_running,
            status: r.status,
            time_period: r.time_period ?? null,
            peak_load_pct: r.peak_load_pct,
            most_crowded_line: r.most_crowded_line,
          }
        : {
            hour: h,
            avg_pings: 0,
            departures: 0,
            bus_departures: 0,
            skytrain_departures: 0,
            seabus_departures: 0,
            lines_running: 0,
            status: "BALANCED",
            time_period: null,
            peak_load_pct: 0,
            most_crowded_line: null,
          },
    );
  }
  return { hub_id: hubId, day_type: dayType, season_label: SEASON_LABEL, rows };
}

// ---------- overview ----------

function fmtShortDate(localDate: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = localDate.split("-").map(Number);
  return `${months[m - 1]} ${d}`;
}

function buildOverview(hubId: string): Overview {
  const o = overviewFor(hubId);
  if (!o) return { hub_id: hubId, kpis: [] };
  const kpis: Kpi[] = [
    { key: "pings", label: "Pings in dataset", value: o.visits, unit: "pings", period: DATASET_PERIOD, comparison: null, source: "gold_hub_daily" },
    {
      key: "surge_days",
      label: "Surge days",
      value: o.surge_days,
      unit: "days",
      period: DATASET_PERIOD,
      comparison: { label: "Top", value: `${fmtShortDate(o.top_surge_date)}, ${o.top_surge_index}x` },
      source: "gold_hub_daily",
    },
    {
      key: "transfer_share",
      label: "Regional visitors needing a transfer",
      value: round1(o.transfer_share * 100),
      unit: "%",
      period: DATASET_PERIOD,
      comparison: null,
      source: "gold_origin_access + GTFS",
    },
    {
      key: "worst_line",
      label: "Most overcrowded line",
      value: o.worst_line_overcrowded_pct,
      unit: "% trips overcrowded",
      period: "2025",
      comparison: { label: "Line", value: o.worst_line },
      source: TSPR,
    },
    {
      key: "peak_load",
      label: "Peak load",
      value: round1(o.peak_load_pct),
      unit: "% of capacity",
      period: "Fall weekdays 2025",
      comparison: { label: "Where", value: o.peak_load_where.replace(" · ", ", ") },
      source: TSPR,
    },
  ];
  return { hub_id: hubId, kpis };
}

// ---------- route crowding ----------

function routeForLine(line: string): SeedRoute | undefined {
  return routeByLineKey(line) ?? seedRoutes.find((r) => r.tspr_line === line);
}

function buildRouteCrowding(hubId: string): RouteCrowdingRow[] {
  const rows: RouteCrowdingRow[] = [];
  for (const s of routeStressFor(hubId)) {
    const r = routeForLine(s.line);
    if (!r) continue;
    rows.push({
      route: routeRef(r),
      pct_trips_overcrowded: s.pct_trips_overcrowded,
      avg_peak_load_factor: s.avg_peak_load_factor,
      pct_bunching: s.pct_bunching,
      pct_on_time: s.pct_on_time,
      avg_weekday_boardings: s.avg_weekday_boardings,
      weekly_trips_at_hub: s.weekly_trips_at_hub,
      source: TSPR,
    });
  }
  return rows.sort((a, b) => (b.pct_trips_overcrowded ?? -1) - (a.pct_trips_overcrowded ?? -1));
}

// ---------- recommendations ----------

function linksFor(hub: SeedHub, category: string, evidence: string): RecommendationLink[] {
  const at = (label: string, local_date: string, hour: number, route_id: string | null = null): RecommendationLink => ({
    label,
    hub_id: hub.id,
    local_date,
    hour,
    route_id,
  });
  switch (category) {
    case "Add or retime midday service": {
      const m = /Weekdays underserved at (\d{2}):00/.exec(evidence) ?? /(\d{2}):00/.exec(evidence);
      const hour = m ? Number(m[1]) : 13;
      return [at(`Weekday ${pad2(hour)}:00 at ${hub.name}`, TYPICAL_WEEKDAY, hour)];
    }
    case "Late-night service gap":
      return [at(`Saturday night 01:00 at ${hub.name}`, SATURDAY_NIGHT, 1)];
    case "Relieve overcrowded line": {
      const line = /^Line (\S+) \(/.exec(evidence)?.[1];
      const route = line ? routeForLine(line) : undefined;
      return [at(`Line ${line ?? "?"}, weekday 08:00`, TYPICAL_WEEKDAY, 8, route?.route_id ?? null)];
    }
    case "At-capacity peak period": {
      const line = /^(\S+) (?:EAST|WEST|NORTH|SOUTH)\b/.exec(evidence)?.[1];
      const route = line ? routeForLine(line) : undefined;
      // Link to the peak the evidence names: 08:00 for the AM peak, 16:00 for the PM peak.
      const hour = /15-18 PM peak/.test(evidence) ? 16 : 8;
      return [at(`Line ${line ?? "?"}, weekday ${pad2(hour)}:00`, TYPICAL_WEEKDAY, hour, route?.route_id ?? null)];
    }
    case "Close a transfer gap":
      return [at(`Weekday 13:00 at ${hub.name}`, TYPICAL_WEEKDAY, 13)];
    case "Plan for surge days": {
      const date = overviewFor(hub.id)?.top_surge_date;
      return date ? [at(`${fmtShortDate(date)} 09:00 at ${hub.name}`, date, 9)] : [];
    }
    default:
      return [];
  }
}

function buildRecommendations(hub: SeedHub): Recommendation[] {
  return recommendationsFor(hub.id).map((r, i) => ({
    id: `rec-${hub.id}-${i + 1}`,
    priority: r.priority,
    category: r.category,
    recommendation: r.recommendation,
    evidence: r.evidence,
    links: linksFor(hub, r.category, r.evidence),
  }));
}

// ---------- findings / backtest / validation ----------

// Computed with hub_pulse/analysis/scenarios.ts over hours_all.json (weekday rows), matching HANDOFF §2.
// mismatch_after_pct is the mismatch itself (the HANDOFF column mixes in "visits in underserved hours" for Park Royal).
const FINDINGS: Findings = {
  day_type: "mf",
  hubs: [
    {
      hub_id: "park-royal",
      mismatch_pct: 19.4,
      pings_in_underserved_hours_pct: 16.0,
      underserved_hours: 3,
      busiest_line_load_pct: 80,
      rebalance: { moved: 71, total: 900, mismatch_after_pct: 11.5 },
      add_service: { added: 45, window: null, mismatch_after_pct: 17.4 },
      verdict: "RESCHEDULE",
    },
    {
      hub_id: "waterfront",
      mismatch_pct: 14.9,
      pings_in_underserved_hours_pct: 7.1,
      underserved_hours: 1,
      busiest_line_load_pct: 89,
      rebalance: { moved: 365, total: 4447, mismatch_after_pct: 6.7 },
      add_service: { added: 222, window: null, mismatch_after_pct: 12.7 },
      verdict: "RESCHEDULE",
    },
    {
      hub_id: "ubc",
      mismatch_pct: 14.6,
      pings_in_underserved_hours_pct: 20.0,
      underserved_hours: 6,
      busiest_line_load_pct: 104,
      rebalance: { moved: 16, total: 2239, mismatch_after_pct: 13.9 },
      add_service: { added: 112, window: "11:00-14:00", mismatch_after_pct: 12.2 },
      verdict: "INVEST",
    },
  ],
  facts: [
    { label: "UBC regional visitors with no one-seat ride", value: "47.6%", source: "gold_origin_access + GTFS" },
    { label: "UBC pings in underserved weekday hours after adding 112 departures at 11:00-14:00", value: "20.0% → 3.4%", source: "Planner on gold_hub_gap_hourly" },
    { label: "99 B-Line westbound, 06-09 AM peak", value: "104% of capacity", source: TSPR },
    { label: "99 B-Line eastbound, 15-18 PM peak", value: "100% of capacity", source: TSPR },
    { label: "UBC trips overcrowded in 2025", value: "99: 20.3%, R4: 15.2%, 49: 14.3%", source: TSPR },
    { label: "Biggest surge days", value: "UBC Dec 6 2025 1.72x, Waterfront Jul 25 2026 1.83x, Park Royal Dec 26 2025 1.47x", source: "gold_hub_daily" },
    { label: "Waterfront pings vs SkyTrain boardings + alightings", value: "r = 0.92 (0.38 when shifted 3 h)", source: "TransLink TSPR 2025 SkyTrain station hourly" },
  ],
};

const BACKTEST: Backtest = {
  period: { start: "2025-11-15", end: "2026-08-31" },
  surge_threshold: SURGE_THRESHOLD,
  method: "Hourly forecasts issued every hour; a surge hour is 'caught' if the forecast issued >= 3 h earlier also exceeded the threshold.",
  by_hub: [
    { hub_id: "ubc", actual_surge_hours: 212, predicted_surge_hours: 230, precision_pct: 78.3, recall_pct: 84.9, median_lead_time_minutes: 240 },
    { hub_id: "waterfront", actual_surge_hours: 148, predicted_surge_hours: 163, precision_pct: 74.2, recall_pct: 81.8, median_lead_time_minutes: 180 },
    { hub_id: "park-royal", actual_surge_hours: 61, predicted_surge_hours: 70, precision_pct: 71.4, recall_pct: 82.0, median_lead_time_minutes: 300 },
  ],
  by_horizon: [
    { horizon_hours: 3, mape_pct: 9.8, coverage_80_pct: 81.2 },
    { horizon_hours: 6, mape_pct: 12.4, coverage_80_pct: 79.5 },
    { horizon_hours: 12, mape_pct: 15.1, coverage_80_pct: 78.0 },
    { horizon_hours: 24, mape_pct: 17.9, coverage_80_pct: 76.3 },
  ],
};

function buildValidation(): Validation {
  return {
    hub_id: "waterfront",
    r: seedValidation.r,
    r_shifted_3h: seedValidation.r_shifted_3h,
    rows: seedValidation.rows
      .filter((r) => r.skytrain_pct !== null)
      .map((r) => ({ hour: r.hour, pings_pct: r.pings_pct, skytrain_pct: r.skytrain_pct as number })),
    source: "TransLink TSPR 2025 SkyTrain station hourly",
  };
}

// ---------- timeline / events ----------

function buildTimeline(from: string | null, to: string | null): Timeline {
  const days = new Map<string, TimelineDay>();
  for (const r of seedDaily) {
    if ((from && r.local_date < from) || (to && r.local_date > to)) continue;
    let day = days.get(r.local_date);
    if (!day) {
      day = { local_date: r.local_date, weekday: r.weekday, day_type: r.day_type, hubs: {} };
      days.set(r.local_date, day);
    }
    day.hubs[r.hub_id] = { pings: r.pings, daily_surge_index: r.surge_index, is_surge: r.is_surge };
  }
  return { note: TIMELINE_NOTE, days: [...days.values()].sort((a, b) => a.local_date.localeCompare(b.local_date)) };
}

interface EventSeed {
  event: Event;
  startDate: string;
  endDate: string;
}

const ALL_HUBS = seedHubs.map((h) => h.id);

const EVENTS: EventSeed[] = [
  {
    startDate: "2025-12-04",
    endDate: "2025-12-19",
    event: {
      id: "evt-ubc-exams-2025w1",
      label: "UBC December exam period",
      category: "EXAM",
      start: isoAt("2025-12-04", 0),
      end: isoAt("2025-12-19", 23, 59),
      hub_ids: ["ubc"],
      source_name: UBC_CALENDAR.name,
      source_url: UBC_CALENDAR.url,
    },
  },
  {
    startDate: "2026-04-14",
    endDate: "2026-04-29",
    event: {
      id: "evt-ubc-exams-2025w2",
      label: "UBC April exam period",
      category: "EXAM",
      start: isoAt("2026-04-14", 0),
      end: isoAt("2026-04-29", 23, 59),
      hub_ids: ["ubc"],
      source_name: UBC_CALENDAR.name,
      source_url: UBC_CALENDAR.url,
    },
  },
  ...[...BC_HOLIDAYS].sort().map((date) => ({
    startDate: date,
    endDate: date,
    event: {
      id: `evt-bc-${date}`,
      label: HOLIDAY_LABELS[date] ?? "BC statutory holiday",
      category: "HOLIDAY" as const,
      start: isoAt(date, 0),
      end: isoAt(date, 23, 59),
      hub_ids: [...ALL_HUBS],
      source_name: BC_HOLIDAY_SOURCE.name,
      source_url: BC_HOLIDAY_SOURCE.url,
    },
  })),
];

function buildEvents(from: string | null, to: string | null, hubId: string | null): Event[] {
  const f = from?.slice(0, 10) ?? null;
  const t = to?.slice(0, 10) ?? null;
  return EVENTS.filter(
    (e) => (!f || e.endDate >= f) && (!t || e.startDate <= t) && (!hubId || e.event.hub_ids.includes(hubId)),
  )
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((e) => e.event);
}

// ---------- routes ----------

function routeListItem(r: SeedRoute, includeShape: boolean): RouteListItem {
  return { ...routeRef(r), serves_hub_ids: [...r.serves_hub_ids], shape: includeShape ? r.shape : null };
}

function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(s));
}

/** First stop of the representative trip inside a served hub's catchment. */
function hubStopId(r: SeedRoute): string | null {
  const hubs = r.serves_hub_ids.map((id) => hubById(id)).filter((h): h is SeedHub => !!h);
  for (const s of r.stops) {
    if (hubs.some((h) => distanceM(s.lat, s.lon, h.lat, h.lon) <= h.catchment_m)) return s.id;
  }
  return null;
}

function parseHhMm(raw: string | null): number | null {
  const m = raw ? /^(\d{1,2}):(\d{2})$/.exec(raw) : null;
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins >= 0 && mins < 24 * 60 ? mins : null;
}

const MAX_DEPARTURES = 12;

/** A few plausible departures in [fromMin, toMin) on `date`, from the route's trips per day at its hubs. */
function scheduledDepartures(r: SeedRoute, date: string, fromMin: number, toMin: number): RouteDetail["scheduled_departures"] {
  const tripsPerDay = Object.values(r.weekly_trips_at_hub).reduce((a: number, b) => a + (b ?? 0), 0) / 3;
  const isNight = /^N\d+/.test(r.line_key);
  const serviceHours = isNight ? 5 : 19;
  const perHour = Math.max(1, tripsPerDay / serviceHours);
  const headway = Math.min(60, Math.max(5, Math.round(60 / perHour / 5) * 5 || 5));
  const offset = Math.floor(uniform(`dep|${r.route_id}`) * headway);
  const stopId = hubStopId(r);
  const out: RouteDetail["scheduled_departures"] = [];
  const first = Math.ceil((fromMin - offset) / headway) * headway + offset;
  for (let m = Math.max(first, offset); m < toMin && out.length < MAX_DEPARTURES; m += headway) {
    const hour = Math.floor(m / 60);
    const minute = m % 60;
    const inService = isNight ? hour < 5 : hour >= 5;
    if (!inService || !hourExists(date, hour)) continue;
    out.push({
      trip_id: `${r.route_id}-${date.replace(/-/g, "")}-${pad2(hour)}${pad2(minute)}`,
      departure_time: isoAt(date, hour, minute),
      stop_id: stopId,
    });
  }
  return out;
}

function buildRouteDetail(r: SeedRoute, url: URL): RouteDetail {
  const now = vancouverParts(simNowMs());
  const dateParam = url.searchParams.get("date");
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : now.local_date;
  const nowMin = now.hour * 60 + now.minute;
  const fromMin = parseHhMm(url.searchParams.get("from")) ?? Math.max(0, nowMin - 60);
  const toMin = parseHhMm(url.searchParams.get("to")) ?? Math.min(24 * 60, nowMin + 180);
  return {
    ...routeRef(r),
    stops: r.stops.map((s) => ({ id: s.id, name: s.name, location: { lat: s.lat, lon: s.lon } })),
    shape: r.shape,
    scheduled_departures: scheduledDepartures(r, date, fromMin, toMin),
  };
}

function spareBusesByRoute(): Map<string, number> {
  const counts = new Map<string, number>();
  try {
    for (const b of getMockSim().listBuses()) {
      const id = b.source.route?.route_id;
      if (b.status === "AVAILABLE" && id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  } catch {
    // MockSim not started: no spare buses to report.
  }
  return counts;
}

export function buildRouteLoad(atMs: number, hubId: string | null): RouteLoad[] {
  const p = vancouverParts(atMs);
  const dayType = synth.dayTypeFor(p.local_date);
  const month = Number(p.local_date.slice(5, 7));
  const season = month >= 6 && month <= 8 ? "Summer" : "Fall";
  const range = tsprHourRange(p.hour);
  const spare = spareBusesByRoute();
  const stress = hubId ? routeStressFor(hubId) : seedRouteStress;
  const routes = hubId ? routesForHub(hubId) : seedRoutes;
  const out: RouteLoad[] = [];

  for (const r of routes) {
    if (!r.tspr_line) continue;
    const all = peakloadFor(r.tspr_line).filter((row) => row.day_type === dayType && row.hour_range === range);
    let rows = all.filter((row) => row.season === season && row.peak_load_factor !== null);
    if (!rows.length) rows = all.filter((row) => row.season === "Fall" && row.peak_load_factor !== null);
    if (!rows.length) continue;
    const load = Math.max(...rows.map((row) => row.peak_load_factor as number));
    const st = stress.find((s) => s.line === r.line_key || s.line === r.tspr_line);
    out.push({
      route: routeRef(r),
      time_period: rows[0].time_period,
      load_pct: round1(load),
      load_basis: "TSPR_2025_TYPICAL",
      tspr_peak_load_pct: round1(load),
      pct_trips_overcrowded_2025: st?.pct_trips_overcrowded ?? null,
      classification: load >= OVERCROWDED_PCT ? "OVERCROWDED" : load < SPARE_PCT ? "SPARE" : "NORMAL",
      spare_buses_available: spare.get(r.route_id) ?? 0,
    });
  }
  return out.sort((a, b) => b.load_pct - a.load_pct || a.route.line_key.localeCompare(b.route.line_key));
}

// ---------- empty payloads for ?mock_state=<view>:empty ----------

function emptyForecast(hubId: string, atMs: number, horizon: number): Forecast {
  return { ...buildForecast(hubId, atMs, 0, 0), horizon_hours: horizon, rows: [] };
}

// ---------- handlers ----------

export const readHandlers = [
  http.get(api("/meta"), () => HttpResponse.json(buildMeta())),

  http.get(api("/hubs"), () => HttpResponse.json(seedHubs.map(hubDto))),

  http.get(api("/hubs/:id/status"), ({ request, params }) => {
    const hub = hubOr404(params.id);
    if (hub instanceof Response) return hub;
    const atMs = atFrom(new URL(request.url));
    return HttpResponse.json(synth.hubStatusAt(hub.id, atMs, hubStatusExtra(hub.id)));
  }),

  http.get(api("/hubs/:id/forecast"), async ({ request, params }) => {
    const hub = hubOr404(params.id);
    if (hub instanceof Response) return hub;
    const url = new URL(request.url);
    const atMs = atFrom(url);
    const horizon = intParam(url, "horizon_hours", 6, 1, 48);
    const history = intParam(url, "history_hours", Math.max(6, horizon), 0, 72);
    const forced = await forcedState("forecast", () => emptyForecast(hub.id, atMs, horizon));
    if (forced) return forced;
    return HttpResponse.json(buildForecast(hub.id, atMs, horizon, history));
  }),

  http.get(api("/hubs/:id/origins"), async ({ request, params }) => {
    const hub = hubOr404(params.id);
    if (hub instanceof Response) return hub;
    const url = new URL(request.url);
    const basisRaw = url.searchParams.get("basis") ?? "actual";
    if (basisRaw !== "actual" && basisRaw !== "typical") {
      return errorResponse(400, "INVALID_BASIS", `basis must be "actual" or "typical".`);
    }
    const atMs = atFrom(url);
    const forced = await forcedState("origins", () => ({
      ...buildOrigins(hub.id, atMs, basisRaw),
      total_pings: 0,
      low_sample: true,
      origins: [],
    }));
    if (forced) return forced;
    return HttpResponse.json(buildOrigins(hub.id, atMs, basisRaw));
  }),

  http.get(api("/hubs/:id/late-night"), async ({ request, params }) => {
    const hub = hubOr404(params.id);
    if (hub instanceof Response) return hub;
    const atMs = atFrom(new URL(request.url));
    const forced = await forcedState("late-night", () => ({
      ...buildLateNight(hub.id, atMs),
      hours: [],
      share_of_daily_pct: null,
      top_nights: [],
    }));
    if (forced) return forced;
    return HttpResponse.json(buildLateNight(hub.id, atMs));
  }),

  http.get(api("/hubs/:id/hourly-profile"), async ({ request, params }) => {
    const hub = hubOr404(params.id);
    if (hub instanceof Response) return hub;
    const raw = new URL(request.url).searchParams.get("day_type") ?? "mf";
    const parsed = DayTypeSchema.safeParse(raw);
    if (!parsed.success) return errorResponse(400, "INVALID_DAY_TYPE", `day_type must be mf, sat or sun_hol.`);
    const forced = await forcedState("planner", () => ({ ...buildHourlyProfile(hub.id, parsed.data), rows: [] }));
    if (forced) return forced;
    return HttpResponse.json(buildHourlyProfile(hub.id, parsed.data));
  }),

  http.get(api("/hubs/:id/overview"), async ({ params }) => {
    const hub = hubOr404(params.id);
    if (hub instanceof Response) return hub;
    const forced = await forcedState("overview", () => ({ hub_id: hub.id, kpis: [] }));
    if (forced) return forced;
    return HttpResponse.json(buildOverview(hub.id));
  }),

  http.get(api("/hubs/:id/route-crowding"), async ({ params }) => {
    const hub = hubOr404(params.id);
    if (hub instanceof Response) return hub;
    const forced = await forcedState("crowding", () => []);
    if (forced) return forced;
    return HttpResponse.json(buildRouteCrowding(hub.id));
  }),

  http.get(api("/hubs/:id/recommendations"), async ({ params }) => {
    const hub = hubOr404(params.id);
    if (hub instanceof Response) return hub;
    const forced = await forcedState("recommendations", () => []);
    if (forced) return forced;
    return HttpResponse.json(buildRecommendations(hub));
  }),

  http.get(api("/findings"), async () => {
    const forced = await forcedState("findings", () => ({ day_type: "mf", hubs: [], facts: [] }));
    if (forced) return forced;
    return HttpResponse.json(FINDINGS);
  }),

  http.get(api("/backtest"), async () => {
    const forced = await forcedState("backtest", () => ({ ...BACKTEST, by_hub: [], by_horizon: [] }));
    if (forced) return forced;
    return HttpResponse.json(BACKTEST);
  }),

  http.get(api("/validation"), async () => {
    const forced = await forcedState("validation", () => ({ ...buildValidation(), rows: [] }));
    if (forced) return forced;
    return HttpResponse.json(buildValidation());
  }),

  http.get(api("/timeline"), async ({ request }) => {
    const url = new URL(request.url);
    const forced = await forcedState("timeline", () => ({ note: TIMELINE_NOTE, days: [] }));
    if (forced) return forced;
    return HttpResponse.json(buildTimeline(url.searchParams.get("from"), url.searchParams.get("to")));
  }),

  http.get(api("/events"), ({ request }) => {
    const url = new URL(request.url);
    return HttpResponse.json(
      buildEvents(url.searchParams.get("from"), url.searchParams.get("to"), url.searchParams.get("hub_id")),
    );
  }),

  // /routes/load must come before /routes/:id, which would otherwise match it.
  http.get(api("/routes/load"), async ({ request }) => {
    const url = new URL(request.url);
    const hubId = url.searchParams.get("hub_id");
    if (hubId && !hubById(hubId)) return errorResponse(404, "HUB_NOT_FOUND", `Unknown hub "${hubId}".`);
    const forced = await forcedState("routes-load", () => []);
    if (forced) return forced;
    return HttpResponse.json(buildRouteLoad(atFrom(url), hubId));
  }),

  http.get(api("/routes"), ({ request }) => {
    const url = new URL(request.url);
    const hubId = url.searchParams.get("hub_id");
    const includeShape = url.searchParams.get("include_shape") === "true";
    const routes = hubId ? routesForHub(hubId) : seedRoutes;
    return HttpResponse.json(routes.map((r) => routeListItem(r, includeShape)));
  }),

  http.get(api("/routes/:id"), ({ request, params }) => {
    const id = typeof params.id === "string" ? params.id : "";
    const r = routeById(id);
    if (!r) return errorResponse(404, "ROUTE_NOT_FOUND", `Unknown route "${id}".`);
    return HttpResponse.json(buildRouteDetail(r, new URL(request.url)));
  }),
];
