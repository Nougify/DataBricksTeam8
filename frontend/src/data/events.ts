// Known demand drivers: UBC exam periods (UBC academic calendar) and the 10 BC statutory holidays the pipeline uses
// (hub_pulse/sql/02_silver.sql). No invented sports or concert events (DECISIONS.md "Seed data"). Restored from the
// v2 mock for the Now tab's driver chips and the timeline's event bands; shared by mock and real mode.
import { BC_HOLIDAYS } from "@/lib/time";

export type DriverCategory = "EXAM" | "HOLIDAY";

export interface DriverEvent {
  id: string;
  label: string;
  category: DriverCategory;
  /** First and last Vancouver calendar date covered (inclusive). */
  start_date: string;
  end_date: string;
  /** Hubs the event affects. */
  hub_ids: string[];
  source_name: string;
  source_url: string;
}

const UBC_CALENDAR = { source_name: "UBC academic calendar", source_url: "https://vancouver.calendar.ubc.ca/dates-and-deadlines" };
const BC_HOLIDAY_SOURCE = {
  source_name: "BC statutory holidays",
  source_url:
    "https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/statutory-holidays",
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
  "2026-08-03": "BC Day",
};

const ALL_HUBS = ["ubc", "waterfront", "park-royal"];

export const DRIVER_EVENTS: readonly DriverEvent[] = [
  {
    id: "evt-ubc-exams-2025w1",
    label: "UBC December exam period",
    category: "EXAM",
    start_date: "2025-12-04",
    end_date: "2025-12-19",
    hub_ids: ["ubc"],
    ...UBC_CALENDAR,
  },
  {
    id: "evt-ubc-exams-2025w2",
    label: "UBC April exam period",
    category: "EXAM",
    start_date: "2026-04-14",
    end_date: "2026-04-29",
    hub_ids: ["ubc"],
    ...UBC_CALENDAR,
  },
  ...[...BC_HOLIDAYS].sort().map(
    (date): DriverEvent => ({
      id: `evt-bc-${date}`,
      label: HOLIDAY_LABELS[date] ?? "BC statutory holiday",
      category: "HOLIDAY",
      start_date: date,
      end_date: date,
      hub_ids: [...ALL_HUBS],
      ...BC_HOLIDAY_SOURCE,
    }),
  ),
];

/** Events affecting `hubId` (or any hub when null) that overlap the inclusive date range. */
export function driverEventsBetween(hubId: string | null, fromDate: string, toDate: string): DriverEvent[] {
  return DRIVER_EVENTS.filter(
    (e) => e.end_date >= fromDate && e.start_date <= toDate && (hubId === null || e.hub_ids.includes(hubId)),
  );
}
