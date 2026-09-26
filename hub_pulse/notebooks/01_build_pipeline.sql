-- Databricks notebook source
-- MAGIC %md
-- MAGIC # Hub Pulse — 01 Build pipeline
-- MAGIC **Problem:** TransLink's schedule is built around commuter peaks, but demand at Vancouver's hubs (UBC, Waterfront, Park Royal) peaks midday, overnight at UBC, and on event/exam days — while the lines serving them (99 B-Line, R4, 49, R5, 257) are already overcrowded.
-- MAGIC
-- MAGIC This notebook rebuilds every table in `rgersxdatabricks_hackathon.hub_pulse` end to end. **Attach it to a SQL warehouse** (e.g. Serverless Starter Warehouse) — `ai_forecast()` requires one.
-- MAGIC
-- MAGIC | Source | What | Where |
-- MAGIC |---|---|---|
-- MAGIC | Hackathon | 21.5M synthetic device visit pings (origin, dwell, time) | `ubc_rogersxdatabricks_hackathon.synthetic_data_ubc` |
-- MAGIC | TransLink GTFS | Every scheduled trip & stop, fall 2026 | gtfs-static.translink.ca |
-- MAGIC | TransLink TSPR 2025 | Route overcrowding, peak loads, bunching; SkyTrain/SeaBus hourly | translink.ca → Managing the Transit Network |
-- MAGIC
-- MAGIC **Data note:** source timestamps carry a `Z` suffix but behave as local wall-clock time; read that way, Waterfront's hourly profile correlates r = 0.92 with real SkyTrain ridership (see notebook 02).

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 1. Bronze: raw open data
-- MAGIC Load TransLink GTFS (fall 2026 schedule) and the 2025 Transit Service Performance Review (TSPR) CSVs from the Unity Catalog volume `/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw`. The hackathon visit pings are already in `rgersxdatabricks_hackathon.ubc_rogersxdatabricks_hackathon.synthetic_data_ubc` (all three hubs).

-- COMMAND ----------

-- SETUP: schema and volumes (raw files are uploaded to the raw volume with `databricks fs cp`; see HANDOFF.md)
CREATE SCHEMA IF NOT EXISTS rgersxdatabricks_hackathon.hub_pulse
COMMENT 'Hub Pulse: transit demand vs service gaps at Vancouver hubs'

-- COMMAND ----------

CREATE VOLUME IF NOT EXISTS rgersxdatabricks_hackathon.hub_pulse.raw
COMMENT 'Hub Pulse landing zone: TransLink GTFS static feed (fall 2026, .txt files + original zip) and TransLink 2025 Transit Service Performance Review open-data CSVs + Transit Service Guidelines PDF'

-- COMMAND ----------

CREATE VOLUME IF NOT EXISTS rgersxdatabricks_hackathon.hub_pulse.code
COMMENT 'Hub Pulse source code snapshot: SQL pipeline, notebooks, dashboard/Genie builders, AppKit app, pitch deck, analysis scripts, HANDOFF.md'

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_stops
COMMENT 'TransLink GTFS static feed (fall 2026): stops and stations with coordinates. Source: gtfs-static.translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/gtfs/stops.txt', format => 'csv', header => true, inferSchema => true)

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_routes
COMMENT 'TransLink GTFS static feed (fall 2026): routes (bus, SkyTrain, SeaBus, West Coast Express). Source: gtfs-static.translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/gtfs/routes.txt', format => 'csv', header => true, inferSchema => true)

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_trips
COMMENT 'TransLink GTFS static feed (fall 2026): scheduled trips with route and service_id. Source: gtfs-static.translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/gtfs/trips.txt', format => 'csv', header => true, inferSchema => true)

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_calendar
COMMENT 'TransLink GTFS static feed (fall 2026): weekly service calendars. Source: gtfs-static.translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/gtfs/calendar.txt', format => 'csv', header => true, inferSchema => true)

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_stop_times
COMMENT 'TransLink GTFS static feed (fall 2026): arrival/departure time of every trip at every stop (stop_id is STRING). Source: gtfs-static.translink.ca' AS
SELECT trip_id, trim(arrival_time) AS arrival_time, trim(departure_time) AS departure_time, stop_id, stop_sequence
FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/gtfs/stop_times.txt', format => 'csv', header => true, schema => 'trip_id BIGINT, arrival_time STRING, departure_time STRING, stop_id STRING, stop_sequence INT, stop_headsign STRING, pickup_type INT, drop_off_type INT, shape_dist_traveled DOUBLE, timepoint INT')

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_bus_route_year
COMMENT 'TransLink 2025 Transit Service Performance Review: annual bus metrics per line (boardings, overcrowding, peak load, bunching, on-time). Source: translink.ca Managing the Transit Network' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/tspr/tspr2025_bus_yearline.csv', format => 'csv', header => true, inferSchema => true, encoding => 'UTF-8')

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_bus_route_timerange
COMMENT 'TransLink 2025 TSPR: bus service and productivity per line, day type, season and time range. Source: translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/tspr/tspr2025_bus_yearlinedaytypeseasontimerange.csv', format => 'csv', header => true, inferSchema => true)

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_bus_peakload
COMMENT 'TransLink 2025 TSPR: average peak passenger load and load factor per line, day type, season, time range and direction. Numeric columns may hold the string NULL; use try_cast. Source: translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/tspr/tspr2025_bus_peakload_yearlinedaytypeseasontimerangedirection.csv', format => 'csv', header => true, inferSchema => true)

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_seabus_hourly
COMMENT 'TransLink 2025 TSPR: SeaBus hourly capacity, volume and peak load by day type, season and direction. Source: translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/tspr/tspr2025_seabus_capvolpkload_yeardaytypeseasonhourlydirection.csv', format => 'csv', header => true, inferSchema => true)

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_skytrain_station_hourly
COMMENT 'TransLink 2025 TSPR: average daily boardings and alightings per SkyTrain station, day type and hour. Source: translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/tspr/tspr2025_skytrainavgalightsbrdgs_yearstationdaytypehourly.csv', format => 'csv', header => true, inferSchema => true)

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_wce_station_hourly
COMMENT 'TransLink 2025 TSPR: West Coast Express average daily boardings and alightings per station, day type and hour. Source: translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/tspr/tspr2025_wce_yearstationdaytypehourly.csv', format => 'csv', header => true, inferSchema => true)

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_skytrain_station_year
COMMENT 'TransLink 2025 TSPR: annual and average daily boardings per SkyTrain station. Source: translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/tspr/tspr2025_skytrain_yearstation.csv', format => 'csv', header => true, inferSchema => true)

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_calendar_dates
COMMENT 'TransLink GTFS static feed (fall 2026): service added (1) or removed (2) on specific dates, e.g. West Coast Express. Source: gtfs-static.translink.ca' AS
SELECT * FROM read_files('/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/gtfs/calendar_dates.txt', format => 'csv', header => true, inferSchema => true)

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 2. Silver: conformed tables
-- MAGIC Hubs, visits (typed + day type + TSPR season/period), stops inside each hub catchment, GTFS→TSPR route lookup, scheduled departures per hub resolved on representative Wed/Sat/Sun dates, and hand-geocoded origin centroids.

