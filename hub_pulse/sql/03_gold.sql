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
FROM d;

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_hub_profile_hourly
COMMENT 'Typical-day demand profile: average pings per hour by hub, day type and season' AS
WITH days AS (SELECT hub, day_type, tspr_season, count(DISTINCT visit_date) AS n_days FROM rgersxdatabricks_hackathon.hub_pulse.silver_visits GROUP BY ALL)
SELECT v.hub, v.day_type, v.tspr_season AS season, v.visit_hour AS hour,
  round(count(*) / max(d.n_days), 1) AS avg_pings, round(avg(v.dwell_min), 1) AS avg_dwell_min
FROM rgersxdatabricks_hackathon.hub_pulse.silver_visits v JOIN days d USING (hub, day_type, tspr_season)
GROUP BY ALL;

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
GROUP BY ALL;

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
FROM dem JOIN sup USING (hub, day_type, hour);

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
  ON CAST(y.Lineno_renamed AS STRING) = l.tspr_line AND y.CalendarYear = 2025;

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
FROM dem2 d LEFT JOIN pl USING (hub, day_type, season, tspr_hour_range);

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
LEFT JOIN direct d ON d.hub = dem.hub AND d.origin = dem.origin;

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
FROM p LEFT JOIN sky USING (hour);

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_seabus_hourly
COMMENT 'TransLink 2025 SeaBus hourly capacity vs volume (Waterfront <-> Lonsdale Quay). utilization_pct = volume / capacity.' AS
SELECT SeasonYear AS year, day_type, Season AS season, Direction AS direction, Hourly AS hour,
  AvgDailyCapacity AS capacity, round(AvgDailyVolume) AS volume, round(AvgPeakLoadFactor * 100, 1) AS peak_load_pct,
  round(100 * AvgDailyVolume / nullif(AvgDailyCapacity, 0), 1) AS utilization_pct
FROM rgersxdatabricks_hackathon.hub_pulse.tspr_seabus_hourly WHERE SeasonYear = 2025;
