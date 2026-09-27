// America/Vancouver time helpers. Instants are epoch ms; wall-clock values come from Intl with an explicit
// timeZone, so output never depends on the viewer's machine. Hourly buckets from the API are keyed on
// local_date + hour; use hourKey() for that and never derive buckets by epoch arithmetic.

export const TZ = "America/Vancouver";

export interface VancouverParts {
  local_date: string; // YYYY-MM-DD
  hour: number; // 0-23
  minute: number;
  second: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
  /** "-08:00" (PST) or "-07:00" (PDT) */
  offset: string;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  weekday: "short",
  timeZoneName: "longOffset",
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function vancouverParts(ms: number): VancouverParts {
  const p: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(new Date(ms))) p[part.type] = part.value;
  const tz = p.timeZoneName ?? "GMT-08:00"; // "GMT-08:00"
  const offset = tz === "GMT" ? "+00:00" : tz.replace("GMT", "");
  return {
    local_date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: WEEKDAYS.indexOf(p.weekday ?? "Sun"),
    offset,
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Epoch ms -> "2025-12-06T10:00:00-08:00" with the correct Vancouver offset for that instant. */
export function toVancouverIso(ms: number): string {
  const p = vancouverParts(ms);
  return `${p.local_date}T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}${p.offset}`;
}

export function isoToMs(iso: string): number {
  return Date.parse(iso);
}

/**
 * Vancouver wall-clock (local_date, hour, minute) -> epoch ms.
 * Repeated hour (fall back): returns the first occurrence (PDT). Missing hour (spring forward): moves forward.
 */
export function vancouverToMs(localDate: string, hour: number, minute = 0): number {
  const [y, m, d] = localDate.split("-").map(Number);
  const naiveUtc = Date.UTC(y, m - 1, d, hour, minute);
  for (const offsetH of [7, 8]) {
    const ms = naiveUtc + offsetH * 3_600_000;
    const p = vancouverParts(ms);
    if (p.local_date === localDate && p.hour === hour && p.minute === minute) return ms;
  }
  return naiveUtc + 8 * 3_600_000;
}

/** Start of the Vancouver wall-clock hour containing ms. */
export function startOfVancouverHour(ms: number): number {
  const p = vancouverParts(ms);
  return ms - (p.minute * 60 + p.second) * 1000 - (ms % 1000);
}

/** Key for hourly buckets: "2025-12-06T13". */
export function hourKey(localDate: string, hour: number): string {
  return `${localDate}T${pad2(hour)}`;
}

export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** 0 = Sunday ... 6 = Saturday, for a calendar date (no time zone involved). */
export function weekdayOf(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export type DayTypeId = "mf" | "sat" | "sun_hol";

/** BC statutory holidays used by the pipeline (hub_pulse/sql/02_silver.sql). Fallback when /timeline isn't loaded. */
export const BC_HOLIDAYS: ReadonlySet<string> = new Set([
  "2025-11-11",
  "2025-12-25",
  "2025-12-26",
  "2026-01-01",
  "2026-02-16",
  "2026-04-03",
  "2026-04-06",
  "2026-05-18",
  "2026-07-01",
  "2026-08-03",
]);

export function dayTypeOf(localDate: string, holidays: ReadonlySet<string> = BC_HOLIDAYS): DayTypeId {
  const wd = weekdayOf(localDate);
  if (wd === 0 || holidays.has(localDate)) return "sun_hol";
  if (wd === 6) return "sat";
  return "mf";
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
