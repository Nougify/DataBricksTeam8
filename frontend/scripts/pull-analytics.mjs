#!/usr/bin/env node
// Snapshots the Databricks model tables the console bundles (spec §19 M2a.1, DECISIONS.md "v3 contract").
// Read-only: only SELECT statements run, through the SQL Statement Execution API via the Databricks CLI.
//
//   node scripts/pull-analytics.mjs [--profile DEFAULT] [--warehouse 93d96b01c499de55]
//
// Writes compact JSON into src/data/ (see src/data/README.md for shapes and the exact SQL):
//   forecast/<hub>.json   model.surge_forecast_hourly, split = history, both targets, columnar per hub
//   metrics.json          model.surge_model_metrics
//   feed/<yyyy-mm>.json   model.surge_recommendations_backtest, per month of event_time, dictionary-encoded
//   feed/manifest.json    months, counts, source version
//   routes_feed_extra.json  feed routes that don't call at a hub (GTFS bronze, same method as routes.json)
//
// Timestamps in these tables are Vancouver wall time stored as UTC (DECISIONS.md). The SQL formats them with
// date_format in the warehouse's UTC session, so the strings written here are Vancouver wall-clock times.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const PROFILE = opt("profile", "DEFAULT");
const WAREHOUSE = opt("warehouse", "93d96b01c499de55");
const CATALOG = "rgersxdatabricks_hackathon";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");

const HUB_IDS = { UBC: "ubc", "Waterfront Station": "waterfront", "Park Royal Mall": "park-royal" };
/** Feed route keys that aren't in routes.json (DECISIONS.md "2a answers"). */
const EXTRA_LINE_KEYS = ["19", "240", "246", "2", "23", "6", "241", "247", "N9"];

