"use client";

// Hubs on the map (config/hubs.ts; v3 has no /hubs endpoint) and the halo maths from DESIGN §8.2: radius and
// opacity follow the last full hour's surge index (actual ÷ typical arrivals from the bundled forecast snapshot);
// colour follows the severity of the hub's current or next surge episode, else the index band.
import { useMemo } from "react";
import { HUBS, type HubConfig } from "@/config/hubs";
import { SEVERITY_BANDS, severityForIndex, type Severity } from "@/config/scenario";
import { useLastFullHour } from "@/lib/live/demand";
import type { LngLatTuple } from "./geo";

export { previousHour } from "@/lib/live/demand";

export type MapHub = Pick<HubConfig, "id" | "name" | "location" | "catchment_m">;

export function useMapHubs(): readonly MapHub[] {
  return HUBS;
}

export const hubLngLat = (h: MapHub): LngLatTuple => [h.location.lon, h.location.lat];

// ---------- last full hour ----------

export interface LastHourIndex {
  local_date: string;
  hour: number;
  /** actual ÷ typical arrivals, or null when the hour isn't in the snapshot. */
  index: number | null;
}

/** Last full hour's surge index per hub, from the bundled forecast snapshots (loaded once per hub). */
export function useLastHourIndex(): Record<string, LastHourIndex | null> {
  const last = useLastFullHour("arrivals");
  return useMemo(() => {
    const out: Record<string, LastHourIndex | null> = {};
    for (const h of HUBS) {
      const l = last[h.id];
      out[h.id] = l ? { local_date: l.local_date, hour: l.hour, index: l.row?.actual_index ?? null } : null;
    }
    return out;
  }, [last]);
}

// ---------- halo ----------

export type SeverityBands = { LOW: number; MEDIUM: number; HIGH: number };
export const DEFAULT_BANDS: SeverityBands = SEVERITY_BANDS;

export function useSeverityBands(): SeverityBands {
  return DEFAULT_BANDS;
}

/** `typical` = elevated but under the surge line; the rest are the severity ramp. */
export type HaloTone = "typical" | "low" | "medium" | "high";

export interface Halo {
  /** 0..1 strength: (index − 1.0) / (HIGH − 1.0), clamped. */
  s: number;
  /** Outer radius in px, 16 → 60. */
  radius: number;
  fillOpacity: number;
  ringOpacity: number;
  tone: HaloTone;
  /** The severity word, when the colour means one (not for `typical`). */
  severity: Severity | null;
}

const toneOf: Record<Severity, HaloTone> = { LOW: "low", MEDIUM: "medium", HIGH: "high" };

export { severityForIndex };

/** DESIGN §8.2 halo formula. Null (no halo) at or below 1.0×, or without a reading. */
export function haloFor(index: number | null | undefined, surgeSeverity: Severity | null, bands: SeverityBands): Halo | null {
  if (index == null || !Number.isFinite(index)) return null;
  const span = Math.max(0.01, bands.HIGH - 1);
  const s = Math.min(1, Math.max(0, (index - 1) / span));
  if (s <= 0) return null;
  const severity = surgeSeverity ?? severityForIndex(index);
  return {
    s,
    radius: 16 + 44 * s,
    fillOpacity: (8 + 22 * s) / 100,
    ringOpacity: (35 + 55 * s) / 100,
    tone: severity ? toneOf[severity] : "typical",
    severity,
  };
}
