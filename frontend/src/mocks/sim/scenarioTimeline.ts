// Timing and shape of the scripted surge scenarios (web/DECISIONS.md "Scenarios").
// Shared by synth.ts (hourly pings + forecasts) and mockSim.ts (surges, proposals, trips).
// Hours are Vancouver wall-clock hours on `localDate`; windows are [start, end).
import type { DriverType } from "@/lib/api/schemas";

export interface ScenarioTimeline {
  id: string;
  surgeId: string;
  hubId: "ubc" | "waterfront" | "park-royal";
  locationName: string;
  localDate: string;
  detectedHour: number;
  windowStartHour: number;
  windowEndHour: number;
  /** Surge index (pings ÷ typical) that actually happens, per hour 0-23 of localDate. */
  actualIndex: readonly number[];
  /** Index forecast by any forecast issued at or after detection, per hour 0-23. */
  predictedIndex: readonly number[];
  drivers: { type: DriverType; label: string; event_id: string | null }[];
}

/** Forecasts issued before detection only see a quarter of the coming excess, keeping them under the 1.25 threshold. */
export const PRE_DETECTION_DAMPING = 0.25;

//                          0     1     2     3     4     5     6     7     8     9    10    11    12    13    14    15    16    17    18    19    20    21    22    23
const UBC_ACTUAL =       [1.12, 1.1, 1.1, 1.08, 1.08, 1.1, 1.12, 1.14, 1.15, 1.15, 1.17, 1.18, 1.24, 1.85, 1.88, 1.22, 1.2, 1.18, 1.16, 1.15, 1.14, 1.14, 1.12, 1.12];
const UBC_PREDICTED =    [1.1, 1.1, 1.1, 1.08, 1.08, 1.1, 1.1, 1.12, 1.13, 1.14, 1.15, 1.15, 1.2, 1.79, 1.72, 1.2, 1.17, 1.15, 1.14, 1.13, 1.12, 1.12, 1.1, 1.1];
const PR_ACTUAL =        [1.05, 1.05, 1.04, 1.04, 1.04, 1.05, 1.06, 1.07, 1.08, 1.1, 1.15, 1.22, 1.4, 1.52, 1.48, 1.3, 1.2, 1.12, 1.1, 1.08, 1.07, 1.06, 1.05, 1.05];
const PR_PREDICTED =     [1.05, 1.05, 1.04, 1.04, 1.04, 1.05, 1.06, 1.07, 1.08, 1.1, 1.14, 1.2, 1.36, 1.47, 1.44, 1.28, 1.18, 1.1, 1.08, 1.07, 1.06, 1.05, 1.05, 1.05];
const WF_ACTUAL =        [1.1, 1.08, 1.06, 1.05, 1.05, 1.06, 1.08, 1.08, 1.1, 1.12, 1.14, 1.16, 1.2, 1.24, 1.6, 1.9, 1.7, 1.24, 1.2, 1.18, 1.16, 1.15, 1.14, 1.12];
const WF_PREDICTED =     [1.08, 1.07, 1.06, 1.05, 1.05, 1.06, 1.07, 1.08, 1.1, 1.11, 1.13, 1.15, 1.18, 1.22, 1.55, 1.83, 1.62, 1.22, 1.18, 1.16, 1.15, 1.14, 1.12, 1.1];

export const SCENARIO_TIMELINES: readonly ScenarioTimeline[] = [
  {
    id: "ubc-exams",
    surgeId: "surge-ubc-2025-12-06",
    hubId: "ubc",
    locationName: "UBC Exchange",
    localDate: "2025-12-06",
    detectedHour: 10,
    windowStartHour: 13,
    windowEndHour: 15,
    actualIndex: UBC_ACTUAL,
    predictedIndex: UBC_PREDICTED,
    drivers: [{ type: "EXAM", label: "UBC December exam period", event_id: "evt-ubc-exams-2025w1" }],
  },
  {
    id: "park-royal-boxing-day",
    surgeId: "surge-park-royal-2025-12-26",
    hubId: "park-royal",
    locationName: "Park Royal",
    localDate: "2025-12-26",
    detectedHour: 9,
    windowStartHour: 12,
    windowEndHour: 16,
    actualIndex: PR_ACTUAL,
    predictedIndex: PR_PREDICTED,
    drivers: [{ type: "HOLIDAY", label: "Boxing Day", event_id: "evt-bc-2025-12-26" }],
  },
  {
    id: "waterfront-jul-25",
    surgeId: "surge-waterfront-2026-07-25",
    hubId: "waterfront",
    locationName: "Waterfront Station",
    localDate: "2026-07-25",
    detectedHour: 11,
    windowStartHour: 14,
    windowEndHour: 17,
    actualIndex: WF_ACTUAL,
    predictedIndex: WF_PREDICTED,
    drivers: [],
  },
];

export function scenarioFor(hubId: string, localDate: string): ScenarioTimeline | undefined {
  return SCENARIO_TIMELINES.find((s) => s.hubId === hubId && s.localDate === localDate);
}
