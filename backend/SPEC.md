# Hub Pulse Dispatch Backend

## Technical Specification — v2.0

This is the target implementation specification for the frontend's v2 contract.
It supersedes the v1 automatic-dispatch contract. Requirements describe intended
behavior, not capabilities already implemented. The current service is Python
3.13/FastAPI, with health routes and initial domain models; the reference to
`backend/server.js` in the frontend draft is obsolete.

## 1. Purpose and scope

Build an authoritative backend for a Next.js TransLink dispatcher console at
`http://localhost:3001`. The console replays demand at UBC, Waterfront, and Park
Royal, compares forecasts with observed device pings, explains origins and route
loads, and lets a human approve additional simulated bus trips.

The demo must support:

1. Hourly, out-of-sample forecasts during Nov 2025–Aug 2026.
2. Hourly surge baselines computed without future observations.
3. Explainable proposals, bus reservations, and human approval/rejection.
4. Deterministic seeking through the replay period.
5. Consistent entity objects across snapshots, lists, and WebSocket events.
6. Hub analytics, a what-if planner's inputs, findings, and model validation.

The backend selects existing GTFS bus service patterns, finds schedule gaps,
reserves simulated spare buses, and simulates deadhead, service, and return travel.
It does not operate real vehicles, animate the entire scheduled fleet, model
driver shifts, or optimize the whole network. GTFS-Realtime and LLM-based dispatch
are outside the MVP. Forecast production and evaluation belong in reproducible
Databricks pipelines; API handlers consume their outputs.

## 2. Architecture and ownership

```text
Databricks hourly forecasts / actuals / gold analytics
                       | validated adapters
GTFS snapshot ---------+----------------------------+
                       v                            v
             demand and dispatch services     analytics read services
                       |
              proposal + reserved bus
                       | human approve/reject
                       v
               simulation engine
                       |
              REST snapshots + WebSocket
                       |
               dispatcher frontend
```

- Use Python 3.13, FastAPI, Pydantic, `uv`, strict typing, and Docker.
- API routes validate requests, call services, and serialize explicit response
  models. Dispatch logic does not belong in handlers.
- Domain entities, typed IDs, invariants, and transitions do not import FastAPI
  or Databricks libraries. API read models are separate from internal entities.
- Services own route matching, scheduling, reservation, approvals, replay, and
  read-model assembly. Integrations own SQL/schema translation, GTFS, and routing.
- Repository protocols isolate in-memory storage. GTFS records are immutable.
- Use one application-owned simulation and one mutation coordinator per server.
  All clients share it. Run one worker for this in-memory MVP; multiple workers
  would require shared state and event ordering.
- Pin input snapshots, configuration, model version, and GTFS feed for each run.
  No network query may partially mutate a simulation.
- The frontend may interpolate animation and run its what-if planner locally;
  authoritative dispatch, bus assignment, expiry, and clock control stay here.

Recommended modules are `app/api/routes`, `app/api/schemas`, `app/domain`,
`app/services`, `app/integrations/{databricks,gtfs,routing}`, and
`app/repositories`, retaining `app/config.py` and `app/main.py`.

## 3. API conventions

### 3.1 Transport, identifiers, and errors

- REST base: `/api/v1`. WebSocket: `/api/v1/ws/simulation`.
- Frontend REST and WebSocket base URLs come from environment variables.
- Configurable `CORS_ORIGINS` defaults to `http://localhost:3001` and
  `http://127.0.0.1:3001`. Validate WebSocket origins against the same list.
- JSON is snake_case. IDs are strings. GTFS `route_id` is preserved exactly;
  `line_key` is the public line identifier used by gold tables, such as `99` or R4.
- Every documented response field is present. Unknown nullable values are `null`;
  empty collections are `[]`. Do not fabricate zeros for unavailable data except
  where an endpoint explicitly defines a zero-fill rule.
- Coordinates are `{ "lat": number, "lon": number }`. GeoJSON positions are
  `[longitude, latitude]`. Validate geographic bounds and finite numeric values.
- Errors use `{"error":{"code":"CODE","message":"Human readable"}}`.
  Trip conflicts additionally include `trip`, a canonical AdditionalTrip or
  `null` if a seek removed it. Do not expose stack traces.
- HTTP 400: semantic parameter errors; 404: unknown entity; 409: state conflict;
  422: malformed/schema-invalid input; 503: required data unavailable. Validation
  errors must use the same envelope. Successful operations below return 200.
- List ordering is deterministic. Reject invalid enum filters and malformed date
  ranges rather than silently ignoring them. Register `/routes/load` before the
  dynamic `/routes/{route_id}` route.

### 3.2 Time and hourly identity

- Serialize aware ISO 8601 timestamps in `America/Vancouver`. Use historical
  timezone-database offsets through B.C.'s final spring transition on March 8,
  2026, then permanent UTC-07:00 Pacific time. Do not apply the superseded 2026
  fall rollback that may remain in older timezone databases.
- Instant-based hourly rows carry `time`, `local_date`, and `hour` (0–23).
  `local_date` and `hour` are display/grouping fields, not a unique key on a
  historical fall-back day: use the offset-bearing `time` as the bucket key. The
  two repeated hours have different offsets. Historical spring-forward days omit
  the nonexistent hour; after March 8, 2026, Vancouver has no clock changes.
  Typical 24-hour profiles are not instant-based rows and only carry `hour`.
- The source hackathon timestamps ending in `Z` represent local wall-clock time,
  according to the supplied data validation. The source adapter must interpret
  these as Vancouver wall time, not convert them from UTC. This exception applies
  only to that source, never to ordinary API timestamps.
- Wall-clock source rows cannot intrinsically distinguish a repeated DST hour.
  Resolve using available source metadata; otherwise record the ambiguity and
  exclude ambiguous/nonexistent buckets from replay scoring instead of inventing
  a second observation. The normalization policy is part of pipeline provenance.
- Incoming timestamps require an explicit offset and must identify a valid
  Vancouver local instant. Reject inconsistent offsets/nonexistent local times.
- Windows are start-inclusive, end-exclusive unless explicitly stated otherwise.
  Clock `min_time` and `max_time` are inclusive seek bounds.
- All `at` queries default to one captured simulation time per request. They are
  side-effect-free and cannot change the global clock.

### 3.3 Hubs, day types, and units

| hub_id | Source location_name |
|---|---|
| `ubc` | `UBC` |
| `waterfront` | `Waterfront Station` |
| `park-royal` | `Park Royal Mall` |

Map source day types `MF`, `Sat`, `Sun/Hol` to `mf`, `sat`, `sun_hol`, using BC
holidays. Device pings are not riders or boardings. Observed ping counts are
nonnegative integers; means and model estimates may be fractional.

