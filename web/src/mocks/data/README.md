# Mock seed data (Databricks snapshots)

These are real aggregates, pulled read-only from `rgersxdatabricks_hackathon.hub_pulse` for mock mode. Only SELECT, DESCRIBE and SHOW were run.

| | |
|---|---|
| Pulled | 2026-09-26 16:02 PDT (queries). The JSON was regenerated at 16:04 from the same results. |
| Workspace | `https://dbc-4e20a0bf-b569.cloud.databricks.com`, CLI profile `DEFAULT` |
| Warehouse | `93d96b01c499de55` (Serverless Starter Warehouse), queried through the Statement Execution API (`databricks api post /api/2.0/sql/statements`) |
| Total size | 1053 KB across 14 JSON files |

The typed accessors are in `index.ts`. Every file is minified JSON.

## Conventions

- **Hub id:** `UBC` → `ubc`, `Waterfront Station` → `waterfront`, `Park Royal Mall` → `park-royal`. The display `name` in `hubs.json` is `UBC`, `Waterfront Station` or `Park Royal`.
- **Day type:** `MF` → `mf`, `Sat` → `sat`, `Sun/Hol` → `sun_hol`. Every file uses these ids in `day_type`, including the raw table dumps (route and time-range stress, peakload).
- **Gap status:** `Underserved`, `Overserved`, `Balanced` and `No service` → `UNDERSERVED`, `OVERSERVED`, `BALANCED` and `NO_SERVICE`.
- **Access type** (from `gold_origin_access.access_type`):
  - `One-seat ride` → `ONE_SEAT_RIDE`
  - `Transfer required` → `TRANSFER_REQUIRED`
  - `Local (same area)` → `LOCAL`
  - `Visitor (out of region)` → `VISITOR`
- **Time:** all times are local wall-clock time (`silver_visits.ts_local`). Nothing is converted between time zones.

## Files

| File | Rows | Size | Contents |
|---|---|---|---|
| `hubs.json` | 3 | 0.7 KB | `dim_hub`, plus `lines_serving` (distinct `line_key` values in `silver_hub_departures`) |
| `daily.json` | 912 | 120.8 KB | All of `gold_hub_daily`: 3 hubs × 304 days, 2025-11-01 to 2026-08-31 |
| `hourly_profile.json` | 216 | 57.1 KB | `hub_hours.sql` for every hub and day type, exactly 24 rows each |
| `origins.json` | 108 | 26.9 KB | `gold_origin_access`, left-joined onto all 36 `dim_origin` rows for each hub |
| `origin_hourly.json` | 216 keys x 36 origins (7750 non-zero source rows) | 39.0 KB | Typical pings per day from each origin, by hub, day type and hour |
| `night_pings.json` | 304 per hub | 56.5 KB | Pings from 00:00 to 05:00 for each calendar date |
| `route_stress.json` | 40 | 11.5 KB | All of `gold_route_stress` |
| `timerange_stress.json` | 126 | 30.4 KB | All of `gold_hub_timerange_stress` |
| `peakload.json` | 2570 | 474.7 KB | `tspr_bus_peakload` for SeasonYear 2025, only lines that serve a hub |
| `routes.json` | 48 | 210.7 KB | GTFS routes that call at a hub, with shape and stops |
| `late_night_lines.json` | 45 keys, 257 line rows | 13.9 KB | Lines departing each hub in hours 0–4 |
| `validation.json` | 24 | 1.3 KB | `gold_waterfront_validation`, plus Pearson r |
| `recommendations.json` | 19 | 8.4 KB | `gold_recommendations` (UBC 11, Waterfront 4, Park Royal 4) |
| `overview.json` | 3 | 0.9 KB | `hub_overview.sql`, one row per hub |

## Sanity checks