-- COMMAND ----------

-- SILVER: cleaned, conformed tables

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.dim_hub
COMMENT 'The three study hubs with the stop catchment radius used to match TransLink GTFS stops' AS
SELECT * FROM VALUES
  ('UBC', 'UBC', 49.2606D, -123.246D, 800, 'University campus + UBC Exchange (largest bus-only exchange in the region; no rapid transit yet)'),
  ('Waterfront Station', 'WF', 49.2857D, -123.1115D, 300, 'Multimodal hub: Expo + Canada Line SkyTrain, SeaBus, West Coast Express, downtown buses'),
  ('Park Royal Mall', 'PR', 49.3265D, -123.138D, 300, 'North Shore retail hub and bus exchange at the Lions Gate Bridge')
AS h(hub, hub_code, lat, lon, catchment_m, description)

-- COMMAND ----------

-- Synthetic timestamps carry a Z suffix but behave like local wall-clock time
-- (overnight trough, midday peak), so they are used as-is and NOT shifted to America/Vancouver.
CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.silver_visits
COMMENT 'Device visit pings at the three hubs. ts_local = source timestamp treated as local time. dwell_min = dwell_time (minutes).' AS
WITH v AS (
  SELECT location_name AS hub, CAST(timestamp AS TIMESTAMP_NTZ) AS ts_local, origin, dwell_time AS dwell_min
  FROM rgersxdatabricks_hackathon.ubc_rogersxdatabricks_hackathon.synthetic_data_ubc
  WHERE timestamp >= '2025-11-01'
),
hol AS (SELECT explode(array(DATE'2025-11-11', DATE'2025-12-25', DATE'2025-12-26', DATE'2026-01-01', DATE'2026-02-16',
                             DATE'2026-04-03', DATE'2026-04-06', DATE'2026-05-18', DATE'2026-07-01', DATE'2026-08-03')) AS d)
SELECT v.*,
  to_date(ts_local) AS visit_date,
  hour(ts_local) AS visit_hour,
  CASE WHEN to_date(ts_local) IN (SELECT d FROM hol) OR dayofweek(ts_local) = 1 THEN 'Sun/Hol'
       WHEN dayofweek(ts_local) = 7 THEN 'Sat' ELSE 'MF' END AS day_type,
  CASE WHEN month(ts_local) BETWEEN 6 AND 8 THEN 'Summer' ELSE 'Fall' END AS tspr_season,
  CASE WHEN hour(ts_local) BETWEEN 4 AND 5 THEN 4 WHEN hour(ts_local) BETWEEN 6 AND 8 THEN 6
       WHEN hour(ts_local) BETWEEN 9 AND 14 THEN 9 WHEN hour(ts_local) BETWEEN 15 AND 17 THEN 15
       WHEN hour(ts_local) BETWEEN 18 AND 20 THEN 18 WHEN hour(ts_local) BETWEEN 21 AND 23 THEN 21 ELSE 24 END AS tspr_hour_range
FROM v

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.silver_hub_stops
COMMENT 'TransLink GTFS stops inside each hub catchment' AS
SELECT h.hub, s.stop_id, s.stop_name, s.stop_lat, s.stop_lon,
  round(6371000*2*asin(sqrt(pow(sin(radians(s.stop_lat-h.lat)/2),2)+cos(radians(h.lat))*cos(radians(s.stop_lat))*pow(sin(radians(s.stop_lon-h.lon)/2),2)))) AS dist_m
FROM rgersxdatabricks_hackathon.hub_pulse.gtfs_stops s
CROSS JOIN rgersxdatabricks_hackathon.hub_pulse.dim_hub h
WHERE 6371000*2*asin(sqrt(pow(sin(radians(s.stop_lat-h.lat)/2),2)+cos(radians(h.lat))*cos(radians(s.stop_lat))*pow(sin(radians(s.stop_lon-h.lon)/2),2))) <= h.catchment_m

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.silver_route_lookup
COMMENT 'GTFS route -> TSPR line key (TSPR combines some lines, e.g. 005/006)' AS
WITH t AS (
  SELECT DISTINCT CAST(Lineno_renamed AS STRING) AS tspr_line, TRIM(LEADING '0' FROM part) AS line_key
  FROM rgersxdatabricks_hackathon.hub_pulse.tspr_bus_route_year
  LATERAL VIEW explode(split(CAST(Lineno_renamed AS STRING), '/')) x AS part
)
SELECT r.route_id, r.route_short_name, r.route_long_name, r.route_type,
  CASE r.route_type WHEN 3 THEN 'Bus' WHEN 1 THEN 'SkyTrain' WHEN 4 THEN 'SeaBus' WHEN 2 THEN 'West Coast Express' ELSE 'Other' END AS mode,
  coalesce(nullif(TRIM(LEADING '0' FROM r.route_short_name), ''), r.route_long_name) AS line_key,
  t.tspr_line