Shares and probabilities expressed as percentages use 0–100. **Capacity load
percentages can exceed 100**, including `load_pct`, `load_before_pct`,
`load_after_pct`, and `peak_load_pct`. MAPE can also exceed 100. Do not impose a
universal 100 ceiling on `_pct` fields. `avg_peak_load_factor` is reported in
percentage points for compatibility with the requested crowding endpoint.

Indexes are ratios: 1 means typical. A surge is at least 1.25. Severity bands are
LOW `[1.25, 1.5)`, MEDIUM `[1.5, 1.75)`, HIGH `[1.75, infinity)`.
`progress.percent_complete` retains the existing **0–1** scale.

## 4. Data contract and leakage prevention

Tables are in `rgersxdatabricks_hackathon.hub_pulse`; existing query definitions
are in `hub_pulse/app/hub-pulse/config/queries/`.

| Source | Required use |
|---|---|
| Rogers synthetic pings | Hourly observed demand and origin breakdowns |
| `gold_hub_forecast_hourly` (required new output) | Historical hourly forecast vintages |
| Trailing hourly baseline output (required) | As-of typical demand and surge indexes |
| `dim_hub`, `dim_origin` | Hubs, catchments, origin names/centroids |
| `gold_hub_daily` | Retrospective daily timeline and overview |
| `gold_origin_access` logic | Hour-sliced origins and direct access |
| `gold_hub_supply_hourly` | Typical GTFS supply by day type/hour |
| `tspr_bus_peakload`, `gold_route_stress` | Typical route loads and crowding |
| `gold_recommendations` | Long-term schedule findings |
| `gold_waterfront_validation` | Ping/ridership hourly-profile comparison |
| `hub_hours.sql`, `hub_overview.sql` | Planner profile and KPI read logic |
| `hub_pulse/analysis/scenarios.ts` | Reproducible network findings |
| BC holidays plus curated event records | Surge drivers and timeline annotations |

### 4.1 Hourly forecast vintages

The existing daily future forecast is not sufficient for historical replay.
Produce an hourly table with at least:

```text
hub, issued_at, target_hour, lead_h, forecast, lower_80, upper_80
```

The unique key is `(hub, issued_at, target_hour)`. Preserve model name/version,
training cutoff, normalization policy, and data snapshot provenance in the
table or a joined metadata artifact. `lead_h` is elapsed hours from issuance to
target; generate all intervening hourly targets through 24 hours, not only the
3/6/12/24-hour scorecard horizons.

- A forecast issued at T only uses observations available strictly before T.
  Fit preprocessing, calibration, and any learned origin mix on that same basis.
- Train/evaluate with rolling origins, not a full-period fit replayed backward.
- At a non-hour `at`, use the most recent issuance at or before `at`; return its
  actual `issued_at`. Never relabel an old issuance as a new forecast.
- `trained_through` must be before issuance. Intervals are nonnegative and ordered
  `lower_80 <= forecast <= upper_80`; missing intervals are explicit nulls.
- Historical chart forecasts use the exact requested horizon vintage; if it is
  missing, return null forecast fields, not a later, more informed prediction.
- Model names and scorecard values in frontend examples are illustrative. Serve
  actual artifacts and computed metrics, never their placeholder numbers.

### 4.2 Typical demand

For target hour H and issuance T, average complete observed hours with the same
hub, local day type, and local hour during the trailing eight weeks strictly
before T. Freeze this baseline with the forecast vintage. Actual/forecast
comparisons for that vintage use the same baseline.

Early replay may have fewer than eight weeks. Record available sample counts and
the effective period in provenance/`typical_basis`; use available prior samples
only. With no samples or a zero baseline, return null surge indexes and
`is_surge: false`, and do not create a surge from that bucket. Never divide by
zero or fill baseline gaps using future observations. Set replay `min_time`
according to actual forecast/baseline readiness, not a hard-coded example date.

### 4.3 Operational versus retrospective reads

Operational reads (`state`, surges, hub status, forecast, origins, route load,
late-night `hours`) may reveal actual observations only when available by `at`.
Do not expose the completed current-hour total as a partial count. If the source
has only hourly totals, partial actual fields are null until the hour closes;
do not prorate the final total and call it observed. Typical partial counts may
use a documented proportional baseline.

Retrospective views deliberately summarize a whole dataset: timeline, overview,
hourly profile, route crowding, recommendations, findings, backtest, validation,
and late-night `top_nights`. Their period/source labels must make that explicit.
They are not inputs to as-of forecast scoring or surge detection. In particular,
`gold_hub_daily`'s centered ±4-week surge index is retrospective context only.

TSPR 2025 statistics and fall 2026 GTFS are fixed scenario references, not claims
of live loads or historically exact service during every replay date. Mark this
in sources, evidence, and `load_basis`/`departures_basis`. Origin/home areas are a
proxy for likely onward travel, not observed destination trajectories.

## 5. Canonical public objects

The following notation defines exact fields: `?` after a type means nullable,
not optional; `Type[]` means an array; `A + {...}` extends A. All fields are
required in responses. Literal unions enumerate allowed values. Examples of IDs
and quantities below are illustrative, not seed data.

