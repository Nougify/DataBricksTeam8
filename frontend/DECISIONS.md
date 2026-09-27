# Decisions log

Answers from the frontend owner (2026-09-26) that fill gaps or resolve conflicts in `../spec.md` and `../message.txt`.
Where this file and the spec disagree, **this file wins**. Where it's silent, the spec wins; `message.txt` wins on field names and shapes.

## Process

| Topic | Decision |
|---|---|
| Pacing | Build milestones 1→5 in order, straight through, using subagents. Report after each milestone. |
| Git | **Don't commit.** The owner commits. Leave `../spec.md`, `../message.txt` and `../Onboarding_Guide.md` untouched. |
| Offline basemap | **Document only.** Don't generate the PMTiles extract, glyphs or sprites. `README.md` explains how. If the online style probe fails and `public/tiles/metro-vancouver.pmtiles` is missing, render a plain themed background; hubs, arcs, surges and buses still draw. |
| Screenshots | Playwright (devDependency, Chromium). Smoke test plus screenshots at 1440, 1024 and 390 px in light and dark. |

## Identity

- `src/config/app.ts`: name is exactly `CrowdCost`. The tagline is an empty string, so render nothing for an empty tagline.

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
