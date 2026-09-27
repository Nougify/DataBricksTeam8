// The Databricks dispatch-event feed, rgersxdatabricks_hackathon.model.surge_recommendations_backtest, snapshotted
// per month of event_time (see README.md "feed"). MockSim replays it the way the backend replays its configured
// source (backendspec.md §4), after mapping to v3 names: hub_id → surge_location, route_key → route,
// destination_share_pct → destination_share.
//
// Times are Vancouver wall-clock strings ("2025-12-06T13:00"): the table stores Vancouver wall time as UTC.
import manifestJson from "./feed/manifest.json";

export interface FeedManifest {
  table: string;
  source_version: string;
  pulled_at: string;
  rows: number;
  events: number;
  months: string[];
}
export const feedManifest = manifestJson as FeedManifest;
export const FEED_SOURCE = `Databricks · ${feedManifest.table.split(".").slice(1).join(".")}`;

export interface FeedRecommendation {
  destination: string;
  /** Percentage points, 0–100. */
  destination_share: number;
  /** Source route key, e.g. "49", "R4", "ExpoLine". */
  route: string;
  extra_bus_trips_est: number;
  priority_score: number;
}

export interface FeedEvent {
  event_id: string;
  /** Canonical hub id ("ubc" | "waterfront" | "park-royal"). */
  surge_location: string;
  /** Vancouver wall time, "YYYY-MM-DDTHH:mm". */
  event_time: string;
  available_at: string | null;
  predicted_people: number;
  normal_people: number;
  /** Ordered by priority desc, then route, then destination (the source query's order). */
  recommendations: FeedRecommendation[];
}

type RawRec = [number, number, number, number, number];
type RawEvent = [string, string, string, string | null, number, number, RawRec[]];
interface RawMonth {
  routes: string[];
  destinations: string[];
  events: RawEvent[];
}

const loaders: Record<string, () => Promise<{ default: unknown }>> = {
  "2025-11": () => import("./feed/2025-11.json"),
  "2025-12": () => import("./feed/2025-12.json"),
  "2026-01": () => import("./feed/2026-01.json"),
  "2026-02": () => import("./feed/2026-02.json"),
  "2026-03": () => import("./feed/2026-03.json"),
  "2026-04": () => import("./feed/2026-04.json"),
  "2026-05": () => import("./feed/2026-05.json"),
  "2026-06": () => import("./feed/2026-06.json"),
  "2026-07": () => import("./feed/2026-07.json"),
  "2026-08": () => import("./feed/2026-08.json"),
};

export function decodeFeedMonth(raw: RawMonth): FeedEvent[] {
  return raw.events.map(([event_id, hub, event_time, available_at, predicted, normal, recs]) => ({
    event_id,
    surge_location: hub,
    event_time,
    available_at,
    predicted_people: predicted,
    normal_people: normal,
    recommendations: recs.map(([d, share, r, extra, priority]) => ({
      destination: raw.destinations[d],
      destination_share: share,
      route: raw.routes[r],
      extra_bus_trips_est: extra,
      priority_score: priority,
    })),
  }));
}

const cache = new Map<string, Promise<FeedEvent[]>>();

/** Events whose event_time falls in the month ("YYYY-MM"); empty for months the feed doesn't cover. */
export function loadFeedMonth(month: string): Promise<FeedEvent[]> {
  const load = loaders[month];
  if (!load) return Promise.resolve([]);
  let p = cache.get(month);
  if (!p) {
    p = load().then((m) => decodeFeedMonth(m.default as RawMonth));
    p.catch(() => cache.delete(month));
    cache.set(month, p);
  }
  return p;
}

/** "YYYY-MM" of a wall-clock string or local date. */
export const monthOf = (wall: string) => wall.slice(0, 7);

/** The month after "YYYY-MM". */
export function nextMonth(month: string): string {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** The month before "YYYY-MM". */
export function prevMonth(month: string): string {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
