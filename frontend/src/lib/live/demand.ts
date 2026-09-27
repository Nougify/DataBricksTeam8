"use client";

// Hub demand from the bundled forecast snapshots (model.surge_forecast_hourly), keyed on the sim hour.
// The "last full hour" is the Vancouver wall-clock hour before the clock's current one, so its actual is complete.
// Future actuals exist in the snapshot but are never shown (DECISIONS.md "2b answers").
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { HUBS } from "@/config/hubs";
import { forecastHour, loadHubForecast, type ForecastHour, type ForecastTarget, type HubForecast } from "@/data/forecast";
import { qk } from "@/lib/api/queryKeys";
import { addDays } from "@/lib/time";
import { useSimHourKey } from "./timeKey";

/** The previous Vancouver wall-clock hour, as local_date + hour. */
export function previousHour(localDate: string, hour: number): { local_date: string; hour: number } {
  return hour > 0 ? { local_date: localDate, hour: hour - 1 } : { local_date: addDays(localDate, -1), hour: 23 };
}

/** The next Vancouver wall-clock hour, as local_date + hour. */
export function nextHour(localDate: string, hour: number): { local_date: string; hour: number } {
  return hour < 23 ? { local_date: localDate, hour: hour + 1 } : { local_date: addDays(localDate, 1), hour: 0 };
}

export interface LastFullHour {
  local_date: string;
  hour: number;
  /** The snapshot's row for that hour, or null when the snapshot doesn't cover it. */
  row: ForecastHour | null;
}

export function lastFullHourOf(f: HubForecast, target: ForecastTarget, localDate: string, hour: number): LastFullHour {
  const prev = previousHour(localDate, hour);
  return { ...prev, row: forecastHour(f, target, prev.local_date, prev.hour) };
}

const forecastData = <T,>(results: { data: T | undefined }[]) => results.map((r) => r.data);

/** Every hub's forecast snapshot, in HUBS order (undefined until each loads). Loaded once per session. */
export function useAllHubForecasts(): (HubForecast | undefined)[] {
  return useQueries({
    queries: HUBS.map((h) => ({
      queryKey: qk.hubForecast(h.id),
      queryFn: () => loadHubForecast(h.id),
      staleTime: Infinity,
      gcTime: Infinity,
    })),
    // `combine` keeps the array referentially stable until a forecast actually loads.
    combine: forecastData,
  });
}

/**
 * The last full hour per hub for a target, following the throttled sim-hour key. A hub maps to null until its
 * snapshot loads or before the first clock.
 */
export function useLastFullHour(target: ForecastTarget = "arrivals"): Record<string, LastFullHour | null> {
  const key = useSimHourKey();
  const data = useAllHubForecasts();
  return useMemo(() => {
    const out: Record<string, LastFullHour | null> = {};
    HUBS.forEach((h, i) => {
      const f = data[i];
      out[h.id] = f && key.localDate !== null && key.hour !== null ? lastFullHourOf(f, target, key.localDate, key.hour) : null;
    });
    return out;
  }, [data, key.localDate, key.hour, target]);
}
