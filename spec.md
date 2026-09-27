# Frontend build spec: transit surge console (working title)

> **Audience:** a Claude coding agent that will build this app. This file is the spec. The backend API contract is **`backendspec.md`** (v2, with `[CHANGED]`/`[NEW]` tags) in the repo root. Where the two disagree on a field name or shape, `backendspec.md` wins.
>
> **Status:** decisions below were confirmed with the frontend owner. Nothing here is a guess unless it's marked **(assumption)**.

---

## 0. Read this first

1. Read this whole spec, then `backendspec.md`, then `AGENTS.md` (repo rules).
2. Load the two UI/UX skills (section 4) **before** designing anything.
3. Build in `web/`. Outside `web/`, the only change allowed is **adding one `web` service to `docker-compose.yml`**.
4. **Do not modify or delete:**
   - `hub_pulse/` (including the old AppKit app in `hub_pulse/app/hub-pulse/`, which this app replaces but which stays in the repo)
   - `frontend/`
   - `backend/`
   - `backendspec.md`
5. The backend doesn't exist yet. Build everything against **mock mode** (section 12), which implements the `backendspec.md` contract exactly. Switching to the real backend must be a flag flip.
6. Work in milestones (section 19). After each one, run the checks in section 18.

---

## 1. Problem and goal

**Problem statement (verbatim from the team):**

> TransLink plans service on fixed schedules updated only a few times a year. Real demand spikes around exams, holidays, events and nightlife, and those spikes don't line up with the timetable. The result is overcrowded stops, pass-ups, and people waiting alone late at night with no bus coming, while other routes run with spare capacity at the same moment. How might we use cell tower traffic to predict demand surges at major hubs hours ahead, and automatically recommend moving spare buses from low-demand routes to where they're needed?

**What the app is:** a one-screen **operations console for a TransLink service planner or dispatcher**. It does five things:

- Shows a map of Metro Vancouver with three hubs highlighted: **UBC**, **Waterfront Station** and **Park Royal**.
- Replays history (Nov 2025 – Aug 2026) on a simulation clock owned by the backend.
- Shows each hub's current demand and an **hourly forecast** 3–24 hours ahead, next to what actually happened.
- Shows **where people at the hub are coming from** (the `origin` column) as flow arcs on the map.
- Lets the dispatcher **preview, approve or reject** backend-proposed moves of spare buses from low-demand routes to surging hubs.

**Secondary audience:** hackathon judges during a 5-minute live demo.

- The interactive tool is worth **25 of 55 points**.
- Insights must be **traceable to the data**. Every number on screen has a visible source.
- Originality counts, so this must not look like a stock dashboard.

### 1.1 The demo story the app must support (≈3 minutes of the 5-minute pitch)

1. The app opens on the **network overview**. The sim is paused on a normal day. Three hubs pulse gently on the map.
2. Presenter picks the preset **"UBC exam weekend"**. The clock jumps to Sat 2025-12-06 09:00, and UBC is selected.
3. Presenter presses **Play** at 300x. Around 10:00 the backend forecasts a surge at UBC for 13:00–15:00 at **~1.8x typical**, three hours ahead.
   - UBC's halo grows.
   - A toast appears: "New proposal".
   - The sim **auto-pauses**.
4. **Now** tab: the forecast chart shows the dashed forecast climbing above the 1.25x surge line, with an 80% band. The driver chip reads "UBC December exam period".
5. **Origins** tab: arcs light up from Surrey, Richmond, New Westminster and North Vancouver. The callout reads "~48% of regional pings come from areas with no one-seat ride".
6. **Dispatch** tab: the proposal is "Move 1 bus from route 25 (48% load) to add a 99 B-Line trip (104% → 91%)".
   - Presenter clicks **Preview**. The map shows the deadhead path (dashed) and the service path (solid).
   - Presenter clicks **Approve**.
7. Play resumes. The bus animates to UBC and runs the trip. At 15:00 the surge resolves, and the card shows **"Predicted 1.79x, actual 1.88x"**.
8. Presenter opens **About**, which shows the model scorecard (surge recall, median lead time) and the validation chart (pings vs real SkyTrain boardings, r = 0.92).

Every step above must work in mock mode.

---

## 2. Hard constraints

| Area | Requirement |
|---|---|
| Location | `web/` at repo root |
| Framework | Latest stable **Next.js, App Router**, React 19, **TypeScript strict**. Use npm. |
| Styling | **Tailwind CSS** + **shadcn/ui** |
| Charts | **Apache ECharts**, client-only through a thin wrapper |
| Map | **MapLibre GL JS** via **react-map-gl/maplibre**, plus the **pmtiles** protocol for offline |
| State and data | **TanStack Query** for REST, **Zustand** for live simulation state, **zod** for contract schemas |
| Mocks | **MSW** (browser) plus an in-browser mock simulator and fake WebSocket |
| Theme | **next-themes**. Light and dark with a toggle; defaults to the system setting. |
| Tests | **Vitest** for unit tests. Playwright is optional for smoke tests and screenshots. |
| Port | **3001**, for both dev and prod |
| Not allowed | **No Lyne design system.** No Genie/chat. No auth. No persistence beyond what the backend stores. |
| Name | The name is a placeholder. It lives **only** in `web/src/config/app.ts` (name plus a one-line tagline). Nothing else hardcodes the name, including the page title and About. |
| Time zone | Every displayed date and time is formatted in **America/Vancouver**, whatever the viewer's machine is set to. |
| Devices | Desktop-first (1280–1920 px, projector). Usable on tablet. Phone gets a stacked layout. |
| Branding | Do **not** use TransLink logos or wordmarks, and don't imitate TransLink's brand. TransLink is named only as a data source. |

### 2.1 Vocabulary (use these words consistently everywhere)

| Say | Don't say | Meaning |
|---|---|---|
| **pings** | riders, visits, passengers, people count | Device pings at a hub (the hackathon data) |
| **surge index** | demand multiplier | Pings ÷ typical pings. 1.0 = typical; 1.25 or more = surge. |
| **typical** | normal, baseline, average | Same hub, day type and hour, averaged over trailing weeks |
| **forecast** | prediction (fine in prose) | The model's hourly pings estimate |
| **proposal** | recommendation (for a single trip) | A trip the engine suggests. It needs approval. |
| **extra trip** | dispatch (fine as a verb) | An approved one-time trip |
| **spare route** / **donor route** | low-demand route (fine in prose) | The route a bus is pulled from |
| **load** | crowding % | Peak load as a % of vehicle capacity |
| **one-seat ride** / **transfer required** | direct/indirect | Whether a line serving the hub reaches the origin area |

Actions keep one name through the whole flow: the button **Approve** leads to the toast **"Trip approved"**. The button **Reject** leads to **"Proposal rejected"**.

---

## 3. Hubs and fixed facts

| `hub_id` | Display name | Data `location_name` | Lat, Lon | Catchment |
|---|---|---|---|---|
| `ubc` | UBC | UBC | 49.2606, −123.2460 | 800 m |
| `waterfront` | Waterfront Station | Waterfront Station | 49.2857, −123.1115 | 300 m |
| `park-royal` | Park Royal | Park Royal Mall | 49.3265, −123.1380 | 300 m |

These are defined in `hub_pulse/sql/02_silver.sql` (`dim_hub`). At runtime they come from `GET /hubs`. The table above is only for mocks and a first-paint fallback.

- **Origin areas:** 36 in total, defined in `dim_origin` (`hub_pulse/sql/02_silver.sql` lines 82–104).
  - 29 have centroids: Vancouver neighbourhoods, Metro municipalities, and the North Shore.
  - 7 are out of region with **no coordinates**: British Columbia Other, Ontario, Alberta, Manitoba, Saskatchewan and Territories, Atlantic Canada, International.