- **UBC transfer share: 47.55%** (HANDOFF says 47.6). This is the sum of `share_of_local_pct` over the `TRANSFER_REQUIRED` origins:

  | Origin | `share_of_local_pct` |
  |---|---|
  | Surrey | 14.50 |
  | Richmond | 11.63 |
  | New Westminster | 6.25 |
  | North Vancouver | 5.57 |
  | Delta | 2.61 |
  | Langley | 2.59 |
  | Marpole | 2.33 |
  | Maple Ridge | 1.10 |
  | Port Moody | 0.80 |
  | Pitt Meadows | 0.17 |

  - HANDOFF's "share of regional visitors" figures match the `share_of_local_pct` column: the share of pings from in-region origins, excluding the hub's own area.
  - They don't match `share_pct`, where Surrey is 7.77.
  - `overview.json` gives `transfer_share` = 0.4755.
- **Validation r = 0.9212**, rounded to 0.92. SQL `corr()` and a local Pearson calculation give the same value. The table has no r column, so r is computed here.
  - **Shifted by 3 h: 0.3784** (0.38). This pairs pings at hour h+3 with SkyTrain activity at hour h, i.e. the ping series moved 3 h earlier, wrapping around midnight.
  - Shifting the other way gives 0.4391.
  - `validation.json` stores `r` and `r_shifted_3h` (2 dp) and `shift_direction: "minus3h"`. All four values are in `r_detail`.
- **Top surge days match HANDOFF:**
  - UBC: 2025-12-06, index 1.722
  - Waterfront: 2026-07-25, index 1.83
  - Park Royal: 2025-12-26, index 1.47
  - There are 70 surge days in total: UBC 37, Waterfront 24, Park Royal 9.
- **Origin totals match daily totals.** `origin_hourly` summed over all origins and hours for UBC weekdays gives 29,748 pings per day. The weekday mean in `daily.json` is 29,749.

## Notes and caveats by file

### hourly_profile

- `gold_hub_gap_hourly` already has all 24 hours for every hub and day type, so no rows were filled in.
- The pull script can fill missing hours with zeros and `BALANCED`. The planner rule only gives `NO_SERVICE` when departures are 0 and the hour has more than 1% of daily demand. The filler was never used.
- `peak_load_pct` = `coalesce(max_peak_load_factor, 0)`. A 0 means unknown.
- `most_crowded_line` is `null` rather than `''` when unknown. In this snapshot it is never unknown.
- No hour in the data is `NO_SERVICE`.
- Pings use the fall-season profile (`season = 'Fall'`, which covers September to May).

### origins

- Every hub had a `gold_origin_access` row for all 36 origins, so no zero-ping rows had to be made up.
- `direct_lines` is the gold comma-separated list split into `line_key` values. The gold rule leaves out NightBus lines.
- `LOCAL` only appears at UBC, for the origin "UBC".

### origin_hourly

- Shape: `{ origins: string[36] (alphabetical), n_days: {"hub|day_type": days}, data: {"hub|day_type|hour": number[36]} }`.
- Each value is the origin's pings in that hour over all dates, divided by the number of dates of that day type at that hub (MF 206, Sat 44, Sun/Hol 54).
- It covers the whole dataset, both seasons, rounded to 1 dp. Combinations with no pings are 0.

### night_pings

- Shape: `{ hub_id: [{night_date, day_type, pings_00_05}] }`.
- `night_date` is the calendar date of hours 0–4. The night from Saturday into Sunday therefore has `night_date` = Sunday. `day_type` is that date's day type.
- A date with no night pings would show 0. None occur.

### route_stress and timerange_stress

- All columns are kept, in snake_case, plus `hub_id`. The original `hub` name is kept too.
- In the gold tables, `weekly_trips_at_hub` counts trips on three representative days (Wednesday + Saturday + Sunday), not a 7-day week.

### peakload

- Only SeasonYear 2025 is included. Every gold table and the contract's `TSPR_2025_TYPICAL` use that year, and adding 2023–2024 would triple the file to about 1.5 MB.
- `try_cast` turns the literal `'NULL'` strings into `null`. Many night and early-morning rows are null.
- `tspr_line` is TSPR `Lineno_renamed`, which combines some lines (for example `005/006` and `015/050`). Join to routes through `routes[].tspr_line`.
- `time_period` uses the gold table labels.

