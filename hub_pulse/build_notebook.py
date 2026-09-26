#!/usr/bin/env python3
"""Generate notebooks/01_build_pipeline.sql (Databricks SQL notebook source) from the sql/ files. Run it attached to a SQL warehouse (ai_forecast needs one)."""
import re

SECTIONS = {
    "01_bronze.sql": ("## 1. Bronze: raw open data",
        "Load TransLink GTFS (fall 2026 schedule) and the 2025 Transit Service Performance Review (TSPR) CSVs from the Unity Catalog "
        "volume `/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw`. The hackathon visit pings are already in "
        "`rgersxdatabricks_hackathon.ubc_rogersxdatabricks_hackathon.synthetic_data_ubc` (all three hubs)."),
    "02_silver.sql": ("## 2. Silver: conformed tables",
        "Hubs, visits (typed + day type + TSPR season/period), stops inside each hub catchment, GTFS→TSPR route lookup, scheduled "
        "departures per hub resolved on representative Wed/Sat/Sun dates, and hand-geocoded origin centroids."),
    "03_gold.sql": ("## 3. Gold: analysis tables",
        "Daily surges, hourly demand profiles, hourly service supply, the demand/service **gap index**, route crowding (TSPR 2025), "
        "crowding by time period, one-seat-ride access by origin, and two validation/benchmark tables."),
    "04_insights.sql": ("## 4. Insights: forecast + AI recommendations",
        "`ai_forecast()` projects daily visits through Oct 2026. Rules turn gold tables into evidence; `ai_query()` (Qwen 3.5 122B on "
        "Databricks Foundation Model APIs) writes a one-sentence action per finding, constrained to facts in the evidence."),
    "05_governance.sql": ("## 5. Governance: Unity Catalog tags",
        "Tags every table with `project`, `layer` (bronze/silver/gold) and `source` so the project is discoverable in Catalog Explorer and `information_schema.table_tags`."),
}

INTRO = """-- MAGIC %md
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
-- MAGIC **Data note:** source timestamps carry a `Z` suffix but behave as local wall-clock time; read that way, Waterfront's hourly profile correlates r = 0.92 with real SkyTrain ridership (see notebook 02)."""


def md(text):
    return "\n".join(f"-- MAGIC {l}" if l else "-- MAGIC" for l in ("%md\n" + text).splitlines())


cells = [INTRO]
for fname, (title, desc) in SECTIONS.items():
    cells.append(md(f"{title}\n{desc}"))
    sql = open(f"sql/{fname}").read()
    for stmt in [s.strip() for s in re.split(r";\s*\n", sql + "\n") if s.strip()]:
        cells.append(stmt)

open("notebooks/01_build_pipeline.sql", "w").write("-- Databricks notebook source\n" + "\n\n-- COMMAND ----------\n\n".join(cells) + "\n")
print(f"{len(cells)} cells written")