- **Day types:** `mf` (Weekday), `sat` (Saturday), `sun_hol` (Sunday / holiday).
- **Late night:** hours 0–4 (00:00–05:00).
- **Replay range:** Nov 2025 – Aug 2026. It crosses DST on **2025-11-02** (a 25-hour day) and **2026-03-08** (a 23-hour day).

---

## 4. UI/UX skills: load both before designing

### 4.1 `frontend-design` (visual identity)

- Install it if missing: the user runs `/plugin install frontend-design@claude-plugins-official`. If you can't install plugins, ask the user.
- Follow its **two-pass process**:
  1. Write a compact design plan to **`web/DESIGN.md`**:
     - 4–6 named hex colours **per theme**
     - Typefaces and their roles
     - A layout concept with an ASCII wireframe
     - Principles
  2. Critique that plan against the skill's list of "generic defaults", revise it, then build.
- Ground the design in the subject. The subject is **real-time transit operations in Metro Vancouver**: departure boards, route bullets and line colours, timetables, dispatch radios, the harbour and North Shore mountains, rainy night streets.
- Following that skill:
  - Spend boldness in **one** place. The recommended place is the map, with its hub pulses and origin arcs.
  - Keep panels quiet and disciplined.
  - Avoid templated tells: all-caps eyebrow labels, identical rounded cards everywhere, gradient washes, and "→" on every link.
- Use tabular numerals for all numbers.

### 4.2 `databricks-app-design` (data-screen rules)

- **Where:** `.databricks/aitools/skills/databricks-app-design/SKILL.md`, plus its `references/dashboard-patterns.md` and `references/ibcs-notation.md`.
- **Apply:** its composition, notation and required-state rules.
- **Ignore:** its AppKit component bindings and anything about Genie/AI chat. There's no chat surface.
- **Mapping to our stack:**

| Skill concept | Use in this app |
|---|---|
| `Skeleton` | shadcn `Skeleton` |
| `Empty` (with a next action) | A small `EmptyState` component (title, one sentence, one action button) |
| `Alert` (errors, stale data) | shadcn `Alert` |
| `Card` / `Badge` / `Tabs` / `Table` / `Tooltip` | shadcn equivalents |
| AppKit charts | ECharts through our wrapper |
| `colorPalette` + semantic tokens | CSS custom properties (section 14.2), read by Tailwind, ECharts and MapLibre |

**Rules that are non-negotiable:**

1. **Every data view** handles four states:
   - **loading:** a skeleton
   - **empty:** says why, and offers one next action
   - **error:** inline, says what failed, has a Retry button, never a blank panel
   - **stale / partial:** shows what exists plus a freshness note, e.g. "Live connection lost. Showing data as of 13:00."
2. **Every KPI** shows a unit, a period, a comparison where one exists, and a **source**.
3. **Chart titles carry the message.** Write "UBC forecast to reach 1.8x typical at 13:00", not "Forecast".
4. **Honest scales:**
   - Bars start at 0.
   - Axes for index values show the 1.0 baseline.
   - Horizons are never truncated silently.
5. **IBCS scenario notation, the same everywhere** (charts, legends, map, chips):
   - actual = solid, dark
   - forecast = dashed or outlined, with a lighter band for the 80% interval
   - typical = thin grey

---

## 5. Layout