FROM rgersxdatabricks_hackathon.hub_pulse.gtfs_routes r
LEFT JOIN t ON t.line_key = TRIM(LEADING '0' FROM r.route_short_name)

-- COMMAND ----------

-- Scheduled departures (fall 2026 GTFS) from each hub, one row per trip per hub
CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.silver_hub_departures
COMMENT 'Fall 2026 scheduled trips calling at each hub (first call inside catchment). Day types resolved on representative dates: Wed 2026-10-14 (MF), Sat 2026-10-17, Sun 2026-10-18.' AS
WITH rep AS (SELECT * FROM VALUES (DATE'2026-10-14', 'MF'), (DATE'2026-10-17', 'Sat'), (DATE'2026-10-18', 'Sun/Hol') AS r(d, day_type)),
cal_dates AS (SELECT service_id, to_date(CAST(date AS STRING), 'yyyyMMdd') AS d, exception_type FROM rgersxdatabricks_hackathon.hub_pulse.gtfs_calendar_dates),
svc AS (
  SELECT c.service_id, rep.day_type
  FROM rgersxdatabricks_hackathon.hub_pulse.gtfs_calendar c CROSS JOIN rep
  WHERE rep.d BETWEEN to_date(CAST(c.start_date AS STRING), 'yyyyMMdd') AND to_date(CAST(c.end_date AS STRING), 'yyyyMMdd')
    AND CASE dayofweek(rep.d) WHEN 4 THEN c.wednesday WHEN 7 THEN c.saturday WHEN 1 THEN c.sunday END = 1
    AND NOT EXISTS (SELECT 1 FROM cal_dates x WHERE x.service_id = c.service_id AND x.d = rep.d AND x.exception_type = 2)
  UNION
  SELECT x.service_id, rep.day_type FROM cal_dates x JOIN rep ON x.d = rep.d WHERE x.exception_type = 1
),
calls AS (
  SELECT hs.hub, st.trip_id, min(st.departure_time) AS dep_time
  FROM rgersxdatabricks_hackathon.hub_pulse.gtfs_stop_times st
  JOIN rgersxdatabricks_hackathon.hub_pulse.silver_hub_stops hs ON CAST(hs.stop_id AS STRING) = st.stop_id
  GROUP BY hs.hub, st.trip_id
)
SELECT c.hub, c.trip_id, svc.day_type, rl.route_short_name, rl.line_key, rl.tspr_line, rl.mode, rl.route_long_name,
  CAST(split(c.dep_time, ':')[0] AS INT) % 24 AS dep_hour
FROM calls c
JOIN rgersxdatabricks_hackathon.hub_pulse.gtfs_trips t ON t.trip_id = c.trip_id
JOIN svc ON svc.service_id = t.service_id
JOIN rgersxdatabricks_hackathon.hub_pulse.silver_route_lookup rl ON rl.route_id = t.route_id

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.dim_origin
COMMENT 'Approximate centroids of visitor origin areas (hand-geocoded). Out-of-region origins have no centroid.' AS
SELECT * FROM VALUES
  ('Surrey', 49.1897D, -122.8480D, 'Metro Vancouver'), ('Oakridge', 49.2330D, -123.1170D, 'City of Vancouver'),
  ('West End', 49.2850D, -123.1350D, 'City of Vancouver'), ('Langley', 49.1044D, -122.6600D, 'Metro Vancouver'),
  ('New Westminster', 49.2057D, -122.9110D, 'Metro Vancouver'), ('Dunbar-Southlands', 49.2400D, -123.1850D, 'City of Vancouver'),
  ('Port Moody', 49.2830D, -122.8310D, 'Metro Vancouver'), ('North Vancouver', 49.3200D, -123.0724D, 'North Shore'),
  ('Burnaby', 49.2267D, -123.0036D, 'Metro Vancouver'), ('Victoria-Fraserview', 49.2180D, -123.0650D, 'City of Vancouver'),
  ('UBC', 49.2606D, -123.2460D, 'City of Vancouver'), ('Richmond', 49.1680D, -123.1365D, 'Metro Vancouver'),
  ('Marpole', 49.2100D, -123.1300D, 'City of Vancouver'), ('Pitt Meadows', 49.2210D, -122.6890D, 'Metro Vancouver'),
  ('Downtown', 49.2820D, -123.1180D, 'City of Vancouver'), ('West Vancouver', 49.3286D, -123.1561D, 'North Shore'),
  ('Kitsilano', 49.2680D, -123.1650D, 'City of Vancouver'), ('Killarney', 49.2170D, -123.0400D, 'City of Vancouver'),
  ('Grandview-Woodland', 49.2750D, -123.0670D, 'City of Vancouver'), ('Sunset', 49.2190D, -123.0900D, 'City of Vancouver'),
  ('Renfrew-Collingwood', 49.2480D, -123.0400D, 'City of Vancouver'), ('Mount Pleasant', 49.2630D, -123.1000D, 'City of Vancouver'),
  ('Kensington-Cedar Cottage', 49.2480D, -123.0730D, 'City of Vancouver'), ('Hastings-Sunrise', 49.2780D, -123.0400D, 'City of Vancouver'),
  ('Fairview', 49.2640D, -123.1300D, 'City of Vancouver'), ('Strathcona', 49.2770D, -123.0880D, 'City of Vancouver'),
  ('Delta', 49.1580D, -122.9080D, 'Metro Vancouver'), ('Maple Ridge', 49.2190D, -122.6010D, 'Metro Vancouver'),
  ('Arbutus Ridge', 49.2500D, -123.1600D, 'City of Vancouver'),
  ('British Columbia Other', NULL, NULL, 'Rest of BC'), ('Ontario', NULL, NULL, 'Out of province'),
  ('Alberta', NULL, NULL, 'Out of province'), ('Manitoba', NULL, NULL, 'Out of province'),
  ('Saskatchewan and Territories', NULL, NULL, 'Out of province'), ('Atlantic Canada', NULL, NULL, 'Out of province'),
  ('International', NULL, NULL, 'International')
