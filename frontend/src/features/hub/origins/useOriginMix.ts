"use client";

// The selected hub's origin mix for the current basis and sim hour, shared by the Origins tab and the map's arcs.
import { useMemo } from "react";
import { originHourly, originsFor, type SeedDayType } from "@/data/index";
import { previousHour } from "@/lib/live/demand";
import { useSim, type OriginsBasis } from "@/lib/live/store";
import { useSimHourKey } from "@/lib/live/timeKey";
import { dayTypeOf } from "@/lib/time";
import { buildOriginMix, type OriginMix } from "./originMix";

export interface OriginMixResult {
  mix: OriginMix;
  basis: OriginsBasis;
  /** For the typical basis: the day type and last full hour the mix describes. */
  dayType: SeedDayType | null;
  localDate: string | null;
  hour: number | null;
}

export const ORIGINS_SOURCE = "Databricks · hub_pulse.gold_origin_access";
export const ORIGIN_HOURLY_SOURCE = "Databricks · hub_pulse.silver_visits (average per day by day type and hour)";

/** Null until the first clock (the typical basis needs the sim hour). */
export function useOriginMix(hubId: string | null): OriginMixResult | null {
  const basis = useSim((s) => s.originsBasis);
  const key = useSimHourKey();
  return useMemo(() => {
    if (!hubId) return null;
    const seeds = originsFor(hubId);
    if (basis === "all") {
      const pings = new Map(seeds.map((s) => [s.origin, s.pings]));
      return { mix: buildOriginMix(seeds, (o) => pings.get(o) ?? 0), basis, dayType: null, localDate: null, hour: null };
    }
    if (key.localDate === null || key.hour === null) return null;
    const prev = previousHour(key.localDate, key.hour);
    const dayType = dayTypeOf(prev.local_date);
    const pings = new Map(originHourly(hubId, dayType, prev.hour).map((o) => [o.origin, o.avg_pings]));
    return {
      mix: buildOriginMix(seeds, (o) => pings.get(o) ?? 0),
      basis,
      dayType,
      localDate: prev.local_date,
      hour: prev.hour,
    };
  }, [hubId, basis, key.localDate, key.hour]);
}