```text
GeoPoint = {lat: number, lon: number}
LineString = {type: "LineString", coordinates: [number, number][]}
RouteShape = LineString | {type: "MultiLineString", coordinates: [number, number][][]}
DayType = "mf" | "sat" | "sun_hol"
DriverType = "EXAM" | "HOLIDAY" | "SPORTS" | "CONCERT" | "FESTIVAL"
           | "NIGHTLIFE" | "WEATHER" | "OTHER"

RouteRef = {
  route_id: string, line_key: string, short_name: string, long_name: string?,
  mode: "Bus" | "SkyTrain" | "SeaBus" | "West Coast Express",
  color: string?, text_color: string?
}
RouteWithLoad = RouteRef + {load_before_pct: number?, load_after_pct: number?}
Destination = {
  origin: string, location: GeoPoint?, share_pct: number, expected_pings: number
}
Clock = {
  current_time: timestamp, local_date: date, hour: integer,
  speed: 1 | 60 | 300 | 900 | 3600, status: "RUNNING" | "PAUSED",
  min_time: timestamp, max_time: timestamp, approval_mode: "MANUAL",
  auto_pause_on_proposal: boolean, epoch: integer
}
HubStatus = {
  hub_id: string, as_of: timestamp,
  current_hour: {
    time: timestamp, local_date: date, hour: integer,
    pings_so_far: integer?, typical_pings_so_far: number?, complete: boolean
  },
  last_full_hour: {
    time: timestamp, local_date: date, hour: integer, pings: integer?,
    typical_pings: number?, surge_index: number?, is_surge: boolean
  }?,
  next_surge: {
    surge_id: string, window_start: timestamp, surge_index: number,
    severity: "LOW" | "MEDIUM" | "HIGH"
  }?,
  active_trip_count: integer, pending_proposal_count: integer
}
Surge = {
  id: string, hub_id: string?, location_name: string, location: GeoPoint,
  detected_at: timestamp,
  predicted_window: {start: timestamp, end: timestamp}, lead_time_minutes: number,
  magnitude: {
    predicted_pings: number, typical_pings: number, surge_index: number,
    lower_80: number?, upper_80: number?
  },
  severity: "LOW" | "MEDIUM" | "HIGH",
  drivers: {type: DriverType, label: string, event_id: string?}[],
  predicted_destinations: Destination[],
  status: "PENDING" | "AWAITING_APPROVAL" | "DISPATCHED"
        | "NO_MATCHING_ROUTE" | "NO_BUS_AVAILABLE" | "EXPIRED",
  phase: "UPCOMING" | "ACTIVE" | "RESOLVED",
  additional_trip_ids: string[],
  actual: {pings: integer?, surge_index: number?}?
}
Bus = {
  id: string,
  status: "AVAILABLE" | "RESERVED" | "DEADHEADING" | "WAITING"
        | "IN_SERVICE" | "RETURNING" | "REPOSITIONING",
  location: GeoPoint, heading_deg: number?, capacity: integer,
  source: {type: "ROUTE" | "DEPOT", route: RouteRef?, depot_name: string?},
  assigned_trip_id: string?, proposed_trip_id: string?
}
AdditionalTrip = {
  id: string, surge_id: string, hub_id: string?, bus: {id: string},
  route: RouteWithLoad, donor_route: RouteWithLoad?,
  status: "PROPOSED" | "APPROVED" | "BUS_EN_ROUTE" | "IN_SERVICE"
        | "COMPLETED" | "REJECTED" | "EXPIRED" | "CANCELLED",
  proposed_at: timestamp, approval_expires_at: timestamp,
  dispatch_time: timestamp, arrival_at_surge_time: timestamp,
  arrives_before_surge: boolean, departure_time: timestamp,
  estimated_completion_time: timestamp, surge_location: GeoPoint,
  predicted_destinations: Destination[], deadhead_path: LineString,
  service_path: LineString,
  impact: {added_capacity: integer, deadhead_minutes: number, deadhead_km: number},
  rationale: string, evidence: {label: string, value: string, source: string}[],
  replaces_trip_id: string?, progress: {percent_complete: number}
}
TripDetail = AdditionalTrip + {
  bus: {id: string, current_location: GeoPoint}, surge: Surge,
  progress: {percent_complete: number, current_stop_id: string?, next_stop_id: string?}
}
```

### 5.1 Shared-object rules

- `/state`, lists, mutation responses, and entity upsert events use identical
  canonical objects. TripDetail is the explicitly named detail-only extension;
  do not replace canonical trip cache entries with a different partial shape.
- Route colors are normalized GTFS hex strings prefixed by `#`, or null. Shapes
  with no geometry are null where nullable, never invalid empty LineStrings.
  Trip paths have at least two valid points.
- Bus capacity is positive. Heading is `[0, 360)` or null when unavailable.
  DEPOT source requires a depot name and null route; ROUTE requires RouteRef and
  null depot name. Home/return locations remain internal.
- `active_trip_count` counts APPROVED, BUS_EN_ROUTE, and IN_SERVICE trips;
  `pending_proposal_count` counts PROPOSED. `next_surge` is the earliest UPCOMING
  surge, tie-broken by ID. `last_full_hour` is null when no earlier bucket exists.
- Magnitude describes the peak forecast hour in the window. Resolve ties by the
  earliest hour, retaining that target internally. At resolution, `actual`
  describes observations at this same target hour, making comparison meaningful.
  It is null before resolution; after resolution missing observations yield an
  object with null values rather than a fabricated actual.
- Phase is UPCOMING before start, ACTIVE in `[start,end)`, RESOLVED at/after end.
  Dispatch status and temporal phase are independent.
- All linked trips, including rejected/expired alternatives, remain in
  `additional_trip_ids` for the current epoch.

## 6. Dispatch and simulation semantics

### 6.1 GTFS and route eligibility

Load a fixed snapshot of `routes.txt`, `stops.txt`, `trips.txt`, `stop_times.txt`,
`shapes.txt`, `calendar.txt`, and `calendar_dates.txt`. Parse times beyond 24:00
as service-day offsets. Retain directions, headsigns, ordered stop sequences,
shapes, and timing templates as internal service patterns.

Read APIs may expose all four modes; only Bus patterns can receive extra buses.
A candidate must board inside the configured surge-stop radius and reach a later
stop near a geocoded destination. Reject destination-before-origin patterns.
Origin centroids with no matching pattern do not justify inventing a route.
Transfer connections require explicit access mapping/evidence; a line toward a
transfer station must not be described as a direct trip to the home area.

Fall 2026 GTFS may not cover historical replay dates. Support a configured,
deterministic representative service-day mapping by day type for this scenario,
and disclose it in `/meta.sources` and schedule/load evidence. Never silently
claim exact historical calendar coverage. When actual date coverage exists,
honor service calendars and exceptions.

### 6.2 Matching, scoring, and proposals

1. Expose only forecast issuances available by simulation time. Group consecutive
   surge target hours into windows using a deterministic versioned rule. Track
   stable surge identities so repeated loads/revised issuances do not duplicate
   an existing proposal. Record the forecast vintage internally.
2. Evaluate UPCOMING surges within configurable dispatch lookahead. Use origins
   available as of issuance. Normal operation produces only the three hub surges;
   nullable hub IDs support explicit fixtures or a future independent source.
3. Score eligible patterns using configurable normalized origin proximity,
   destination share coverage, schedule gap, and deadhead time. Store candidate
   scores and the chosen pattern in an internal DispatchDecision. No LLM is used.
4. Find the departure closest to the predicted window start that satisfies
   minimum separation from adjacent scheduled and already committed additional
   departures, plus configured maximum deviation from the surge. Document the
   policy for missing previous/next departures in configuration.
5. Consider AVAILABLE buses only. Require arrival before departure and before
   the surge begins. Prefer shortest feasible deadhead duration, then bus ID;
   route/pattern ties also have stable ID ordering.
6. Atomically create PROPOSED trip(s), reserve buses, link the surge, and publish
   events after commit. A surge can have several trips, each with its own bus.
   Cap proposals per surge and account for existing reservations/added capacity.
   Never compute bus quantity by treating pings as passenger counts.
