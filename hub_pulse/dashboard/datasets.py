"""Dashboard dataset SQL (bare table names; catalog/schema supplied at deploy time)."""

DATASETS = {
    "ds_daily": ("Daily visits", """
SELECT hub, visit_date, weekday, day_type, pings, surge_index, is_surge, visitor_share,
  CASE WHEN is_surge THEN 1 ELSE 0 END AS surge_flag
FROM gold_hub_daily
ORDER BY visit_date"""),

    "ds_gap": ("Hourly demand vs service", """
SELECT hub, day_type,
  CASE day_type WHEN 'MF' THEN 'Weekday' WHEN 'Sat' THEN 'Saturday' ELSE 'Sunday/holiday' END AS day_label,
  hour, lpad(CAST(hour AS STRING), 2, '0') || ':00' AS hour_label,
  avg_pings, departures, demand_pct / 100 AS demand_share, supply_pct / 100 AS supply_share,
  gap_index, status, departures_short,
  CASE WHEN status IN ('Underserved', 'No service') THEN 1 ELSE 0 END AS underserved_flag
FROM gold_hub_gap_hourly
ORDER BY hub, day_type, hour"""),

    "ds_route": ("Route crowding (TSPR 2025)", """
SELECT hub, line || ' ' || route_name AS line_label, line, route_name, weekly_trips_at_hub,
  avg_weekday_boardings, pct_trips_overcrowded / 100 AS overcrowded_share,
  avg_peak_load_factor / 100 AS peak_load, pct_bunching / 100 AS bunching_share, pct_on_time / 100 AS on_time_share
FROM gold_route_stress
ORDER BY pct_trips_overcrowded DESC"""),

    "ds_period": ("Crowding by time period", """
SELECT hub, season, time_period, tspr_hour_range, demand_pct / 100 AS demand_share,
  max_peak_load_factor / 100 AS max_peak_load, avg_peak_load_factor / 100 AS avg_peak_load, most_crowded_line
FROM gold_hub_timerange_stress
WHERE day_type = 'MF' AND max_peak_load_factor IS NOT NULL
ORDER BY tspr_hour_range"""),

    "ds_forecast": ("Visits forecast", """
WITH actuals AS (
  SELECT hub, visit_date AS ds, CAST(pings AS DOUBLE) AS visits FROM gold_hub_daily
),
last AS (SELECT hub, max(ds) AS max_d FROM actuals GROUP BY hub),
fc AS (
  SELECT hub, forecast_date AS ds, CAST(greatest(forecast_pings, 0) AS DOUBLE) AS visits_forecast,
    CAST(upper_80 AS DOUBLE) AS visits_upper, CAST(greatest(lower_80, 0) AS DOUBLE) AS visits_lower
  FROM gold_hub_forecast
)
SELECT a.hub, a.ds, a.visits, CAST(NULL AS DOUBLE) AS visits_forecast, CAST(NULL AS DOUBLE) AS visits_upper, CAST(NULL AS DOUBLE) AS visits_lower
FROM actuals a
UNION ALL
SELECT a.hub, a.ds, a.visits, a.visits, a.visits, a.visits FROM actuals a JOIN last l ON a.hub = l.hub AND a.ds = l.max_d
UNION ALL
SELECT hub, ds, CAST(NULL AS DOUBLE), visits_forecast, visits_upper, visits_lower FROM fc
ORDER BY ds"""),

    "ds_origin": ("Visitor origins & access", """
SELECT hub, origin, region, lat, lon, pings, share_pct / 100 AS share, access_type, n_direct_lines,
  coalesce(direct_lines, '—') AS direct_lines, avg_dwell_min,
  CASE WHEN share_of_local_pct IS NOT NULL THEN pings ELSE 0 END AS regional_pings,
  CASE WHEN access_type = 'Transfer required' THEN pings ELSE 0 END AS transfer_pings
FROM gold_origin_access
ORDER BY pings DESC"""),

    "ds_recs": ("Recommendations", """
SELECT hub, priority,
  CASE priority WHEN 1 THEN 'P1 — act now' WHEN 2 THEN 'P2 — plan' ELSE 'P3 — prepare' END AS priority_label,
  category, recommendation, evidence
FROM gold_recommendations
ORDER BY priority, hub, category"""),

    "ds_validation": ("Waterfront validation", """
SELECT hour, lpad(CAST(hour AS STRING), 2, '0') || ':00' AS hour_label,
  pings_pct / 100 AS pings_share, skytrain_pct / 100 AS skytrain_share
FROM gold_waterfront_validation
ORDER BY hour"""),

    "ds_seabus": ("SeaBus hourly load (TSPR 2025)", """
SELECT day_type, season, direction, hour, capacity, volume, utilization_pct / 100 AS utilization, peak_load_pct / 100 AS peak_load
FROM gold_seabus_hourly
ORDER BY hour"""),
}