AS o(origin, lat, lon, region)

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 3. Gold: analysis tables
-- MAGIC Daily surges, hourly demand profiles, hourly service supply, the demand/service **gap index**, route crowding (TSPR 2025), crowding by time period, one-seat-ride access by origin, and two validation/benchmark tables.

-- COMMAND ----------

-- GOLD: analysis-ready tables for the dashboard, Genie space and app

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_hub_daily
COMMENT 'Daily visit pings per hub. surge_index = pings / average of the same weekday in the surrounding 9 weeks. surge_index >= 1.25 marks a surge day.' AS
WITH d AS (
  SELECT hub, visit_date, day_type, dayofweek(visit_date) AS dow, date_format(visit_date, 'EEEE') AS weekday,
    count(*) AS pings, round(avg(dwell_min), 1) AS avg_dwell_min,
    round(avg(IF(origin IN ('Ontario','Alberta','Manitoba','Saskatchewan and Territories','Atlantic Canada','International','British Columbia Other'), 1, 0)), 3) AS visitor_share
  FROM rgersxdatabricks_hackathon.hub_pulse.silver_visits GROUP BY ALL
)
SELECT *, round(pings / avg(pings) OVER (PARTITION BY hub, dow ORDER BY visit_date ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING), 3) AS surge_index,
  pings / avg(pings) OVER (PARTITION BY hub, dow ORDER BY visit_date ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING) >= 1.25 AS is_surge
FROM d

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_hub_profile_hourly
COMMENT 'Typical-day demand profile: average pings per hour by hub, day type and season' AS
WITH days AS (SELECT hub, day_type, tspr_season, count(DISTINCT visit_date) AS n_days FROM rgersxdatabricks_hackathon.hub_pulse.silver_visits GROUP BY ALL)
SELECT v.hub, v.day_type, v.tspr_season AS season, v.visit_hour AS hour,
  round(count(*) / max(d.n_days), 1) AS avg_pings, round(avg(v.dwell_min), 1) AS avg_dwell_min
FROM rgersxdatabricks_hackathon.hub_pulse.silver_visits v JOIN days d USING (hub, day_type, tspr_season)
GROUP BY ALL

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_hub_supply_hourly
COMMENT 'Scheduled transit departures per hour at each hub (TransLink GTFS, fall 2026 schedule)' AS
WITH hrs AS (SELECT h.hub, dt.day_type, x.hour FROM rgersxdatabricks_hackathon.hub_pulse.dim_hub h
  CROSS JOIN (SELECT explode(array('MF','Sat','Sun/Hol')) AS day_type) dt
  CROSS JOIN (SELECT explode(sequence(0,23)) AS hour) x)
SELECT hrs.hub, hrs.day_type, hrs.hour,
  count(d.trip_id) AS departures,
  count_if(d.mode = 'Bus') AS bus_departures,
  count_if(d.mode = 'SkyTrain') AS skytrain_departures,
  count_if(d.mode = 'SeaBus') AS seabus_departures,
  count(DISTINCT d.line_key) AS lines_running
FROM hrs LEFT JOIN rgersxdatabricks_hackathon.hub_pulse.silver_hub_departures d
  ON d.hub = hrs.hub AND d.day_type = hrs.day_type AND d.dep_hour = hrs.hour
GROUP BY ALL

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_hub_gap_hourly
COMMENT 'Demand vs service mismatch per hub/day type/hour (fall season). gap_index = share of daily demand in the hour / share of daily departures in the hour. gap_index > 1.5 = underserved hour; < 0.67 = overserved.' AS
WITH dem AS (
  SELECT hub, day_type, hour, avg_pings, avg_dwell_min, avg_pings / sum(avg_pings) OVER (PARTITION BY hub, day_type) AS demand_share
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_profile_hourly WHERE season = 'Fall'
),
sup AS (
  SELECT *, departures / sum(departures) OVER (PARTITION BY hub, day_type) AS supply_share
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_supply_hourly
)
SELECT dem.hub, dem.day_type, dem.hour, dem.avg_pings, dem.avg_dwell_min,
  sup.departures, sup.bus_departures, sup.skytrain_departures, sup.seabus_departures, sup.lines_running,
  round(dem.demand_share * 100, 2) AS demand_pct, round(sup.supply_share * 100, 2) AS supply_pct,
  round(dem.demand_share / nullif(sup.supply_share, 0), 2) AS gap_index,
  round(dem.avg_pings / nullif(sup.departures, 0), 1) AS pings_per_departure,
  -- departures needed in this hour for demand share to equal supply share, holding the daily total fixed
  greatest(0, round(dem.demand_share * sum(sup.departures) OVER (PARTITION BY dem.hub, dem.day_type) - sup.departures)) AS departures_short,
  CASE WHEN sup.departures = 0 AND dem.demand_share > 0.01 THEN 'No service'
       WHEN dem.demand_share / nullif(sup.supply_share, 0) > 1.5 THEN 'Underserved'
       WHEN dem.demand_share / nullif(sup.supply_share, 0) < 0.67 THEN 'Overserved'
       ELSE 'Balanced' END AS status
