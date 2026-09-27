# Architecture (module contracts)

Read with `../spec.md` (what to build), `../backendspec.md` (API contract v3; wins on shapes) and `DECISIONS.md` (owner answers; wins over the spec). The real v3 backend is in `../backend/`; the frontend mirrors its payloads.
Several agents build this in parallel, so **keep to these file paths and exported names**. If you must change an interface, change its callers too and note it at the bottom of this file.

## Ground rules

- Next.js 16 App Router. **Read `node_modules/next/dist/docs/` before using a Next API you're unsure of.** This Next version differs from older training data.
- TypeScript strict. No `any` in exported types. `@/*` maps to `src/*`.
- Everything interactive is a client component (`"use client"`). `app/page.tsx` renders `<Console />`.
- Don't add npm packages. Everything needed is installed (see `package.json`). If something is truly missing, stop and report it.
- Keep frontend implementation in `frontend/`; root Compose configuration is the
  only deployment file maintained outside it.
- Vocabulary (spec §2.1): **pings**, **surge index**, **typical**, **forecast**, **proposal**, **extra trip**, **spare/donor route**, **load**, **one-seat ride / transfer required**. Never say riders or passengers for pings.
- Every displayed time and date goes through `@/lib/format` (America/Vancouver). Hourly buckets are keyed by the API's `local_date` + `hour` (`hourKey()`), never by epoch math.
- Colours come from CSS custom properties (see "Theme tokens"), never hard-coded hex in components.

## Module map

```
src/
  config/app.ts            APP.name, APP.tagline (only place the name lives)
  config/env.ts            ENV: apiBaseUrl, wsUrl, useMocks, basemapLightUrl, basemapDarkUrl, isDev
  config/hubs.ts           HUBS (id, name, location_name, location, catchment_m): v3 has no /hubs endpoint
  config/scenario.ts       PRESETS, DEFAULT_START_TIME, DAY_TYPE_LABELS, SURGE_THRESHOLD, SEVERITY_BANDS
  app/layout.tsx           fonts (next/font), <Providers>, metadata title from APP.name
  app/page.tsx             <Console /> (client)
  app/providers.tsx        ThemeProvider (next-themes, attribute="class", defaultTheme="system"),
                           QueryClientProvider, TooltipProvider, <Toaster/>, <LiveBoot/> (starts mocks, then live connection)
  app/globals.css          Tailwind v4 + shadcn tokens + semantic tokens (both themes)

  lib/api/schemas.ts       zod schemas + inferred types for backendspec.md v3 (DispatchEvent, AdditionalTrip, Bus, Clock, /state, /meta, WS)
  lib/api/client.ts        apiGet / apiSend, ApiError, contract-mismatch reporting, tripConflictMessage (409 copy)
  lib/api/endpoints.ts     one typed function per v3 endpoint (getMeta, getState, seekClock, approveTrip, getRoutes, ...)
  lib/api/queryKeys.ts     key factories (qk.meta(), qk.routes(), qk.hubForecast(hub), qk.trip(...))
  lib/api/hooks.ts         TanStack hooks: queries (with staleTime rules), bundled-snapshot loaders, mutations
  lib/api/contractIssues.ts  tiny zustand store of contract mismatches for the dev banner
  lib/time/index.ts        Vancouver time helpers (done)
  lib/format/index.ts      display formatters
  lib/theme/tokens.ts      TOKEN_NAMES, readTokens(), useThemeTokens()
  lib/live/transport.ts    SimTransport interface
  lib/live/wsTransport.ts  real WebSocket transport
  lib/live/createTransport.ts  picks the real or mock transport from ENV.useMocks
  lib/live/reducer.ts      pure reducer: snapshot + envelopes -> SimSlice (+ effects for toasts)
  lib/live/store.ts        zustand store: sim slice + UI slice + actions
  lib/live/clock.ts        extrapolation + useSimNow hooks
  lib/live/connection.ts   startup sequence, buffering, reconnect/backoff
  lib/live/effects.ts      toasts + aria-live announcements from reducer effects
  lib/live/timeKey.ts      throttled sim-hour key for time-dependent queries (spec §11.2)
  lib/live/episodes.ts     display-only surge episodes grouped from dispatch events (buildEpisodes, useEpisodes)
  lib/url/state.ts         URL <-> UI state sync (hub, tab, basis, h, layers, t)

  data/*.json              bundled Databricks analytics snapshots, shared by mock and real mode (+ README.md with the SQL)
  data/index.ts            typed accessors over the small snapshots (hubs, daily, origins, routes, ...)
  data/forecast.ts         lazy per-hub hourly actual/forecast/typical (model.surge_forecast_hourly)
  data/feed.ts             lazy per-month dispatch feed (model.surge_recommendations_backtest), the mock's event source
  data/metrics.ts          scorecard (model.surge_model_metrics)
  (frontend/scripts/pull-analytics.mjs re-pulls forecast, metrics, feed and extra routes, read-only)

  mocks/sim/rng.ts         seeded PRNG + hash (deterministic by key)
  mocks/sim/network.ts     mock GTFS index + fleet (mirrors backend/config/fleet.json) + feed → DispatchEvent mapping
  mocks/sim/mockSim.ts     MockSim: mirrors the backend coordinator (activation, proposals, expiry, movement, seek)
  mocks/handlers/sim.ts    MSW handlers for every v3 REST endpoint
  mocks/ws/fakeTransport.ts  SimTransport over MockSim: /state snapshot first, then envelopes; drop-connection support
  mocks/browser.ts         startMocks(): MSW worker + MockSim singleton (waits for the first feed months)
  mocks/devFlags.ts        ?mock_state parsing

  components/ui/*          shadcn (generated; restyle via tokens, avoid editing logic)
  components/*             EmptyState, Kpi, SourceNote, RouteBullet, LoadBar, StateBoundary, charts/EChart
  features/shell/          Console layout (desktop grid / tablet drawer / phone stack)
  features/topbar/         clock, play/pause, speed, presets, date picker, auto-pause, status, theme, about, reset, overflow
  features/map/            ConsoleMap (next/dynamic ssr:false), basemap probe, layers, preview chip, bus animation
  features/overview/       network overview panel
  features/hub/            hub panel header + tabs (now, origins, dispatch, routes, late-night, findings)
  features/planner/        planner.ts + planner.test.ts (copied unchanged), planner UI
  features/timeline/       scrubber
  features/about/          About modal
```

