// Demo presets, the Reset demo start time and display constants. v3's /meta carries none of these, so they live
// in frontend config. Preset times are computed from the bundled dispatch feed; see DECISIONS.md "Preset times".
import type { HubId } from "./hubs";

export interface Preset {
  id: string;
  label: string;
  description: string;
  /** Hub to select after the jump, or null for the network overview. */
  hub_id: HubId | null;
  /** ISO 8601 with the Vancouver offset. */
  time: string;
}

/** Reset demo and MockSim's initial time: the normal-weekday preset. */
export const DEFAULT_START_TIME = "2026-02-11T13:00:00-08:00";

export const PRESETS: readonly Preset[] = [
  {
    id: "ubc-exam-weekend",
    label: "UBC exam weekend",
    description: "Sat Dec 6 2025. UBC surges from 09:00 and peaks at 1.99× typical at 13:00.",
    hub_id: "ubc",
    time: "2025-12-06T07:30:00-08:00",
  },
  {
    id: "park-royal-boxing-day",
    label: "Park Royal Boxing Day",
    description: "Fri Dec 26 2025 (holiday). Park Royal peaks at 1.44× typical at 14:30.",
    hub_id: "park-royal",
    time: "2025-12-26T10:30:00-08:00",
  },
  {
    id: "waterfront-summer-saturday",
    label: "Waterfront summer Saturday",
    description: "Sat Jul 25 2026. Waterfront surges from 09:00 and peaks at 1.79× typical at 10:00.",
    hub_id: "waterfront",
    time: "2026-07-25T07:30:00-07:00",
  },
  {
    id: "normal-weekday",
    label: "Normal weekday 13:00",
    description: "Wed Feb 11 2026. No surges forecast at any hub.",
    hub_id: null,
    time: DEFAULT_START_TIME,
  },
  {
    id: "saturday-late-night",
    label: "Saturday late night",
    description: "Sat Feb 14 2026, 22:00. Who's still at the hubs after the evening peak.",
    hub_id: "waterfront",
    time: "2026-02-14T22:00:00-08:00",
  },
];

export const DAY_TYPE_LABELS = {
  mf: "Weekday",
  sat: "Saturday",
  sun_hol: "Sunday / holiday",
} as const;

/** Surge index at or above which an hour counts as a surge (the model's surge_ratio). */
export const SURGE_THRESHOLD = 1.25;

/** Severity bands on the surge index (display only). */
export const SEVERITY_BANDS = { LOW: 1.25, MEDIUM: 1.5, HIGH: 1.75 } as const;
export type Severity = keyof typeof SEVERITY_BANDS;

export function severityForIndex(index: number | null | undefined): Severity | null {
  if (index == null || !Number.isFinite(index)) return null;
  if (index >= SEVERITY_BANDS.HIGH) return "HIGH";
  if (index >= SEVERITY_BANDS.MEDIUM) return "MEDIUM";
  if (index >= SEVERITY_BANDS.LOW) return "LOW";
  return null;
}