FROM dem JOIN sup USING (hub, day_type, hour)

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_route_stress
COMMENT 'TransLink 2025 TSPR performance for every bus line serving each hub: overcrowding, peak load factor, bunching, on-time' AS
WITH lines AS (
  SELECT hub, line_key, tspr_line, first(route_long_name) AS route_name, count(*) AS weekly_trips_at_hub
  FROM rgersxdatabricks_hackathon.hub_pulse.silver_hub_departures WHERE mode = 'Bus' GROUP BY ALL
)
SELECT l.hub, l.line_key AS line, l.route_name, l.weekly_trips_at_hub,
  round(y.AVG_Daily_Boardings_MF) AS avg_weekday_boardings,
  round(y.Perc_Trips_w_Overcrowding, 1) AS pct_trips_overcrowded,
  round(y.Revenue_Hrs_w_Overcrowding) AS revenue_hrs_overcrowded,
  round(y.Average_Peak_Load_Factor, 1) AS avg_peak_load_factor,
  round(y.Bus_Bunching_Percentage, 1) AS pct_bunching,
  round(y.On_Time_Performance_Percentage, 1) AS pct_on_time,
  round(y.AVG_speed_km_per_hr, 1) AS avg_speed_kmh
FROM lines l
JOIN rgersxdatabricks_hackathon.hub_pulse.tspr_bus_route_year y
  ON CAST(y.Lineno_renamed AS STRING) = l.tspr_line AND y.CalendarYear = 2025

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_hub_timerange_stress
COMMENT 'Joins hub demand to real 2025 TSPR bus crowding by day type, season and TSPR time period. max_peak_load_factor >= 100 means buses at capacity.' AS
WITH dem AS (
  SELECT hub, day_type, tspr_season AS season, tspr_hour_range, count(*) AS pings
  FROM rgersxdatabricks_hackathon.hub_pulse.silver_visits GROUP BY ALL
),
dem2 AS (SELECT *, round(100 * pings / sum(pings) OVER (PARTITION BY hub, day_type, season), 2) AS demand_pct FROM dem),
lines AS (SELECT DISTINCT hub, tspr_line FROM rgersxdatabricks_hackathon.hub_pulse.silver_hub_departures WHERE mode = 'Bus' AND tspr_line IS NOT NULL),
pl AS (
  SELECT l.hub, p.DayType AS day_type, p.Season AS season, p.HourRange AS tspr_hour_range,
    round(avg(try_cast(p.Average_Peak_Load_Factor AS DOUBLE)), 1) AS avg_peak_load_factor,
    round(max(try_cast(p.Average_Peak_Load_Factor AS DOUBLE)), 1) AS max_peak_load_factor,
    max_by(CAST(p.Lineno_renamed AS STRING) || ' ' || p.direction_updated, try_cast(p.Average_Peak_Load_Factor AS DOUBLE)) AS most_crowded_line
  FROM lines l JOIN rgersxdatabricks_hackathon.hub_pulse.tspr_bus_peakload p
    ON CAST(p.Lineno_renamed AS STRING) = l.tspr_line AND p.SeasonYear = 2025
  GROUP BY ALL
)
SELECT d.*,
  CASE d.tspr_hour_range WHEN 4 THEN '04-06 Early' WHEN 6 THEN '06-09 AM peak' WHEN 9 THEN '09-15 Midday' WHEN 15 THEN '15-18 PM peak'
    WHEN 18 THEN '18-21 Evening' WHEN 21 THEN '21-24 Late evening' ELSE '00-04 Night' END AS time_period,
  pl.avg_peak_load_factor, pl.max_peak_load_factor, pl.most_crowded_line
FROM dem2 d LEFT JOIN pl USING (hub, day_type, season, tspr_hour_range)

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_origin_access
COMMENT 'Where hub visitors come from and whether a one-seat (no-transfer) transit ride exists: a line serving the hub that also stops within 1 km (bus) or 2 km (SkyTrain/SeaBus/WCE station) of the origin centroid' AS
WITH line_stops AS (
  SELECT DISTINCT rl.line_key, rl.mode, st.stop_id
  FROM rgersxdatabricks_hackathon.hub_pulse.gtfs_stop_times st
  JOIN rgersxdatabricks_hackathon.hub_pulse.gtfs_trips t ON t.trip_id = st.trip_id
  JOIN rgersxdatabricks_hackathon.hub_pulse.silver_route_lookup rl ON rl.route_id = t.route_id
  WHERE rl.line_key NOT LIKE 'N%'
),
origin_stops AS (
  SELECT o.origin, CAST(s.stop_id AS STRING) AS stop_id,
    6371000*2*asin(sqrt(pow(sin(radians(s.stop_lat-o.lat)/2),2)+cos(radians(o.lat))*cos(radians(s.stop_lat))*pow(sin(radians(s.stop_lon-o.lon)/2),2))) AS m
  FROM rgersxdatabricks_hackathon.hub_pulse.dim_origin o
  JOIN rgersxdatabricks_hackathon.hub_pulse.gtfs_stops s
    ON o.lat IS NOT NULL AND abs(s.stop_lat - o.lat) < 0.02 AND abs(s.stop_lon - o.lon) < 0.03
),
origin_lines AS (
  SELECT DISTINCT os.origin, ls.line_key
  FROM origin_stops os JOIN line_stops ls ON ls.stop_id = os.stop_id
  WHERE os.m <= IF(ls.mode = 'Bus', 1000, 2000)
),
hub_lines AS (SELECT DISTINCT hub, line_key FROM rgersxdatabricks_hackathon.hub_pulse.silver_hub_departures WHERE line_key NOT LIKE 'N%'),
direct AS (
  SELECT hl.hub, ol.origin, array_join(sort_array(collect_set(hl.line_key)), ', ') AS direct_lines, count(DISTINCT hl.line_key) AS n_direct_lines
  FROM hub_lines hl JOIN origin_lines ol ON ol.line_key = hl.line_key GROUP BY ALL
),
dem AS (
  SELECT hub, origin, count(*) AS pings, round(avg(dwell_min), 1) AS avg_dwell_min
  FROM rgersxdatabricks_hackathon.hub_pulse.silver_visits GROUP BY ALL
)
SELECT dem.hub, dem.origin, o.region, o.lat, o.lon, dem.pings,
  round(100 * dem.pings / sum(dem.pings) OVER (PARTITION BY dem.hub), 2) AS share_pct,
  IF(o.lat IS NOT NULL AND dem.origin <> dem.hub,
     round(100 * dem.pings / sum(IF(o.lat IS NOT NULL AND dem.origin <> dem.hub, dem.pings, 0)) OVER (PARTITION BY dem.hub), 2), NULL) AS share_of_local_pct,
  dem.avg_dwell_min,
  coalesce(d.n_direct_lines, 0) AS n_direct_lines, d.direct_lines,
  CASE WHEN o.lat IS NULL THEN 'Visitor (out of region)'
       WHEN dem.origin = dem.hub THEN 'Local (same area)'
       WHEN coalesce(d.n_direct_lines, 0) = 0 THEN 'Transfer required'
       ELSE 'One-seat ride' END AS access_type