7. Include forecast and recipient-route load evidence; include donor-route load
   evidence for route-sourced buses. Missing estimates stay null and are explained
   as unavailable. Before/after loads must follow a documented capacity/service
   model; a typical load statistic alone does not prove a spare bus exists.

No eligible pattern yields NO_MATCHING_ROUTE. No feasible bus/departure yields
NO_BUS_AVAILABLE in the public v2 enum; retain a precise internal reason such as
NO_FEASIBLE_DEPARTURE. EVALUATING is internal, not a public status.

Surge dispatch status precedence: any approved, non-cancelled trip (including a
completed trip) means DISPATCHED; otherwise any proposal means AWAITING_APPROVAL;
otherwise a started window means EXPIRED; otherwise use PENDING or the current
failure outcome. Rejection may return a surge to PENDING and trigger a different
candidate. Bound retries, track rejected candidates, and use `replaces_trip_id`
to avoid endlessly reproposing the same rejected choice.

### 6.3 Approval, reservation, and expiry

Default timeout policy: 30 simulated minutes, shortened by the latest feasible
dispatch instant. For a fixed proposal schedule:

```text
approval_expires_at = min(proposed_at + 30 minutes, dispatch_time)
proposed_at < approval_expires_at <= dispatch_time
dispatch_time <= arrival_at_surge_time <= departure_time < estimated_completion_time
arrival_at_surge_time < predicted_window.start
```

If no positive approval window exists, do not create a proposal. The timeout is
configurable. `arrives_before_surge` reflects the strict arrival comparison.

Approve/reject, seek, expiry, and movement run through one serialized mutation
coordinator. Check request epoch before trip-state validation. An epoch must
equal the current epoch; older or otherwise mismatched epochs yield STALE_EPOCH.
Process expiry at its simulation instant before approvals at that same instant.
Nothing expires while paused.

| Trip state | Bus state and links |
|---|---|
| PROPOSED | RESERVED; proposed_trip_id set, assigned_trip_id null |
| APPROVED, before dispatch_time | RESERVED; assigned_trip_id set, proposed_trip_id null |
| BUS_EN_ROUTE, moving | DEADHEADING; assigned_trip_id set |
| BUS_EN_ROUTE, arrived before departure | WAITING; assigned_trip_id set |
| IN_SERVICE | IN_SERVICE; assigned_trip_id set |
| COMPLETED | RETURNING, then AVAILABLE on reaching home |
| REJECTED / EXPIRED | AVAILABLE; clear proposal reservation |
| CANCELLED | AVAILABLE if unmoved, otherwise RETURNING until home |

APPROVED does not mean the bus moves immediately. RESERVED also covers an
approved future dispatch; this resolves the draft's conflicting APPROVED/movement
definitions. One bus has at most one proposal or assignment. Clear assignment
links when return completes, not at the end of passenger service.

Approve a PROPOSED trip into APPROVED and update the bus/surge atomically.
Reapproving an APPROVED trip returns 200 without another transition/event.
Approving later lifecycle states returns TRIP_NOT_PROPOSED. Rejecting PROPOSED
releases the bus and records the supplied reason in rationale/internal audit.
Repeated rejection returns a conflict. Cancellation is an engine operation for
approved pre-service trips and includes a rationale; in-service trips finish.
Terminal trips never reactivate within an epoch.

### 6.4 Clock and deterministic seek

- One global clock starts PAUSED at configurable `/meta.default_start_time`.
  Approval mode is MANUAL; auto-pause defaults to true.
- Use monotonic wall time only inside the production clock. Business logic uses
  a SimulationClock abstraction. Tests use a fake clock, never sleep.
- Process every crossed event boundary in chronological order, even at 3600x:
  issuance, proposal, expiry, departure, arrival, completion, and hourly demand.
  At an auto-pausing proposal, stop exactly there before advancing further.
- At `max_time`, stop and report PAUSED with state-change reason PAUSED.
- Seek validates bounds, builds replacement state off to the side, and swaps it
  atomically. Failure retains the existing state and epoch.
- At T, restore configured buses, discard previous approvals/rejections/trips,
  and rebuild surges detected at or before T whose windows have not ended.
  Recreate feasible UPCOMING proposals with `proposed_at = T` and expiry derived
  from T. Active windows cannot receive fresh pre-surge proposals.
- Preserve speed, paused/running state, and settings during seek. Reconstruction
  itself does not trigger auto-pause. Normal subsequent proposals do.
- Increment epoch once and emit `state.reset` only after the replacement is ready.
  Do not replay every reconstructed creation event. GET /state supplies them.
- Same T, data, configuration, and settings yield the same domain state and IDs,
  excluding epoch and event sequence metadata. Determinism does not mean replaying
  discarded user actions. A seek to default_start_time is the demo reset.

### 6.5 Movement and impact

Use a replaceable RoutingService returning geometry, distance meters, and duration
seconds for deadhead and return paths. A labeled straight-line/configured-speed
approximation is acceptable for the MVP. Passenger service follows the selected
GTFS shape and shifted relative stop timing, not a straight line to a centroid.

Interpolate location by distance along geometry and derive heading from the
active segment. Deadhead spans dispatch to arrival; hold at the start stop until
departure; service spans departure to completion. Progress is service completion
on a 0–1 scale. Return to internal home location, then release the assignment.
Paths, times, deadhead duration/distance, and capacity impact must agree. Impact
reports seats/capacity and travel cost, never inferred "riders served".

## 7. REST simulation and entity endpoints

All paths in sections 7–9 are relative to `/api/v1`.

| Method and path | Request / filters | Response |
|---|---|---|
| GET `/state` | None | StateSnapshot below |
| GET `/surges` | Optional hub_id, phase, status | Surge[] |
| GET `/buses` | None | Bus[] |
| GET `/additional-trips` | Optional status, hub_id, surge_id | AdditionalTrip[] |
| GET `/additional-trips/{trip_id}` | Trip ID | TripDetail |
| GET `/simulation` | None | Clock |
| PUT `/simulation/time` | `{current_time: timestamp}` | Clock with new epoch |
| PUT `/simulation/speed` | `{speed: number}` | Clock |
| PUT `/simulation/settings` | `{auto_pause_on_proposal: boolean}` | Clock |
| POST `/simulation/pause` | No body | Clock, PAUSED |
| POST `/simulation/resume` | No body | Clock, RUNNING |
| POST `/additional-trips/{trip_id}/approve` | `{epoch: integer}` | AdditionalTrip |
| POST `/additional-trips/{trip_id}/reject` | `{epoch: integer, reason: string}` | AdditionalTrip |