## Key interfaces

### config/env.ts
```ts
export const ENV: {
  apiBaseUrl: string;   // NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1"
  wsUrl: string;        // NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws"
  useMocks: boolean;    // NEXT_PUBLIC_USE_MOCKS === "true"
  basemapLightUrl: string; basemapDarkUrl: string;
  isDev: boolean;       // process.env.NODE_ENV !== "production"
};
```
Reference `process.env.NEXT_PUBLIC_*` literally, because Next inlines them at build time.

### lib/api/client.ts
```ts
export class ApiError extends Error { status: number; code: string }
export async function apiGet<T>(path: string, schema: z.ZodType<T>, params?: Record<string, string | number | boolean | undefined>): Promise<T>;
export async function apiSend<T>(method: "POST", path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
export function tripConflictMessage(err: ApiError): string; // 409 → spec §9.3 copy (the backend sends HTTP_ERROR + a message, no trip)
```
- Non-2xx: parse `ErrorBody` and throw `ApiError` (network failure → code `NETWORK`).
- Validation, dev (`ENV.isDev`): `safeParse`. On failure, `console.error(path, issues)` and `reportContractIssue(endpoint)`, then **still return the raw data cast to T**, so the UI keeps working and the banner shows.
- Validation, prod: `safeParse`. On failure, return the raw data (degrade gracefully) and don't show the banner.
- Mock mode validates too, so the mocks are held to the contract.

### lib/live/transport.ts
```ts
export type TransportStatus = "connecting" | "open" | "closed";
export interface SimTransport {
  connect(h: { onMessage(msg: unknown): void; onStatus(s: TransportStatus): void }): void;
  close(): void;
}
export type TransportFactory = () => SimTransport;
```