### routes

**Coverage.** There are 48 routes:

- Canada Line, Expo Line, SeaBus and West Coast Express
- 36 daytime buses
- 8 NightBus lines: N8, N15, N17, N19, N20, N22, N24 and N35

The required extras (25, 14, R4, R2, 250, 257, 99 and SeaBus) already call at a hub.

**Fields.** Each route has the RouteRef fields plus `serves_hub_ids`, `weekly_trips_at_hub`, `shape` and `stops`. There are also extra fields: `tspr_line`, `rep_trip_id`, `rep_shape_id`, `rep_direction_id` and `n_stops_trip`.

- **`short_name`:** the GTFS `route_short_name` without leading zeros (`099` → `99`).
  - SkyTrain and SeaBus have no GTFS short name, so it falls back to `line_key` (for example `Expo Line`).
  - The fallback exists because the zod RouteRef schema requires a string.
- **`color` and `text_color`:** `#` plus the GTFS hex in upper case, or `null`.
  - Only 8 routes have GTFS colours: Canada Line, Expo Line, SeaBus, WCE, 99, R2, R4 and R5.
  - 25, 14, 250, 257 and every NightBus line are `null`.
- **`serves_hub_ids`:** hubs where at least one trip of the route stops inside the catchment (`gtfs_stop_times` joined with `silver_hub_stops`). For all 48 routes this matches the set in `silver_hub_departures`.
- **`weekly_trips_at_hub`:** uses the gold definition, i.e. trips on the Wednesday, Saturday and Sunday representative days.

**Shapes.** Bronze has no `shapes.txt`, so each shape is built from the stops of one representative trip, in `stop_sequence` order.

- Coordinates are `[lon, lat]`, rounded to 5 dp.
- Choosing the representative trip:
  1. Take the route's trips that call at a hub.
  2. Find the most common `(direction_id, shape_id)` among them.
  3. Within that group, pick the trip with the most stops. Ties go to the lowest `trip_id`.
- Segments are straight lines between stops, not street geometry.
- The longest shape has 88 points, so no simplification was needed. The script can simplify to 300 points or fewer with RDP (Ramer–Douglas–Peucker) if needed.

**Stops.** These are the stops of the same representative trip, capped at 80.

- The first and last stops and any stops inside a hub catchment are always kept. The rest are spaced evenly.
- Only N19 (88 stops) was trimmed.
- There are 1,762 stops in total.

**Known limits.**

- A representative trip runs in one direction only, and it may be a common short-turn variant. For example, route 250's trip starts at Marine Dr @ 25 St.
- Route 44 lists `park-royal` because of 6 interlined trips a day, but its representative trip runs Waterfront ↔ UBC and never reaches Park Royal.
- R2's representative trip runs from Park Royal to Bonsor Ave in Burnaby, matching the fall 2026 GTFS long name "Marine-Willingdon".

### late_night_lines

- Shape: `{ "hub|day_type|hour": [{route_id, line_key, departures}] }` for hours 0–4. All 45 keys are present, and 7 of them are empty arrays.
- It includes every mode departing in those hours, not only NightBus.
- Departures come from the typical fall 2026 timetable (representative dates Wed 2026-10-14, Sat 2026-10-17 and Sun 2026-10-18), not the specific date.

### overview

- This is `hub_overview.sql` with `:hub` replaced by the literal location name.
- `transfer_share` and `visitor_share` are fractions from 0 to 1.
- `peak_load_where` contains a middle dot (U+00B7).
- Park Royal's highest peak load is on the 44 EAST (80.3%), which comes from the interlined 44 trips.

### recommendations

- The `recommendation` text is what the pipeline last generated with `ai_query`. It was not regenerated for this snapshot.

## SQL (exact statements run)

### hubs.json
```sql
-- hubs
SELECT h.hub, h.hub_code, h.lat, h.lon, h.catchment_m, h.description,
  count(DISTINCT d.line_key) AS lines_serving
FROM rgersxdatabricks_hackathon.hub_pulse.dim_hub h
LEFT JOIN rgersxdatabricks_hackathon.hub_pulse.silver_hub_departures d ON d.hub = h.hub
GROUP BY ALL
```