```text
StateSnapshot = {
  epoch: integer, last_seq: integer, simulation: Clock,
  hubs: HubStatus[], surges: Surge[], buses: Bus[], additional_trips: AdditionalTrip[]
}
```

Snapshot assembly and `last_seq` capture are atomic relative to mutations and
event sequencing. Snapshot epoch equals Clock epoch. Include all three hubs and
all entities retained in the current epoch, including terminal trips. Read-only
lists use the same serializers. Historical `at` hub reads do not invent past user
actions: counts and next_surge for non-current times use deterministic seek-style
reconstruction without committing it.

Seek outside bounds returns 400 OUT_OF_RANGE. Invalid allowed-speed values return
400 INVALID_SPEED; supported speeds are exactly 1, 60, 300, 900, 3600. Pause/resume
are idempotent; unchanged requests do not emit duplicate state changes.

Trip errors:

| HTTP/code | Meaning |
|---|---|
| 404 TRIP_NOT_FOUND | No current trip with that ID and epoch matches |
| 409 STALE_EPOCH | Request epoch does not equal current epoch; trip may be null |
| 409 TRIP_EXPIRED | Proposal expired before this decision |
| 409 TRIP_REJECTED | Approval attempted after rejection |
| 409 TRIP_NOT_PROPOSED | Other incompatible state |

```json
{
  "error": {"code": "STALE_EPOCH", "message": "Simulation changed; refresh state."},
  "trip": null
}
```

## 8. REST route endpoints

### GET `/routes?hub_id=&include_shape=false`

Return `(RouteRef + {serves_hub_ids: string[], shape: RouteShape?})[]`.
Filter by hub when supplied. `shape` is null unless requested and available.
Simplify map geometry to approximately 300 points or fewer per route; use
MultiLineString for distinct variants instead of joining disconnected paths.
Do not simplify the internal dispatch timing/stop model to match map rendering.

### GET `/routes/{route_id}?date=YYYY-MM-DD&from=HH:MM&to=HH:MM`

```text
RouteDetail = RouteRef + {
  stops: {id: string, name: string, location: GeoPoint}[],
  shape: RouteShape?,
  scheduled_departures: {trip_id: string, departure_time: timestamp, stop_id: string?}[]
}
```

Defaults: current simulation local date and the interval one hour before through
three hours after current simulation time. Explicit from/to must be supplied
together; `to <= from` crosses midnight. With an explicit date only, anchor the
default interval on that date at the current local clock time. Include relevant
previous-service-day departures after midnight. Departure stop is the trip's
first stop inside a hub catchment, or null when none exists; for null use the
trip's first-stop departure. Sort by timestamp then trip ID. Stops are a stable
deduplicated route list; internal service patterns retain correct ordering for
each variant. The route detail's flat shape does not erase those patterns.

## 9. REST metadata and analytical endpoints

### 9.1 GET `/meta`

```text
Meta = {
  timezone: "America/Vancouver", data_start: date, data_end: date,
  default_start_time: timestamp, allowed_speeds: integer[],
  forecast_horizons_hours: integer[], surge_threshold: number,
  severity_bands: {LOW: number, MEDIUM: number, HIGH: number},
  late_night: {start_hour: 0, end_hour_exclusive: 5},
  route_load_thresholds: {overcrowded_pct: number, spare_pct: number},
  day_types: {id: DayType, label: string}[],
  presets: {id: string, label: string, hub_id: string?, time: timestamp, description: string}[],
  sources: {name: string, url: string?, used_for: string}[],
  pipeline_refreshed_at: timestamp?
}
```

Publish allowed speeds `[1,60,300,900,3600]`, horizons `[3,6,12,24]`, surge
threshold 1.25, severity cutoffs 1.25/1.5/1.75, and default load thresholds 85/60.
Data dates describe the source dataset; Clock bounds describe usable replay.
Validate default time and presets against those bounds. Candidate presets are
UBC Dec 6 exams, Park Royal Dec 26 shopping, Waterfront Jul 25, a normal weekday,
and Saturday night. Verify them against actual model outputs; retrospective
daily surges alone do not prove a forecast-driven proposal will occur.

### 9.2 GET `/hubs`

Return all three hubs from dim_hub:

```text
{id: string, name: string, location_name: string, location: GeoPoint,
 catchment_m: number, description: string, lines_serving: integer}[]
```

### 9.3 GET `/hubs/{hub_id}/status?at=`

Return HubStatus. Same shape as `/state.hubs[]` and `hub.demand_updated`.
Unknown hub returns 404; out-of-replay-range at returns 400 OUT_OF_RANGE.

### 9.4 GET `/hubs/{hub_id}/forecast?at=&horizon_hours=6&history_hours=6`

```text
{
  hub_id: string, issued_at: timestamp, horizon_hours: integer,
  surge_threshold: number, typical_basis: string,
  model: {name: string, trained_through: timestamp, granularity: "hour"},
  rows: {
    time: timestamp, local_date: date, hour: integer,
    kind: "HISTORY" | "CURRENT" | "FORECAST", hour_complete: boolean,
    actual_pings: integer?, forecast_pings: number?, forecast_issued_at: timestamp?,
    lower_80: number?, upper_80: number?, typical_pings: number?,
    surge_index: number?, is_surge: boolean
  }[]
}
```

Horizon must be one of `/meta.forecast_horizons_hours`; history is an integer
0–168. Return history_hours completed buckets, the current bucket, and
horizon_hours future buckets where within data coverage, in instant order.
HISTORY uses the forecast issued horizon_hours before the target and actual /
that vintage's baseline. CURRENT uses partial actuals only if available, with
surge index from the full-hour forecast / full-hour baseline, not partial counts.
For CURRENT use the requested-horizon historical vintage. FORECAST uses the
latest issuance at/before at, forecast / typical, and null actuals.
`hour_complete` is true for HISTORY and false otherwise. Missing individual
vintages yield null prediction fields; no available issuance yields 503
FORECAST_UNAVAILABLE. Publish real model metadata, not the example name.

### 9.5 GET `/hubs/{hub_id}/origins?at=&basis=actual|typical`

Default basis is actual. Actual covers the last completed hour; typical is the
trailing as-of mean for that same target day type/hour. No future origin samples.

```text
{
  hub_id: string, basis: "actual" | "typical",
  window: {start: timestamp, end: timestamp}, day_type: DayType,
  total_pings: number, low_sample: boolean,
  origins: {
    origin: string, region: string, location: GeoPoint?, pings: number,
    share_pct: number, share_of_local_pct: number?, avg_dwell_min: number?,
    access_type: "ONE_SEAT_RIDE" | "TRANSFER_REQUIRED" | "LOCAL" | "VISITOR",
    direct_lines: string[], n_direct_lines: integer
  }[]
}
```

