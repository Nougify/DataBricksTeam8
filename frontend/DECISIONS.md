# Decisions log

Answers from the frontend owner that fill gaps or resolve conflicts in `../spec.md` and `../backendspec.md`.
Where this file and the spec disagree, **this file wins**. Where it's silent, the spec wins; `backendspec.md` (v3) wins on field names and shapes.
The **v3 section below supersedes** anything later in this file that assumes the v2 contract (`message.txt`, now deleted): Surge objects, `/hubs`, forecast/origins/timeline/backtest endpoints, `PUT /simulation/*`, and the scripted-scenario numbers.

## v3 contract and Milestone 2 (2026-09-26/27)

### Process

- Work in `frontend/` (`web/` was renamed on main). **No subagents** this time. Phases: Codex fixes + `web/` cleanup → v3 migration → M2 UI. Post an update after each phase, run checks + screenshots, **don't commit**.
- Also: silence the ESLint warning from the generated `public/mockServiceWorker.js`, fix the Atkinson Hyperlegible Next font-override build warning, point `ARCHITECTURE.md` at `backendspec.md` v3, and update `../handoff.md` at the end.
- Codex follow-ups: make `useThemeChoice` hydration-safe properly (no `getServerSnapshot` warning, no mismatch); strip the garbled UTF-16 "Implementation Status" block from the end of `../spec.md`.
- Old `web/`: copy `web/.env.local` into `frontend/` if frontend has none, move `web/screenshots` into `frontend/screenshots`, then delete `web/`.

### Contract (zod)

- Fields `backendspec.md` lists are **required and strict**. Extra fields the real backend sends are **optional/nullable**, and the UI uses them when present: `Clock.local_date`, `hour`, `approval_mode`, `auto_pause_on_proposal`; `Bus.heading_deg`, `source`; `AdditionalTrip.source_route`, `destination`, `selected_candidate`, `movement_plan` (deadhead/service/return paths).
- Endpoints and WS as in v3 (and the real backend): `POST /clock/pause|resume|speed|seek` (bodies `{speed}` / `{time}`), `GET /ws` (first frame = `/state` snapshot, then `{type, seq, epoch, simulation_time, data}` envelopes with `clock.updated`, `dispatch_event.updated`, `proposal.created`, `proposal.updated`, `trip.updated`, `bus.updated`, `system.reset`, `system.error`). Errors are `{error:{code,message}}`.
- **Auto-pause** has no API. The top bar shows `Clock.auto_pause_on_proposal` as a **read-only indicator** with a tooltip saying it's set on the backend; hidden if the field is absent.

### Where data comes from ("hybrid")

- **Live state** (clock, dispatch events, proposals/trips, buses, routes) comes from the v3 backend, or from MockSim in mock mode.
- **Analytics** come from **static JSON bundled in the frontend** (used in both mock and real mode), each with a visible source:
  - Hubs (id, name, lat/lon, catchment) and **presets** live in frontend config.
  - **Hourly actual / forecast / typical** come from `rgersxdatabricks_hackathon.model.surge_forecast_hourly` (split `history`, full range, both targets). Mapping: actual = `actual`, forecast = `predicted`, typical = `normal`, surge line = `normal × 1.25`. Hours it doesn't cover (before 2025-11-29) are synthesized and labelled "estimate".
  - **Scorecard**: `model.surge_model_metrics`. Per-hub precision/recall/F1 at **60 min lead** in the strip and badges; 30/60/120 min in About. There's no "median lead time"; the copy says "1 h ahead".
  - Origins, daily timeline, exam/holiday events, validation: the existing `src/mocks/data` snapshots, which move to a shared analytics location.
  - Bundle the **full range**, compacted (columnar JSON, lazy-loaded per hub or month).
