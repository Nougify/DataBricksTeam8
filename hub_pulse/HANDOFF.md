# Hub Pulse — handoff for a new chat

Paste this whole file (or point the new chat at `~/Downloads/OneDrive_1_2026-09-25/hub_pulse/HANDOFF.md`) to continue.

## 1. What this is

Rogers × Databricks hackathon project (Sept 2026) by Youssef Ahmed (UBC, `yahmed06@student.ubc.ca`).
Brief: find a problem in Vancouver **transit** (chosen over security) using the hackathon data plus open data, and build a solution on Databricks with notebooks, a dashboard, an app and a Genie space.

**Problem:** TransLink schedules are built around the commute peak (about 8 a.m.). Visits at the three hubs peak around midday, and UBC is also busy overnight. Meanwhile, the lines feeding these hubs are already overcrowded.

**Solution:** "Hub Pulse", a Databricks-native analysis plus a what-if service planner. Users add buses, or move them at zero cost, hour by hour, and watch the demand/service gap close. The planner never moves a bus if that would push the busiest line past 85% full.

## 2. Headline findings (weekdays unless noted)

| Hub | Mismatch* | Visits in underserved hours | Zero-cost rebalance | +5% service | Verdict |
|---|---|---|---|---|---|
| Park Royal Mall | 19.4% | 16.0% | move 71 of 900 departures → 0.6% | → 0.6% | Reschedule |
| Waterfront Station | 14.9% | 7.1% | move 365 of 4,447 → mismatch 6.7%; hours over 85% full 3 → 0 | mismatch 12.7% | Reschedule |
| UBC | 14.6% | 20.0% | only 16 can move safely → still 20.0% | +112 departures at 11:00–14:00 → 3.4% | Invest |

\*Mismatch = the share of departures running at the wrong hour for demand (0.5 × Σ|visit share − departure share|). An hour is underserved when its share of visits exceeds 1.5× its share of departures.

Other facts:
- **UBC crowding:** the westbound 99 B-Line runs at **104%** of capacity in the 06–09 AM peak, and the eastbound runs at 100% in the PM peak. 2025 trips overcrowded: 99 at 20.3%, R4 at 15.2%, 49 at 14.3% (TSPR 2025).
- **UBC access:** **47.6%** of UBC's regional visitors have no one-seat ride, mainly from Surrey (14.5%), Richmond (11.6%), New Westminster (6.3%) and North Vancouver (5.6%).
- **Surge days:** UBC Dec 6–7 2025 (exam weekend, 1.72×), Waterfront Jul 25 2026 (1.83×), Park Royal Dec 26 (1.47×).
- **Validation:** Waterfront's weekday ping profile vs real TSPR SkyTrain boardings + alightings gives **r = 0.92**. Shifting the pings by 3 hours drops it to 0.38.

## 3. Data facts and gotchas (important)

- The hackathon data is preloaded in `rgersxdatabricks_hackathon.ubc_rogersxdatabricks_hackathon.synthetic_data_ubc`, which holds **all three hubs** (21,496,090 rows) despite its name. The local CSVs in `~/Downloads/OneDrive_1_2026-09-25/*.csv` are the same data, so there's no need to upload them.
  - Columns: `location_name, longitude, latitude, timestamp, origin, dwell_time`.
- **Timestamps have a `Z` suffix but are local wall-clock time.** Don't convert them to America/Vancouver. This was validated against the real ridership data.
- `dwell_time` is treated as minutes. Origins are 36 areas: Vancouver neighbourhoods, Metro municipalities, provinces and "International".
- Data runs Nov 2025 – Aug 2026 (304 days).
- **Open data used:**
  - TransLink GTFS static feed (fall 2026, from `https://gtfs-static.translink.ca/gtfs/google_transit.zip`).
  - TransLink **TSPR 2025** CSVs and the Transit Service Guidelines PDF, from translink.ca → Plans and Projects → *Managing the Transit Network*.
  - All raw files are in the UC volume `/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/{gtfs,tspr}/`.
- GTFS `stop_id` is a **string** (station ids like `WFSHS`).
- Some TSPR numeric columns contain the literal string `'NULL'`, so use `try_cast`.
- Some services run only via `calendar_dates`, e.g. West Coast Express (service 155601). Day types are resolved on representative dates: Wed 2026-10-14, Sat 2026-10-17, Sun 2026-10-18.
- **Hub catchments:** UBC 800 m (covers all of UBC Exchange); Waterfront and Park Royal 300 m.
- **One-seat ride test:** a line serving the hub stops within 1 km (bus) or 2 km (SkyTrain/SeaBus/WCE station) of a hand-geocoded origin centroid.

## 4. Environment