### lib/live/reducer.ts (pure; unit-tested)
```ts
export interface SimSlice {
  clock: Clock | null;
  receivedAt: number;              // wall ms (performance.now()-free; use Date.now()) when clock was last set by the server
  epoch: number; lastSeq: number;
  events: Record<string, DispatchEvent>; trips: Record<string, AdditionalTrip>; buses: Record<string, Bus>;
  resyncing: boolean;
  lastSimTime: string | null;      // simulation_time of the last applied message (for stale notes)
}
export type SimEffect =
  | { kind: "trip-proposed"; trip: AdditionalTrip }
  | { kind: "auto-paused" }
  | { kind: "event-new"; event: DispatchEvent }
  | { kind: "trip-expired"; trip: AdditionalTrip }
  | { kind: "system-error"; message: string }
  | { kind: "reset"; epoch: number };
export const emptySim: SimSlice;
export function applySnapshot(s: SimSlice, state: StateResponse, wallNow: number): SimSlice;
export function applyMessage(s: SimSlice, msg: WsMessage, wallNow: number): { sim: SimSlice; effects: SimEffect[] };
```
- Drop a message if `msg.epoch < s.epoch`, or if `msg.seq <= s.lastSeq`, except `system.reset`, which applies whenever its `data.epoch > s.epoch`.
- `system.reset`, a newer-epoch message, or a seq gap (`seq > lastSeq + 1`): set `resyncing = true` and emit `{kind:"reset"}`. The connection layer then refetches `/state`.
- Clock: `clock.updated` replaces the clock. Ticks carry `reason: null`; `AUTO_PAUSE_PROPOSAL` emits `auto-paused`.
- `event-new` fires only for a dispatch event id not seen before in this epoch. `trip-proposed` fires on `proposal.created`.
- The WebSocket's first frame is the /state snapshot, which the connection applies. REST /state is the fallback after 3 s.

### lib/live/store.ts
```ts
export type HubTab = "now" | "origins" | "dispatch" | "routes" | "late-night" | "planner" | "findings";
export type LayerKey = "origins" | "surges" | "buses" | "routes" | "catchments";
export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";
export interface UiSlice {
  selectedHubId: string | null; tab: HubTab;
  previewTripId: string | null; focusTripId: string | null;
  originsBasis: "actual" | "typical"; horizon: number;
  layers: LayerKey[];                 // default: ["origins","surges","buses","catchments"]
  hoverOrigin: string | null; highlightRouteId: string | null;
  aboutOpen: boolean;
  pendingSeek: boolean;               // true between a seek request and the post-reset /state
}
export const useSim: UseBoundStore<StoreApi<SimSlice & UiSlice & { connection: ConnectionState } & Actions>>;
// Actions: setSnapshot, applyMessages, setConnection, selectHub(id|null, tab?), setTab, startPreview(tripId), exitPreview(),
//          setOriginsBasis, setHorizon, toggleLayer, setHoverOrigin, setHighlightRoute, setAboutOpen, setClockOptimistic(clock)
```

### lib/live/clock.ts
```ts
export function simNowMs(clock: Clock | null, receivedAt: number, wallNow: number): number; // RUNNING: current + (wall-received)*speed
export function getSimNowMs(): number;                  // reads the store; for rAF loops (no React)
export function useSimNow(throttleMs?: number): number;  // rAF-driven React hook; re-renders at most every throttleMs (default 250)
```

### lib/live/timeKey.ts
`useSimHourKey(opts?: { visible?: boolean })` returns `{ localDate, hour, epoch, at }`. It changes at sim-hour boundaries and on epoch change, throttled per spec §11.2: at most once per 2 s at ≥ 900x; at 3600x only when `visible`; always once on pause. `at` is the ISO sim time captured when the key changed.

