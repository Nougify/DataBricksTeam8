// Date ↔ x for the timeline (spec §17.1). Days are Vancouver calendar dates; the scale counts whole days, so DST
// never shifts a marker.
import { addDays } from "@/lib/time";

const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;

export interface DayScale {
  first: string;
  last: string;
  days: number;
  /** Day index of a date (0 = first), clamped. */
  index(date: string): number;
  /** x (px) of a date's centre; dates outside the range are clamped. */
  x(date: string): number;
  /** The date nearest to x (px), clamped into the range. */
  dateAt(x: number): string;
  /** Moves a date by n days, clamped into the range. */
  shift(date: string, n: number): string;
  clamp(date: string): string;
}

export function dayScale(first: string, last: string, width: number): DayScale {
  const d0 = dayNumber(first);
  const days = Math.max(1, dayNumber(last) - d0 + 1);
  const step = width / days;
  const clampIndex = (i: number) => Math.min(days - 1, Math.max(0, i));
  const clamp = (date: string) => addDays(first, clampIndex(dayNumber(date) - d0));
  return {
    first,
    last,
    days,
    index: (date) => clampIndex(dayNumber(date) - d0),
    x: (date) => (clampIndex(dayNumber(date) - d0) + 0.5) * step,
    dateAt: (x) => addDays(first, clampIndex(Math.floor(x / step))),
    shift: (date, n) => clamp(addDays(date, n)),
    clamp,
  };
}

/** First day of each month in the range, for axis ticks. */
export function monthStarts(first: string, last: string): string[] {
  const out: string[] = [];
  let y = +first.slice(0, 4);
  let m = +first.slice(5, 7);
  for (;;) {
    const d = `${y}-${String(m).padStart(2, "0")}-01`;
    if (d > last) break;
    if (d >= first) out.push(d);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