### daily.json
```sql
-- daily
SELECT hub, CAST(visit_date AS STRING) AS local_date, weekday, day_type, pings,
  round(surge_index, 3) AS surge_index, is_surge
FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_daily
ORDER BY hub, visit_date
```

### hourly_profile.json
This is `hub_hours.sql` with the `:hub`/`:day_type` filter removed and `g.hub, g.day_type` added to the SELECT.
```sql
-- hourly_profile
SELECT
  g.hub, g.day_type, g.hour,
  g.avg_pings, g.departures, g.bus_departures, g.skytrain_departures, g.seabus_departures, g.lines_running, g.status,
  t.time_period,
  CAST(coalesce(t.max_peak_load_factor, 0) AS DOUBLE) AS max_peak_load_factor,
  t.most_crowded_line
FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_gap_hourly g
LEFT JOIN rgersxdatabricks_hackathon.hub_pulse.gold_hub_timerange_stress t
  ON t.hub = g.hub AND t.day_type = g.day_type AND t.season = 'Fall'
 AND t.tspr_hour_range = CASE WHEN g.hour BETWEEN 4 AND 5 THEN 4 WHEN g.hour BETWEEN 6 AND 8 THEN 6
                              WHEN g.hour BETWEEN 9 AND 14 THEN 9 WHEN g.hour BETWEEN 15 AND 17 THEN 15
                              WHEN g.hour BETWEEN 18 AND 20 THEN 18 WHEN g.hour BETWEEN 21 AND 23 THEN 21 ELSE 24 END
ORDER BY g.hub, g.day_type, g.hour
```

### origins.json
```sql
-- origins
SELECT h.hub, o.origin, o.region, o.lat, o.lon,
  coalesce(a.pings, 0) AS pings, coalesce(a.share_pct, 0) AS share_pct, a.share_of_local_pct, a.avg_dwell_min,
  coalesce(a.n_direct_lines, 0) AS n_direct_lines, a.direct_lines, a.access_type
FROM rgersxdatabricks_hackathon.hub_pulse.dim_hub h
CROSS JOIN rgersxdatabricks_hackathon.hub_pulse.dim_origin o
LEFT JOIN rgersxdatabricks_hackathon.hub_pulse.gold_origin_access a ON a.hub = h.hub AND a.origin = o.origin
ORDER BY h.hub, pings DESC, o.origin
```

### origin_hourly.json
```sql
-- origin_hourly
WITH days AS (
  SELECT hub, day_type, count(DISTINCT visit_date) AS n_days FROM rgersxdatabricks_hackathon.hub_pulse.silver_visits GROUP BY ALL
),
c AS (
  SELECT hub, day_type, visit_hour AS hour, origin, count(*) AS pings FROM rgersxdatabricks_hackathon.hub_pulse.silver_visits GROUP BY ALL
)
SELECT c.hub, c.day_type, c.hour, c.origin, c.pings, d.n_days, round(c.pings / d.n_days, 1) AS avg_pings_per_day
FROM c JOIN days d USING (hub, day_type)
```

### night_pings.json
```sql
-- night_pings
WITH n AS (
  SELECT hub, visit_date, count(*) AS pings FROM rgersxdatabricks_hackathon.hub_pulse.silver_visits WHERE visit_hour BETWEEN 0 AND 4 GROUP BY ALL
)
SELECT d.hub, CAST(d.visit_date AS STRING) AS night_date, d.day_type, coalesce(n.pings, 0) AS pings_00_05
FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_daily d LEFT JOIN n USING (hub, visit_date)
ORDER BY d.hub, d.visit_date
```

### route_stress.json
```sql
-- route_stress
SELECT * FROM rgersxdatabricks_hackathon.hub_pulse.gold_route_stress
ORDER BY hub, pct_trips_overcrowded DESC NULLS LAST, line
```

