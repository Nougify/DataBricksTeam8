// Hourly actual / forecast / typical pings per hub, from rgersxdatabricks_hackathon.model.surge_forecast_hourly
// (split = history, both targets). One lazy-loaded JSON per hub (~240 KB); see README.md "forecast".
//
// Mapping (DECISIONS.md "Where data comes from"): actual = `actual`, forecast = `predicted`, typical = `normal`,
// surge line = typical × 1.25. Slots are Vancouver wall-clock hours, 24 per calendar day, indexed from start_date.
// Hours before start_date aren't covered.
import type { SeedHubId } from "./index";

export const FORECAST_SOURCE = "Databricks · model.surge_forecast_hourly";
export const SURGE_THRESHOLD = 1.25;

export type ForecastTarget = "arrivals" | "departures";

export interface ForecastSeries {
  actual: (number | null)[];
  forecast: (number | null)[];
  typical: (number | null)[];
  /** 1 when the model flagged the hour as a surge (`is_surge`). */
  surge: (0 | 1)[];
}

export interface HubForecast {
  hub_id: SeedHubId;
  /** First covered local date (YYYY-MM-DD). */
  start_date: string;
  days: number;
  arrivals: ForecastSeries;
  departures: ForecastSeries;
}

export interface ForecastHour {
  local_date: string;
  hour: number;
  actual: number | null;
  forecast: number | null;
  typical: number | null;
  /** forecast ÷ typical, or null when either is missing or typical is 0. */
  forecast_index: number | null;
  /** actual ÷ typical, or null when either is missing or typical is 0. */
  actual_index: number | null;
  is_surge: boolean;
}

const loaders: Record<SeedHubId, () => Promise<{ default: unknown }>> = {
  ubc: () => import("./forecast/ubc.json"),
  waterfront: () => import("./forecast/waterfront.json"),
  "park-royal": () => import("./forecast/park-royal.json"),
};

const cache = new Map<string, Promise<HubForecast>>();

/** Loads one hub's forecast snapshot (cached for the session). Rejects for an unknown hub. */
export function loadHubForecast(hubId: string): Promise<HubForecast> {
  let p = cache.get(hubId);
  if (!p) {
    const load = loaders[hubId as SeedHubId];
    if (!load) return Promise.reject(new Error(`No forecast snapshot for hub "${hubId}".`));
    p = load().then((m) => m.default as HubForecast);
    p.catch(() => cache.delete(hubId));
    cache.set(hubId, p);
  }
  return p;
}

const dayNumber = (localDate: string) => Date.UTC(+localDate.slice(0, 4), +localDate.slice(5, 7) - 1, +localDate.slice(8, 10)) / 86_400_000;

/** Slot index for a Vancouver local date + hour, or null outside the snapshot. */
export function slotIndex(f: HubForecast, localDate: string, hour: number): number | null {
  const day = dayNumber(localDate) - dayNumber(f.start_date);
  if (day < 0 || day >= f.days || hour < 0 || hour > 23) return null;
  return day * 24 + hour;
}

const ratio = (a: number | null, b: number | null) => (a === null || b === null || b <= 0 ? null : a / b);

/** One hour of one target, or null when the hour isn't covered. */
export function forecastHour(f: HubForecast, target: ForecastTarget, localDate: string, hour: number): ForecastHour | null {
  const i = slotIndex(f, localDate, hour);
  if (i === null) return null;
  const s = f[target];
  const actual = s.actual[i] ?? null;
  const forecast = s.forecast[i] ?? null;
  const typical = s.typical[i] ?? null;
  if (actual === null && forecast === null && typical === null) return null;
  return {
    local_date: localDate,
    hour,
    actual,
    forecast,
    typical,
    forecast_index: ratio(forecast, typical),
    actual_index: ratio(actual, typical),
    is_surge: s.surge[i] === 1,
  };
}