- The **dispatch-event feed** for mocks and presets is `model.surge_recommendations_backtest` (the full range, 3 hubs), snapshotted and mapped to v3 names: `hub_id`→`surge_location`, `route_key`→`route`, `destination_share_pct`→`destination_share`. It's queried read-only with `--profile DEFAULT`.
- **Timestamps** in those tables are **Vancouver wall time stored as UTC**. Read `2025-12-06T13:00Z` as 13:00 America/Vancouver. *Open item for the data owner.*

### Surges → dispatch events

- There's no Surge object. **DispatchEvents are the surges**: surge index = `surge_ratio` (predicted/normal); the window is anchored on `event_time`; non-hub events use `DispatchEvent.location`.
- **Episodes (display only):** consecutive visible events for the same hub, with gaps of 30 min or less, are grouped into one "surge episode" with a window and peak index. Halos, the overview's "next surge", map surge markers and the timeline use episodes. Individual events and proposals are listed under their episode. Data is never merged.
- Vocabulary: always **pings**. `predicted_people` = "forecast pings", `normal_people` = "typical pings", `surge_ratio` = "surge index".

### Now chart

- Real forecast (above). **No 80% band**; the legend/tooltip says no interval is published.
- A small **arrivals / departures toggle** (default arrivals) drives both the chart and the hub KPIs.
- Replace the 3/6/12/24 h horizon selector with a **window selector**: next 6 / 12 / 24 h plus matching history. No per-horizon vintage claims.
- **Don't rescale** the forecast to match events. Overlay visible dispatch events as markers (at `event_time`, value = forecast pings, tooltip with surge index and lead time), each with its own source.

### Origins

- "Where the surge crowd is headed" = the recommendations of the hub's visible dispatch event(s): destination, `destination_share` %, and the recommended route bullet. Source: the Databricks dispatch event.
- Feed destinations ("NewWestminster") match `dim_origin` names case- and space-insensitively. Display the `dim_origin` spelling. Unmatched names are shown as text only (no arc).

### Timeline

- Keep the bundled retrospective surge days and exam/holiday bands ("Retrospective index"). Also mark dispatch events that have **already become actionable** up to the current sim time. Never show future events.

### MockSim (v3)

- **Mirror the backend rules:** events activate at `actionable_at` (proactive when `available_at` is set). Sort recommendations by priority and take the first whose route exists in the mock routes. Bus count = `ceil(extra_bus_trips_est)`, capped by the per-event max (3) and free buses; zero creates no proposal. Approval timeout is 30 sim-min; auto-pause on proposal is on. Reject or expiry releases the bus. Approval mode is MANUAL.
- **The mock fleet mirrors `backend/config/fleet.json`** (currently 3 × 50-seat buses: 2 at UBC, 1 at Waterfront, all homed at UBC). Running out of buses shows up honestly as `NO_BUS_AVAILABLE`.
- Mock routes include the real GTFS routes named in the bundled feed rows, so recommendations resolve.
- Seek is deterministic, as before.

### Presets and the demo story

- Keep the preset **days** (UBC Sat 2025-12-06, Park Royal Fri 2025-12-26, Waterfront Sat 2026-07-25, plus the normal weekday and Saturday late night), but **use real data and numbers**. For example, UBC Dec 6 peaks at 1.99× at 13:00, the lead is 60 min, and the top recommendation is route 49 → Surrey.
- Preset time = **30 min before the first `available_at` of that hub's highest-peak episode** that day. The exact times are recorded below once computed.

### 2a answers (2026-09-27)

