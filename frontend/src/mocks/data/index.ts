// Typed accessors over the Databricks seed snapshots in this folder (see README.md for the SQL behind each file).
// Read-only data: treat every exported array/object as immutable.
import dailyJson from "./daily.json";
import hourlyProfileJson from "./hourly_profile.json";
import hubsJson from "./hubs.json";
import lateNightLinesJson from "./late_night_lines.json";
import nightPingsJson from "./night_pings.json";
import originHourlyJson from "./origin_hourly.json";
import originsJson from "./origins.json";
import overviewJson from "./overview.json";
import peakloadJson from "./peakload.json";
import recommendationsJson from "./recommendations.json";
import routeStressJson from "./route_stress.json";
import routesJson from "./routes.json";
import timerangeStressJson from "./timerange_stress.json";
import validationJson from "./validation.json";

// ---------- shared literals ----------

export type SeedHubId = "ubc" | "waterfront" | "park-royal";
export type SeedDayType = "mf" | "sat" | "sun_hol";
export type SeedGapStatus = "UNDERSERVED" | "OVERSERVED" | "BALANCED" | "NO_SERVICE";
export type SeedAccessType = "ONE_SEAT_RIDE" | "TRANSFER_REQUIRED" | "LOCAL" | "VISITOR";
export type SeedMode = "Bus" | "SkyTrain" | "SeaBus" | "West Coast Express";
export type SeedSeason = "Fall" | "Summer";

export const SEED_HUB_IDS: readonly SeedHubId[] = ["ubc", "waterfront", "park-royal"];
export const SEED_DAY_TYPES: readonly SeedDayType[] = ["mf", "sat", "sun_hol"];

// ---------- 1. hubs.json (dim_hub + distinct line_key count) ----------

export interface SeedHub {
  id: SeedHubId;
  name: string;
  /** location_name in the Rogers data / hub column in hub_pulse tables. */
  location_name: string;
  lat: number;
  lon: number;
  catchment_m: number;
  description: string;
  lines_serving: number;
}
export const seedHubs = hubsJson as unknown as SeedHub[];

// ---------- 2. daily.json (gold_hub_daily) ----------

export interface SeedDailyRow {
  hub_id: SeedHubId;
  local_date: string;
  weekday: string;
  day_type: SeedDayType;
  pings: number;
  /** Retrospective: pings / mean of the same weekday over the surrounding 9 weeks. */
  surge_index: number | null;
  is_surge: boolean;
}
export const seedDaily = dailyJson as unknown as SeedDailyRow[];

// ---------- 3. hourly_profile.json (hub_hours.sql, 24 rows per hub x day type) ----------

export interface SeedHourlyProfileRow {
  hub_id: SeedHubId;
  day_type: SeedDayType;
  hour: number;
  avg_pings: number;
  departures: number;
  bus_departures: number;
  skytrain_departures: number;
  seabus_departures: number;
  lines_running: number;
  status: SeedGapStatus;
  time_period: string;
  /** TSPR 2025 fall max peak load factor for the hour's period; 0 = unknown. */
  peak_load_pct: number;
  most_crowded_line: string | null;
}
export const seedHourlyProfile = hourlyProfileJson as unknown as SeedHourlyProfileRow[];

// ---------- 4. origins.json (gold_origin_access, all 36 dim_origin rows per hub) ----------

export interface SeedOriginRow {
  hub_id: SeedHubId;
  origin: string;
  region: string;
  lat: number | null;
  lon: number | null;
  pings: number;
  share_pct: number;
  share_of_local_pct: number | null;
  avg_dwell_min: number | null;
  access_type: SeedAccessType;
  /** line_key values of hub lines with a stop near the origin centroid. */
  direct_lines: string[];
  n_direct_lines: number;
}
export const seedOrigins = originsJson as unknown as SeedOriginRow[];

// ---------- 5. origin_hourly.json (typical pings per day by origin, hub x day type x hour) ----------

export interface SeedOriginHourly {
  /** Fixed origin order (alphabetical, 36 entries); every data vector is aligned with it. */
  origins: string[];
  /** Days in the dataset per "<hub_id>|<day_type>" (the averaging denominator). */
  n_days: Record<string, number>;
  /** "<hub_id>|<day_type>|<hour>" -> average pings per day for each origin (1 dp). */
  data: Record<string, number[]>;
}
export const seedOriginHourly = originHourlyJson as unknown as SeedOriginHourly;

// ---------- 6. night_pings.json (pings 00:00-05:00 per calendar date) ----------

export interface SeedNightRow {
  night_date: string;
  day_type: SeedDayType;
  pings_00_05: number;
}
export type SeedNightPings = Record<SeedHubId, SeedNightRow[]>;
export const seedNightPings = nightPingsJson as unknown as SeedNightPings;

// ---------- 7. route_stress.json (gold_route_stress) ----------

