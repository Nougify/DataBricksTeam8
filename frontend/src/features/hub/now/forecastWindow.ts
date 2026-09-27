// The Now chart's data (spec §9.1, DECISIONS.md "Now chart"): `horizon` hours of history, the current hour, and
// `horizon` hours ahead, keyed on Vancouver local_date + hour (never epoch arithmetic). Wall-clock hours that don't
// exist (02:00 on the spring-forward day, which the table still has a row for) are skipped, so a DST day simply
// has 23 buckets. Actuals stop at the last full hour: the snapshot has future actuals, and they're never shown.
import { SURGE_THRESHOLD, forecastHour, type ForecastTarget, type HubForecast } from "@/data/forecast";
import { hourKey, vancouverParts, vancouverToMs } from "@/lib/time";
import { nextHour, previousHour } from "@/lib/live/demand";

export interface WindowRow {
  key: string;
  local_date: string;
  hour: number;
  /** "past" = complete hours before now, "current" = the hour now in progress, "future" = after it. */
  kind: "past" | "current" | "future";
  actual: number | null;
  forecast: number | null;
  typical: number | null;
  /** typical × 1.25. */
  surge_line: number | null;
  /** The model flagged the hour: forecast ≥ 1.25 × typical. */
  is_surge: boolean;
  forecast_index: number | null;
}

export interface ForecastWindow {
  rows: WindowRow[];
  /** Index of the current hour in `rows`. */
  nowIndex: number;
  /** True when no row in the window is covered by the snapshot. */
  uncovered: boolean;
  /** The future row with the highest forecast index (the chart title's message), or null. */
  peak: WindowRow | null;
}

/** False for wall-clock hours skipped by spring forward. */
export function hourExists(localDate: string, hour: number): boolean {
  const p = vancouverParts(vancouverToMs(localDate, hour));
  return p.local_date === localDate && p.hour === hour;
}

function step(localDate: string, hour: number, dir: 1 | -1) {
  let h = dir === 1 ? nextHour(localDate, hour) : previousHour(localDate, hour);
  if (!hourExists(h.local_date, h.hour)) h = dir === 1 ? nextHour(h.local_date, h.hour) : previousHour(h.local_date, h.hour);
  return h;
}

export function buildForecastWindow(
  f: HubForecast,
  target: ForecastTarget,
  localDate: string,
  hour: number,
  horizon: number,
): ForecastWindow {
  const slots: { local_date: string; hour: number; kind: WindowRow["kind"] }[] = [];
  let back = { local_date: localDate, hour };
  const past: typeof slots = [];
  for (let i = 0; i < horizon; i++) {
    back = step(back.local_date, back.hour, -1);
    past.unshift({ ...back, kind: "past" });
  }
  slots.push(...past, { local_date: localDate, hour, kind: "current" });
  let fwd = { local_date: localDate, hour };
  for (let i = 0; i < horizon; i++) {
    fwd = step(fwd.local_date, fwd.hour, 1);
    slots.push({ ...fwd, kind: "future" });
  }

  let covered = 0;
  const rows = slots.map(({ local_date, hour: h, kind }): WindowRow => {
    const r = forecastHour(f, target, local_date, h);
    if (r) covered++;
    const typical = r?.typical ?? null;
    return {
      key: hourKey(local_date, h),
      local_date,
      hour: h,
      kind,
      actual: kind === "past" ? (r?.actual ?? null) : null,
      forecast: r?.forecast ?? null,
      typical,
      surge_line: typical === null ? null : typical * SURGE_THRESHOLD,
      is_surge: r?.is_surge ?? false,
      forecast_index: r?.forecast_index ?? null,
    };
  });

  let peak: WindowRow | null = null;
  for (const r of rows) {
    if (r.kind === "past" || r.forecast_index === null) continue;
    if (peak === null || r.forecast_index > peak.forecast_index!) peak = r;
  }
  return { rows, nowIndex: past.length, uncovered: covered === 0, peak };
}

/** Contiguous runs of `is_surge` rows as [firstKey, lastKey] pairs, for the shaded background. */
export function surgeRuns(rows: readonly WindowRow[]): [string, string][] {
  const runs: [string, string][] = [];
  let start: string | null = null;
  rows.forEach((r, i) => {
    if (r.is_surge && start === null) start = r.key;
    const endsHere = r.is_surge && (i === rows.length - 1 || !rows[i + 1].is_surge);
    if (endsHere && start !== null) {
      runs.push([start, r.key]);
      start = null;
    }
  });
  return runs;
}
