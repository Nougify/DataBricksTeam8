# Databricks notebook source
# MAGIC %md
# MAGIC # Hub Pulse — 02 Findings
# MAGIC **Where does Vancouver's transit schedule fall out of step with the people using its hubs?**
# MAGIC
# MAGIC We combine 21.5M visit pings at **UBC**, **Waterfront Station** and **Park Royal Mall** with TransLink's own schedule (GTFS) and 2025 performance data (TSPR) to find hours, routes and origins where service does not match demand.
# MAGIC
# MAGIC All tables live in `rgersxdatabricks_hackathon.hub_pulse` (built by notebook 01).

# COMMAND ----------

import plotly.express as px
import plotly.graph_objects as go

S = "rgersxdatabricks_hackathon.hub_pulse"
HUB_COLORS = {"UBC": "#2a78d6", "Waterfront Station": "#e0712b", "Park Royal Mall": "#1f9d6b"}


def q(sql):
    return spark.sql(sql).toPandas()

# COMMAND ----------

# MAGIC %md
# MAGIC ## 0. Can we trust synthetic pings? Validate against real ridership
# MAGIC Waterfront's weekday ping profile vs TransLink's **real 2025 SkyTrain boardings + alightings at Waterfront Station** (TSPR). Correlation r ≈ 0.92 — the pings track real transit activity, and it confirms the timestamps are local time.

# COMMAND ----------

v = q(f"SELECT hour, pings_pct, skytrain_pct FROM {S}.gold_waterfront_validation ORDER BY hour")
r = v[["pings_pct", "skytrain_pct"]].corr().iloc[0, 1]
fig = go.Figure()
fig.add_scatter(x=v.hour, y=v.pings_pct, name="Visit pings (hackathon data)", mode="lines+markers", line=dict(color="#e0712b", width=3))
fig.add_scatter(x=v.hour, y=v.skytrain_pct, name="SkyTrain boardings+alightings (TransLink 2025)", mode="lines+markers", line=dict(color="#6b7280", width=2, dash="dot"))
fig.update_layout(title=f"Waterfront weekday profile: pings vs real SkyTrain ridership (r = {r:.2f})",
                  xaxis_title="Hour of day", yaxis_title="% of daily total", template="plotly_white", height=420)
fig.show()

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Demand peaks midday — service peaks at commute time
# MAGIC `gap_index` = the hour's share of daily visits ÷ its share of daily scheduled departures. **> 1.5 = underserved**, < 0.67 = overserved.

# COMMAND ----------

g = q(f"SELECT hub, hour, demand_pct, supply_pct, gap_index FROM {S}.gold_hub_gap_hourly WHERE day_type = 'MF' ORDER BY hub, hour")
fig = px.line(g.melt(id_vars=["hub", "hour"], value_vars=["demand_pct", "supply_pct"], var_name="series", value_name="pct"),
              x="hour", y="pct", color="series", facet_col="hub", markers=True,
              color_discrete_map={"demand_pct": "#d9435a", "supply_pct": "#2a78d6"},
              labels={"pct": "% of daily total", "hour": "Hour"}, title="Weekday: share of visits (red) vs share of departures (blue)")
fig.update_layout(template="plotly_white", height=420)
fig.show()

# COMMAND ----------

h = q(f"SELECT hub, day_type, hour, gap_index FROM {S}.gold_hub_gap_hourly")
h["row"] = h.hub + " · " + h.day_type
pivot = h.pivot(index="row", columns="hour", values="gap_index")
fig = px.imshow(pivot, color_continuous_scale="RdBu_r", color_continuous_midpoint=1.0, zmin=0, zmax=3, aspect="auto",
                labels=dict(color="gap index"), title="Gap index heatmap (red = more demand than service)")
fig.update_layout(height=450)
fig.show()

# COMMAND ----------