export interface SeedRouteStressRow {
  hub_id: SeedHubId;
  hub: string;
  /** TSPR line key (matches routes[].line_key for buses). */
  line: string;
  route_name: string;
  weekly_trips_at_hub: number;
  avg_weekday_boardings: number | null;
  pct_trips_overcrowded: number | null;
  revenue_hrs_overcrowded: number | null;
  avg_peak_load_factor: number | null;
  pct_bunching: number | null;
  pct_on_time: number | null;
  avg_speed_kmh: number | null;
}
export const seedRouteStress = routeStressJson as unknown as SeedRouteStressRow[];

// ---------- 8. timerange_stress.json (gold_hub_timerange_stress) ----------

export interface SeedTimerangeStressRow {
  hub_id: SeedHubId;
  hub: string;
  day_type: SeedDayType;
  season: SeedSeason;
  tspr_hour_range: number;
  pings: number;
  demand_pct: number;
  time_period: string;
  avg_peak_load_factor: number | null;
  max_peak_load_factor: number | null;
  most_crowded_line: string | null;
}
export const seedTimerangeStress = timerangeStressJson as unknown as SeedTimerangeStressRow[];

// ---------- 9. peakload.json (tspr_bus_peakload, SeasonYear 2025, lines serving a hub) ----------

export interface SeedPeakLoadRow {
  season_year: number;
  /** TSPR Lineno_renamed, e.g. "99", "R4", "005/006" (matches routes[].tspr_line). */
  tspr_line: string;
  direction: string;
  day_type: SeedDayType;
  season: SeedSeason;
  /** TSPR HourRange start: 4, 6, 9, 15, 18, 21 or 24 (00-04). */
  hour_range: number;
  time_period: string;
  peak_passenger_load: number | null;
  peak_load_factor: number | null;
}
export const seedPeakload = peakloadJson as unknown as SeedPeakLoadRow[];

// ---------- 10. routes.json (GTFS routes calling at a hub) ----------

export interface SeedRouteStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}
export interface SeedRoute {
  route_id: string;
  line_key: string;
  short_name: string;
  long_name: string;
  mode: SeedMode;
  color: string | null;
  text_color: string | null;
  /** TSPR line key for joins with peakload/route_stress; null for SkyTrain, SeaBus, WCE and NightBus. */
  tspr_line: string | null;
  serves_hub_ids: SeedHubId[];
  /** Same definition as gold_route_stress: trips on the MF + Sat + Sun representative days. */
  weekly_trips_at_hub: Partial<Record<SeedHubId, number>>;
  rep_trip_id: string;
  rep_shape_id: number;
  rep_direction_id: number;
  shape: { type: "LineString"; coordinates: [number, number][] };
  /** Stops of the representative trip in order (at most 80; hub stops and endpoints always kept). */
  stops: SeedRouteStop[];
  /** Stop count of the representative trip before trimming. */
  n_stops_trip: number;
}
export const seedRoutes = routesJson as unknown as SeedRoute[];

// ---------- 11. late_night_lines.json (silver_hub_departures, hours 0-4) ----------

export interface SeedLateNightLine {
  route_id: string;
  line_key: string;
  departures: number;
}
/** "<hub_id>|<day_type>|<hour 0-4>" -> lines departing the hub in that hour (empty array when none). */
export type SeedLateNightLines = Record<string, SeedLateNightLine[]>;
export const seedLateNightLines = lateNightLinesJson as unknown as SeedLateNightLines;

// ---------- 12. validation.json (gold_waterfront_validation) ----------

export interface SeedValidationRow {
  hour: number;
  pings_pct: number;
  skytrain_pct: number | null;
}
export interface SeedValidation {
  rows: SeedValidationRow[];
  /** Pearson r of pings_pct vs skytrain_pct over the 24 hours (2 dp). */
  r: number;
  /** Pearson r with the ping series moved 3 h earlier (circular), 2 dp. See shift_direction / README. */
  r_shifted_3h: number;
  shift_direction: string;
  r_detail: Record<string, number>;
}
export const seedValidation = validationJson as unknown as SeedValidation;

// ---------- 13. recommendations.json (gold_recommendations) ----------

export interface SeedRecommendation {
  hub_id: SeedHubId;
  category: string;
  priority: number;
  evidence: string;
  /** Written by ai_query from the rule-based evidence. */
  recommendation: string;
}
export const seedRecommendations = recommendationsJson as unknown as SeedRecommendation[];

// ---------- 14. overview.json (hub_overview.sql per hub) ----------

export interface SeedOverview {
  hub_id: SeedHubId;
  days: number;
  visits: number;
  visitor_share: number;
  surge_days: number;
  top_surge_date: string;
  top_surge_index: number;
  /** Fraction (0-1) of regional visitors needing a transfer. */
  transfer_share: number;
  worst_line: string;
  worst_line_overcrowded_pct: number;
  peak_load_where: string;
  peak_load_pct: number;
}
export const seedOverview = overviewJson as unknown as SeedOverview[];

// ---------- lookups ----------

