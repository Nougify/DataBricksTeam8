-- INSIGHTS: forecast + actionable recommendations

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_hub_forecast
COMMENT 'Daily visit forecast per hub for Sep-Oct 2026 using Databricks ai_forecast() trained on Nov 2025 - Aug 2026 history' AS
SELECT hub, CAST(ds AS DATE) AS forecast_date, date_format(ds, 'EEEE') AS weekday,
  round(y_forecast) AS forecast_pings, round(y_lower) AS lower_80, round(y_upper) AS upper_80
FROM ai_forecast(
  TABLE(SELECT visit_date AS ds, CAST(pings AS DOUBLE) AS y, hub
        FROM rgersxdatabricks_hackathon.hub_pulse.gold_hub_daily WHERE visit_date >= '2025-11-02'),
  horizon => '2026-10-31', time_col => 'ds', value_col => 'y', group_col => 'hub');

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
FROM surge;

CREATE OR REPLACE TABLE rgersxdatabricks_hackathon.hub_pulse.gold_recommendations
COMMENT 'Service recommendations: rule-based evidence + LLM-written action (ai_query, Qwen 3.5 122B)' AS
SELECT hub, category, priority, evidence,
  ai_query('databricks-qwen35-122b-a10b',
    concat('You are a TransLink service planner writing for a hackathon demo. In ONE sentence (max 40 words), recommend a specific, practical action for ', hub,
           '. Name the exact day types, hours, lines or origins given in the evidence. For surge days, recommend an event-day service plan for those dates. ',
           'STRICT RULES: only mention route numbers, hours, dates, origins and numbers that appear verbatim in the evidence; do not add times of day that are not in the evidence; if the evidence says there is no spare service, recommend adding service hours rather than moving trips. Output only the sentence. Category: ', category, '. Evidence: ', evidence)) AS recommendation
FROM rgersxdatabricks_hackathon.hub_pulse.gold_recommendations_base;
