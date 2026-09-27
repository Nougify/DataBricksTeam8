// Per-hub, per-day summary of the bundled dispatch feed (model.surge_recommendations_backtest), derived offline by
// scripts/derive-feed-days.mjs. The timeline marks a day once its first actionable_at has passed; future days are
// never shown (DECISIONS.md "2b answers").
import { vancouverToMs } from "@/lib/time";
import feedDaysJson from "./feed_days.json";

/** "YYYY-MM-DDTHH:mm" Vancouver wall time -> epoch ms. */
const wallToMs = (wall: string) => vancouverToMs(wall.slice(0, 10), Number(wall.slice(11, 13)), Number(wall.slice(14, 16)));

export interface FeedDay {
  hub_id: string;
  local_date: string;
  /** First actionable_at that day, epoch ms (Vancouver wall time in the source). */
  firstActionableMs: number;
  peak_index: number | null;
  /** "HH:mm" of the peak event_time. */
  peak_at: string | null;
  events: number;
}

type Row = [string, string, string, number | null, string | null, number];

export const feedDays: readonly FeedDay[] = (feedDaysJson.rows as Row[]).map(([hub_id, local_date, first, peak, peakAt, n]) => ({
  hub_id,
  local_date,
  firstActionableMs: wallToMs(first),
  peak_index: peak,
  peak_at: peakAt,
  events: n,
}));

/** Days whose first dispatch event had become actionable by `nowMs`. */
export function feedDaysActionableBy(nowMs: number): FeedDay[] {
  if (!Number.isFinite(nowMs)) return [];
  return feedDays.filter((d) => d.firstActionableMs <= nowMs);
}