### 5.1 Desktop (≥ 1280 px)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR                                                                          │
│ [Name]  Sat Dec 6 2025 13:20 PST [Saturday]  [▶/❚❚] [1x 60x 300x 900x 3600x]    │
│         [Presets ▾] [Date+hour ▾] [Auto-pause ◉]  [● Live|Mock]  [☀/☾] [About]  │
│         [Reset demo]                                                             │
├──────────────────────────────────────────────────────┬───────────────────────────┤
│                                                      │ SIDE PANEL (~420 px)      │
│  MAP (fills remaining space)                         │                           │
│  ┌──────────────┐                                    │ No hub selected:          │
│  │ Layers ▾     │         ◎ Park Royal               │   NETWORK OVERVIEW        │
│  └──────────────┘                                    │                           │
│                 ◎ Waterfront                         │ Hub selected:             │
│      ◎ UBC  ~~~ arcs ~~~ ● Surrey                    │   [← All hubs] UBC        │
│                                                      │   Now | Origins | Dispatch│
│                              ● Richmond              │   Routes | Late night |   │
│                                                      │   Planner | Findings      │
│  [legend]                          [attribution]     │   (scrolls)               │
├──────────────────────────────────────────────────────┴───────────────────────────┤
│ TIMELINE SCRUBBER (~88 px): daily pings per hub, Nov 2025 → Aug 2026,            │
│ surge days ▲, events ▮, "now" handle ┃ (drag to seek)                            │
└──────────────────────────────────────────────────────────────────────────────────┘
```

This wireframe shows structure only. `web/DESIGN.md` decides the look.

### 5.2 Tablet (768–1279 px)

- The side panel becomes a right-side **drawer** (380 px) over the map. It opens automatically when a hub is selected, and a button re-opens it.
- The timeline switches to a compact 56 px mode with markers only.
- The top-bar controls that don't fit (presets, date picker, auto-pause, reset) move into an overflow menu.

### 5.3 Phone (< 768 px)

- The top bar shows only the name, clock, Play/Pause and a menu button holding every other control.
- The map takes the top ~45vh. The panel sits below at full width, with its tabs as a horizontally scrollable strip.
- The timeline is hidden behind a "Timeline" button that opens a bottom sheet.
- No horizontal page scroll.

---

## 6. Top bar

| Element | Behaviour | Data |
|---|---|---|
| App name | Taken from `config/app.ts` | — |
| Sim clock | Weekday, date, 24 h time and TZ abbreviation (PST/PDT) in America/Vancouver, plus a day-type badge. While running, it updates smoothly by extrapolating between ticks (section 11.3). | `Clock.current_time`, `speed`, `status`; WS `simulation.tick` |
| Play / Pause | Toggles. Disabled while a request is in flight. | `POST /simulation/resume`, `/pause` |
| Speed | Segmented control built from `/meta.allowed_speeds`. Each option's tooltip explains it, e.g. 60x = "1 sim-hour per real minute". | `PUT /simulation/speed` |
| Presets | Menu built from `/meta.presets` (label and description). Choosing one seeks and selects `hub_id`, or shows the overview if `hub_id` is null. | `PUT /simulation/time` |
| Date + hour picker | Popover with a calendar limited to `min_time`..`max_time`, an hour select (0–23) and a Go button | `PUT /simulation/time` |
| Auto-pause switch | Label: "Pause when a bus is proposed". Default on. | `PUT /simulation/settings`, `Clock.auto_pause_on_proposal` |
| Connection status | "Live", "Reconnecting…", "Offline" or **"Mock data"** (always visible in mock mode) | WS client state |
| Theme toggle | Light / dark / system | next-themes |
| About | Opens the About modal (section 10) | — |
| Reset demo | Seeks to `/meta.default_start_time`, pauses, sets speed to 60, clears the selection and closes previews | seek + pause + speed |

---

## 7. Map

### 7.1 Basemap and offline fallback

- **Online (default):** CARTO **Positron** GL style in light mode and **Dark Matter** GL style in dark mode.
- **Offline fallback:** at startup, probe the online style URL with a **3 s timeout**. If it fails, switch to:
  - a bundled **PMTiles extract** at `web/public/tiles/metro-vancouver.pmtiles`
  - bbox −123.35, 49.00, −122.50, 49.45; maxzoom ~13; aim for no more than ~30 MB
  - rendered with Protomaps basemap styles in light and dark flavours
  - **with glyphs and sprites served locally** from `web/public/`
- **Generating the extract:** document in `web/README.md` how to make it with the `pmtiles extract` CLI from a Protomaps daily build and that bbox. It needs internet once.
- If the extract file is missing, fall back to a plain themed background. Hubs, arcs, surges and buses still render.
- **Attribution:** always show © OpenStreetMap contributors, plus © CARTO or Protomaps.
- **Theme switch** swaps the style URL. Every overlay must be declared as react-map-gl `<Source>`/`<Layer>` children, so overlays re-attach automatically after `setStyle`. **Never add layers imperatively.**

### 7.2 Initial view

- Fit to Metro Vancouver, covering the three hubs and the eastern origins out to Langley and Maple Ridge (about −123.30, 49.08 to −122.55, 49.36).
- When a hub is selected, fit to the hub plus its origins that have a share of at least 2%.
- In Preview, fit to the trip's paths (section 7.5).

### 7.3 Layers (drawn bottom to top)

| # | Layer | Content | Style rules | Data |
|---|---|---|---|---|
| 1 | Routes | Routes serving the selected hub, shown when the Routes layer is on or during Preview | Colour by load class: need (OVERCROWDED) vs spare (SPARE) vs neutral. The selected route is thicker. | `GET /routes?hub_id=&include_shape=true` + `GET /routes/load` |
| 2 | Hub catchments | Circles of `catchment_m` | Subtle | `/hubs` |
| 3 | Origin arcs | One arc per origin with coordinates → the selected hub. Leave out `LOCAL` and `VISITOR`. | Width ∝ `share_of_local_pct` (1–10 px). Colour by `access_type`: **transfer required** is emphasised, because that's the insight; one-seat ride is muted. Arcs are quadratic Bézier curves (32–64 points, all bowing the same way), computed on the client. | `/hubs/{id}/origins` |
| 4 | Origin bubbles | A circle at each origin centroid | Area ∝ pings (radius ∝ √pings), same colour as its arc | same |
| 5 | Hub markers | Three always-labelled markers | **Halo radius and opacity scale with the surge index** (1.0 → none, 1.75 or more → max). The halo is coloured by severity. **This slow pulse is the single deliberate ambient motion in the app.** | `HubStatus.last_full_hour.surge_index`, `next_surge.severity` |
| 6 | Surges | A marker at `Surge.location` (hub and non-hub) | UPCOMING = ring, ACTIVE = filled, RESOLVED = faded. Resolved surges are hidden unless within the last 6 sim-hours. Colour by severity. | `/state.surges`, WS `surge.updated` |
| 7 | Trip paths | `deadhead_path` (dashed) and `service_path` (solid) for PROPOSED (only while previewing) and APPROVED/BUS_EN_ROUTE/IN_SERVICE trips | Colour by trip status | AdditionalTrip |
| 8 | Buses | Spare buses as icons rotated by `heading_deg` | Colour by bus status; `RESERVED` gets an outline | Bus, interpolated (section 7.6) |
| 9 | Labels | Hub names, and origin names on hover or for the top 5 | — | — |

**Interactions:**

- **Click a hub** to select it and open the Now tab.
- **Click an arc or bubble** to highlight the matching row in the Origins list, and vice versa. Hovering does the same.
- **Click a surge** to open a popover. It shows the window, magnitude (predicted vs typical, 80% band), severity, drivers and status, plus a "View proposals" link to the Dispatch tab.
- **Click a bus or path** to open the trip in the Dispatch tab.
- **Press Esc** to exit a preview or clear the selection.

**Layer toggle control (top-left):** Origins, Surges, Buses & trips, Routes (need/spare), Hub catchments. Store the choices in the URL (section 11.5).

**Legend (bottom-left):** explains only the layers that are on, using the same notation as the charts.

### 7.4 Accessibility on the map

- Everything clickable on the map can also be reached from the side panel: the hub list, origin list, surge list and trip list.
- Hub markers can take keyboard focus.

### 7.5 Preview mode (dispatch)

Preview starts from the **Preview** button on a proposal card:

- The map fits to the deadhead path, service path, donor route and target route.
- Other overlays dim to about 20%.
- The donor route is drawn in the **spare** colour and the target route in the **need** colour.
- The bus is shown at its current location.
- A floating chip reads "Previewing: bus from route 25 → extra 99 trip". It has Approve, Reject and Exit buttons.
- The panel card shows load bars for both routes, before → after.

### 7.6 Moving buses smoothly (performance)

- Bus positions come from `bus.positions_updated` (4 per second or fewer) **and** are interpolated on the client along the trip paths:
  - `dispatch_time` → `arrival_at_surge_time` along `deadhead_path`
  - `departure_time` → `estimated_completion_time` along `service_path`
  - Timing uses the extrapolated sim clock.
- Update a single GeoJSON source with `setData`, called from a `requestAnimationFrame` loop that reads from a ref. This must happen **outside React state**, so the panel doesn't re-render at 60 fps.
- Pause the loop when the tab is hidden.
- With `prefers-reduced-motion`: no halo pulse, and buses jump to each position update instead of gliding.
- Must stay smooth at **3600x** with up to 30 buses.

### 7.7 Next.js specifics

- The map component is **client-only**: load it with `next/dynamic` and `ssr: false`.
- Register the PMTiles protocol **once**, guarded against the React StrictMode double mount.
- Render the map only after next-themes has resolved the theme, so the wrong style never flashes.

---

## 8. Side panel: network overview (no hub selected)

This is the default view. Sections, top to bottom:

1. **Hub cards (3).** Each card shows:
   - name
   - pings in the last full hour vs typical
   - a surge-index badge
   - the next forecast surge: "Surge in 2 h 40 min, 1.79x, High"
   - pending proposals and active extra trips

   Clicking a card selects the hub. The same data comes from `/state.hubs[]` and `hub.demand_updated`.
2. **Approval queue.** Every `PROPOSED` trip across hubs, soonest `approval_expires_at` first. Each row shows:
   - the hub
   - "route 25 → 99"
   - the time left, in sim time; it counts down only while the sim runs
   - Preview, Approve and Reject buttons

   **Empty state:** "No proposals waiting. The engine proposes a bus when it forecasts a surge." with the action **Jump to UBC exam weekend**.
3. **Active extra trips.** Trips that are APPROVED, BUS_EN_ROUTE or IN_SERVICE, each with a progress bar and an ETA.
4. **Surges away from the hubs.** Surges where `hub_id` is null.
   - **Empty state:** "No surges away from the three hubs right now."
   - This list is expected to be empty often. It must look intentional, not broken.
5. **Scorecard strip.** Network surge recall and median lead time from `/backtest`, e.g. "Caught 85% of surge hours, a median 4 h ahead". It links to About.

---

## 9. Side panel: hub selected

**Header:**

- A "← All hubs" button, the hub name, and a status line such as "1.50x typical in the last hour; surge forecast 13:00–15:00".
- Tabs: **Now, Origins, Dispatch, Routes, Late night, Planner, Findings**.
- The Dispatch tab label shows a badge with the count of `PROPOSED` trips.

**When a sim-hour boundary passes:** refetch the data behind the active tab. The throttling rules are in section 11.2.

### 9.1 Now

**Purpose:** "How busy is this hub, how busy will it be, and why?"

**KPI row.** Each KPI has a unit, period, comparison and source line:

| KPI | Value | Comparison | Source |
|---|---|---|---|
| Pings, last full hour (e.g. 12:00–13:00) | `last_full_hour.pings` | vs `typical_pings` | Rogers pings |
| Surge index | `last_full_hour.surge_index` | vs 1.25 threshold | computed |
| Next surge | Start time and countdown, predicted index, severity | "None forecast in the next N h" if null | forecast model |
| Warning given | `lead_time_minutes` of the next surge, e.g. "3 h ahead" | — | forecast model |

**Forecast chart (ECharts):**

- **Title** is the message, built from the data, e.g. "UBC forecast to reach 1.79x typical at 13:00", or "No surge forecast for UBC in the next 6 h".
- **X axis** is a **category axis** labelled by hour, keyed on `local_date`+`hour`. Never do epoch arithmetic. A DST day has 23 or 25 buckets, and that is fine.
- **Series:**
  - `actual_pings`: solid
  - `forecast_pings`: dashed
  - 80% band: `lower_80`–`upper_80`, shaded
  - `typical_pings`: thin grey
  - a dotted **surge line** = typical × `surge_threshold`. It's a series, not a constant, because typical changes by hour.
  - hours where `is_surge` is true: shaded background
  - a vertical **"now"** marker
- **HISTORY rows** plot the forecast issued `horizon_hours` earlier. The tooltip says "Forecast made at 07:00 for 10:00". This is the "did we predict it" view.
- **The CURRENT row** shows `actual_pings` as a partial bar or point, labelled "so far".
- **Horizon selector:** built from `/meta.forecast_horizons_hours` (3/6/12/24). Default 6. `history_hours` = max(6, horizon).
- **Chart animation** is off when speed is 900 or more.

**Other content:**

- **Driver chips:** built from `next_surge.drivers` and any `/events` overlapping the window. Each chip opens a popover with the event's source link.
- **"Did it happen?" card:** appears when this hub has a RESOLVED surge in the last 24 sim-hours. It shows predicted vs actual surge index and pings side by side, e.g. "Predicted 1.79x, actual 1.88x".
- **Scorecard badge:** this hub's precision, recall and median lead time from `/backtest.by_hub`. It opens About.

**Data:** `/hubs/{id}/forecast`, `/hubs/{id}/status` (or the store), `/events`, `/backtest`.

### 9.2 Origins

**Purpose:** "Where are the people at this hub coming from, and can they get home without a transfer?"

- **Basis toggle:**
  - **Actual:** the last full hour, the default. The window is labelled "12:00–13:00, Sat Dec 6".
  - **Typical:** "Typical Saturday, 12:00–13:00".
- **Insight callout**, computed on the client from the same response:
  - "X% of regional pings come from areas with no one-seat ride"
  - X = the sum of `share_of_local_pct` over rows where access is `TRANSFER_REQUIRED`
  - A tooltip shows the formula.
- **Ranked list** of regional origins with coordinates:
  - bar = `share_of_local_pct`
  - pings
  - access badge: "One-seat ride" or "Transfer required"
  - direct-line chips from `direct_lines`
  - Hovering highlights the arc, and the reverse.
- **"Same area"** row for `LOCAL`, shown separately.
- **"From outside the region"** list for `VISITOR`, using `share_pct`.
- **Low sample:** when `low_sample` is true, show a warning banner: "Few pings in this hour. Shares may be noisy."
- **Surge destinations:** if an UPCOMING or ACTIVE surge exists at this hub, add a "Where the surge crowd is headed" sub-list from `predicted_destinations`.

**Data:** `/hubs/{id}/origins?at=&basis=`.

### 9.3 Dispatch

**Purpose:** "Review and approve bus moves for this hub."

**Proposals (`PROPOSED`).** One card each, containing:

- **Headline:** "Move 1 bus from route 25 → extra 99 trip at 12:55".
- **Target route:** a route bullet in `color`/`text_color`, and a load bar `load_before_pct` → `load_after_pct`. The ≥85% zone is marked.
- **Donor route:** the same, or "From depot: {depot_name}".
- **Facts:**
  - Arrives before the surge: yes/no badge
  - Deadhead: 20 min / 11.4 km
  - Added capacity: 77
  - Expires in 32 sim-min
- **Rationale:** one sentence.
- **Evidence:** an expandable list of label, value and source. Every item shows its source.
- **Buttons:** Preview, Approve (primary), Reject (a popover with an optional reason field).

**Approve or Reject:**

- Disable the buttons while the request runs.
- On success, show a toast ("Trip approved" / "Proposal rejected") and update the card from the response.
- **On 409:** replace the card with the returned `trip` and show an inline message for the error code:

  | Code | Message |
  |---|---|
  | `TRIP_EXPIRED` | "This proposal expired before approval." |
  | `TRIP_REJECTED` | "Already rejected." |
  | `STALE_EPOCH` | "The simulation moved. Refreshing…" (then refetch `/state`) |
  | `TRIP_NOT_PROPOSED` | "This trip changed state. Showing latest." |

**Active extra trips:** APPROVED, BUS_EN_ROUTE or IN_SERVICE. Each shows its status, a progress bar and an ETA. Clicking one focuses the map on it.

**History:** COMPLETED, REJECTED, EXPIRED and CANCELLED, collapsed by default. For CANCELLED trips, show the `rationale` as the reason.

**Alternative proposals:** a proposal with `replaces_trip_id` shows "Alternative to a rejected proposal".

**Empty state:** "No proposals for UBC. The engine proposes a bus when it forecasts a surge." with the action **Jump to the next surge**.

- The target is the preset for this hub if one exists.
- Otherwise seek to 1 hour before `next_surge.window_start`, if that exists.

**Data:** the store (`additional_trips`, `buses`, `surges`), `GET /additional-trips/{id}` for details, and the approve/reject POSTs.

### 9.4 Routes

**Purpose:** "Which routes need relief, and which have spare capacity right now?"

- **Two columns (stacked on narrow screens):**
  - **Need relief:** routes classed `OVERCROWDED`.
  - **Spare capacity:** routes classed `SPARE`.
  - Each row: route bullet, name, load bar (`load_pct`), a `load_basis` label ("TSPR 2025 typical" or "Model estimate"), `time_period`, and "% trips overcrowded in 2025".
  - Clicking a row highlights that route on the map (turn the Routes layer on).
- **Crowding table** (TSPR 2025, from `/hubs/{id}/route-crowding`): % of trips overcrowded, average peak load, % bunching, % on time, and weekday boardings. It's sortable. Source line: "TransLink TSPR 2025".

**Data:** `/routes/load?hub_id=`, `/hubs/{id}/route-crowding`, `/routes?hub_id=&include_shape=true` (fetched once per hub and cached).

### 9.5 Late night

**Purpose:** "Are people at this hub after midnight with no bus coming?"

- **Explainer (one line):** "People at {hub} between 00:00 and 05:00, compared with scheduled departures."
- **Chart** for hours 0–4 of `night_date`:
  - Bars for pings: actual solid, forecast outlined, typical as a ghost.
  - Departures as a step line. Its label reads "typical {day type} timetable (fall 2026)".
  - Hours where the hour's `share_of_daily_pct` is at least 1 and `departures_typical` is 1 or fewer are **flagged** as "waiting-alone risk".
- **KPIs:**
  - `share_of_daily_pct`: "Share of the day's pings after midnight".
  - NightBus lines running, as chips from `lines`.
- **Top nights list:** labelled "Whole dataset". Each row has a **Show me** button that seeks to 00:00 on `night_date`.

**Data:** `/hubs/{id}/late-night?at=`.

### 9.6 Planner (what-if, ported from the AppKit app)

**Purpose:** "If we re-timed or added departures on a typical day, how much better would service match demand?"

- **Label at the top:** "Typical {day type} (fall pings vs fall 2026 timetable). Not tied to the simulation clock."
- **Controls:**
  - A day-type select. Its default is the sim date's day type.
  - A strategy toggle: **Add service** or **Rebalance (zero cost)**. The default is Add when the hub's peak load is 95% or more (overview `peak_load`), otherwise Rebalance, matching the AppKit behaviour.
  - A budget slider (0–200 departures).
  - A Reset button.
- **Metrics, before → after:** mismatch, share of pings in underserved hours, underserved hours, total departures, and over-capacity hours.
- **Chart:** share of pings vs share of departures by hour, before and after, with notation as in section 4.2.
- **Hour table:** a row per hour with pings, departures, delta, status, peak load and a **floor lock** icon. The lock shows the capacity-safe minimum. Include ± buttons for manual changes.
- **Engine:** copy `hub_pulse/app/hub-pulse/client/src/lib/planner.ts` and `planner.test.ts` **unchanged**, apart from import paths. All maths runs on the client.
- **Field mapping** from `GET /hubs/{id}/hourly-profile`:
  - `hour` → `hour`
  - `avg_pings` → `visits` (the planner's internal name; the UI still says "pings")
  - `departures` → `departures`
  - `peak_load_pct` → `peakLoad`
- **Reference behaviour:** `hub_pulse/app/hub-pulse/client/src/pages/PlannerPage.tsx` and `components/HourTable.tsx`. Port their behaviour, not their AppKit components.

### 9.7 Findings

**Purpose:** "What should change in the long-term schedule, and what's the evidence?"

1. **Hub profile KPIs** from `/hubs/{id}/overview`, each with its period and source.
2. **Headline comparison** from `/findings`:
   - this hub's mismatch, share of pings in underserved hours, zero-cost rebalance result vs +service result, and the verdict (**Reschedule** or **Invest**)
   - a compact 3-hub comparison table
   - the network `facts`
3. **Recommendations** from `/hubs/{id}/recommendations`, sorted by priority:
   - category
   - the recommendation sentence, labelled "Written by AI from rule-based evidence. Verify before acting."
   - the evidence, expandable
   - **Show me** buttons from `links[]`: seek to `local_date`+`hour`, select `hub_id`, and open the tab that fits (Routes if `route_id` is set, otherwise Now)
4. **Surge days:** the top 5 days where `is_surge` is true for this hub, from `/timeline`. Label: "Retrospective index". Each has a Show me button (seek to 09:00 that day).

---

## 10. About modal

Open it from the top bar and from the scorecard links. Sections:

1. **What this is:** two sentences on the problem and the console.
2. **How it works:**
   - pings → Databricks pipeline (bronze/silver/gold) → hourly forecast → dispatch engine → human approval
   - the definitions of surge index and typical
3. **Model scorecard** (`/backtest`):
   - a per-hub table: precision, recall, median lead time
   - a by-horizon chart: MAPE and 80% coverage for 3/6/12/24 h
   - the `method` text
4. **Validation** (`/validation`):
   - a two-line chart by hour: `pings_pct` vs `skytrain_pct`
   - "r = 0.92; shifting pings by 3 h drops it to 0.38"
   - the source
5. **Data sources** from `/meta.sources`, with links.
6. **Limitations:**
   - Pings count devices at a hub, not boardings.
   - Origin centroids are approximate.
   - There are only 10 months of history.
   - TSPR loads are 2025 period averages.
   - The timetable is the typical fall 2026 one.
   - The data is synthetic.
7. **Freshness:** `/meta.pipeline_refreshed_at`. In mock mode, say "Mock data" instead.

---

## 11. Data layer

### 11.1 Contract and types

- **One module** holds zod schemas for every object, response and WS message in `backendspec.md` (v2). TS types are inferred from the schemas.
- **Dev (real backend):** validate every REST response and WS message. On failure:
  - log the path and issue to the console
  - show a small dev-only banner "Contract mismatch: {endpoint}"
- **Prod:** use `safeParse` and degrade gracefully.
- **API client:**
  - base URL from `NEXT_PUBLIC_API_BASE_URL`, default `http://localhost:8000/api/v1`
  - parses `{error:{code,message}}` into a typed error that carries `code`, `message` and an optional `trip`

