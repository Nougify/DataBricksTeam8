-- TransLink TSPR 2025 performance of the bus lines serving one hub
-- @param hub STRING
SELECT
  line || ' ' || route_name AS line_name,
  CAST(pct_trips_overcrowded AS DOUBLE) AS pct_trips_overcrowded,
  CAST(avg_peak_load_factor AS DOUBLE) AS avg_peak_load_factor,
  CAST(pct_bunching AS DOUBLE) AS pct_bunching
FROM rgersxdatabricks_hackathon.hub_pulse.gold_route_stress
WHERE hub = :hub
ORDER BY pct_trips_overcrowded DESC
LIMIT 8