FROM dem JOIN rgersxdatabricks_hackathon.hub_pulse.dim_origin o USING (origin)
LEFT JOIN direct d ON d.hub = dem.hub AND d.origin = dem.origin

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_waterfront_validation
COMMENT 'Validation: Waterfront weekday ping profile vs real TransLink 2025 SkyTrain boardings+alightings at Waterfront Station' AS
WITH sky AS (
  SELECT (hour(to_timestamp(split(Hour, ' to ')[1], 'h:mm a')) + 23) % 24 AS hour,
    sum(Average_Daily_Station_Boardings + Average_Daily_Station_Alightings) AS skytrain_activity
  FROM rgersxdatabricks_hackathon.hub_pulse.tspr_skytrain_station_hourly
  WHERE StationName = 'Waterfront Station' AND CalendarYear = 2025 AND DayType = 'MF'
  GROUP BY 1
),
p AS (SELECT hour, avg(avg_pings) AS avg_pings FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_profile_hourly
      WHERE hub = 'Waterfront Station' AND day_type = 'MF' GROUP BY 1)
SELECT p.hour, round(p.avg_pings, 1) AS avg_pings, sky.skytrain_activity,
  round(100 * p.avg_pings / sum(p.avg_pings) OVER (), 2) AS pings_pct,
  round(100 * sky.skytrain_activity / sum(sky.skytrain_activity) OVER (), 2) AS skytrain_pct
FROM p LEFT JOIN sky USING (hour)

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_seabus_hourly
COMMENT 'TransLink 2025 SeaBus hourly capacity vs volume (Waterfront <-> Lonsdale Quay). utilization_pct = volume / capacity.' AS
SELECT SeasonYear AS year, day_type, Season AS season, Direction AS direction, Hourly AS hour,
  AvgDailyCapacity AS capacity, round(AvgDailyVolume) AS volume, round(AvgPeakLoadFactor * 100, 1) AS peak_load_pct,
  round(100 * AvgDailyVolume / nullif(AvgDailyCapacity, 0), 1) AS utilization_pct
FROM rgersxdatabricks_hackathon.hub_pulse.tspr_seabus_hourly WHERE SeasonYear = 2025

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 4. Insights: forecast + AI recommendations
-- MAGIC `ai_forecast()` projects daily visits through Oct 2026. Rules turn gold tables into evidence; `ai_query()` (Qwen 3.5 122B on Databricks Foundation Model APIs) writes a one-sentence action per finding, constrained to facts in the evidence.

-- COMMAND ----------

-- INSIGHTS: forecast + actionable recommendations

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_hub_forecast
COMMENT 'Daily visit forecast per hub for Sep-Oct 2026 using Databricks ai_forecast() trained on Nov 2025 - Aug 2026 history' AS
SELECT hub, CAST(ds AS DATE) AS forecast_date, date_format(ds, 'EEEE') AS weekday,
  round(y_forecast) AS forecast_pings, round(y_lower) AS lower_80, round(y_upper) AS upper_80