### 11.2 REST caching (TanStack Query)

- **Static queries:** `staleTime: Infinity`. These are `/meta`, `/hubs`, `/findings`, `/backtest`, `/validation`, `/timeline`, `/events`, `/hubs/{id}/overview`, `/route-crowding`, `/recommendations`, `/hourly-profile` and `/routes`.
- **Time-dependent queries** include the sim hour and `epoch` in their keys:
  - forecast: `[forecast, hub, horizon, local_date, hour, epoch]`
  - also origins, late-night and routes/load
  - They refetch when the sim hour changes, when `epoch` changes, or when inputs change.
- **Throttling at 900x or faster:**
  - refetch time-dependent queries at most once every 2 s of wall time
  - at 3600x, only the query behind the **visible** tab refetches
  - everything refetches once on pause
- **Mutations:**
  - pause, resume, speed, seek, settings, approve, reject
  - For seek, apply the returned Clock optimistically, then wait for `state.reset` before refetching `/state`.

### 11.3 Live simulation store (Zustand)

**What it holds:**

- the Clock, and the wall time it was received (`receivedAt`)
- `epoch` and `lastSeq`
- surges, trips and buses (maps by id)
- hub statuses
- connection status
- UI selection: hub, tab, previewed trip, origins basis, horizon, map layers