### timerange_stress.json
```sql
-- timerange_stress
SELECT * FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_timerange_stress
ORDER BY hub, day_type, season, tspr_hour_range
```

### peakload.json
```sql
-- peakload
SELECT p.SeasonYear AS season_year, CAST(p.Lineno_renamed AS STRING) AS tspr_line, p.direction_updated AS direction,
  p.DayType AS day_type, p.Season AS season, p.HourRange AS hour_range,
  CASE p.HourRange WHEN 4 THEN '04-06 Early' WHEN 6 THEN '06-09 AM peak' WHEN 9 THEN '09-15 Midday' WHEN 15 THEN '15-18 PM peak'
    WHEN 18 THEN '18-21 Evening' WHEN 21 THEN '21-24 Late evening' ELSE '00-04 Night' END AS time_period,
  round(try_cast(p.Average_Peak_Passenger_Load AS DOUBLE), 1) AS peak_passenger_load,
  round(try_cast(p.Average_Peak_Load_Factor AS DOUBLE), 1) AS peak_load_factor
FROM rgersxdatabricks_hackathon.hub_pulse.tspr_bus_peakload p
WHERE p.SeasonYear = 2025
  AND CAST(p.Lineno_renamed AS STRING) IN (SELECT DISTINCT tspr_line FROM rgersxdatabricks_hackathon.hub_pulse.silver_hub_departures WHERE tspr_line IS NOT NULL)
ORDER BY tspr_line, day_type, season, hour_range, direction
```

### routes.json
Four queries:

1. The route list.
2. Trips per hub.
3. Which hubs each route calls at.
4. The representative trip's stops. Python builds the shape and the stops list from this query.