- **Recommendation eligibility (overrides "first whose route exists" above):** MockSim mirrors the backend. It takes the first recommendation, by priority, that is a **bus-mode route serving the hub**. Rail, SeaBus, WCE and routes that don't call at the hub are skipped. If none qualifies, the event becomes `NO_MATCHING_ROUTE`. The destination stop is the route-shape point nearest the destination's `dim_origin` centroid, after the hub point.
- **409s mirror the backend:** `{error:{code:"HTTP_ERROR", message}}` with the backend's messages ("proposal has expired", "trip is not proposed", …) and no `trip`. The client maps known messages to the spec §9.3 copy and refetches the trip.
- **Feed routes that don't call at a hub** (19, 240, 246, 2, 23, 6, 241, 247, N9) are snapshotted read-only from GTFS bronze, using the routes.json method, with `serves_hub_ids: []`. They're for display only and are never dispatchable.
- **Real-backend smoke test:** run against the compose backend's fixture window (2026-07-10 09:00–15:00). Don't change `backend/` or its env.

### Preset times (computed 2026-09-27 from the bundled feed)

Episodes are consecutive events for a hub with gaps of 30 min or less. The highest-peak episode's first `available_at`, minus 30 min:

| Preset | Hub | Highest-peak episode (event_time) | Peak surge index | First `available_at` | Preset time |
|---|---|---|---|---|---|
| UBC exam weekend | ubc | Sat 2025-12-06 09:00–23:30 (30 events) | 1.99× at 13:00 | 08:00 | **2025-12-06T07:30:00-08:00** |
| Park Royal Boxing Day | park-royal | Fri 2025-12-26 12:00–16:00 (9 events) | 1.44× at 14:30 | 11:00 | **2025-12-26T10:30:00-08:00** |
| Waterfront summer Saturday | waterfront | Sat 2026-07-25 09:00–23:30 (30 events) | 1.79× at 10:00 | 08:00 | **2026-07-25T07:30:00-07:00** |
| Normal weekday | — | no events on 2026-02-11 | — | — | 2026-02-11T13:00:00-08:00 (unchanged) |
| Saturday late night | waterfront | — | — | — | 2026-02-14T22:00:00-08:00 (unchanged). Note: Waterfront has events from 21:00 to 23:30 that night (up to 2.27×), so this preset isn't quiet. |

- Every feed destination matches a `dim_origin` name exactly, and every feed route key matches a bundled route `line_key` ("Expo Line", "Canada Line", "SeaBus", "49", …). Matching is still case- and space-insensitive.
- Top recommendation: UBC is 49 → Surrey; Park Royal is R2 → North Vancouver; Waterfront is Expo Line → Surrey (skipped as rail, so a lower-priority bus recommendation is used).

### 2b answers (2026-09-27)