**Displayed sim time** is extrapolated:

- while `RUNNING`: `current_time + (wallNow − receivedAt) × speed`
- It is recalculated with requestAnimationFrame for the clock display and bus animation.
- It snaps back to the server value on each `simulation.tick` or `simulation.state_changed`.

**WS reducer:**

- Apply full-object upserts: `surge.updated`, `trip.updated`, `dispatch.*`, `bus.updated` and `hub.demand_updated`.
- Merge `bus.positions_updated` into the bus map.
- Replace the clock on `simulation.state_changed`.
- On `state.reset`, set a "resyncing" flag and refetch `/state`.
- Ignore any message whose `epoch` is older than the store's, or whose `seq` is at or below `lastSeq`.

**Toasts:**

- **`dispatch.proposed`:** "New proposal: bus from route 25 → 99 at UBC".
  - It has a **Review** button that selects the hub, opens the Dispatch tab and starts Preview.
  - If the event came with an auto-pause (`simulation.state_changed.reason = AUTO_PAUSE_PROPOSAL`), add "Simulation paused for review."
- **A new surge id seen for the first time:** "Surge forecast at UBC 13:00, 1.79x".
- **Trip `EXPIRED`:** "Proposal expired".
- **At high speed:** show at most 3 toasts at once, and group repeats.
- New proposals are also announced through an `aria-live="polite"` region.

### 11.4 WebSocket client

- Connect to `NEXT_PUBLIC_WS_URL` (default `ws://localhost:8000/api/v1/ws/simulation`).
- **Startup sequence:**
  1. Open the socket and **start buffering** messages.
  2. Fetch `/state` and apply it (setting `epoch` and `lastSeq`).
  3. Replay buffered messages where `epoch` matches and `seq > last_seq`.
  4. Switch to live apply.
- **Reconnect** with exponential backoff and jitter (0.5 s → 10 s max). Show "Reconnecting…" in the top bar.
- **After reconnecting**, repeat the startup sequence.
- **While disconnected**, panels show a **stale** note with the last sim time received.
- **Hosted over `https`,** the WS URL must be `wss://`. Show a clear configuration error if it isn't.
- **Transport:** hide the transport behind a small interface. Mock mode supplies an in-browser fake that implements it (section 12.3).

