// Derives src/data/feed_days.json from the bundled dispatch feed (src/data/feed/<yyyy-mm>.json): one row per hub
// and Vancouver date of event_time, with the day's first actionable_at, its peak surge index and the event count.
// The timeline marks these days once their first actionable_at has passed (DECISIONS.md "2b answers").
// Offline and deterministic: run `node scripts/derive-feed-days.mjs` after `npm run pull:analytics`.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");
const manifest = JSON.parse(readFileSync(join(dataDir, "feed", "manifest.json"), "utf8"));

/** "<hub>|<date>" -> { hub, date, first, peak, peakAt, n } */
const days = new Map();
for (const month of manifest.months) {
  const raw = JSON.parse(readFileSync(join(dataDir, "feed", `${month}.json`), "utf8"));
  for (const [, hub, eventTime, availableAt, predicted, normal] of raw.events) {
    const date = eventTime.slice(0, 10);
    const actionable = availableAt ?? eventTime;
    const index = normal > 0 ? predicted / normal : null;
    const key = `${hub}|${date}`;
    const d = days.get(key) ?? { hub, date, first: actionable, peak: null, peakAt: null, n: 0 };
    if (actionable < d.first) d.first = actionable;
    if (index !== null && (d.peak === null || index > d.peak)) {
      d.peak = index;
      d.peakAt = eventTime.slice(11, 16);
    }
    d.n += 1;
    days.set(key, d);
  }
}

const rows = [...days.values()]
  .sort((a, b) => a.date.localeCompare(b.date) || a.hub.localeCompare(b.hub))
  .map((d) => [d.hub, d.date, d.first, d.peak === null ? null : Math.round(d.peak * 100) / 100, d.peakAt, d.n]);

const out = {
  table: manifest.table,
  source_version: manifest.source_version,
  derived_from: "src/data/feed/*.json",
  columns: ["hub_id", "local_date", "first_actionable_at", "peak_surge_index", "peak_at", "events"],
  rows,
};
writeFileSync(join(dataDir, "feed_days.json"), JSON.stringify(out));
console.log(`feed_days.json: ${rows.length} hub-days from ${manifest.events} events`);