- **Origins basis:** the bundled data has no per-hour *actual* origin mix, so the toggle is **Typical hour** (default: origin_hourly for the sim's day type and last full hour, "Typical Saturday, 12:00–13:00") vs **Whole dataset** (origins.json). There's no "Actual" option. URL `basis` is `typical` (default, omitted) or `all`.
- **Approval queue (overview):** Approve and Reject work now (existing mutation hooks, "Trip approved" / "Proposal rejected" toasts, 409 copy). Preview arrives with map preview mode in M3, so there's no Preview button yet.
- **Timeline dispatch markers:** come from `src/data/feed_days.json`, a compact per-hub, per-day summary of the bundled feed (first `actionable_at`, peak surge index), derived by `scripts/derive-feed-days.mjs`. Only days whose first `actionable_at` is at or before the sim time are shown. It's the same in mock and real mode.
- **Defaults chosen without asking** (flag if wrong):
  - Hours before the forecast snapshot (before 2025-11-29) show no forecast: the Now chart shows an empty state with "Jump to Nov 29 2025".
  - The current hour has no sub-hour actual in the snapshot, so the chart shows actuals through the last full hour. There's no "so far" point.
  - Future actuals in the snapshot are never drawn: actual stops at the last full hour.
  - Overview hub cards use arrivals (like the halos). The Now tab's arrivals/departures toggle drives its own KPIs and chart and lives in the store, not the URL.
  - Exam and holiday events are restored from the v2 mock as `src/data/events.ts` (UBC Dec 2025 and Apr 2026 exam periods, the 10 BC holidays), each with its source link. They feed driver chips and timeline bands.
  - Tabs other than Now and Origins show a short "arrives in a later milestone" note.

### Mock-only deviations from the backend

- **Retention:** the backend keeps every event since the simulation start in `/state`. MockSim keeps events whose `actionable_at` falls in the last **24 sim-hours**, plus their trips, so `/state` stays small. A seek replays from T − 24 h with the initial fleet.
- **Service leg:** the snapshot has no GTFS stop-time offsets, so a mock service leg runs at **20 km/h** along the representative shape. Deadhead and return legs are straight lines at 30 km/h, like the backend's `straight_line` provider.

## Process

| Topic | Decision |
|---|---|
| Pacing | Build milestones 1→5 in order, straight through, using subagents. Report after each milestone. |
| Git | **Don't commit.** The owner commits. Leave `../spec.md`, `../message.txt` and `../Onboarding_Guide.md` untouched. |
| Offline basemap | **Document only.** Don't generate the PMTiles extract, glyphs or sprites. `README.md` explains how. If the online style probe fails and `public/tiles/metro-vancouver.pmtiles` is missing, render a plain themed background; hubs, arcs, surges and buses still draw. |
| Screenshots | Playwright (devDependency, Chromium). Smoke test plus screenshots at 1440, 1024 and 390 px in light and dark. |

## Identity

- `src/config/app.ts`: name is exactly `(changelaterBUSALLOVERME)`. The tagline is an empty string, so render nothing for an empty tagline.

## Seed data

- Pull real aggregates **read-only** from Databricks with `--profile DEFAULT` (catalog `rgersxdatabricks_hackathon`, schema `hub_pulse`). Snapshot them as JSON in `src/mocks/data/`, and note the queries in `src/mocks/data/README.md`.
- Hourly mock pings = the real daily total (`gold_hub_daily`) × that hub/day-type/hour's share of the day (real hourly profile) × seeded noise, so hours sum to the timeline.
  - **Exception:** on the 3 scripted surge days, hours follow the scripted surge-index curve (typical × curve × noise) so the demo story holds, and may not sum exactly to the daily total.
- "Typical" = same hub, day type and hour, averaged over the trailing 8 weeks before that time, using the pings above.
- Routes: about 10 **real** GTFS routes serving the hubs (99, R4, 25, 14, R2, 250, 257, N17, SeaBus, plus whatever the scenarios need), with real `route_id`, names and colours. Shapes are built from one representative trip's stop sequence (bronze has no `shapes.txt`), at most 300 points.
- Backtest: the contract's placeholder numbers, labelled **"Mock"** in the UI.
- Validation: the real rows and `r` from `gold_waterfront_validation`.
- Events: UBC Dec 2025 and Apr 2026 exam periods (UBC academic calendar URL) and the 10 BC holidays in `hub_pulse/sql/02_silver.sql` (BC government URL). **No invented sports or concert events.**

## Clock and presets

- `default_start_time` (initial state and **Reset demo**) = the normal-weekday preset time: **2026-02-11T13:00:00-08:00**.
- The normal-weekday preset is `{ id: "normal-weekday", label: "Normal weekday 13:00", hub_id: null, time: "2026-02-11T13:00:00-08:00" }`. The other presets follow `message.txt` §13.
- Clock bounds follow the contract: `min_time` 2025-11-15T00:00:00-08:00, `max_time` 2026-08-31T23:00:00-07:00.

## MockSim behaviour

- **Surges:** only the scripted scenarios create Surge objects. Other real surge days show elevated pings and forecasts, but no surge object.
- **Forecast consistency:** forecasts issued before a scripted surge's `detected_at` are damped toward typical, so they stay below the 1.25x threshold. The surge first crosses the line in the forecast issued at `detected_at`. After resolution, the HISTORY rows honestly show which horizons caught it.
- **Expiry:** every proposal expires 45 sim-min after `proposed_at`. When UBC proposal A is **rejected or expires**, the surge returns to PENDING and alternative B is proposed at that instant, with `replaces_trip_id` = A. If the sim is running and auto-pause is on, it pauses again. If B is also rejected, the surge becomes `NO_BUS_AVAILABLE`. If a surge has no approved trip when its window starts, it becomes `EXPIRED`.
- **Fleet:** 8 spare buses: 6 on low-load routes and 2 at depots. They're parked at a point on their route or depot; only dispatched buses move. A dev-only flag spawns 30 moving buses to test 3600x smoothness.
- **Dev flags (dev only):**
  - `?mock_nonhub=1` adds a non-hub surge at Broadway-City Hall.
  - `?mock_state=<view>:loading|empty|error` forces a view's state.
  - A "Drop connection" item in the overflow menu.

### Scenarios

| Scenario | Detected | Window | Peak index | Severity | Drivers | Trip(s) |
|---|---|---|---|---|---|---|
| UBC exam weekend, Sat 2025-12-06 | 10:00 | 13:00–15:00 | 1.79 predicted, 1.88 actual | HIGH | EXAM "UBC December exam period" (`evt-ubc-exams-2025w1`) | A: route 25 bus (SPARE, 48% → 55%) → extra 99 trip (104% → 91%); dispatch 12:20, arrive 12:40, depart 12:55, complete 13:45; deadhead 20 min / 11.4 km; +77 capacity. B (alt): route 14 bus → extra R4 trip. After the trip, the bus returns to its home point. Destinations: Surrey 14.5%, Richmond 11.6%, New Westminster 6.3%, North Vancouver 5.6%. |
| Park Royal Boxing Day, Fri 2025-12-26 (holiday → `sun_hol`) | 09:00 | 12:00–16:00 | 1.47 | LOW | HOLIDAY "Boxing Day" | Extra **R2** Marine Dr trip Park Royal → Phibbs Exchange, departing 12:10. Bus from depot **"North Vancouver Transit Centre"** (`donor_route` null). Destinations: top real Park Royal origins. |
| Waterfront, Sat 2026-07-25 | 11:00 | 14:00–17:00 | 1.83 | HIGH | **none** (`drivers: []`; UI says "No known driver") | One proposal: a bus from the lowest-load route serving Waterfront → an extra trip on the most overcrowded one, both picked from real TSPR data. Destinations: top real Waterfront origins. |
| Saturday late night (preset 2026-02-14 22:00) | — | — | — | — | — | **No tweak.** Real timetable and pings. The "waiting-alone risk" flag (share ≥ 1% and departures ≤ 1) will rarely or never fire; that's accepted. |

## UI details

- **Network scorecard strip:** recall = Σ(recall_pct × actual_surge_hours) ÷ Σ actual_surge_hours across `by_hub`, which is exact. Lead time shows the **range** of hub medians, e.g. "3–5 h ahead". A tooltip explains both.
- **Docker:** the `web` service builds with `NEXT_PUBLIC_USE_MOCKS=true` until the backend exists.
- **Stack:** Next.js 16 (App Router), React 19, TS strict, Tailwind v4, shadcn/ui (radix-nova), sonner, echarts (core, own wrapper), react-map-gl/maplibre + maplibre-gl, pmtiles, TanStack Query v5, Zustand, zod v4, MSW v2, Vitest, Playwright. Fonts come from `next/font`, which self-hosts at build time.

## Later answers

- **Timeline scrubber (deviates from spec §17.1):** three labelled lanes, one per hub (UBC / Waterfront / Park Royal), with surge markers placed in their hub's lane. Hub identity comes from position and label, not colour. The selected hub's lane is emphasised. See DESIGN.md.
- **Databricks:** `--profile DEFAULT` now points at the HANDOFF workspace (dbc-4e20a0bf-b569), which holds `rgersxdatabricks_hackathon.hub_pulse`.