### 11.5 URL state

- **Query params:** `hub`, `tab`, `basis`, `h` (horizon), `layers`. They're shareable and survive a reload.
- **Optional `t` (sim time):** because the clock is global and server-owned, opening a link with `t` **doesn't seek automatically**. It shows a banner "This link points to Sat Dec 6 13:00. Jump there?" with a Jump button.

---

## 12. Mock mode (build everything against this first)

### 12.1 Switch

- `NEXT_PUBLIC_USE_MOCKS=true` starts MSW (browser worker) and the mock WS transport. It is the default in `.env.example` until the backend is live.
- Setting it to `false` uses the real backend with **no other code changes**.
- The top bar always shows **"Mock data"** while mocks are on.

### 12.2 MockSim (in-browser simulator)

A single, **deterministic** state machine shared by the MSW handlers and the fake WS. Seeded, and keyed by sim time: the same seek always produces the same state.

**Behaviour it must implement:**

- The Clock (speed, pause, resume, seek, settings, auto-pause on proposal), `epoch`/`seq`, and ticks capped at 4 per second.
- **Scripted scenarios:**

  | Scenario | Detected | Window | Surge index | Drivers | Destinations |
  |---|---|---|---|---|---|
  | **UBC exam weekend** (primary) | 2025-12-06 10:00 | 13:00–15:00 | ~1.79x predicted, 1.88x actual on resolution | EXAM "UBC December exam period" | Surrey, Richmond, New Westminster, North Vancouver |
  | **Park Royal Boxing Day** | 2025-12-26 | late morning → afternoon | ~1.47x | HOLIDAY | — |
  | **Waterfront Jul 25 2026** | — | — | ~1.83x | — | — |
  | **Saturday late night** | — | Waterfront, 00:00–03:00 | pings with ≤ 1 departure | — | — |

  The UBC scenario runs as follows:
  - Proposal A: a bus from **route 25** (SPARE, 48% → 55%) makes an extra **99** trip (104% → 91%), with `approval_expires_at` 45 sim-min later.
  - If A is rejected, proposal B replaces it: a bus from **route 14** makes an extra R4 trip, with `replaces_trip_id` = A.
  - After approval, the bus deadheads along a hand-drawn plausible path to UBC Exchange, runs the service path east along Broadway, completes, and returns.

  The Park Royal scenario has a depot bus proposal.

- A flag (dev only) adds one **non-hub surge** so that UI can be tested. It's off by default.
- Approve, reject, expiry and cancel follow the state rules in `backendspec.md`. That includes the 409 codes and the trip→bus status mapping.

**Synthesised data:**

- **Hourly pings:** start from the typical profiles in **`hub_pulse/analysis/hours_all.json`**. It needs converting:
  - numbers are **strings** → coerce them
  - `peak` → `peak_load_pct`
  - hub names → ids
  - `MF`/`Sat`/`Sun/Hol` → `mf`/`sat`/`sun_hol`
  - Multiply by a per-date factor (surge days get their multiplier) and add seeded noise.
- **Forecasts:** actual × (1 + seeded error that grows with lead time). The 80% band is ±(8% + 1% × lead hours).
- **Origins:**
  - centroids and regions from `dim_origin` (`hub_pulse/sql/02_silver.sql` lines 82–104)
  - per-hub share distributions seeded from the known numbers: UBC regional shares Surrey 14.5%, Richmond 11.6%, New Westminster 6.3%, North Vancouver 5.6%, Delta 2.6%, all transfer-required, about 47.6% transfer-required in total
  - varied by hour and by basis
- **Routes:** about 10 hand-made routes with rough shapes, e.g. 99, R4, 25, 14, 9, 250, 257, N17, SeaBus. Each has colour and load classes.
- **Hourly profile, overview, route crowding, recommendations:** shaped like the queries in `hub_pulse/app/hub-pulse/config/queries/*.sql`, with values from `hub_pulse/HANDOFF.md` §2 and the rule categories in `hub_pulse/sql/04_insights.sql`.
- **Findings:** the headline table in `hub_pulse/HANDOFF.md` §2.
- **Backtest and validation:** plausible placeholder numbers, labelled "Mock" in the UI. Validation may use r = 0.92.

### 12.3 Fake WebSocket

- Implements the same transport interface as the real client.
- Emits envelope messages (`type`, `seq`, `epoch`, `simulation_time`, `data`) produced by MockSim.
- Obeys the same rate limits.
- Supports being disconnected, so reconnect handling can be tested. Add a dev-only "Drop connection" item in the overflow menu.

---

## 13. Reuse from the old AppKit app

| From `hub_pulse/app/hub-pulse/client/src/` | Use |
|---|---|
| `lib/planner.ts`, `lib/planner.test.ts` | Copy **unchanged** (only import paths change). The tests must pass. |
| `lib/format.ts` | Reuse `compact`, `hourLabel` and `signed` where useful. Replace the hub and day-type constants with the new ids. |
| `pages/PlannerPage.tsx`, `components/HourTable.tsx`, `components/Kpi.tsx`, `components/ContextPanels.tsx` | Behaviour reference only. Don't import them (they use AppKit). |
| `pages/AboutPage.tsx` | Content reference for About |

---

## 14. Visual and interaction rules

### 14.1 Process

- Follow section 4. `web/DESIGN.md` must exist before any component work.
- After each milestone, take screenshots of both themes at 1440 px and 390 px (Playwright or the dev browser), critique them against `DESIGN.md` and the skills, and fix what you find.

### 14.2 Semantic colour roles

Define these as CSS custom properties in **both** themes. They must meet WCAG AA against their background, and Tailwind, ECharts and MapLibre all consume them. ECharts and MapLibre read them at runtime and refresh when the theme changes.

| Role | Used for |
|---|---|
| `surge-low`, `surge-medium`, `surge-high` | Severity: halos, surge markers, badges |
| `need` | Overcrowded routes, target-route load |
| `spare` | Spare or donor routes, donor load |
| `late-night` | Late-night tab accents, flagged hours |
| `actual`, `forecast`, `typical` | IBCS notation |
| `access-transfer`, `access-oneseat` | Origin arcs and badges |
| `trip-proposed`, `trip-active`, `trip-done`, `trip-failed` | Trip status |

- Colour is **never the only signal**. Pair it with an icon, pattern, dash style or text.
- Motion: only the hub halo pulse is ambient. Motion in response to user actions (panel open, card expand, map fit) is fine. Respect `prefers-reduced-motion`.

### 14.3 Number and time formats

| Kind | Format |
|---|---|
| Pings | Thousands separators (3,920). Compact (10.3M) only in KPIs over 100k. |
| Index | `1.79×` (two decimals) |
| Percent | `14.5%` (one decimal) |
| Time | 24 h (`13:00`) |
| Duration | `2 h 40 min` |
| Date | `Sat Dec 6 2025` |

- Every formatter passes `timeZone: 'America/Vancouver'`.
- Hourly buckets are keyed and labelled by `local_date` + `hour` from the API, never recomputed from the ISO timestamp.

### 14.4 Accessibility

- Every control works from the keyboard, with a visible focus ring.
- Tabs, menus, dialogs and popovers follow the shadcn/Radix accessibility defaults.
- The map has panel equivalents (section 7.4).
- New proposals are announced through `aria-live`.
- Charts get an accessible text summary (the title plus key numbers) through `aria-label`.

---

## 15. Folder structure (suggested)