### lib/format/index.ts
`fmtPings(n)` "3,920" · `fmtPingsKpi(n)` (compact only when > 100k: "10.3M") · `fmtIndex(1.79)` "1.79×" · `fmtPct(14.5)` "14.5%" · `fmtTime(iso)` "13:00" · `fmtDate(iso)` "Sat Dec 6 2025" · `fmtDateShort(local_date)` "Sat Dec 6" · `fmtClock(iso)` → `{ weekday, date, time, tz }` for the top bar · `tzAbbr(iso)` "PST"/"PDT" · `fmtDuration(minutes)` "2 h 40 min" / "45 min" · `fmtWindow(startIso, endIso)` "13:00–15:00" · `hourLabel(h)` "13:00" · `compact(n)` · `signed(n)`. Every Intl call passes `timeZone: TZ`.

### lib/theme/tokens.ts
```ts
export const TOKEN_NAMES = ["surge-low","surge-medium","surge-high","need","spare","late-night","actual","forecast","typical",
  "access-transfer","access-oneseat","trip-proposed","trip-active","trip-done","trip-failed",
  "background","foreground","muted-foreground","border","card","primary","map-land","map-water","map-label"] as const;
export type TokenName = (typeof TOKEN_NAMES)[number];
export function readTokens(): Record<TokenName, string>;           // getComputedStyle(document.documentElement)
export function useThemeTokens(): Record<TokenName, string>;       // re-reads when next-themes resolvedTheme changes
```

### mocks
- `startMocks(): Promise<void>` starts the MSW worker (`onUnhandledRequest: "bypass"`, quiet) and creates the MockSim singleton `getMockSim()`.
- `MockSim` is deterministic (seeded by keys, not call order) and takes an injectable `now()` for tests. Public API:
  `getState(): StateResponse`, `getClock()`, `pause()`, `resume()`, `setSpeed(n)`, `seek(iso)`, `setSettings({auto_pause_on_proposal})`,
  `approve(id, epoch)`, `reject(id, epoch, reason?)` (both throw `MockApiError` with code, status and trip), `getTrip(id)`, `getTripDetail(id)`,
  `subscribe(fn: (env: WsMessage) => void): () => void`, `step(wallNow?)` (advance to now; called by the internal 250 ms timer or by tests),
  `dropConnections()`.
- Handlers call MockSim and `synth` and return **contract-exact** JSON: the same shapes the zod schemas accept, with explicit nulls.

## Theme tokens (CSS custom properties)

Both themes define: shadcn base tokens (`--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--border`, ...) and the semantic roles from spec §14.2:
`--surge-low --surge-medium --surge-high --need --spare --late-night --actual --forecast --typical --access-transfer --access-oneseat --trip-proposed --trip-active --trip-done --trip-failed`, plus map roles `--map-land --map-water --map-label` for the plain fallback background.
Tailwind exposes them through `@theme inline` as `bg-surge-high`, `text-need`, and so on. ECharts and MapLibre read them via `useThemeTokens()`.

## Interface change log
(append here)

### Data layer (lib/api, lib/live, lib/format, lib/url), 2026-09-26
All additive unless marked **changed**. `schemas.ts` needed no changes: every message.txt example parses and round-trips unchanged.

