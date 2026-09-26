-- SILVER: cleaned, conformed tables

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.dim_hub
COMMENT 'The three study hubs with the stop catchment radius used to match TransLink GTFS stops' AS
SELECT * FROM VALUES
  ('UBC', 'UBC', 49.2606D, -123.246D, 800, 'University campus + UBC Exchange (largest bus-only exchange in the region; no rapid transit yet)'),
  ('Waterfront Station', 'WF', 49.2857D, -123.1115D, 300, 'Multimodal hub: Expo + Canada Line SkyTrain, SeaBus, West Coast Express, downtown buses'),
  ('Park Royal Mall', 'PR', 49.3265D, -123.138D, 300, 'North Shore retail hub and bus exchange at the Lions Gate Bridge')
AS h(hub, hub_code, lat, lon, catchment_m, description);

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
FROM v;

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.silver_hub_stops
COMMENT 'TransLink GTFS stops inside each hub catchment' AS
SELECT h.hub, s.stop_id, s.stop_name, s.stop_lat, s.stop_lon,
  round(6371000*2*asin(sqrt(pow(sin(radians(s.stop_lat-h.lat)/2),2)+cos(radians(h.lat))*cos(radians(s.stop_lat))*pow(sin(radians(s.stop_lon-h.lon)/2),2)))) AS dist_m
FROM rgersxdatabricks_hackathon.hub_pulse.gtfs_stops s
CROSS JOIN rgersxdatabricks_hackathon.hub_pulse.dim_hub h
WHERE 6371000*2*asin(sqrt(pow(sin(radians(s.stop_lat-h.lat)/2),2)+cos(radians(h.lat))*cos(radians(s.stop_lat))*pow(sin(radians(s.stop_lon-h.lon)/2),2))) <= h.catchment_m;

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
LEFT JOIN t ON t.line_key = TRIM(LEADING '0' FROM r.route_short_name);

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
JOIN rgersxdatabricks_hackathon.hub_pulse.silver_route_lookup rl ON rl.route_id = t.route_id;

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
AS o(origin, lat, lon, region);