Include all 36 origin categories, including observed zeros; seven out-of-region
origins have null locations. `direct_lines` contains line_key values. Local share
uses regional origins only; visitors have null local share. Zero total gives
zero shares and low_sample true; absent input data is unavailable, not a zero
total. Low sample means total_pings < 200. Centroids come from dim_origin.

### 9.6 GET `/timeline?from=YYYY-MM-DD&to=YYYY-MM-DD`

Required inclusive date range within source coverage. Return:

```text
{
  note: string,
  days: {local_date: date, weekday: string, day_type: DayType,
    hubs: {
      ubc: DailyHub, waterfront: DailyHub, "park-royal": DailyHub
    }
  }[]
}
DailyHub = {pings: integer?, daily_surge_index: number?, is_surge: boolean}
```

Source: gold_hub_daily. Note must state that the centered ±4-week daily index is
retrospective context, not a forecast. This scrubber intentionally spans dates
after the simulation time.

### 9.7 GET `/events?from=&to=&hub_id=`

Required ISO timestamp bounds and optional hub filter; include events overlapping
the requested window. Return:

```text
{id: string, label: string, category: DriverType, start: timestamp, end: timestamp,
 hub_ids: string[], source_name: string, source_url: string?}[]
```

BC holidays already have pipeline logic. Exams, sports, concerts, and festivals
require curated source-backed records. Empty results are valid. Retain internal
known/published-at metadata for explanatory drivers used during replay; actual
outcomes learned later must not become advance forecast features.

### 9.8 GET `/routes/load?at=&hub_id=`

```text
{
  route: RouteRef, time_period: string, load_pct: number?,
  load_basis: "TSPR_2025_TYPICAL" | "MODEL_ESTIMATE",
  tspr_peak_load_pct: number?, pct_trips_overcrowded_2025: number?,
  classification: "OVERCROWDED" | "SPARE" | "NORMAL" | null,
  spare_buses_available: integer
}[]
```

Use TSPR period/day-type values unless a documented hour-level model exists.
Classification: load >= overcrowded threshold is OVERCROWDED; below spare
threshold is SPARE; otherwise NORMAL. Unknown load has null classification and
does not qualify as spare. `spare_buses_available` counts actual configured
AVAILABLE simulated route-sourced buses, not an estimate from load percentage.

### 9.9 GET `/hubs/{hub_id}/late-night?at=`

```text
{
  hub_id: string, night_date: date, window: {start: timestamp, end: timestamp},
  hours: {
    time: timestamp, local_date: date, hour: integer,
    actual_pings: integer?, forecast_pings: number?, typical_pings: number?,
    share_of_daily_pct: number?, departures_typical: number?,
    lines_running: integer, lines: RouteRef[]
  }[],
  share_of_daily_pct: number?, departures_basis: string,
  top_nights: {night_date: date, pings_00_05: integer, departures_typical: number?,
              surge_index: number?}[]
}
```

Before 05:00 local, return the current night; otherwise the next night. Window
is 00:00–05:00, respecting repeated/missing DST buckets. Future and incomplete
hour actuals are null here; use forecasts for those hours. Compute shares using
completed actual hours plus forecasts for the rest of the day, all available
as of at. Missing denominator components yield null shares, not future actuals.
Zero daily total gives zero shares. Sum the window's shares for the top-level
share. Beyond forecast coverage, return nulls for unavailable predictions.
`departures_basis` labels typical fall 2026 GTFS, not exact historical service.
`top_nights` is a whole-dataset retrospective ranking, labeled separately in UI.

### 9.10 GET `/hubs/{hub_id}/hourly-profile?day_type=mf|sat|sun_hol`

Day type is required. Source is hub_hours.sql; return exactly 24 ordered rows.

```text
{
  hub_id: string, day_type: DayType, season_label: string,
  rows: {hour: integer, avg_pings: number, departures: number,
    bus_departures: number, skytrain_departures: number, seabus_departures: number,
    lines_running: integer,
    status: "UNDERSERVED" | "OVERSERVED" | "BALANCED" | "NO_SERVICE",
    time_period: string?, peak_load_pct: number, most_crowded_line: string?
  }[]
}
```

Zero-fill missing hours in otherwise valid data; NO_SERVICE when departures are
zero. Map remaining classifications from the existing profile logic. Rename
max_peak_load_factor to peak_load_pct; use 0 for unknown load as the planner's
documented sentinel. Labels describe actual demand season and reference GTFS
season. This is a retrospective typical profile, not an as-of forecast.

### 9.11 GET `/hubs/{hub_id}/overview`

```text
{hub_id: string, kpis: {
  key: string, label: string, value: number | string | null,
  unit: string, period: string,
  comparison: {label: string, value: number | string}?, source: string
}[]}
```

Source: hub_overview.sql. Include pings, surge_days, transfer_share, worst_line,
and peak_load keys. Every KPI has its own source and period, especially when
mixing replay-period pings and TSPR 2025 loads.

### 9.12 GET `/hubs/{hub_id}/route-crowding`

```text
{route: RouteRef, pct_trips_overcrowded: number?, avg_peak_load_factor: number?,
 pct_bunching: number?, pct_on_time: number?, avg_weekday_boardings: number?,
 weekly_trips_at_hub: number?, source: string}[]
```

Use gold_route_stress/TSPR 2025 for bus lines serving the hub. Sort descending
by overcrowded percentage, nulls last, then route_id. Values are historical
performance statistics, not simulated current-hour loads.

### 9.13 GET `/hubs/{hub_id}/recommendations`

```text
{id: string, priority: integer, category: string, recommendation: string,
 evidence: string,
 links: {label: string, hub_id: string, local_date: date, hour: integer, route_id: string?}[]
}[]
```

Use gold_recommendations. Links choose unambiguous local hours inside replay
bounds; the UI translates them to a seek timestamp. Sort by priority then ID.
These are long-term findings, separate from operational trip proposals.

### 9.14 GET `/findings`

```text
{
  day_type: DayType,
  hubs: {hub_id: string, mismatch_pct: number, pings_in_underserved_hours_pct: number,
    underserved_hours: integer, busiest_line_load_pct: number?,
    rebalance: {moved: number, total: number, mismatch_after_pct: number},
    add_service: {added: number, window: string?, mismatch_after_pct: number},
    verdict: "RESCHEDULE" | "INVEST"
  }[],
  facts: {label: string, value: string, source: string}[]
}
```

Return the weekday scenario (`day_type: mf`) across all three hubs. Versioned
output from scenarios.ts may be bundled as static data with provenance matching
hub_pulse/HANDOFF.md. Mismatch is the share of departures at the wrong hour for
demand. Do not copy illustrative values without reproducing the analysis.