```
web/
  DESIGN.md                 tokens + design plan (from frontend-design)
  README.md                 run, env, mock mode, PMTiles extract, switching to real backend
  .env.example
  Dockerfile
  public/
    tiles/                  metro-vancouver.pmtiles (fallback)
    fonts/ glyphs/ sprites/ local map assets for offline
    mockServiceWorker.js    (generated by MSW)
  src/
    app/                    layout, page (single screen), globals.css, providers
    config/app.ts           APP name + tagline (placeholder)
    components/ui/          shadcn components
    components/             shared: EmptyState, Kpi, SourceNote, RouteBullet, LoadBar, charts wrapper
    features/
      topbar/               clock, controls, presets, date picker
      map/                  map, layers, preview, bus animation, basemap probe
      overview/             network overview panel
      hub/                  hub panel + tabs: now, origins, dispatch, routes, late-night, findings
      planner/              planner.ts, planner.test.ts (copied), planner UI
      timeline/             scrubber
      about/                about modal, scorecard, validation
    lib/
      api/                  schemas (zod), client, errors, query keys
      live/                 ws transport interface, real ws client, sim store, reducer, clock extrapolation
      format/               number/time formatters
      theme/                css-var readers for ECharts/MapLibre
    mocks/
      sim/                  MockSim, scenarios, synthesis
      data/                 seed data derived from hub_pulse (hubs, origins, routes, hours)
      handlers/             MSW handlers
      ws/                   fake transport
```

---

## 16. Running and configuration

**npm scripts:**

| Script | Does |
|---|---|
| `dev` | Next dev on port 3001 |
| `build` | Production build |
| `start` | Serve the build on port 3001 |
| `test` | Vitest |
| `lint` | ESLint |
| `typecheck` | `tsc --noEmit` |

**`.env.example`:**

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000/api/v1` | REST base |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:8000/api/v1/ws/simulation` | WS endpoint |
| `NEXT_PUBLIC_USE_MOCKS` | `true` | Mock mode |
| `NEXT_PUBLIC_BASEMAP_LIGHT_URL` / `_DARK_URL` | CARTO Positron / Dark Matter GL style URLs | Online basemaps |

**Docker:**

- `web/Dockerfile` is a multi-stage build on Node 22 alpine, using Next standalone output and exposing 3001.
- `NEXT_PUBLIC_*` values are **baked in at build time**, so pass them as build args.
- In `docker-compose.yml`, add a **`web`** service:
  - build `./web`
  - ports `3001:3001`
  - build args for the `NEXT_PUBLIC_*` values
  - `depends_on: backend`
- Keep the existing `backend` and `frontend` services as they are.

**Vercel (later, not now):**

- Set the env vars in the project settings.
- The backend must be public over `https`/`wss` with CORS allowing the Vercel domain.
- Mock mode also works on Vercel for a no-backend demo.

---

## 17. Traceability: UI element → data

| UI element | Endpoint / event | Fields |
|---|---|---|
| Clock, play/pause, speed | `/state.simulation`, `simulation.tick`, `simulation.state_changed`; `POST /simulation/pause`/`resume`, `PUT /simulation/speed` | `current_time`, `local_date`, `hour`, `speed`, `status`, `epoch` |
| Speed options, presets, horizons, thresholds, late-night hours | `GET /meta` | `allowed_speeds`, `presets[]`, `forecast_horizons_hours`, `surge_threshold`, `severity_bands`, `late_night`, `route_load_thresholds` |
| Date picker bounds | Clock | `min_time`, `max_time` |
| Seek (picker, presets, scrubber, Show me, Reset) | `PUT /simulation/time`, `state.reset` | `current_time`, `epoch` |
| Auto-pause switch | `PUT /simulation/settings` | `auto_pause_on_proposal` |
| Hub markers and halo | `GET /hubs`, `/state.hubs`, `hub.demand_updated` | `location`, `last_full_hour.surge_index`, `next_surge.severity` |
| Hub cards (overview) | `/state.hubs`, `hub.demand_updated` | `last_full_hour.*`, `next_surge`, `active_trip_count`, `pending_proposal_count` |
| Approval queue, active trips | `/state.additional_trips`, `dispatch.*`, `trip.updated` | `status`, `approval_expires_at`, `route`, `donor_route`, `progress` |
| Non-hub surges | `/state.surges`, `surge.updated` | `hub_id == null`, `location_name`, `predicted_window`, `magnitude`, `status` |
| Surge markers and popover | same | `location`, `phase`, `severity`, `magnitude`, `drivers`, `status` |
| Now: KPIs | HubStatus, Surge | `last_full_hour`, `next_surge`, `lead_time_minutes` |
| Now: forecast chart | `GET /hubs/{id}/forecast` | `rows[].{local_date, hour, kind, actual_pings, forecast_pings, forecast_issued_at, lower_80, upper_80, typical_pings, surge_index, is_surge}` |
| Now: driver chips | Surge `drivers`, `GET /events` | `type`, `label`, `source_url` |
| Now: "Did it happen?" | Surge (RESOLVED) | `magnitude.surge_index`, `actual.surge_index`, `actual.pings` |
| Scorecard badge/strip | `GET /backtest` | `by_hub[]`, `by_horizon[]` |
| Origins: arcs, bubbles, list, callout | `GET /hubs/{id}/origins` | `origins[].{origin, location, pings, share_pct, share_of_local_pct, access_type, direct_lines}`, `window`, `low_sample` |
| Origins: surge destinations | Surge | `predicted_destinations[]` |
| Dispatch cards and preview | AdditionalTrip, `GET /additional-trips/{id}` | `route.*load*`, `donor_route.*`, `impact`, `rationale`, `evidence`, paths, times, `replaces_trip_id` |
| Approve / Reject | `POST /additional-trips/{id}/approve`/`reject` | response trip; 409 `error.code` + `trip` |
| Bus icons and animation | `/state.buses`, `bus.updated`, `bus.positions_updated`, trip times and paths | `location`, `heading_deg`, `status`, `source` |
| Routes: need/spare | `GET /routes/load` | `route`, `load_pct`, `load_basis`, `classification`, `time_period`, `pct_trips_overcrowded_2025` |
| Routes: crowding table | `GET /hubs/{id}/route-crowding` | all fields |
| Route lines on map | `GET /routes?hub_id=&include_shape=true` | `shape`, `color`, `text_color` |
| Late night tab | `GET /hubs/{id}/late-night` | `hours[].{actual_pings, forecast_pings, typical_pings, share_of_daily_pct, departures_typical, lines}`, `share_of_daily_pct`, `top_nights[]`, `departures_basis` |
| Planner | `GET /hubs/{id}/hourly-profile`, `GET /hubs/{id}/overview` (peak load, for the default strategy) | `rows[].{hour, avg_pings, departures, peak_load_pct, status, time_period, most_crowded_line}` |
| Findings | `GET /hubs/{id}/overview`, `GET /findings`, `GET /hubs/{id}/recommendations`, `GET /timeline` | `kpis[]`, `hubs[]`, `facts[]`, `recommendations[].links[]`, `days[]` |
| Timeline scrubber | `GET /timeline`, `GET /events` | `days[].hubs.*`, events `start`/`end`/`category` |
| About: validation | `GET /validation` | `rows[]`, `r`, `r_shifted_3h`, `source` |
| About: sources, freshness | `GET /meta` | `sources[]`, `pipeline_refreshed_at` |

### 17.1 Timeline scrubber (detail)

- **Chart:** a thin multi-line chart of daily pings per hub. The selected hub is emphasised; the others are muted. Month ticks along the bottom.
- **Markers:**
  - surge days (`is_surge`), as markers coloured by hub
  - events, as short bands coloured by category
