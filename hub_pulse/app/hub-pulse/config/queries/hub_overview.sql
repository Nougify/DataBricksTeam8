-- Headline facts for one hub
-- @param hub STRING
WITH d AS (
  SELECT count(*) AS days, sum(pings) AS visits, avg(visitor_share) AS visitor_share, count_if(is_surge) AS surge_days,
    max_by(visit_date, surge_index) AS top_surge_date, max(surge_index) AS top_surge_index
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_daily WHERE hub = :hub
),
o AS (
  SELECT sum(IF(access_type = 'Transfer required', share_of_local_pct, 0)) / 100 AS transfer_share
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_origin_access WHERE hub = :hub AND share_of_local_pct IS NOT NULL
),
r AS (
  SELECT max_by(line || ' ' || route_name, pct_trips_overcrowded) AS worst_line, max(pct_trips_overcrowded) AS worst_line_overcrowded_pct
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_route_stress WHERE hub = :hub
),
p AS (
  SELECT max_by(most_crowded_line || ' · ' || time_period, max_peak_load_factor) AS peak_load_where, max(max_peak_load_factor) AS peak_load_pct
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_timerange_stress WHERE hub = :hub AND day_type = 'MF' AND season = 'Fall'
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