const dailyIndex = new Map<string, SeedDailyRow>(seedDaily.map((r) => [`${r.hub_id}|${r.local_date}`, r]));
const hourlyIndex = new Map<string, SeedHourlyProfileRow[]>();
for (const r of seedHourlyProfile) {
  const key = `${r.hub_id}|${r.day_type}`;
  const list = hourlyIndex.get(key);
  if (list) list.push(r);
  else hourlyIndex.set(key, [r]);
}
for (const list of hourlyIndex.values()) list.sort((a, b) => a.hour - b.hour);
const routeIdIndex = new Map<string, SeedRoute>(seedRoutes.map((r) => [r.route_id, r]));
const routeLineIndex = new Map<string, SeedRoute>(seedRoutes.map((r) => [r.line_key, r]));

export function hubById(hubId: string): SeedHub | undefined {
  return seedHubs.find((h) => h.id === hubId);
}

/** Map a hub_pulse location name ("Park Royal Mall") to its id ("park-royal"). */
export function hubIdForLocation(locationName: string): SeedHubId | undefined {
  return seedHubs.find((h) => h.location_name === locationName)?.id;
}

export function dailyByHubDate(hubId: string, localDate: string): SeedDailyRow | undefined {
  return dailyIndex.get(`${hubId}|${localDate}`);
}

/** All daily rows for a hub, oldest first. */
export function dailyForHub(hubId: string): SeedDailyRow[] {
  return seedDaily.filter((r) => r.hub_id === hubId);
}

/** 24 rows (hour 0-23) for the hub and day type; empty for an unknown hub. */
export function hourlyProfile(hubId: string, dayType: SeedDayType): SeedHourlyProfileRow[] {
  return hourlyIndex.get(`${hubId}|${dayType}`) ?? [];
}

/** All 36 origins for a hub, most pings first. */
export function originsFor(hubId: string): SeedOriginRow[] {
  return seedOrigins.filter((o) => o.hub_id === hubId);
}

/** Typical pings per day by origin for one hub / day type / hour, in seedOriginHourly.origins order. */
export function originHourly(
  hubId: string,
  dayType: SeedDayType,
  hour: number,
): { origin: string; avg_pings: number }[] {
  const vec = seedOriginHourly.data[`${hubId}|${dayType}|${hour}`];
  if (!vec) return [];
  return seedOriginHourly.origins.map((origin, i) => ({ origin, avg_pings: vec[i] ?? 0 }));
}

export function nightPingsFor(hubId: string): SeedNightRow[] {
  return seedNightPings[hubId as SeedHubId] ?? [];
}

/** Lines departing the hub in a late-night hour (0-4) on the typical fall 2026 timetable. */
export function lateNightLines(hubId: string, dayType: SeedDayType, hour: number): SeedLateNightLine[] {
  return seedLateNightLines[`${hubId}|${dayType}|${hour}`] ?? [];
}

export function routeById(routeId: string): SeedRoute | undefined {
  return routeIdIndex.get(routeId);
}

/** line_key is unique across the snapshot (e.g. "99", "R4", "N17", "SeaBus", "Expo Line"). */
export function routeByLineKey(lineKey: string): SeedRoute | undefined {
  return routeLineIndex.get(lineKey);
}

export function routesForHub(hubId: string): SeedRoute[] {
  return seedRoutes.filter((r) => (r.serves_hub_ids as string[]).includes(hubId));
}

/** gold_route_stress rows for a hub, most overcrowded first. */
export function routeStressFor(hubId: string): SeedRouteStressRow[] {
  return seedRouteStress.filter((r) => r.hub_id === hubId);
}

export function timerangeStressFor(hubId: string, dayType: SeedDayType, season: SeedSeason = "Fall"): SeedTimerangeStressRow[] {
  return seedTimerangeStress.filter((r) => r.hub_id === hubId && r.day_type === dayType && r.season === season);
}

/** TSPR 2025 peak-load rows for one TSPR line (both directions unless filtered by the caller). */
export function peakloadFor(tsprLine: string): SeedPeakLoadRow[] {
  return seedPeakload.filter((r) => r.tspr_line === tsprLine);
}

/** Recommendations for a hub, sorted by priority then category. */
export function recommendationsFor(hubId: string): SeedRecommendation[] {
  return seedRecommendations.filter((r) => r.hub_id === hubId);
}

export function overviewFor(hubId: string): SeedOverview | undefined {
  return seedOverview.find((r) => r.hub_id === hubId);
}

/** TSPR period start for a clock hour, as used by gold_hub_timerange_stress / tspr_bus_peakload. */
export function tsprHourRange(hour: number): number {
  if (hour >= 4 && hour <= 5) return 4;
  if (hour >= 6 && hour <= 8) return 6;
  if (hour >= 9 && hour <= 14) return 9;
  if (hour >= 15 && hour <= 17) return 15;
  if (hour >= 18 && hour <= 20) return 18;
  if (hour >= 21 && hour <= 23) return 21;
  return 24;
}
