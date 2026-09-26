-- Hourly demand vs scheduled service for one hub and day type, with TSPR crowding for the hour's time period
-- @param hub STRING
-- @param day_type STRING
SELECT
  g.hour,
  g.avg_pings,
  g.departures,
  g.bus_departures,
  g.skytrain_departures,
  g.seabus_departures,
  g.lines_running,
  g.status,
  t.time_period,
  CAST(coalesce(t.max_peak_load_factor, 0) AS DOUBLE) AS max_peak_load_factor,
  coalesce(t.most_crowded_line, '') AS most_crowded_line
FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_gap_hourly g
LEFT JOIN rgersxdatabricks_hackathon.hub_pulse.gold_hub_timerange_stress t
  ON t.hub = g.hub AND t.day_type = g.day_type AND t.season = 'Fall'
 AND t.tspr_hour_range = CASE WHEN g.hour BETWEEN 4 AND 5 THEN 4 WHEN g.hour BETWEEN 6 AND 8 THEN 6
                              WHEN g.hour BETWEEN 9 AND 14 THEN 9 WHEN g.hour BETWEEN 15 AND 17 THEN 15
                              WHEN g.hour BETWEEN 18 AND 20 THEN 18 WHEN g.hour BETWEEN 21 AND 23 THEN 21 ELSE 24 END
WHERE g.hub = :hub AND g.day_type = :day_type
ORDER BY g.hour