```sql
-- routes_meta
WITH hub_routes AS (
  SELECT DISTINCT t.route_id FROM rgersxdatabricks_hackathon.hub_pulse.silver_hub_departures d JOIN rgersxdatabricks_hackathon.hub_pulse.gtfs_trips t ON t.trip_id = d.trip_id
),
hub_stop_trips AS (
  SELECT DISTINCT st.trip_id FROM rgersxdatabricks_hackathon.hub_pulse.gtfs_stop_times st JOIN rgersxdatabricks_hackathon.hub_pulse.silver_hub_stops hs ON hs.stop_id = st.stop_id
),
extra AS (
  SELECT l.route_id FROM rgersxdatabricks_hackathon.hub_pulse.silver_route_lookup l
  WHERE l.line_key IN ('25','14','R4','R2','250','257','99') OR l.mode = 'SeaBus'
     OR (l.line_key LIKE 'N%' AND l.route_id IN (SELECT t.route_id FROM rgersxdatabricks_hackathon.hub_pulse.gtfs_trips t JOIN hub_stop_trips h ON h.trip_id = t.trip_id))
),
sel AS (SELECT route_id FROM hub_routes UNION SELECT route_id FROM extra)
SELECT r.route_id, r.route_short_name, r.route_long_name, r.route_type, r.route_color, r.route_text_color,
  l.line_key, l.tspr_line, l.mode
FROM sel JOIN rgersxdatabricks_hackathon.hub_pulse.gtfs_routes r USING (route_id) JOIN rgersxdatabricks_hackathon.hub_pulse.silver_route_lookup l USING (route_id)
```
```sql
-- routes_hub_trips
SELECT t.route_id, d.hub, count(*) AS trips
FROM rgersxdatabricks_hackathon.hub_pulse.silver_hub_departures d JOIN rgersxdatabricks_hackathon.hub_pulse.gtfs_trips t ON t.trip_id = d.trip_id
GROUP BY ALL
```
```sql
-- routes_hub_calls
SELECT DISTINCT t.route_id, hs.hub
FROM rgersxdatabricks_hackathon.hub_pulse.gtfs_stop_times st
JOIN rgersxdatabricks_hackathon.hub_pulse.silver_hub_stops hs ON hs.stop_id = st.stop_id
JOIN rgersxdatabricks_hackathon.hub_pulse.gtfs_trips t ON t.trip_id = st.trip_id
```
```sql
-- routes_stops
WITH hub_routes AS (
  SELECT DISTINCT t.route_id FROM rgersxdatabricks_hackathon.hub_pulse.silver_hub_departures d JOIN rgersxdatabricks_hackathon.hub_pulse.gtfs_trips t ON t.trip_id = d.trip_id
),
hub_stop_trips AS (
  SELECT DISTINCT st.trip_id FROM rgersxdatabricks_hackathon.hub_pulse.gtfs_stop_times st JOIN rgersxdatabricks_hackathon.hub_pulse.silver_hub_stops hs ON hs.stop_id = st.stop_id
),
extra AS (
  SELECT l.route_id FROM rgersxdatabricks_hackathon.hub_pulse.silver_route_lookup l
  WHERE l.line_key IN ('25','14','R4','R2','250','257','99') OR l.mode = 'SeaBus'
     OR (l.line_key LIKE 'N%' AND l.route_id IN (SELECT t.route_id FROM rgersxdatabricks_hackathon.hub_pulse.gtfs_trips t JOIN hub_stop_trips h ON h.trip_id = t.trip_id))
),
sel AS (SELECT route_id FROM hub_routes UNION SELECT route_id FROM extra),
cand AS (
  SELECT t.route_id, t.trip_id, t.direction_id, t.shape_id, CAST(h.trip_id IS NOT NULL AS INT) AS at_hub
  FROM rgersxdatabricks_hackathon.hub_pulse.gtfs_trips t JOIN sel USING (route_id) LEFT JOIN hub_stop_trips h ON h.trip_id = t.trip_id
),
cand2 AS (
  SELECT * FROM (SELECT *, max(at_hub) OVER (PARTITION BY route_id) AS any_hub FROM cand) WHERE at_hub = any_hub
),
shp AS (SELECT route_id, direction_id, shape_id, count(*) AS n_trips FROM cand2 GROUP BY ALL),
best_shp AS (
  SELECT * FROM (SELECT *, row_number() OVER (PARTITION BY route_id ORDER BY n_trips DESC, direction_id, shape_id) AS rn FROM shp)
  WHERE rn = 1
),
trip_len AS (
  SELECT c.route_id, c.trip_id, count(*) AS n_stops
  FROM cand2 c
  JOIN best_shp b ON b.route_id = c.route_id AND b.direction_id = c.direction_id AND b.shape_id = c.shape_id
  JOIN rgersxdatabricks_hackathon.hub_pulse.gtfs_stop_times st ON st.trip_id = c.trip_id
  GROUP BY ALL
),
rep AS (
  SELECT * FROM (SELECT *, row_number() OVER (PARTITION BY route_id ORDER BY n_stops DESC, trip_id) AS rn FROM trip_len)
  WHERE rn = 1
),
hubstops AS (SELECT stop_id, array_join(sort_array(collect_set(hub)), ',') AS hubs FROM rgersxdatabricks_hackathon.hub_pulse.silver_hub_stops GROUP BY 1)
SELECT rep.route_id, CAST(rep.trip_id AS STRING) AS trip_id, b.direction_id, b.shape_id, b.n_trips AS shape_trips, rep.n_stops,
  st.stop_sequence, st.stop_id, s.stop_name, s.stop_lat, s.stop_lon, hs.hubs AS in_hub
FROM rep
JOIN best_shp b ON b.route_id = rep.route_id
JOIN rgersxdatabricks_hackathon.hub_pulse.gtfs_stop_times st ON st.trip_id = rep.trip_id
JOIN rgersxdatabricks_hackathon.hub_pulse.gtfs_stops s ON s.stop_id = st.stop_id
LEFT JOIN hubstops hs ON hs.stop_id = st.stop_id
ORDER BY rep.route_id, st.stop_sequence
```