### 9.15 GET `/backtest`

```text
{
  period: {start: date, end: date}, surge_threshold: number, method: string,
  by_hub: {hub_id: string, actual_surge_hours: integer, predicted_surge_hours: integer,
    precision_pct: number?, recall_pct: number?, median_lead_time_minutes: number?}[],
  by_horizon: {horizon_hours: integer, mape_pct: number?, coverage_80_pct: number?}[]
}
```

Evaluate rolling-origin forecasts over usable replay coverage. For the hub
scorecard, a target hour is predicted positive if at least one valid 3–24-hour
lead forecast crosses 1.25. Deduplicate target hours. Classify actual demand
using the target's three-hour-lead frozen baseline; require that baseline and
actual observation for eligibility. Describe this policy and sample exclusions
in method. Precision is true-positive targets / predicted-positive targets;
recall is true-positive targets / actual-positive targets. Median lead time uses
the earliest positive eligible issuance for each true-positive target.

For each 3/6/12/24 horizon, compare that exact vintage with actuals. MAPE excludes
zero actuals; coverage_80 is the fraction of valid intervals containing actuals.
Undefined metrics are null, not zero. Record eligible/excluded sample counts,
model version, and computation provenance in the evaluation artifact and method.
Return 503 BACKTEST_UNAVAILABLE if no real evaluation artifact exists.

### 9.16 GET `/validation`

```text
{hub_id: "waterfront", r: number?, r_shifted_3h: number?,
 rows: {hour: integer, pings_pct: number, skytrain_pct: number}[], source: string}
```

Use gold_waterfront_validation: weekday ping profile versus SkyTrain station
boardings plus alightings. Return actual computed correlations and normalized
hourly rows. The draft's 0.92 and 0.38 are reference examples, not constants to
invent if the source is unavailable.

## 10. WebSocket contract

Every message has this envelope:

```json
{
  "type": "surge.updated",
  "seq": 1043,
  "epoch": 3,
  "simulation_time": "2025-12-06T10:00:00-08:00",
  "data": {}
}
```

`seq` strictly increases across all event types and seeks within a server
process. `epoch` increments on successful seeks. A server restart creates a new
session; clients discard previous sequence/epoch state on reconnect and establish
it from the new snapshot. Do not compare process-local counters across restarts.

| Type | data | When |
|---|---|---|
| simulation.tick | `{current_time, local_date, hour}` | Clock advances; at most 4/s wall time |
| simulation.state_changed | Clock + `{reason}` | Pause/resume/speed/settings/auto-pause |
| state.reset | `{epoch, reason: "SEEK"}` | Atomic seek completed |
| surge.updated | Surge | Creation and status/phase/magnitude/actual changes |
| dispatch.proposed | AdditionalTrip | Enters PROPOSED |
| dispatch.approved | AdditionalTrip | Enters APPROVED |
| dispatch.rejected | AdditionalTrip | Enters REJECTED |
| trip.updated | AdditionalTrip | Other trip transitions and progress |
| bus.updated | Bus | Status, source, or assignment changes |
| bus.positions_updated | `{positions: {bus_id, location, heading_deg, status}[]}` | Batched positions; at most 4/s wall time |
| hub.demand_updated | HubStatus | Once per hub per simulated hour boundary |

State-change reasons: PAUSED, RESUMED, SPEED, SETTINGS, AUTO_PAUSE_PROPOSAL.
Emit exactly one trip event per status transition; idempotent requests emit none.
Changes affecting bus/surge objects also emit their entity upserts. Position
batches and clock ticks are explicit partial telemetry exceptions to full-object
upserts. Coalesce progress-only trip updates at the telemetry cadence, but never
drop lifecycle transitions to satisfy telemetry limits. Hourly events are
processed for every crossed hour even at accelerated speed.

Commit multi-entity changes before assigning/publishing their events. At a
proposal emit the trip, bus, and surge changes, then AUTO_PAUSE_PROPOSAL when
enabled. Snapshot last_seq includes every event represented by that snapshot.

### 10.1 Bootstrap, reconnect, and reset

To avoid the REST-before-WebSocket subscription gap:

1. Connect WebSocket and buffer messages.
2. Fetch `/state` while buffering.
3. Install snapshot and discard buffered events with older epoch or
   `seq <= last_seq`. Apply remaining current-epoch events in seq order.
4. On state.reset, buffer again and refetch. A newer epoch while fetching requires
   a fresh snapshot; never apply old-epoch entities into new state.
5. Reconnect with backoff and repeat. A UI may render an initial REST snapshot
   early, but must refetch after establishing its subscription.

No server replay buffer is required. Slow clients must reconnect/refetch rather
than block simulation. Disconnecting one client does not affect other clients.

## 11. Runtime configuration, reliability, and health

Typed environment/file configuration includes:

```text
APP_ENV, CORS_ORIGINS
SIMULATION_START_TIME, SIMULATION_MIN_TIME, SIMULATION_MAX_TIME, SIMULATION_SPEED
AUTO_PAUSE_ON_PROPOSAL, APPROVAL_TIMEOUT_MINUTES
FLEET_SIZE, DEFAULT_BUS_CAPACITY, fleet source/home/initial-location records
DISPATCH_LOOKAHEAD_MINUTES, MAX_PROPOSALS_PER_SURGE
ORIGIN_STOP_RADIUS_METERS, DESTINATION_STOP_RADIUS_METERS
MIN_SCHEDULE_SEPARATION_SECONDS, MAX_SURGE_DEPARTURE_DEVIATION_SECONDS
route scoring weights, routing speed/provider, return policy
GTFS_SOURCE, GTFS_SERVICE_DAY_MAPPING
DATABRICKS_HOST, DATABRICKS_HTTP_PATH, DATABRICKS_TOKEN, data catalog/schema
DATA_MODE (Databricks/exported snapshot/explicit fixture)
```

Validate configuration at startup and publish applicable values through meta
and Clock. Default return policy is home/depot; isolate future repositioning.
Route-sourced buses require explicit configuration and donor evidence. Neither
fleet count nor donor availability is inferred just from a low load statistic.

Retain loaded, validated snapshots on Databricks failure and mark integration
health degraded. Never silently fall back to mock values. Serve reads covered by
the snapshot; return a structured 503 for missing required data. Seeking must not
destroy a working state if reconstruction data is unavailable. Cache/query keys
include dataset version and relevant as-of time/vintage to prevent future leaks.

- GET `/healthz`: `{"status":"ok"}`.
- GET `/readyz`: `{status: "ready" | "degraded" | "not_ready", components:
  {gtfs: string, prediction_source: string, analytics: string, simulation: string}}`.
  Return 200 if simulation prerequisites are usable (including cached/degraded
  sources), otherwise 503. Report optional analytics degradation separately.
