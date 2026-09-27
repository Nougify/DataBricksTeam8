"use client";

// Hubs on the map: GET /hubs with the spec §3 table as first-paint / failure fallback, and the halo maths
// from DESIGN §8.2 (radius and opacity from the surge index, colour from surge severity or the index band).
import type { Hub, HubStatus, Severity, Surge } from "@/lib/api/schemas";
import type { LngLatTuple } from "./geo";

export type MapHub = Pick<Hub, "id" | "name" | "location" | "catchment_m">;

/** Spec §3. Only for first paint and when GET /hubs fails; the API is the source of truth. */
export const FALLBACK_HUBS: readonly MapHub[] = [
  { id: "ubc", name: "UBC", location: { lat: 49.2606, lon: -123.246 }, catchment_m: 800 },
  { id: "waterfront", name: "Waterfront Station", location: { lat: 49.2857, lon: -123.1115 }, catchment_m: 300 },
  { id: "park-royal", name: "Park Royal", location: { lat: 49.3265, lon: -123.138 }, catchment_m: 300 },
];

export function useMapHubs(): readonly MapHub[] {
  return FALLBACK_HUBS;
}

export const hubLngLat = (h: MapHub): LngLatTuple => [h.location.lon, h.location.lat];

// ---------- halo ----------

export type SeverityBands = { LOW: number; MEDIUM: number; HIGH: number };
export const DEFAULT_BANDS: SeverityBands = { LOW: 1.25, MEDIUM: 1.5, HIGH: 1.75 };

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

export function severityForIndex(index: number, bands: SeverityBands): Severity | null {
  if (index >= bands.HIGH) return "HIGH";
  if (index >= bands.MEDIUM) return "MEDIUM";
  if (index >= bands.LOW) return "LOW";
  return null;
}

/**
 * The surge that colours the halo: `next_surge`, when it is UPCOMING or ACTIVE. If the store doesn't hold that
 * surge (yet), trust `next_surge` itself.
 */
export function liveSurgeSeverity(status: HubStatus | undefined, surges: Record<string, Surge>): Severity | null {
  const next = status?.next_surge;
  if (!next) return null;
  const surge = surges[next.surge_id];
  if (surge && surge.phase === "RESOLVED") return null;
  return next.severity;
}

/** DESIGN §8.2 halo formula. Null (no halo) at or below 1.0×, or without a reading. */
export function haloFor(index: number | null | undefined, surgeSeverity: Severity | null, bands: SeverityBands): Halo | null {
  if (index == null || !Number.isFinite(index)) return null;
  const span = Math.max(0.01, bands.HIGH - 1);
  const s = Math.min(1, Math.max(0, (index - 1) / span));
  if (s <= 0) return null;
  const severity = surgeSeverity ?? severityForIndex(index, bands);
  return {
    s,
    radius: 16 + 44 * s,
    fillOpacity: (8 + 22 * s) / 100,
    ringOpacity: (35 + 55 * s) / 100,
    tone: severity ? toneOf[severity] : "typical",
    severity,
  };
}