display(spark.sql(f"""
SELECT hub, day_type, hour, avg_pings, departures, demand_pct, supply_pct, gap_index, status
FROM {S}.gold_hub_gap_hourly WHERE status IN ('Underserved','No service') ORDER BY hub, day_type, hour"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. The routes feeding these hubs are already overcrowded (TransLink TSPR 2025)
# MAGIC UBC's trunk lines top the list: the **99 B-Line runs at 104% of capacity westbound in the AM peak** and 100% eastbound in the PM peak — so UBC can't fix its midday gap by moving peak buses; it needs new service hours.

# COMMAND ----------

rs = q(f"SELECT hub, line || ' ' || route_name AS line, pct_trips_overcrowded, avg_weekday_boardings FROM {S}.gold_route_stress WHERE pct_trips_overcrowded >= 2 ORDER BY pct_trips_overcrowded")
fig = px.bar(rs, x="pct_trips_overcrowded", y="line", color="hub", orientation="h", color_discrete_map=HUB_COLORS,
             hover_data=["avg_weekday_boardings"], labels={"pct_trips_overcrowded": "% of trips overcrowded (2025)", "line": ""},
             title="Overcrowded bus lines serving each hub")
fig.update_layout(template="plotly_white", height=520)
fig.show()

# COMMAND ----------

ts = q(f"""SELECT hub, time_period, max_peak_load_factor, most_crowded_line, demand_pct
FROM {S}.gold_hub_timerange_stress WHERE day_type='MF' AND season='Fall' ORDER BY hub, tspr_hour_range""")
fig = px.bar(ts, x="time_period", y="max_peak_load_factor", color="hub", barmode="group", color_discrete_map=HUB_COLORS,
             hover_data=["most_crowded_line", "demand_pct"], labels={"max_peak_load_factor": "Worst line: peak load factor (%)", "time_period": ""},
             title="Fall weekdays: how full is the most crowded line at each hub? (100% = at capacity)")
fig.add_hline(y=100, line_dash="dash", line_color="#d9435a", annotation_text="Vehicle capacity")
fig.update_layout(template="plotly_white", height=440)
fig.show()

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Who has to transfer? One-seat-ride access by origin
# MAGIC A "one-seat ride" exists if a line serving the hub also stops within 1 km (bus) / 2 km (SkyTrain, SeaBus, WCE station) of the origin. **38% of UBC's regional visitors — from Surrey, Richmond, New Westminster and North Vancouver — must transfer**, typically onto the already-full 99 B-Line or R4.

# COMMAND ----------

oa = q(f"""SELECT hub, access_type, round(sum(share_of_local_pct),1) AS pct
FROM {S}.gold_origin_access WHERE share_of_local_pct IS NOT NULL GROUP BY ALL""")
fig = px.bar(oa, x="hub", y="pct", color="access_type", text="pct",
             color_discrete_map={"One-seat ride": "#1f9d6b", "Transfer required": "#d9435a"},
             labels={"pct": "% of regional visitors (excl. same-area)", "hub": ""}, title="Regional visitors with and without a one-seat ride")
fig.update_layout(template="plotly_white", height=420)
fig.show()

# COMMAND ----------

o = q(f"SELECT hub, origin, lat, lon, pings, access_type FROM {S}.gold_origin_access WHERE lat IS NOT NULL AND origin <> hub")
fig = px.scatter_mapbox(o, lat="lat", lon="lon", size="pings", color="access_type", hover_name="origin",
                        hover_data=["hub", "pings"], animation_frame="hub", zoom=9.2, height=560, size_max=40,
                        color_discrete_map={"One-seat ride": "#1f9d6b", "Transfer required": "#d9435a"},
                        center={"lat": 49.24, "lon": -123.0}, title="Where visitors come from (bubble = visits), by hub")
fig.update_layout(mapbox_style="carto-positron")
fig.show()

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Surge days & forecast
# MAGIC `surge_index` = visits ÷ average of the same weekday in the surrounding 9 weeks. UBC surges on the Dec 6–7 exam weekend (1.7×) when Saturday/Sunday service is ~35–45% below weekdays; Waterfront peaks in late July; Park Royal on Boxing Day.

# COMMAND ----------

d = q(f"SELECT hub, visit_date, pings, surge_index, is_surge FROM {S}.gold_hub_daily ORDER BY visit_date")
f = q(f"SELECT hub, forecast_date AS visit_date, forecast_pings, lower_80, upper_80 FROM {S}.gold_hub_forecast ORDER BY forecast_date")
fig = go.Figure()
for hub, c in HUB_COLORS.items():
    dd, ff = d[d.hub == hub], f[f.hub == hub]
    fig.add_scatter(x=dd.visit_date, y=dd.pings, name=hub, line=dict(color=c, width=1.5))
    fig.add_scatter(x=ff.visit_date, y=ff.forecast_pings, name=f"{hub} forecast", line=dict(color=c, dash="dot"))
    s = dd[dd.is_surge]
    fig.add_scatter(x=s.visit_date, y=s.pings, mode="markers", marker=dict(color=c, size=8, symbol="diamond"), name=f"{hub} surge", showlegend=False)
fig.update_layout(title="Daily visits, surge days (◆) and ai_forecast() to Oct 2026", template="plotly_white", height=480,
                  yaxis_title="Visits per day")
fig.show()

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Recommendations (rules + `ai_query`)
# MAGIC Evidence is computed in SQL; the sentence is written by an LLM on Databricks Foundation Model APIs and restricted to facts in the evidence.

# COMMAND ----------

display(spark.sql(f"SELECT hub, priority, category, recommendation, evidence FROM {S}.gold_recommendations ORDER BY priority, hub, category"))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Limitations
# MAGIC - Visit pings are synthetic; they measure **people at the hub**, not boardings. We validate the shape against real SkyTrain ridership but compare demand and service as **shares** (scale-free), not absolute counts.
# MAGIC - Service is the fall 2026 GTFS schedule on representative Wed/Sat/Sun dates; crowding is TSPR 2025 (latest published).
# MAGIC - Origin centroids are approximate; "one-seat ride" is a proximity heuristic, not a trip planner.
# MAGIC - `ai_forecast` has 10 months of history, so it cannot learn full annual seasonality (e.g. September term start).