- **Databricks:**
  - CLI profile **`DEFAULT`** (user chose it); workspace `https://dbc-4e20a0bf-b569.cloud.databricks.com` (`?o=7474647815578778`). The user is a workspace admin.
  - Always pass `--profile DEFAULT`.
  - SQL warehouse: `93d96b01c499de55` (Serverless Starter Warehouse, 2X-Small).
- **Project schema:** `rgersxdatabricks_hackathon.hub_pulse`.
- **Local project:** `~/Downloads/OneDrive_1_2026-09-25/hub_pulse/`. The git root is `~/Downloads`, which is full of unrelated personal files, so **don't commit** unless asked.
- The user has another process on **port 8000**, so run the app's dev server on **8123**. `.claude/launch.json` in `~/Downloads/OneDrive_1_2026-09-25/` does this.
- The in-app browser pane is **not signed in to Databricks**. The user must sign in there before the dashboard or deployed app can be checked visually.

## 4b. Everything in the project catalog (`rgersxdatabricks_hackathon.hub_pulse`)

| What | Where in Unity Catalog |
|---|---|
| 31 Delta tables (bronze/silver/gold) | `rgersxdatabricks_hackathon.hub_pulse.*`; every table has a comment and tags `project=hub_pulse`, `layer`, `source` (see `sql/05_governance.sql`) |
| Raw open data | volume `raw`: `/Volumes/rgersxdatabricks_hackathon/hub_pulse/raw/gtfs/` (GTFS .txt files + original `google_transit_20260925.zip`) and `/raw/tspr/` (TSPR 2025 CSVs + Transit Service Guidelines PDF) |
| All source code (snapshot) | volume `code`: `/Volumes/rgersxdatabricks_hackathon/hub_pulse/code/hub_pulse/` (sql, notebooks, dashboard, genie, app source without node_modules/dist/.env, deck, analysis, this HANDOFF.md) |
| Hackathon pings (unchanged) | `rgersxdatabricks_hackathon.ubc_rogersxdatabricks_hackathon.synthetic_data_ubc` (organizers' table; not copied) |

To refresh the code snapshot after local changes, from `hub_pulse/`: stage with `rsync -a --exclude node_modules --exclude dist --exclude .databricks --exclude .env --exclude __pycache__ ./ <stage>/` and then run `databricks fs cp -r --overwrite <stage> dbfs:/Volumes/rgersxdatabricks_hackathon/hub_pulse/code/hub_pulse --profile DEFAULT`.

## 5. Tables (`rgersxdatabricks_hackathon.hub_pulse`)

- **Bronze:**
  - `gtfs_stops`, `gtfs_routes`, `gtfs_trips`, `gtfs_stop_times`, `gtfs_calendar`, `gtfs_calendar_dates`
  - `tspr_bus_route_year`, `tspr_bus_route_timerange`, `tspr_bus_peakload`, `tspr_seabus_hourly`, `tspr_skytrain_station_hourly`, `tspr_skytrain_station_year`, `tspr_wce_station_hourly`
- **Silver:**
  - `dim_hub`, `dim_origin` (hand-geocoded centroids)
  - `silver_visits` (typed pings + day type + TSPR season/period)
  - `silver_hub_stops`, `silver_route_lookup` (GTFS→TSPR line keys), `silver_hub_departures`
- **Gold:**
  - `gold_hub_daily` (with `surge_index` and `is_surge`)
  - `gold_hub_profile_hourly`, `gold_hub_supply_hourly`
  - `gold_hub_gap_hourly` (`gap_index`, `status`, `departures_short`)
  - `gold_route_stress` (TSPR per line), `gold_hub_timerange_stress` (demand vs TSPR peak load per period)
  - `gold_origin_access`, `gold_waterfront_validation`, `gold_seabus_hourly`
  - `gold_hub_forecast` (`ai_forecast` to 2026-10-31)
  - `gold_recommendations_base` + `gold_recommendations` (`ai_query`, model `databricks-qwen35-122b-a10b`, prompt restricted to the evidence)

## 6. Deliverables and IDs

| Item | Where |
|---|---|
| SQL pipeline | `hub_pulse/sql/01_bronze.sql`, `02_silver.sql`, `03_gold.sql`, `04_insights.sql`, `05_governance.sql` (tags) |
| Run SQL | `./run_sql.sh sql/<file>.sql` (splits on `;` at end of line); `python3 q.py "<sql>"` or `q.py @file.sql` prints a table |
| Notebook 01 (pipeline, SQL) | workspace `/Users/yahmed06@student.ubc.ca/hub_pulse/01_build_pipeline`, generated by `build_notebook.py` → `notebooks/01_build_pipeline.sql`. Attach it to a SQL warehouse (`ai_forecast` needs one). **Never run end to end.** |
| Notebook 02 (findings, Python + plotly) | workspace `.../hub_pulse/02_findings`, local `notebooks/02_findings.py`. Ran successfully as a serverless job. |
| AI/BI dashboard | id `01f1b9ba38eb19b380359bc436db086f`, published: https://dbc-4e20a0bf-b569.cloud.databricks.com/sql/dashboardsv3/01f1b9ba38eb19b380359bc436db086f/published?o=7474647815578778 . Source: `dashboard/datasets.py` + `dashboard/build_dashboard.py [genie_space_id]` → `dashboard.json`. **Not yet visually verified.** |
| Genie space | id `01f1b9ba76251c4684f359bee3795d70` ("Hub Pulse — Ask about Vancouver transit hubs"). Source: `genie/build_genie.py` (`--validate` checks the example SQL). Tested via API; answers were correct. Linked to the dashboard. |
| Databricks App | name `hub-pulse`, URL https://hub-pulse-7474647815578778.aws.databricksapps.com . Source: `app/hub-pulse/` (AppKit 0.57, analytics + genie plugins). Status RUNNING; tested fully locally, **not in the deployed browser**. |
| Pitch deck | https://claude.ai/artifact/1asgLPLcSaabT3AboL9BGg (11 slides, private: share it via the Share menu before judges can open it). Sources: `deck/build_charts.py`, `deck/build_slides.py` → `deck/project/`. |
| Scenario numbers | `analysis/scenarios.ts`, `analysis/alloc.ts` (+ `hours_all.json`); run with `npx --prefix app/hub-pulse tsx analysis/scenarios.ts analysis/hours_all.json` |

### App details (`app/hub-pulse/`)

- **Queries** in `config/queries/`: `hub_hours`, `hub_overview`, `route_crowding`, `origin_access`, `recommendations`, `weekly_trend`. Each has `-- @param hub STRING` annotations and fully qualified table names.
- **Planner engine:** `client/src/lib/planner.ts` (pure, 9 vitest tests in `planner.test.ts`).
  - `planAdd`: greedy.
  - `planShift`: cost-neutral, with a capacity-safe floor, `minDepartures = ceil(deps × peakLoad / 85)`, min 2.
  - `evaluate`: metrics.
- **Pages:**
  - `pages/PlannerPage.tsx`: keyed by hub|dayType so state resets. The default strategy is "Add" when peak load ≥ 95%, else "Rebalance".
  - `pages/AskGeniePage.tsx`: all 5 trust features (identity via `/api/whoami`, generated SQL panel, status, disclaimer, on-behalf-of note).
  - `pages/AboutPage.tsx`.
- **Components:** `components/{Kpi,HourTable,ContextPanels}.tsx`.
- **Access and identity:**
  - The app service principal (`a2e21b51-fdf3-4dba-8ded-5b3e4addd594`) was granted `USE CATALOG` on `rgersxdatabricks_hackathon` and `USE SCHEMA, SELECT` on `hub_pulse`. Without this, the platform build fails at typegen.
  - Planner queries run as the service principal; Genie runs on-behalf-of the user (`user_api_scopes: dashboards.genie`).
- **Checks and deploy:**
  - Checks: `npm run typecheck`, `npm run lint`, `npm test`, `databricks apps validate --profile DEFAULT`.
  - Deploy: `databricks apps deploy --profile DEFAULT` (from `app/hub-pulse`).
  - Generated types in `shared/appkit-types/` are excluded from ESLint.
- **Local dev:** start the `hub-pulse` config in `.claude/launch.json` (port 8123).

## 7. Open items and next steps

1. **Visual check of the dashboard and the deployed app.** The user must sign in to Databricks in the browser pane. Check every dashboard widget renders: forecast-line, heatmap, symbol map, counters with the MEASURE, and the recommendations table. Fix any "unsupported widget" issues with `dashboard/build_dashboard.py`, then run `databricks lakeview update <id> --dataset-catalog rgersxdatabricks_hackathon --dataset-schema hub_pulse --serialized-dashboard "$(cat dashboard.json)"` + `publish`.
2. **Optional reproducibility proof:** run notebook 01 end to end on the warehouse. Note it regenerates the LLM recommendation text, which may change wording.
3. **Share access:** the pitch deck (Share menu), plus workspace access for judges to the dashboard, Genie space and app.
4. **Possible polish:**
   - A per-hub Genie benchmark set.
   - Add origins to the app map.
   - Weekend/exam-season scenario presets.
   - A slide with an app screenshot (needs the deployed-app screenshot first).
5. **Limitations to state honestly:**
   - Pings count people at a hub, not boardings (hence the share-based comparison).
   - Origin centroids are approximate.
   - 10 months of history limits seasonal forecasting.
   - Peak load is per TSPR time period and busiest line, re-projected assuming riders spread evenly over the remaining buses.

## 8. How the user likes to work

- Wants an ambitious, "most impressive" result; chose the transit-only angle; wants all Databricks surfaces (notebooks, dashboard, app, Genie).
- Pointed to TransLink's *Managing the Transit Network* page as a data source; it was used heavily.