FROM ai_forecast(
  TABLE(SELECT visit_date AS ds, CAST(pings AS DOUBLE) AS y, hub
        FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_daily WHERE visit_date >= '2025-11-02'),
  horizon => '2026-10-31', time_col => 'ds', value_col => 'y', group_col => 'hub')

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_recommendations_base
COMMENT 'Rule-generated service recommendations with supporting evidence' AS
WITH gap_by_day AS (
  SELECT hub, day_type,
    CASE WHEN hour BETWEEN 9 AND 20 THEN 'day' ELSE 'night' END AS band,
    array_join(collect_list(lpad(CAST(hour AS STRING), 2, '0') || ':00'), '/') AS hours,
    sum(departures_short) AS trips_short, round(avg(gap_index), 1) AS avg_gap, sum(demand_pct) AS demand_pct
  FROM (SELECT * FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_gap_hourly
        WHERE status IN ('Underserved','No service') AND hour NOT BETWEEN 6 AND 8 ORDER BY hour)
  GROUP BY ALL
),
-- spare hours: overserved relative to visits AND buses not crowded in that TSPR period (max peak load factor < 85%)
crowded_periods AS (
  SELECT hub, day_type, tspr_hour_range FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_timerange_stress
  WHERE season = 'Fall' AND max_peak_load_factor >= 85
),
spare_by_day AS (
  SELECT hub, day_type, array_join(collect_list(lpad(CAST(hour AS STRING), 2, '0') || ':00'), '/') AS hours
  FROM (SELECT g.* FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_gap_hourly g
        LEFT ANTI JOIN crowded_periods c ON c.hub = g.hub AND c.day_type = g.day_type
          AND c.tspr_hour_range = CASE WHEN g.hour BETWEEN 4 AND 5 THEN 4 WHEN g.hour BETWEEN 6 AND 8 THEN 6 WHEN g.hour BETWEEN 9 AND 14 THEN 9
                                       WHEN g.hour BETWEEN 15 AND 17 THEN 15 WHEN g.hour BETWEEN 18 AND 20 THEN 18 WHEN g.hour BETWEEN 21 AND 23 THEN 21 ELSE 24 END
        WHERE g.status = 'Overserved' AND g.hour BETWEEN 5 AND 23 ORDER BY g.hour)
  GROUP BY ALL
),
midday AS (
  SELECT g.hub, sum(g.trips_short) AS trips_short,
    array_join(collect_list(concat(CASE g.day_type WHEN 'MF' THEN 'Weekdays' WHEN 'Sat' THEN 'Saturdays' ELSE 'Sundays/holidays' END,
      ' underserved at ', g.hours, ' (demand/service ratio ', g.avg_gap, 'x; ',
      coalesce('uncrowded spare service at ' || s.hours, 'NO spare service to shift because peak buses are already near capacity, so new service hours are needed'), ')')), '; ') AS detail
  FROM gap_by_day g LEFT JOIN spare_by_day s USING (hub, day_type) WHERE g.band = 'day' GROUP BY g.hub
),
night AS (
  SELECT hub, sum(trips_short) AS trips_short,
    array_join(collect_list(concat(CASE day_type WHEN 'MF' THEN 'Weekdays' WHEN 'Sat' THEN 'Saturdays' ELSE 'Sundays/holidays' END,
      ' ', hours, ' (', round(demand_pct, 1), '% of daily visits, ratio ', avg_gap, 'x)')), '; ') AS detail
  FROM gap_by_day WHERE band = 'night' AND demand_pct >= 2 GROUP BY hub
),
crowd AS (
  SELECT hub, line, route_name, pct_trips_overcrowded, avg_peak_load_factor, pct_bunching, avg_weekday_boardings
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_route_stress WHERE pct_trips_overcrowded >= 8
),
peak AS (
  SELECT hub, most_crowded_line, time_period, max_peak_load_factor, demand_pct
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_timerange_stress
  WHERE day_type = 'MF' AND season = 'Fall' AND max_peak_load_factor >= 95
),
xfer AS (
  SELECT hub, origin, share_of_local_pct, pings FROM rgersxdatabricks_hackathon.hub_pulse.gold_origin_access
  WHERE access_type = 'Transfer required' AND share_of_local_pct >= 4
),
surge AS (
  SELECT hub, count(*) AS surge_days, max(surge_index) AS max_idx,
    array_join(slice(array_sort(collect_list(struct(-surge_index AS k, date_format(visit_date, 'MMM d') || ' (' || weekday || ')' AS d))).d, 1, 4), '; ') AS top_days
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_daily WHERE is_surge GROUP BY hub
)
SELECT hub, 'Add or retime midday service' AS category, 1 AS priority,
  concat(detail, '. About ', CAST(trips_short AS INT), ' extra midday departures (summed over weekday, Saturday and Sunday patterns) would bring service in line with demand.') AS evidence
FROM midday
UNION ALL
SELECT hub, 'Late-night service gap', 2,
  concat('Overnight demand outpaces NightBus service: ', detail, '.')
FROM night
UNION ALL
SELECT hub, 'Relieve overcrowded line', 1,
  concat('Line ', line, ' (', route_name, '): ', pct_trips_overcrowded, '% of trips overcrowded in 2025, peak load factor ', avg_peak_load_factor,
         '%, bunching ', pct_bunching, '%, ', CAST(avg_weekday_boardings AS INT), ' weekday boardings (TransLink TSPR 2025).')
FROM crowd
UNION ALL
SELECT hub, 'At-capacity peak period', 1,
  concat(most_crowded_line, ' averages ', max_peak_load_factor, '% of vehicle capacity in the ', time_period, ' (fall weekdays), when the hub sees ', demand_pct, '% of its daily visits.')
FROM peak
UNION ALL
SELECT hub, 'Close a transfer gap', 2,
  concat(array_join(collect_list(origin || ' (' || share_of_local_pct || '%)'), ', '), ' together supply ', round(sum(share_of_local_pct), 1),
         '% of regional visitors to ', hub, ' but have no one-seat transit ride, so every trip needs a transfer.')
FROM (SELECT * FROM xfer ORDER BY share_of_local_pct DESC) GROUP BY hub
UNION ALL
SELECT hub, 'Plan for surge days', 3,
  concat(surge_days, ' days had 25%+ more visits than a normal same weekday (max ', round(max_idx, 2), 'x). Biggest: ', top_days, '.')
FROM surge

-- COMMAND ----------

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_recommendations
COMMENT 'Service recommendations: rule-based evidence + LLM-written action (ai_query, Qwen 3.5 122B)' AS
SELECT hub, category, priority, evidence,
  ai_query('databricks-qwen35-122b-a10b',
    concat('You are a TransLink service planner writing for a hackathon demo. In ONE sentence (max 40 words), recommend a specific, practical action for ', hub,
           '. Name the exact day types, hours, lines or origins given in the evidence. For surge days, recommend an event-day service plan for those dates. ',
           'STRICT RULES: only mention route numbers, hours, dates, origins and numbers that appear verbatim in the evidence; do not add times of day that are not in the evidence; if the evidence says there is no spare service, recommend adding service hours rather than moving trips. Output only the sentence. Category: ', category, '. Evidence: ', evidence)) AS recommendation