### late_night_lines.json
```sql
-- late_night_lines
SELECT d.hub, d.day_type, d.dep_hour AS hour, t.route_id, d.line_key, count(*) AS departures
FROM rgersxdatabricks_hackathon.hub_pulse.silver_hub_departures d JOIN rgersxdatabricks_hackathon.hub_pulse.gtfs_trips t ON t.trip_id = d.trip_id
WHERE d.dep_hour BETWEEN 0 AND 4
GROUP BY ALL
ORDER BY d.hub, d.day_type, hour, departures DESC, d.line_key
```

### validation.json
```sql
-- validation
SELECT hour, avg_pings, skytrain_activity, pings_pct, skytrain_pct
FROM rgersxdatabricks_hackathon.hub_pulse.gold_waterfront_validation ORDER BY hour
```
```sql
-- validation_r
WITH v AS (SELECT hour, pings_pct, skytrain_pct FROM rgersxdatabricks_hackathon.hub_pulse.gold_waterfront_validation)
SELECT
  (SELECT corr(pings_pct, skytrain_pct) FROM v) AS r,
  (SELECT corr(p.pings_pct, s.skytrain_pct) FROM v p JOIN v s ON s.hour = (p.hour + 3) % 24) AS r_pings_plus3h,
  (SELECT corr(p.pings_pct, s.skytrain_pct) FROM v p JOIN v s ON s.hour = (p.hour + 21) % 24) AS r_pings_minus3h
```

### recommendations.json
```sql
-- recommendations
SELECT hub, category, priority, evidence, recommendation
FROM rgersxdatabricks_hackathon.hub_pulse.gold_recommendations ORDER BY hub, priority, category
```

### overview.json
This is `hub_pulse/app/hub-pulse/config/queries/hub_overview.sql`, run once per hub with `:hub` set to `'UBC'`, `'Waterfront Station'` or `'Park Royal Mall'`. The UBC version:
```sql
-- overview:UBC
-- Headline facts for one hub
-- @param hub STRING
WITH d AS (
  SELECT count(*) AS days, sum(pings) AS visits, avg(visitor_share) AS visitor_share, count_if(is_surge) AS surge_days,
    max_by(visit_date, surge_index) AS top_surge_date, max(surge_index) AS top_surge_index
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_daily WHERE hub = 'UBC'
),
o AS (
  SELECT sum(IF(access_type = 'Transfer required', share_of_local_pct, 0)) / 100 AS transfer_share
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_origin_access WHERE hub = 'UBC' AND share_of_local_pct IS NOT NULL
),
r AS (
  SELECT max_by(line || ' ' || route_name, pct_trips_overcrowded) AS worst_line, max(pct_trips_overcrowded) AS worst_line_overcrowded_pct
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_route_stress WHERE hub = 'UBC'
),
p AS (
  SELECT max_by(most_crowded_line || ' · ' || time_period, max_peak_load_factor) AS peak_load_where, max(max_peak_load_factor) AS peak_load_pct
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_timerange_stress WHERE hub = 'UBC' AND day_type = 'MF' AND season = 'Fall'
)
SELECT
  CAST(d.days AS INT) AS days,
  CAST(d.visits AS BIGINT) AS visits,
  CAST(round(d.visitor_share, 4) AS DOUBLE) AS visitor_share,
  CAST(d.surge_days AS INT) AS surge_days,
  CAST(d.top_surge_date AS STRING) AS top_surge_date,
  CAST(round(d.top_surge_index, 2) AS DOUBLE) AS top_surge_index,
  CAST(round(o.transfer_share, 4) AS DOUBLE) AS transfer_share,
  coalesce(r.worst_line, '') AS worst_line,
  CAST(coalesce(r.worst_line_overcrowded_pct, 0) AS DOUBLE) AS worst_line_overcrowded_pct,
  coalesce(p.peak_load_where, '') AS peak_load_where,
  CAST(coalesce(p.peak_load_pct, 0) AS DOUBLE) AS peak_load_pct
FROM d CROSS JOIN o CROSS JOIN r CROSS JOIN p
```

## Refreshing

The pull script isn't in the repo; it was kept in a scratchpad. To refresh the data:

1. Re-run the SQL above against the same warehouse with `--profile DEFAULT`.
2. Apply the mappings in the Conventions section.