- **Handle:** at the current sim date.
- **Dragging** previews the date label locally. **On release**, it seeks **once** to that date at the current sim hour. Debounce 300 ms.
- **Clicking a marker** seeks to 09:00 on that day.
- **Keyboard:**
  - ←/→ moves one day
  - Shift+←/→ moves one week
  - Enter seeks
- **Label:** "Daily totals. Surge markers use a retrospective index."

---

## 18. Acceptance criteria and verification

### 18.1 Automated

- `typecheck`, `lint`, `test` and `build` all pass.
- `planner.test.ts` (the 9 copied tests) passes unchanged.
- **New unit tests:**
  - **WS reducer:** seq/epoch filtering, buffering during `/state` fetch, `state.reset` handling.
  - **Clock extrapolation:** running, paused and speed change.
  - **zod schemas:** every JSON example in `backendspec.md` parses. Copy them into test fixtures.
  - **MockSim:** a seek is deterministic; approve → APPROVED → BUS_EN_ROUTE → IN_SERVICE → COMPLETED; reject → alternative proposal carrying `replaces_trip_id`; expiry only advances while running.
  - **Formatters:** America/Vancouver output on DST days 2025-11-02 and 2026-03-08.

### 18.2 Manual demo run (mock mode)

- The full story in section 1.1 works end to end: preset → surge forecast about 3 h ahead → auto-pause toast → Origins arcs → Preview → Approve → bus animates → resolved "predicted vs actual" → About scorecard and validation.
- Rejecting proposal A produces alternative B.
- Letting a proposal expire shows the expiry toast.
- Seek, presets, scrubber, Show me links and Reset demo all resync state, with no stale trips left on the map.
- Speed 3600x: buses stay smooth and panels don't stutter.
- The theme toggle switches the UI, charts and map, and overlays survive the style swap.
- **Offline:** block the CARTO host in devtools and reload. The PMTiles basemap loads.
- **Viewports:** 1440, 1024 and 390 px wide all work, with no horizontal page scroll.
- **Keyboard only:** you can select a hub, switch tabs, approve a proposal, and scrub the timeline.
- Every data view shows its loading, empty and error states. Force them with an MSW toggle or a dev query param.
- Every KPI shows a source, and every chart title states a message.

### 18.3 Contract check (once the backend exists)

- Set `NEXT_PUBLIC_USE_MOCKS=false` and run the demo against the real backend.
- It passes when the dev contract banner never appears. If it does, report the mismatch to the backend teammate. Don't silently adapt the schemas.

---

## 19. Milestones (build order)

1. **Foundation:**
   - `web/` scaffold, tooling, env
   - `DESIGN.md` from the frontend-design process
   - theme tokens
   - zod schemas from `backendspec.md`
   - MockSim skeleton, MSW and fake WS
   - top bar with the clock and controls
   - map with the basemap, offline fallback and hub markers
2. **Understand demand.** Build in `frontend/`, following the v3 section of `frontend/DECISIONS.md`, which overrides this spec where they differ.
   - **2a. Move to the v3 contract** (prerequisite for the UI):
     1. **Bundle the real data from Databricks** (read-only, `--profile DEFAULT`, catalog `rgersxdatabricks_hackathon`). Snapshot these as compact bundled JSON, lazy-loaded per hub or month:
        - `model.surge_forecast_hourly`: hourly actual / forecast / typical
        - `model.surge_model_metrics`: scorecard
        - `model.surge_recommendations_backtest`: the dispatch-event feed, mapped to v3 field names

        Timestamps are Vancouver wall time stored as UTC. Compute each preset time (30 min before the first `available_at` of that day's peak-surge episode) and record it in `DECISIONS.md`.
     2. **Move the analytics snapshots out of `mocks/`.** Origins, daily timeline, exam/holiday events, validation, hubs and presets go into a shared location that both mock and real mode read.
     3. **Rewrite the zod schemas to v3.**
        - Required: DispatchEvent, AdditionalTrip, Bus, Clock, `/state`, and the WS envelopes (`clock.updated`, `dispatch_event.updated`, `proposal.created`, `proposal.updated`, `trip.updated`, `bus.updated`, `system.reset`, `system.error`).
        - Optional: the real backend's extras (`movement_plan`, `heading_deg`, `Clock.auto_pause_on_proposal`, …).
        - Update the test fixtures from `backendspec.md`.
     4. **Update the API client and hooks** for `POST /clock/pause|resume|speed|seek` and `{error:{code,message}}`. Remove the v2-only endpoints.
     5. **Update the live layer for v3:**
        - WS at `/ws`, whose first frame is the `/state` snapshot
        - the new event types
        - `system.reset` triggers a refetch of `/state`
        - epoch/seq filtering as before
     6. **Rewrite MockSim to mirror the backend's rules:**
        - events activate at `actionable_at` (proactive when `available_at` is set)
        - the top-priority recommendation whose route exists wins; bus count = `ceil(extra_bus_trips_est)`, capped at 3 per event and by free buses
        - 30 sim-min approval timeout; auto-pause on proposal; reject or expiry releases the bus
        - the fleet mirrors `backend/config/fleet.json`
        - seek is deterministic

        Mock routes include every real GTFS route the bundled feed names (49, 4, R4, 25, 99, 14, 84, 33, …).
     7. **Rebuild the MSW handlers and fake WS** on the new MockSim. Adapt the M1 UI (top bar, hub markers) to v3. Auto-pause becomes a read-only indicator.
     8. **Checks:** lint, typecheck, tests, build. Run a smoke test against the real backend with `docker compose up --build`.
   - **2b. UI:**
     - **Network overview.** Hub cards, the approval queue, active extra trips, and non-hub events come from DispatchEvents grouped into display-only surge episodes. The scorecard strip comes from `surge_model_metrics` at 60 min lead.
     - **Now tab.** Real forecast chart with an arrivals/departures toggle (default arrivals), a 6 / 12 / 24 h window selector, and no 80% band. Visible dispatch events are overlaid as markers, not rescaled into the line.
     - **Origins tab.** Arcs from the bundled origins. "Where the surge crowd is headed" comes from the event's recommendations, with destinations matched to `dim_origin` case- and space-insensitively.
     - **Timeline scrubber.** Bundled retrospective surge days and event bands, plus dispatch events that have already become actionable. Never show future events.
     - **Checks** plus screenshots at 1440, 1024 and 390 px in light and dark.
3. **Act:** the full dispatch flow (proposals, preview, approve/reject, toasts, auto-pause, bus animation, resolution) and the UBC scenario end to end.
4. **Depth and proof:** Routes, Late night, Planner (port), Findings, the About modal with scorecard and validation, and the remaining mock scenarios.
5. **Polish:** responsive layouts, accessibility pass, the states audit, performance at 3600x, a screenshot critique, `web/README.md`, Dockerfile and the compose service.

---

## 20. Out of scope

- Authentication, user accounts, saved plans, and audit logs (the backend owns state).
- Genie or any chat and natural-language surface.
- Deleting or changing the AppKit app, `frontend/`, `backend/` or `hub_pulse/`.
- Building or changing Databricks pipelines, models or tables. That's backend/data work, requested in `backendspec.md`.
- Deploying to Vercel. Documenting the steps is enough.
- Choosing the final product name.

---

## 21. Dependencies and open items

- **Backend:** the open questions at the end of `backendspec.md`. These are non-hub surge sources, route-load method, spare fleet, events CSV, forecast model, approval timeout, the trip→bus mapping, and hosting.
- **Backend blocking items:** until they land (hourly forecast backtest, hourly surge index, approval, seek), the real-backend demo can't run. Mock mode covers development.
- **Product name:** TBD. Change it only in `web/src/config/app.ts`.
- **PMTiles extract:** has to be generated once with internet access (section 7.1).