- **api/client.ts:** `apiGet(path, schema, params?, options?)` and `apiSend(method, path, body, schema, options?)` take an optional trailing `{ signal }`. `ApiError` fields are readonly; `isApiError(e)` helper. Codes besides the contract's: `NETWORK` (status 0), `INVALID_RESPONSE`, `HTTP_<status>`.
- **api/contractIssues.ts:** `useContractIssues` (`endpoints: string[]`, `clear()`), `reportContractIssue(label)`, `validateContract(label, schema, data)`. Labels look like `GET /hubs/ubc/forecast` or `WS surge.updated`.
- **api/mockGate.ts (new):** `mocksReady()` starts the mock layer once in mock mode (no-op otherwise). The client awaits it before every request and LiveBoot before connecting, so nothing races the MSW worker.
- **api/endpoints.ts:** `getState, getSimulation, seekSimulation, setSimulationSpeed, updateSimulationSettings, pauseSimulation, resumeSimulation, getSurges, getBuses, getTrips, getTripDetail, approveTrip, rejectTrip, getRoutes, getRoute, getRouteLoad, getMeta, getHubs, getTimeline, getEvents, getFindings, getBacktest, getValidation, getHubStatus, getForecast, getOrigins, getLateNight, getHourlyProfile, getHubOverview, getRouteCrowding, getRecommendations`.
- **api/queryKeys.ts:** `qk.*` factories plus `TIME_DEPENDENT_ROOTS` and `isTimeDependentKey(key)`.
- **api/hooks.ts:** static `useMeta, useHubs, useFindings, useBacktest, useValidation, useTimeline, useEvents, useHubOverview, useRouteCrowding, useRecommendations, useHourlyProfile, useRoutes(hubId, includeShape)`; time-dependent `useForecast(hub, horizon, {visible}), useOrigins(hub, basis, {visible}), useLateNight, useRouteLoad, useHubStatus, useRouteDetail`, plus `useTripDetail(tripId)`. Time-dependent queries keep the previous hour's data as placeholder (only for the same hub and inputs; check `isPlaceholderData`). Mutations `usePause, useResume, useSetSpeed, useUpdateSettings, useSeek, useApproveTrip({tripId}), useRejectTrip({tripId, reason?})`, and `TRIP_CONFLICT_MESSAGES` for the 409 codes. The hooks don't toast; callers show "Trip approved" / "Proposal rejected".
- **live/transport.ts (changed):** `TransportFactory` is `() => SimTransport | Promise<SimTransport>`, so `createTransport` (async, code-splits the mock) is itself the factory. New `TransportConfigError` (not retried).
- **live/createTransport.ts:** `createTransport(): Promise<SimTransport>`, `mixedContentError(protocol, wsUrl)`. An https page with a non-wss URL sets `configError` and the connection stays offline, showing /state once.
- **live/reducer.ts:** extra `applyMessages(s, msgs, wallNow) → { sim, effects, remaining }`, which stops at the first reset. A non-reset message from a *newer* epoch counts as a missed `state.reset`. Ticks and state changes older than a seek's optimistic clock don't roll it back.
- **live/store.ts:** exports `HUB_TABS, LAYER_KEYS, DEFAULT_LAYERS, DEFAULT_HORIZON, LiveState`. Extra state: `configError`, `announcement`, `pendingLinkTime`. Extra actions: `upsertTrip` (never downgrades status), `setFocusTrip`, `setLayers`, `setConfigError`, `announce`, `setPendingLinkTime`. **Changed:** `applyMessages(msgs)` returns `{ effects, remaining }`. `setClockOptimistic` ignores stale Clocks and sets `pendingSeek` only for a newer epoch; `selectHub(id)` with a new hub resets tab to `now` and clears preview, focus, hover and route highlight.
- **live/clock.ts:** `simNowMs` returns NaN before the first snapshot and clamps at `max_time`.
- **live/timeKey.ts:** `localDate`, `hour` and `at` are null before the first snapshot (`EMPTY_HOUR_KEY`). The key holds while `pendingSeek || resyncing`, then follows the new epoch at once. `decideKeyUpdate` is exported for tests.
- **live/connection.ts:** `startLiveConnection` (stops any previous one), `resyncNow()`, `parseWsMessage`, `backoffDelay`. Reconnect syncs invalidate time-dependent queries as well as resets do. `resync()` with the socket down fetches /state directly, and `useSeek` calls it when not live, so `pendingSeek` can't stick.
- **live/effects.ts:** `handleSimEffects(effects, { queryClient })`, `hubDisplayName`, `describeProposal`, `depotLine`, `surgeToastText`.
- **format:** time and date formatters accept an ISO string or epoch ms. Every formatter returns "—" for null or invalid input. `fmtClock` returns `{ weekday: "Sat", date: "Dec 6 2025", time: "13:20", tz: "PST" }`.
- **url/state.ts:** `useUrlStateSync()` (one active owner; mounted by `app/providers.tsx`, so the Console needn't call it), `parseUrlState`, `serializeUrlState`. Defaults are left out of the URL; `layers=` (empty) means every layer is off.
- **app/providers.tsx:** exports `Providers` (named and default).

### Orchestrator, 2026-09-26
- `features/map/index.ts` exports `ConsoleMap` (next/dynamic, ssr:false) loading `features/map/ConsoleMapImpl.tsx` (default export). The shell imports `ConsoleMap`; the map agent owns `ConsoleMapImpl.tsx` and everything else in `features/map/`.
- `mocks/browser.ts` exports `startMocks()` and `dropMockConnections()` (dev "Drop connection" menu item). The mock agent keeps both names.
- `mocks/sim/scenarioTimeline.ts` holds the scripted scenario timings and surge-index curves (shared by synth and MockSim).
- `mocks/sim/types.ts` (orchestrator) defines the seam: `MockSimApi`, `SynthApi`, `MockApiError`, `MockHubId`.
  - `mocks/sim/synth.ts` exports `synth: SynthApi` (synthesis agent).
  - `mocks/sim/instance.ts` exports `getMockSim(): MockSimApi` (simulator agent).
  - Read handlers take `at` from the query, else `getMockSim().nowMs()`.
  - Handlers: `mocks/handlers/read.ts` exports `readHandlers` (synthesis agent); `mocks/handlers/sim.ts` exports `simHandlers` (simulator agent); `mocks/handlers/index.ts` exports `handlers = [...simHandlers, ...readHandlers]` (simulator agent).

### Simulator (mocks/sim, mocks/ws, mocks/handlers/sim.ts, mocks/browser.ts), 2026-09-26
All additive; `types.ts` unchanged.

- **sim/instance.ts:** `getMockSim()` (lazy singleton; reads `?mock_nonhub` via `devFlags.isMockNonHubEnabled()` and `?mock_buses=N` itself) and `startMockSimTimer()` (idempotent 250 ms `step()` timer, browser only). `startMocks()` calls both after the MSW worker starts.
- **sim/mockSim.ts:** `class MockSim implements MockSimApi`, `new MockSim({ now?, synth?, startTime?, nonHub?, extraBuses? })`; constants `DEFAULT_START_TIME`, `MIN_TIME`, `MAX_TIME`, `ALLOWED_SPEEDS`.
- **sim/scenarios.ts:** `getWorld()` → `{ scenarios, fleet, waterfrontRanking }`; `rankWaterfrontRoutes`, `severityFor`, `BUS_CAPACITY`, `PROPOSAL_TTL_MS`. **sim/geo.ts:** path helpers.
- **ws/fakeTransport.ts:** `createFakeTransport(sim = getMockSim())`; the optional arg is for tests.
- **Semantics worth knowing in the UI:**
  - `progress.percent_complete` is a **fraction 0–1** (message.txt's example is 0.18), measured from `dispatch_time` to `estimated_completion_time`.
  - A trip's `surge_location` is the stop where the bus waits and the service starts (UBC Exchange for UBC), not the surge's hub centroid (`surge.location`).
  - An approved trip's bus is `DEADHEADING` (per the table) but stays parked at home until `dispatch_time`; `bus.positions_updated` only includes it once it moves.
  - A surge that went `NO_BUS_AVAILABLE` keeps that status when its window starts; only `PENDING`/`AWAITING_APPROVAL` become `EXPIRED`.
  - Seek to a time inside a scripted window (decisions discarded) shows the surge `ACTIVE`/`EXPIRED` with proposal A `EXPIRED`. A seek past the dispatch time re-times the re-opened proposal to leave at T.
  - The same trip ids come back after every seek (`trip-ubc-2025-12-06-a`, `-b`, `trip-park-royal-2025-12-26-a`, `trip-waterfront-2026-07-25-a`); epochs tell them apart.

## v3 migration (Milestone 2a, 2026-09-27)

- **Contract:** `schemas.ts` now describes backendspec.md v3 plus the real backend's optional extras. The v2 objects (Surge, HubStatus, Forecast, Origins, …) and their endpoints are gone. The fixtures in `lib/api/__fixtures__/` are payloads captured from `backend/` running in fixture mode.
- **Data:** the analytics snapshots moved from `mocks/data/` to `src/data/`, shared by both modes. New files: `forecast/<hub>.json`, `metrics.json`, `feed/<month>.json` and `routes_feed_extra.json` (see `src/data/README.md`).
- **Live:** the store holds `events` (DispatchEvents) instead of `surges` and `hubs`. Hub halos use the bundled forecast's last full hour and `lib/live/episodes.ts`.
- **Mocks:** MockSim was rewritten to mirror the backend (see its header, and DECISIONS.md "MockSim (v3)", "2a answers" and "Mock-only deviations"). The v2 read handlers, synthesis and scripted scenarios were removed.
- **Top bar:** presets and the Reset demo time come from `config/scenario.ts`, and presets outside the clock's bounds are disabled. Auto-pause is a read-only indicator. Speeds come from `/meta.supported_speeds`.

## Milestone 2b UI (2026-09-27)

Decisions: DECISIONS.md "2b answers". New modules:

- **Data:** `data/events.ts` (`DRIVER_EVENTS`, `driverEventsBetween`) and `data/feedDays.ts` (`feedDays`, `feedDaysActionableBy`, from `feed_days.json`, which `scripts/derive-feed-days.mjs` builds).
- **Live helpers:** `lib/live/demand.ts` (`previousHour`, `nextHour`, `lastFullHourOf`, `useAllHubForecasts`, `useLastFullHour(target)`). `lib/live/trips.ts` (`approvalQueue`, `activeTrips`, `minutesLeft`, `tripProgress`, `tripEta`, `tripHub`). `episodes.ts` adds `episodeLeadMinutes` and `latestResolvedEpisode`.
- **Store (changed):** `OriginsBasis` is now `"typical" | "all"` (`DEFAULT_ORIGINS_BASIS` = typical; URL `basis=all`). New are `forecastTarget` / `setForecastTarget` (`"arrivals" | "departures"`, store only) and `HORIZON_OPTIONS` (6/12/24).
- **Components:** `SeverityBadge` / `SeverityMark`, `TripStatusBadge`, and `Segmented` (a single-choice control styled like the speed control). `SourceNote` now wraps long table names.
- **Features:**
  - `features/overview/*`: `NetworkOverview`, `HubCards`, `ApprovalQueue` (optional `hubId`), `ActiveTrips` (optional `hubId`), `AwayEvents` and `ScorecardStrip`.
  - `features/trips/*`: `useTripActions` (Approve / Reject with the toasts and 409 copy) and `TripRoute`.
  - `features/hub/*`: `HubPanel` (header, status line, tabs), `now/*` (`NowTab`, `ForecastChart`, pure `forecastWindow.ts`), `origins/*` (`OriginsTab`, pure `originMix.ts`, `useOriginMix`) and `DispatchInterim` (hub queue + active trips until M3).
  - `features/timeline/*`: `Timeline` (full / compact) and pure `scale.ts`.
- **Map:**
  - `layers/OriginsLayers.tsx` adds arcs (slot 3, with HTML origin labels and the key) and bubbles (slot 4) on the `origins` toggle.
  - `arcs.ts` holds the geometry and scales.
  - `camera.tsx` fits the hub plus its origins with a share of 2% or more (key `hub:<id>:origins`).
  - `FitTarget.extraPadding` is new. `hubs.ts` `useLastHourIndex` now delegates to `lib/live/demand`.
- **Shell:** `slots.tsx` renders the overview and the hub panel, and `TimelineSlot` renders `Timeline`. The Console root is `md:flex-none`, so `md:h-dvh` holds when the panel is taller than the screen.
- **Tests:** `features/hub/m2b.test.ts`. `e2e/smoke.spec.ts` gains an M2b flow, and `e2e/screenshots.spec.ts` captures overview, Now, Now chart, Origins and the phone timeline at a fixed sim time (`SHOT_TAG`, `SHOT_TIME`, `SHOT_QUERY`).
