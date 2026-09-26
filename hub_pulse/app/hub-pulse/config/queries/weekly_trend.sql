-- Weekly visits (actual) and ai_forecast projection for one hub
-- @param hub STRING
WITH a AS (
  SELECT date_trunc('WEEK', visit_date) AS week, sum(pings) AS visits
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_daily WHERE hub = :hub GROUP BY 1
),
f AS (
  SELECT date_trunc('WEEK', forecast_date) AS week, sum(greatest(forecast_pings, 0)) AS forecast
  FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_forecast WHERE hub = :hub GROUP BY 1
)
SELECT
  date_format(coalesce(a.week, f.week), 'yyyy-MM-dd') AS week,
  CAST(a.visits AS DOUBLE) AS visits,
  CAST(f.forecast AS DOUBLE) AS forecast
FROM a FULL OUTER JOIN f ON a.week = f.week
WHERE coalesce(a.week, f.week) > '2025-11-01'
ORDER BY 1