FROM rgersxdatabricks_hackathon.hub_pulse.gold_recommendations_base

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 5. Governance: Unity Catalog tags
-- MAGIC Tags every table with `project`, `layer` (bronze/silver/gold) and `source` so the project is discoverable in Catalog Explorer and `information_schema.table_tags`.

-- COMMAND ----------

-- GOVERNANCE: tags for discoverability in Unity Catalog (idempotent)
ALTER SCHEMA rgersxdatabricks_hackathon.hub_pulse SET TAGS ('project' = 'hub_pulse', 'event' = 'rogers_databricks_hackathon_2026', 'owner' = 'yahmed06@student.ubc.ca')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_stops SET TAGS ('project' = 'hub_pulse', 'layer' = 'bronze', 'source' = 'translink_gtfs')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_routes SET TAGS ('project' = 'hub_pulse', 'layer' = 'bronze', 'source' = 'translink_gtfs')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_trips SET TAGS ('project' = 'hub_pulse', 'layer' = 'bronze', 'source' = 'translink_gtfs')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_calendar SET TAGS ('project' = 'hub_pulse', 'layer' = 'bronze', 'source' = 'translink_gtfs')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_calendar_dates SET TAGS ('project' = 'hub_pulse', 'layer' = 'bronze', 'source' = 'translink_gtfs')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gtfs_stop_times SET TAGS ('project' = 'hub_pulse', 'layer' = 'bronze', 'source' = 'translink_gtfs')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_bus_route_year SET TAGS ('project' = 'hub_pulse', 'layer' = 'bronze', 'source' = 'translink_tspr_2025')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_bus_route_timerange SET TAGS ('project' = 'hub_pulse', 'layer' = 'bronze', 'source' = 'translink_tspr_2025')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_bus_peakload SET TAGS ('project' = 'hub_pulse', 'layer' = 'bronze', 'source' = 'translink_tspr_2025')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_seabus_hourly SET TAGS ('project' = 'hub_pulse', 'layer' = 'bronze', 'source' = 'translink_tspr_2025')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_skytrain_station_hourly SET TAGS ('project' = 'hub_pulse', 'layer' = 'bronze', 'source' = 'translink_tspr_2025')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_skytrain_station_year SET TAGS ('project' = 'hub_pulse', 'layer' = 'bronze', 'source' = 'translink_tspr_2025')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.tspr_wce_station_hourly SET TAGS ('project' = 'hub_pulse', 'layer' = 'bronze', 'source' = 'translink_tspr_2025')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.dim_hub SET TAGS ('project' = 'hub_pulse', 'layer' = 'silver', 'source' = 'derived')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.dim_origin SET TAGS ('project' = 'hub_pulse', 'layer' = 'silver', 'source' = 'derived')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.silver_visits SET TAGS ('project' = 'hub_pulse', 'layer' = 'silver', 'source' = 'hackathon_pings')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.silver_hub_stops SET TAGS ('project' = 'hub_pulse', 'layer' = 'silver', 'source' = 'hackathon_pings+translink')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.silver_route_lookup SET TAGS ('project' = 'hub_pulse', 'layer' = 'silver', 'source' = 'derived')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.silver_hub_departures SET TAGS ('project' = 'hub_pulse', 'layer' = 'silver', 'source' = 'hackathon_pings+translink')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gold_hub_daily SET TAGS ('project' = 'hub_pulse', 'layer' = 'gold', 'source' = 'hackathon_pings')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gold_hub_profile_hourly SET TAGS ('project' = 'hub_pulse', 'layer' = 'gold', 'source' = 'hackathon_pings')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gold_hub_supply_hourly SET TAGS ('project' = 'hub_pulse', 'layer' = 'gold', 'source' = 'hackathon_pings+translink')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gold_hub_gap_hourly SET TAGS ('project' = 'hub_pulse', 'layer' = 'gold', 'source' = 'hackathon_pings+translink')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gold_route_stress SET TAGS ('project' = 'hub_pulse', 'layer' = 'gold', 'source' = 'hackathon_pings+translink')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gold_hub_timerange_stress SET TAGS ('project' = 'hub_pulse', 'layer' = 'gold', 'source' = 'hackathon_pings+translink')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gold_origin_access SET TAGS ('project' = 'hub_pulse', 'layer' = 'gold', 'source' = 'hackathon_pings+translink')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gold_waterfront_validation SET TAGS ('project' = 'hub_pulse', 'layer' = 'gold', 'source' = 'hackathon_pings+translink')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gold_seabus_hourly SET TAGS ('project' = 'hub_pulse', 'layer' = 'gold', 'source' = 'hackathon_pings+translink')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gold_hub_forecast SET TAGS ('project' = 'hub_pulse', 'layer' = 'gold', 'source' = 'hackathon_pings')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gold_recommendations_base SET TAGS ('project' = 'hub_pulse', 'layer' = 'gold', 'source' = 'hackathon_pings+translink')

-- COMMAND ----------

ALTER TABLE rgersxdatabricks_hackathon.hub_pulse.gold_recommendations SET TAGS ('project' = 'hub_pulse', 'layer' = 'gold', 'source' = 'hackathon_pings+translink')

-- COMMAND ----------

ALTER VOLUME rgersxdatabricks_hackathon.hub_pulse.raw SET TAGS ('project' = 'hub_pulse', 'layer' = 'landing')