- Docker uses locked dependencies, a non-root user, a health check, environment
  configuration, and an ASGI server on port 8000. Local entry point is
  `docker compose up --build`.
- Keep credentials server-side; parameterize queries, accept no arbitrary SQL,
  and retain source attribution. Use TLS/WSS for a hosted frontend connection.
- Structured logs capture epoch, simulation time, IDs, data/model versions,
  candidate scores, proposal/approval/rejection/expiry/cancellation, seek,
  movement transitions, and integration errors without leaking credentials.

## 12. Verification and acceptance criteria

Use deterministic fixtures and a fake clock. Required tests include:

- Canonical schema equality across state/lists/events and TripDetail extension;
  explicit nulls, error envelope, CORS, and generated OpenAPI compatibility.
- Source wall-clock normalization, historical DST transitions, permanent Pacific
  time after March 8, 2026, repeated bucket keys, invalid offsets, GTFS >24-hour
  times, and representative-day mapping.
- Forecast training/issuance cutoffs, exact historical vintages, trailing-only
  baselines, insufficient history, zero denominators, and partial-hour masking.
- Actuals after at remain hidden; retrospective endpoints stay isolated from
  runtime scoring; missing artifacts do not return fake metrics.
- Direction/stop ordering, route variants, scoring ties, schedule separation,
  unavailable/unreachable buses, immutable scheduled service, and path ordering.
- Competing proposals cannot reserve the same bus; multi-trip surge linking,
  bounded alternatives, duplicate forecast ingestion, and load evidence.
- Approve versus expiry/seek races, double approval, rejected/expired conflicts,
  deferred dispatch after approval, reservation release, and cancellation return.
- High-speed stepping stops at proposal time, pause freezes expiry/movement,
  clock end bounds, and repeated seeks reproduce state except epoch/seq.
- Position interpolation, waiting, service progress, completion, return, and
  cleanup; zero-duration segments must not produce NaN or invalid transitions.
- WebSocket ordering, atomic snapshot watermark, reconnect/reset races, event
  rate limits, slow/disconnected clients, and no duplicate idempotent events.
- Integration degradation, failed seek rollback, origins zero-fill, profile 24
  rows, and reproducible backtest counts/metric denominator handling.

Required code checks when implementing this spec, run from backend:

```sh
uv run ruff check .
uv run ruff format --check .
uv run mypy --strict app tests
uv run pytest
```

Keep explicit function types and typed domain collections. Do not bypass strict
typing, weaken assertions, swallow integration errors, or silently change
dispatch semantics. Generate/check OpenAPI once endpoint schemas exist.

### 12.1 Delivery priorities

1. Canonical models, forecast/baseline inputs, meta, state/WebSocket, simulation
   controls/seek, approve/reject, trip preview, hub forecast, and origins.
2. Routes/load and geometry, timeline, hourly profile, late-night, and backtest.
3. Remaining hub views, curated events, findings, recommendations, validation,
   and operational polish.

### 12.2 End-to-end definition of done

A developer can start Docker, load pinned inputs and a configured simulated
fleet, open the frontend paused at a verified preset, and see a real historical
forecast with origins. On resume, a forecast-triggered proposal reserves a bus
and pauses the server. Preview explains the route, donor/depot, load evidence,
capacity, paths, and times. Reject releases the bus and optionally offers a
distinct feasible alternative; approve holds it until dispatch, then the bus
deadheads, waits, serves, returns, and becomes available. After the forecast
window, actual results appear. Seeking and reconnecting preserve contract
consistency. The scorecard is reproducible from out-of-sample artifacts and all
required checks pass.

## 13. Migration and decisions requiring confirmation

### 13.1 Superseded v1 surface

- Replace predicted_time with predicted_window.start/end and additional_trip_id
  with additional_trip_ids. Replace passenger-count interpretation with ping
  magnitude and origin shares.
- Replace flat snapshot trip references with canonical AdditionalTrip. Keep
  service_pattern_id, home locations, candidate scores, and stop sequencing
  internally even though they are no longer in the canonical public shape.
- Retire public PLANNED/READY/RETURNING trip states, STOPPED clock state, and
  EVALUATING/NO_FEASIBLE_DEPARTURE surge states in favor of this spec's mappings.
- Replace route `id` with route_id and add line_key. Public route details are
  flat; routing continues to use internal directional patterns.
- Replace simulation/start and simulation/reset with startup + resume and seek.
- Retire surge.detected, dispatch.created, trip.started, trip.completed,
  bus.position_updated, and bus.available events. Their replacements are the
  section 10 events, including bus.updated for availability.
- V1 surge/bus detail and development surge-injection endpoints are not required
  by v2. Any retained debug extensions must use v2 shapes; injection must be
  disabled outside development and cannot contaminate real backtest results.

### 13.2 Clarifications to confirm with frontend

These resolve contradictions in the supplied draft and are explicit changes to
its mocks: offset-bearing hourly `time` keys (including HubStatus/late-night),
capacity loads above 100%, null unknown/partial actuals, hour_complete on every
forecast row, RESERVED for an approved bus awaiting dispatch, null trip on a
stale-epoch conflict after removal, and WebSocket subscription before the final
bootstrap snapshot. Idempotent approval emits no duplicate event. Retrospective
views are explicit exceptions to the operational no-future-actuals rule.

### 13.3 Outstanding data/product decisions

| Decision | Current specification / outstanding input |
|---|---|
| Non-hub surges | Only three data-backed hubs by default; identify any additional real source before enabling it |
| Route load | TSPR_2025_TYPICAL until a documented hour-level model and before/after capacity formula are supplied |
| Spare fleet | Supports depot and route sources; team must supply bus count, capacity, starting/home locations, and eligible donor routes |
| Events | Team must assign curator and choose repository CSV or Databricks storage; include source URLs and known-at metadata |
| Forecast model | Team must choose/version the model and supply hourly rolling-origin artifacts, training provenance, and real evaluation metrics |
| Replay bounds | Derive from usable input history and forecasts; Nov 15 is a candidate, not a guaranteed warm-up completion date |
| Approval timeout | Default min(30 simulated minutes, dispatch deadline); confirm with dispatcher UI |
| Trip/bus mapping | Section 6.3 resolves approved-but-not-moving behavior; frontend mocks must match |
| Hosted backend | Hosting provider remains undecided; must support public HTTPS/WSS and the single authoritative simulation |

`IMPLEMENTATION_PLAN.md` defines the v2 dependency-ordered implementation chunks,
data deliverables, and completion gates. This specification remains authoritative
for the v2 API and behavior.
