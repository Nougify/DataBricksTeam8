// Display formatters (spec §14.3). Times and dates are always America/Vancouver, whatever the viewer's
// machine is set to: wall-clock parts come from vancouverParts(), an Intl formatter with timeZone: TZ.
// Hourly buckets from the API are labelled from local_date + hour (hourLabel, fmtDateShort), never
// recomputed from an ISO timestamp. Missing or invalid input renders as an em dash.
import { vancouverParts, weekdayOf } from "@/lib/time";

type Instant = string | number;
type MaybeNumber = number | null | undefined;

const EMPTY = "—";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const pad2 = (n: number) => String(n).padStart(2, "0");
const isNum = (n: MaybeNumber): n is number => typeof n === "number" && Number.isFinite(n);

function toMs(t: Instant | null | undefined): number {
  if (typeof t === "number") return t;
  if (typeof t === "string") return Date.parse(t);
  return Number.NaN;
}

// ---------- numbers ----------

const integerFormat = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat("en-CA", { notation: "compact", maximumFractionDigits: 1 });

/** 10324110 → "10.3M" (from hub_pulse format.ts). */
export const compact = (n: number) => compactFormat.format(Number(n));

/** 5 → "+5", -3 → "-3" (from hub_pulse format.ts). */
export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** 13 → "13:00" (from hub_pulse format.ts). */
export const hourLabel = (h: number) => `${pad2(h)}:00`;

/** Pings with thousands separators: 3920 → "3,920". */
export function fmtPings(n: MaybeNumber): string {
  return isNum(n) ? integerFormat.format(Math.round(n)) : EMPTY;
}

/** Pings in a KPI: compact only above 100k ("10.3M"), otherwise "3,920". */
export function fmtPingsKpi(n: MaybeNumber): string {
  if (!isNum(n)) return EMPTY;
  return Math.abs(n) > 100_000 ? compact(n) : fmtPings(n);
}

/** Surge index: 1.79 → "1.79×". */
export function fmtIndex(n: MaybeNumber): string {
  return isNum(n) ? `${n.toFixed(2)}×` : EMPTY;
}

/** Percent on a 0–100 scale: 14.5 → "14.5%". */
export function fmtPct(n: MaybeNumber): string {
  return isNum(n) ? `${n.toFixed(1)}%` : EMPTY;
}

/** Minutes → "2 h 40 min", "45 min", "3 h". */
export function fmtDuration(minutes: MaybeNumber): string {
  if (!isNum(minutes)) return EMPTY;
  const sign = minutes < 0 ? "-" : "";
  const total = Math.round(Math.abs(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${sign}${m} min`;
  return m === 0 ? `${sign}${h} h` : `${sign}${h} h ${m} min`;
}

// ---------- times and dates (America/Vancouver) ----------

/** "PST" or "PDT" for the instant, from its Vancouver UTC offset (Intl short names vary by runtime). */
export function tzAbbr(t: Instant | null | undefined): string {
  const ms = toMs(t);
  if (!Number.isFinite(ms)) return EMPTY;
  const { offset } = vancouverParts(ms);
  if (offset === "-08:00") return "PST";
  if (offset === "-07:00") return "PDT";
  return `UTC${offset}`;
}

/** 24-hour wall-clock time: "13:00". */
export function fmtTime(t: Instant | null | undefined): string {
  const ms = toMs(t);
  if (!Number.isFinite(ms)) return EMPTY;
  const p = vancouverParts(ms);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "Sat Dec 6 2025". */
export function fmtDate(t: Instant | null | undefined): string {
  const ms = toMs(t);
  if (!Number.isFinite(ms)) return EMPTY;
  const p = vancouverParts(ms);
  const [y, m, d] = p.local_date.split("-").map(Number);
  return `${WEEKDAYS[p.weekday]} ${MONTHS[m - 1]} ${d} ${y}`;
}

/** An API local_date ("2025-12-06") → "Sat Dec 6". */
export function fmtDateShort(localDate: string | null | undefined): string {
  if (!localDate || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return EMPTY;
  // Already a Vancouver calendar date: no time zone conversion involved.
  const [, m, d] = localDate.split("-").map(Number);
  return `${WEEKDAYS[weekdayOf(localDate)]} ${MONTHS[m - 1]} ${d}`;
}

export interface ClockParts {
  /** "Sat" */
  weekday: string;
  /** "Dec 6 2025" */
  date: string;
  /** "13:20" */
  time: string;
  /** "PST" | "PDT" */
  tz: string;
}

/** Parts for the top-bar clock: "Sat" "Dec 6 2025" "13:20" "PST". */
export function fmtClock(t: Instant | null | undefined): ClockParts {
  const ms = toMs(t);
  if (!Number.isFinite(ms)) return { weekday: EMPTY, date: EMPTY, time: EMPTY, tz: EMPTY };
  const p = vancouverParts(ms);
  const [y, m, d] = p.local_date.split("-").map(Number);
  return {
    weekday: WEEKDAYS[p.weekday],
    date: `${MONTHS[m - 1]} ${d} ${y}`,
    time: `${pad2(p.hour)}:${pad2(p.minute)}`,
    tz: tzAbbr(ms),
  };
}

/** A time window: "13:00–15:00". */
export function fmtWindow(start: Instant | null | undefined, end: Instant | null | undefined): string {
  return `${fmtTime(start)}–${fmtTime(end)}`;
}