function cli(argv, body) {
  // The CLI can't read a body from stdin on every platform, so it goes through a temp file.
  let dir = null;
  if (body !== undefined) {
    dir = mkdtempSync(join(tmpdir(), "pull-analytics-"));
    writeFileSync(join(dir, "body.json"), JSON.stringify(body));
    argv = [...argv, "--json", `@${join(dir, "body.json")}`];
  }
  try {
    const out = execFileSync("databricks", [...argv, "--profile", PROFILE, "-o", "json"], {
      maxBuffer: 512 * 1024 * 1024,
      encoding: "utf8",
    });
    return JSON.parse(out);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Runs one SELECT and returns every row as an object, following result chunks. */
function query(sql) {
  let res = cli(["api", "post", "/api/2.0/sql/statements"], {
    statement: sql,
    warehouse_id: WAREHOUSE,
    wait_timeout: "50s",
    disposition: "INLINE",
    format: "JSON_ARRAY",
  });
  while (res.status?.state === "PENDING" || res.status?.state === "RUNNING") {
    sleep(2000);
    res = cli(["api", "get", `/api/2.0/sql/statements/${res.statement_id}`]);
  }
  if (res.status?.state !== "SUCCEEDED") throw new Error(`Query failed: ${JSON.stringify(res.status)}\n${sql}`);
  const cols = res.manifest.schema.columns.map((c) => c.name);
  const rows = [...(res.result?.data_array ?? [])];
  let next = res.result?.next_chunk_internal_link;
  while (next) {
    const chunk = cli(["api", "get", next]);
    rows.push(...(chunk.data_array ?? []));
    next = chunk.next_chunk_internal_link;
  }
  return rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

const num = (v) => (v === null || v === undefined ? null : Number(v));
const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
function write(rel, data) {
  const path = join(OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
  console.log(`wrote ${rel}`);
}

// ---------- forecast ----------

function pullForecast() {
  const rows = query(`
    SELECT hub, target, date_format(ts, 'yyyy-MM-dd') AS local_date, hour(ts) AS hour,
      actual, predicted, normal, CAST(is_surge AS INT) AS is_surge
    FROM ${CATALOG}.model.surge_forecast_hourly
    WHERE split = 'history'
    ORDER BY hub, target, ts`);
  const byHub = {};
  for (const r of rows) {
    const hubId = HUB_IDS[r.hub];
    const hub = (byHub[hubId] ??= { rows: [] });
    hub.rows.push(r);
  }
  for (const [hubId, { rows: hubRows }] of Object.entries(byHub)) {
    const start = hubRows.reduce((m, r) => (r.local_date < m ? r.local_date : m), "9999");
    const end = hubRows.reduce((m, r) => (r.local_date > m ? r.local_date : m), "0000");
    const days = Math.round((Date.parse(`${end}T00:00Z`) - Date.parse(`${start}T00:00Z`)) / 86_400_000) + 1;
    const n = days * 24;
    const series = () => ({ actual: Array(n).fill(null), forecast: Array(n).fill(null), typical: Array(n).fill(null), surge: Array(n).fill(0) });
    const out = { hub_id: hubId, start_date: start, days, arrivals: series(), departures: series() };
    for (const r of hubRows) {
      const day = Math.round((Date.parse(`${r.local_date}T00:00Z`) - Date.parse(`${start}T00:00Z`)) / 86_400_000);
      const i = day * 24 + Number(r.hour);
      const s = out[r.target];
      s.actual[i] = r1(num(r.actual));
      s.forecast[i] = r1(num(r.predicted));
      s.typical[i] = r1(num(r.normal));
      s.surge[i] = Number(r.is_surge);
    }
    write(`forecast/${hubId}.json`, out);
  }
}

// ---------- metrics ----------

function pullMetrics() {
  const rows = query(`
    SELECT lead_minutes, hub, surge_slots, slots, auc, threshold, precision, recall, f1,
      rule_precision, rule_recall, rule_f1, surge_ratio, slot_minutes, source_version
    FROM ${CATALOG}.model.surge_model_metrics
    ORDER BY lead_minutes, hub`);
  write(
    "metrics.json",
    rows.map((r) => ({
      lead_minutes: num(r.lead_minutes),
      hub_id: HUB_IDS[r.hub] ?? null,
      hub: r.hub,
      surge_slots: num(r.surge_slots),
      slots: num(r.slots),
      auc: num(r.auc),
      threshold: num(r.threshold),
      precision: num(r.precision),
      recall: num(r.recall),
      f1: num(r.f1),
      rule_precision: num(r.rule_precision),
      rule_recall: num(r.rule_recall),
      rule_f1: num(r.rule_f1),
      surge_ratio: num(r.surge_ratio),
      slot_minutes: num(r.slot_minutes),
      source_version: r.source_version,
    })),
  );
}

// ---------- dispatch feed ----------

function pullFeed() {
  const rows = query(`
    SELECT event_id, source_version, hub_id,
      date_format(event_time, 'yyyy-MM-dd HH:mm') AS event_time,
      date_format(available_at, 'yyyy-MM-dd HH:mm') AS available_at,
      predicted_people, normal_people, destination, destination_share_pct, route_key,
      extra_bus_trips_est, priority_score
    FROM ${CATALOG}.model.surge_recommendations_backtest
    ORDER BY event_time, event_id, priority_score DESC, route_key, destination`);
  const versions = new Set(rows.map((r) => r.source_version));
  const months = {};
  for (const r of rows) {
    const month = r.event_time.slice(0, 7);
    const m = (months[month] ??= { routes: [], destinations: [], events: new Map() });
    let ev = m.events.get(r.event_id);
    if (!ev) {
      ev = [r.event_id, r.hub_id, r.event_time.replace(" ", "T"), r.available_at ? r.available_at.replace(" ", "T") : null, num(r.predicted_people), num(r.normal_people), []];
      m.events.set(r.event_id, ev);
    }
    const idx = (list, v) => {
      let i = list.indexOf(v);
      if (i < 0) i = list.push(v) - 1;
      return i;
    };
    ev[6].push([idx(m.destinations, r.destination), num(r.destination_share_pct), idx(m.routes, r.route_key), num(r.extra_bus_trips_est), num(r.priority_score)]);
  }
  const manifest = {
    table: `${CATALOG}.model.surge_recommendations_backtest`,
    source_version: [...versions].join(", "),
    pulled_at: new Date().toISOString(),
    rows: rows.length,
    events: 0,
    months: Object.keys(months).sort(),
    event_columns: ["event_id", "hub_id", "event_time", "available_at", "predicted_people", "normal_people", "recommendations"],
    recommendation_columns: ["destination_idx", "destination_share_pct", "route_idx", "extra_bus_trips_est", "priority_score"],
  };
  for (const [month, m] of Object.entries(months)) {
    const events = [...m.events.values()];
    manifest.events += events.length;
    write(`feed/${month}.json`, { routes: m.routes, destinations: m.destinations, events });
  }
  write("feed/manifest.json", manifest);
}

// ---------- extra routes ----------

function pullExtraRoutes() {
  const keys = EXTRA_LINE_KEYS.map((k) => `'${k}'`).join(",");
  const meta = query(`
    SELECT r.route_id, r.route_short_name, r.route_long_name, r.route_color, r.route_text_color,
      l.line_key, l.tspr_line, l.mode
    FROM ${CATALOG}.hub_pulse.silver_route_lookup l
    JOIN ${CATALOG}.hub_pulse.gtfs_routes r USING (route_id)
    WHERE l.line_key IN (${keys})`);
  const stops = query(`
    WITH sel AS (SELECT route_id FROM ${CATALOG}.hub_pulse.silver_route_lookup WHERE line_key IN (${keys})),
    shp AS (
      SELECT t.route_id, t.direction_id, t.shape_id, count(*) AS n_trips
      FROM ${CATALOG}.hub_pulse.gtfs_trips t JOIN sel USING (route_id) GROUP BY ALL
    ),
    best_shp AS (
      SELECT * FROM (SELECT *, row_number() OVER (PARTITION BY route_id ORDER BY n_trips DESC, direction_id, shape_id) AS rn FROM shp)
      WHERE rn = 1
    ),
    trip_len AS (
      SELECT t.route_id, t.trip_id, count(*) AS n_stops
      FROM ${CATALOG}.hub_pulse.gtfs_trips t
      JOIN best_shp b ON b.route_id = t.route_id AND b.direction_id = t.direction_id AND b.shape_id = t.shape_id
      JOIN ${CATALOG}.hub_pulse.gtfs_stop_times st ON st.trip_id = t.trip_id
      GROUP BY ALL
    ),
    rep AS (
      SELECT * FROM (SELECT *, row_number() OVER (PARTITION BY route_id ORDER BY n_stops DESC, trip_id) AS rn FROM trip_len)
      WHERE rn = 1
    )
    SELECT rep.route_id, CAST(rep.trip_id AS STRING) AS trip_id, b.direction_id, b.shape_id, rep.n_stops,
      st.stop_sequence, st.stop_id, s.stop_name, s.stop_lat, s.stop_lon
    FROM rep
    JOIN best_shp b ON b.route_id = rep.route_id
    JOIN ${CATALOG}.hub_pulse.gtfs_stop_times st ON st.trip_id = rep.trip_id
    JOIN ${CATALOG}.hub_pulse.gtfs_stops s ON s.stop_id = st.stop_id
    ORDER BY rep.route_id, st.stop_sequence`);
  const round5 = (v) => Math.round(Number(v) * 1e5) / 1e5;
  const hex = (c) => (c ? `#${String(c).replace(/^#/, "").toUpperCase()}` : null);
  const routes = meta
    .map((m) => {
      const own = stops.filter((s) => s.route_id === m.route_id).sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
      const first = own[0];
      return {
        route_id: String(m.route_id),
        line_key: m.line_key,
        short_name: m.route_short_name ? String(m.route_short_name).replace(/^0+(?=\w)/, "") : m.line_key,
        long_name: m.route_long_name || null,
        mode: m.mode,
        color: hex(m.route_color),
        text_color: hex(m.route_text_color),
        tspr_line: m.tspr_line ?? null,
        serves_hub_ids: [],
        weekly_trips_at_hub: {},
        rep_trip_id: first ? first.trip_id : null,
        rep_shape_id: first ? num(first.shape_id) : null,
        rep_direction_id: first ? num(first.direction_id) : null,
        shape: { type: "LineString", coordinates: own.map((s) => [round5(s.stop_lon), round5(s.stop_lat)]) },
        stops: own.map((s) => ({ id: String(s.stop_id), name: s.stop_name, lat: Number(s.stop_lat), lon: Number(s.stop_lon) })),
        n_stops_trip: own.length,
      };
    })
    .sort((a, b) => a.line_key.localeCompare(b.line_key, "en", { numeric: true }));
  const missing = EXTRA_LINE_KEYS.filter((k) => !routes.some((r) => r.line_key === k));
  if (missing.length) console.warn(`No GTFS route for line keys: ${missing.join(", ")}`);
  write("routes_feed_extra.json", routes);
}

const only = opt("only", "all");
if (only === "all" || only === "forecast") pullForecast();
if (only === "all" || only === "metrics") pullMetrics();
if (only === "all" || only === "feed") pullFeed();
if (only === "all" || only === "routes") pullExtraRoutes();
