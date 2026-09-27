# Surge Bus Backend

## Technical Specification - v3.0

Status: authoritative target specification.

This version supersedes the v2 multi-table forecast snapshot contract. Databricks
provides one filtered historical dispatch-event feed. The backend owns the
simulated fleet, GTFS interpretation, proposal decisions, dispatch, movement,
and deterministic replay.

## 1. Purpose And Scope

The product replays historical transit-demand events at UBC, Waterfront Station,
and Park Royal. Databricks identifies when and where additional service is useful,
recommends a route or destination, and estimates how many extra buses are needed.
The backend decides whether that recommendation is feasible with its configured
GTFS network and simulated buses.

The required end-to-end behavior is:

1. Query dispatch events for a bounded historical simulation window.
2. Make each event actionable only when its source timestamp permits.
3. Validate its hub, route, and destination recommendation against backend data.
4. Propose or automatically dispatch available simulated buses.
5. Move buses through deadhead, service, and return lifecycles.
6. Support pause, speed changes, seek, reset, reconnect, and deterministic replay.
7. Trace every proposal and trip to its Databricks event and backend decision.

The backend does not require Databricks fleet data, live vehicle locations,
forecast-vintage tables, hourly actuals, origin distributions, route-load tables,
or analytical scorecards to perform this workflow.

## 2. Architecture And Ownership

```text
Databricks dispatch_events table/view
        |
        | parameterized query(event_time >= start AND event_time < end)
        v
validated dispatch-event source -----> event repository
                                              |
backend hub map + GTFS index -----------------+
backend simulated fleet ----------------------+--> proposal/dispatch engine
backend routing provider ---------------------+            |
                                                           v
                                               authoritative coordinator
                                                           |
                                               REST + WebSocket snapshots
```

Databricks owns:

- Historical event detection and recommendation rows.
- Predicted and normal people estimates.
- Suggested extra-bus count and source priority.
- Source provenance and, when available, proactive availability time.

The backend owns:

- Hub IDs, coordinates, and aliases used to resolve source hub names.
- GTFS routes, stops, service patterns, schedules, and shapes.
- Simulated bus identity, capacity, initial location, and availability.
- Route and destination recommendation validation.
- Proposal, approval, reservation, dispatch, movement, service, and return state.
- Simulation clock, event activation, seek, replay, API state, and WebSocket order.

Databricks recommendations are evidence, not vehicle commands. The backend must
never invent a source event, silently replace an unknown route, or dispatch more
buses than its configured fleet can supply.

## 3. API Conventions

- REST and WebSocket payloads use JSON and `snake_case`.
- Timestamps are ISO 8601 instants with an explicit offset valid for
  `America/Vancouver` at that instant.
- Time ranges are start-inclusive and end-exclusive: `[start, end)`.
- IDs are opaque, stable strings. Display names are not IDs.
- Collections have deterministic ordering and never depend on database row order.
- Validation errors use `400`; missing entities use `404`; state conflicts use
  `409`; unavailable required source data uses `503`.
- Every mutation is committed atomically before its WebSocket events are emitted.

People estimates are nonnegative numbers. `destination_share` is expressed in
percentage points from 0 through 100. Source values in the 0 through 1 range must
be converted by the Databricks view or explicit adapter mapping, never guessed
from individual rows.

## 4. Databricks Import Contract

### 4.1 Single Source

The only required Databricks integration is a configured table or view containing
historical dispatch-event recommendations. The backend issues a fixed,
parameterized query equivalent to:

```sql
SELECT
  event_id,
  available_at,
  event_time,
  surge_location,
  surge_type,
  predicted_people,
  normal_people,
  destination,
  destination_share,
  route,
  extra_bus_trips_est,
  priority_score,
  split,
  direction,
  link,
  scheduled_trips_that_hour,
  extra_people_on_route,
  avg_daily_boardings,
  pct_trips_overcrowded
FROM <configured_table_or_view>
WHERE event_time >= :window_start
  AND event_time < :window_end
ORDER BY event_time, event_id, priority_score DESC, route, destination
```

The actual catalog, schema, table/view, and warehouse are configuration. Values
are bound parameters; user input is never interpolated into SQL identifiers or
predicates. Optional columns may be projected as typed nulls by the configured
view.

### 4.2 Required Fields

```text
event_id: non-empty string
event_time: offset-aware timestamp
surge_location: non-empty source hub name or canonical hub ID
predicted_people: number >= 0
normal_people: number >= 0
destination: non-empty string
destination_share: number in [0, 100]
route: non-empty source route key
extra_bus_trips_est: number >= 0
priority_score: number >= 0
```

`event_id` identifies one demand event. An event may have multiple rows for
different route/destination recommendations. The unique row key is
`(event_id, route, destination)`. Duplicate identical rows are collapsed;
conflicting duplicate rows reject the query result.

All rows sharing an `event_id` must agree on event-level fields: event and
availability times, source location, surge type, predicted people, and normal
people. Disagreement rejects the event rather than choosing an arbitrary row.

`surge_location` and `route` are translated through explicit backend alias maps to
canonical `hub_id` and `route_id` values. Unknown values remain visible as invalid
source rows in diagnostics but cannot create proposals.

### 4.3 Optional Fields

```text
available_at: offset-aware timestamp <= event_time
surge_type: string
split: string
direction: string
link: string
scheduled_trips_that_hour: integer >= 0
extra_people_on_route: number >= 0
avg_daily_boardings: number >= 0
pct_trips_overcrowded: number >= 0
source_version: string
generated_at: offset-aware timestamp
```

If `available_at` is null or absent, the event is reactive and becomes actionable
at `event_time`. If it is earlier than `event_time`, the event is proactive and
becomes actionable at `available_at` for service targeted at `event_time`.
`available_at > event_time` is invalid.

Optional evidence is displayed and logged but does not override backend fleet or
GTFS feasibility.

### 4.4 Query Windows And Atomicity

- Startup queries only the configured simulation window.
- Seeking within the loaded window does not query Databricks again.
- Seeking outside it loads a bounded window containing the target and atomically
  replaces the event repository only after the entire result validates.
- A query failure retains the prior valid window and reports degraded readiness.
- No fixture fallback occurs when Databricks mode is configured.
- Window metadata records query bounds, source identity/version when available,
  row count, load time, and provenance.
- Simulation bounds are the intersection of configured bounds, available event
  coverage, and usable GTFS/fleet constraints.

The initial implementation may query the complete configured demo range because
it is already bounded. Pagination or adjacent-window prefetch is an optimization,
not a requirement.

## 5. Canonical Objects

The notation below defines required public fields. `?` means nullable.

```text
GeoPoint = {lat: number, lon: number}

RecommendationCandidate = {
  route_id: string,
  pattern_id: string,
  source_stop_id: string,
  destination_stop_id: string,
  source_stop_sequence: integer,
  destination_stop_sequence: integer,
  direction_id: integer?,
  requested_service_date: date,
  feed_service_date: date,
  representative_service: boolean,
  scheduled_trip_ids: string[]
}

EventRecommendation = {
  destination: string,
  destination_share: number,
  route_id: string?,
  source_route: string,
  extra_bus_trips_est: number,
  priority_score: number,
  scheduled_trips_that_hour: integer?,
  extra_people_on_route: number?,
  avg_daily_boardings: number?,
  pct_trips_overcrowded: number?,
  mapping_status: "UNRESOLVED" | "RESOLVED" | "INVALID",
  failure_code: "UNKNOWN_HUB" | "UNKNOWN_ROUTE" | "AMBIGUOUS_ROUTE"
              | "ROUTE_NOT_SERVING_HUB" | "UNKNOWN_DESTINATION"
              | "DESTINATION_NOT_ON_ROUTE" | "UNKNOWN_DIRECTION"
              | "INCOMPATIBLE_DIRECTION" | "NO_DISPATCH_ELIGIBLE_PATTERN"
              | "NO_SERVICE_ON_DATE" | null,
  failure_reason: string?,
  candidates: RecommendationCandidate[]
}

DispatchEvent = {
  id: string,
  hub_id: string?,
  source_location: string,
  location: GeoPoint?,
  available_at: timestamp?,
  actionable_at: timestamp,
  event_time: timestamp,
  mode: "REACTIVE" | "PROACTIVE",
  surge_type: string?,
  predicted_people: number,
  normal_people: number,
  surge_ratio: number?,
  suggested_extra_buses: integer,
  priority_score: number,
  recommendations: EventRecommendation[],
  status: "PENDING" | "NO_ACTION_REQUIRED" | "AWAITING_APPROVAL" | "DISPATCHED"
         | "COMPLETED" | "NO_MATCHING_ROUTE" | "NO_BUS_AVAILABLE"
         | "EXPIRED" | "REJECTED" | "INVALID_SOURCE",
  additional_trip_ids: string[],
  source: {split: string?, direction: string?, link: string?, version: string?}
}

Clock = {
  current_time: timestamp,
  speed: 1 | 60 | 300 | 900 | 3600,
  status: "RUNNING" | "PAUSED",
  min_time: timestamp,
  max_time: timestamp,
  epoch: integer
}

Bus = {
  id: string,
  status: "AVAILABLE" | "RESERVED" | "DEADHEADING" | "WAITING"
        | "IN_SERVICE" | "RETURNING" | "REPOSITIONING",
  location: GeoPoint,
  capacity: integer,
  assigned_trip_id: string?,
  proposed_trip_id: string?
}

MovementLeg = {
  kind: "DEADHEAD" | "SERVICE" | "RETURN",
  path: GeoJSON LineString,
  distance_m: number,
  duration_seconds: integer,
  provenance: {
    provider: string,
    is_approximation: boolean,
    method: string,
    speed_kph: number?
  }
}

MovementPlan = {
  route_id: string,
  pattern_id: string,
  source_stop_id: string,
  destination_stop_id: string,
  reference_scheduled_trip_id: string,
  mode: "REACTIVE" | "PROACTIVE",
  deadhead: MovementLeg,
  service: MovementLeg,
  return_leg: MovementLeg,
  dispatch_time: timestamp,
  estimated_arrival_time: timestamp,
  service_departure_time: timestamp,
  estimated_completion_time: timestamp,
  estimated_return_time: timestamp,
  waiting_seconds: integer,
  arrival_lateness_seconds: integer,
  total_distance_m: number
}

AdditionalTrip = {
  id: string,
  dispatch_event_id: string,
  bus_id: string,
  route_id: string,
  status: "PROPOSED" | "APPROVED" | "BUS_EN_ROUTE" | "IN_SERVICE"
        | "COMPLETED" | "REJECTED" | "EXPIRED" | "CANCELLED",
  proposed_at: timestamp,
  approval_expires_at: timestamp,
  dispatch_time: timestamp?,
  target_event_time: timestamp,
  estimated_arrival_time: timestamp?,
  service_departure_time: timestamp?,
  estimated_completion_time: timestamp?,
  added_capacity: integer,
  rationale: string,
  source_priority: number,
  source_route: string?,
  destination: string?,
  selected_candidate: RecommendationCandidate?,
  movement_plan: MovementPlan?
}
```

An explicit fleet file has this backend configuration contract:

```text
FleetConfig = {
  buses: [{
    id: string,
    capacity: positive integer,
    initial_location_id: canonical hub ID,
    home_location_id: canonical hub ID
  }]
}
```

The file rejects duplicate IDs, unknown fields, non-integer capacities, and
location IDs absent from the loaded transit index. An empty bus list is valid.
When no file is configured, development mode may generate a homogeneous fleet at
an explicit default hub. Runtime reads expose buses in stable ID order; proposal
selection starts from available, unlinked buses in that same order.

The backend selects the highest-priority feasible recommendation and sets
`suggested_extra_buses = ceil(extra_bus_trips_est)` from that recommendation.
It caps proposals by its configured per-event limit and currently available
fleet. A zero suggestion creates no proposal. Lower-priority recommendations are
fallback candidates, not additional simultaneous dispatches.

`surge_ratio` is null when `normal_people` is zero; otherwise it is
`predicted_people / normal_people`. It is context only: the source event already
represents the Databricks decision that service is worth considering.

## 6. Dispatch Semantics

### 6.1 Activation And Ordering

An event cannot affect backend state before `actionable_at`, where:

```text
actionable_at = available_at if available_at is not null else event_time
```

When the clock crosses multiple boundaries, events activate in this order:

```text
(actionable_at ascending, event_time ascending,
 priority_score descending, event_id ascending)
```

Stable event IDs prevent repeated polling, reconnect, or seek from creating
duplicate proposals.

### 6.2 Route And Bus Selection

For each actionable event:

1. Resolve the source hub through the configured hub map.
2. Sort recommendations by priority, then stable route/destination keys.
3. Resolve the recommended route against the backend GTFS index.
4. Resolve a compatible service pattern and destination stop/area.
5. Find available simulated buses that can serve the recommendation.
6. Rank feasible choices deterministically by arrival time, deadhead distance,
   route/pattern ID, and bus ID.
7. Select the first feasible recommendation and create at most its rounded
   suggested count, the configured per-event maximum, and the available
   feasible-bus count.

The first version does not silently substitute an unrelated route. If a source
route cannot be resolved, the recommendation is invalid. A future alternative
route policy requires an explicit specification change and visible rationale.

### 6.3 Reactive And Proactive Events

For a proactive event, the backend attempts arrival by `event_time`. Failure to
arrive before the target may make a candidate infeasible according to configured
lateness tolerance.

For a reactive event, proposal creation starts at `event_time`. Arrival after the
event begins is expected and must not by itself invalidate the proposal. The API
reports the ETA and lateness honestly.

For every bus/candidate pair, routing produces an all-or-nothing immutable
movement plan. Deadhead and home-return legs use the configured routing provider;
the service leg uses the selected GTFS pattern shape and source-departure to
destination-arrival offsets. Provider durations round upward to whole seconds.
The plan records all three paths, distances, durations, lifecycle timestamps,
waiting time, arrival lateness, routing provenance, and a stable reference
scheduled trip. Provider, pattern, stop-occurrence, shape, timing, and proactive
lateness failures are typed and never produce partial plans or silent fallback.

Human approval mode reserves the selected bus while the proposal is pending.
Approval dispatches it; rejection or expiry releases it. Automatic mode may
approve immediately. A bus may be reserved by only one proposal or trip.
Approval recomputes the immutable movement plan from the current simulation time.
If the plan is no longer feasible, the backend atomically cancels the proposal,
releases the bus, and reports the typed planning reason as a conflict.

### 6.4 Movement

Approved buses progress through deadheading, optional waiting, in-service travel,
and return. Exact lifecycle endpoints are committed at semantic clock boundaries;
between boundaries, API reads interpolate distance-weighted location and heading
from backend-owned paths using simulation time. Service completion marks the trip
complete while its bus remains assigned through the return leg. Return releases
the bus at home exactly once. Cancellation releases it immediately at its
interpolated current location, and stale future boundaries become no-ops.

Same-time milestones, including zero-duration legs, are consumed in canonical
order in one coordinator transaction. Only the next strictly future milestone is
registered, so accelerated clocks process every crossed phase without exposing
partial state.

Added capacity is the sum of capacities of backend buses assigned to the event.
The backend does not reinterpret predicted people as observed riders and does not
claim a real-world load reduction without a separate model.

## 7. Clock, Seek, And Determinism

The coordinator is the sole authority for clock, event, proposal, trip, and bus
mutations. It serializes commands, commits state atomically, allocates increasing
event sequence numbers, then publishes WebSocket updates.

The clock processes every crossed boundary even at accelerated speed:

- Event `actionable_at`.
- Event `event_time`.
- Proposal expiry.
- Approved dispatch.
- Arrival, service departure, completion, and return.

Seeking to `T`:

1. Pauses the clock and increments the epoch.
2. Loads a new bounded Databricks window only if `T` is outside the cached range.
3. Restores the configured initial fleet and empty runtime repositories.
4. Replays event activation and automatic lifecycle boundaries through `T` in
   canonical order.
5. Reapplies recorded human decisions whose simulation timestamps are at or
   before `T`; decisions after `T` are permanently discarded.
6. Atomically installs rebuilt state and emits `system.reset` followed by a fresh
   snapshot.

Replay occurs against an isolated copy of the immutable initial fleet. Historical
transition events and auto-pause requests are not published; only the successful
epoch reset is emitted. The future semantic-boundary queue is replaced in full so
callbacks from the prior epoch cannot mutate rebuilt state. Effective manual
approvals and rejections are recorded in the same coordinator transaction as their
state change and replayed by timestamp, boundary priority, and stable decision
order.

Event windows are half-open. A seek target must be strictly before the validated
window end. Candidate source loading and recommendation mapping complete before
live mutation, and reader/coordinator revisions prevent concurrent refreshes or
commands from being overwritten. Query, mapping, replay, publication, or revision
failure preserves the prior epoch and simulation state.

Given identical event rows/query metadata, GTFS version, fleet configuration,
backend settings, and recorded decisions, seek must reproduce identical state and
IDs. Databricks is never queried once per simulation tick.

## 8. REST Surface

Required endpoints:

All paths below except `/healthz` are relative to `/api/v1`.

```text
GET  /healthz
GET  /meta
GET  /state
GET  /dispatch-events?from=&to=&hub_id=&status=
GET  /dispatch-events/{event_id}
GET  /buses
GET  /buses/{bus_id}
GET  /additional-trips
GET  /additional-trips/{trip_id}
GET  /routes?hub_id=&include_shape=false
GET  /routes/{route_id}
POST /clock/pause
POST /clock/resume
POST /clock/speed
POST /clock/seek
POST /additional-trips/{trip_id}/approve
POST /additional-trips/{trip_id}/reject
```

`GET /dispatch-events` is side-effect free. It returns only rows in the loaded
window and only events with `actionable_at <= at`, where `at` defaults to the
captured simulation time. An administrative diagnostics response may report
future loaded-row counts, but must not expose their contents to operational UI.

`GET /meta` reports event-source mode, source identity/version when available,
loaded query bounds, usable simulation bounds, supported speeds, GTFS version,
fleet size/capacity summary, approval mode, and readiness.

`GET /state` is an atomic snapshot containing clock, relevant visible dispatch
events, buses, proposals/trips, epoch, and last sequence number.

The v2 `/forecast`, `/origins`, `/timeline`, `/late-night`, `/hourly-profile`,
`/overview`, `/route-crowding`, `/findings`, `/backtest`, and `/validation`
contracts are not required by this architecture. They may be added later only as
optional reads that do not block dispatch.

## 9. WebSocket Contract

`GET /ws` first sends the same `StateSnapshot` object returned by `GET /state`,
then sends ordered event envelopes:

```text
clock.updated
dispatch_event.updated
proposal.created
proposal.updated
trip.updated
bus.updated
system.reset
system.error
```

Every event carries `epoch`, `seq`, simulation timestamp, type, and payload.
Clients discard stale epochs, apply only increasing sequence numbers, and refetch
`/state` after a gap or reset. Activation and proposal creation commit before
their corresponding messages are emitted. The server subscribes before capturing
the bootstrap and suppresses any buffered envelope already represented by the
bootstrap's `(epoch, last_seq)`, so a concurrent mutation is neither lost nor sent
twice. Missing or untrusted WebSocket origins are rejected. A client that cannot
keep up is disconnected and must reconnect for a fresh snapshot rather than
continuing across a silently dropped sequence gap.

## 10. Runtime Configuration And Reliability

Required configuration groups:

- Simulation: bounds, start, speed, approval mode, proposal timeout.
- Event source: mode (`fixture`, `exported_events`, or `databricks`), source
  version, query window, table/view identity, host, HTTP path, and credentials.
- Mapping: source hub aliases, source route aliases, destination-to-stop aliases,
  direction aliases, and exact stop-ID/name matching.
- GTFS: feed path/version and representative service dates.
- Fleet: optional JSON definition, generated fallback count/capacity/default hub,
  known initial/home locations, and per-event proposal cap.
- Routing: provider, fallback speed, return policy, and proactive lateness
  tolerance in seconds. Reactive arrival lateness is reported but not rejected.

Credentials remain server-side and are never returned by APIs or logs. Production
must not start in fixture mode. Databricks mode requires all connection and source
settings and fails closed without them.

Readiness components are `dispatch_event_source`, `gtfs`, `fleet`, and
`simulation`. A failed refresh may be degraded but ready only if the cached event
window covers the active simulation time. Otherwise the service is not ready.

Structured logs include query bounds and source version, event ID, action and
target times, source recommendation, validation result, suggested and assigned bus
counts, proposal/trip IDs, and rejection or failure reason.

## 11. Verification And Acceptance

Required automated coverage includes:

- Parameterized query construction and identifier validation.
- Required/optional row parsing and percentage normalization policy.
- Duplicate event/recommendation handling and deterministic ordering.
- No event visibility or state effect before `actionable_at`.
- Reactive activation exactly at `event_time` when `available_at` is absent.
- Proactive activation at `available_at` and target handling at `event_time`.
- Hub, route, and destination resolution failures.
- Suggested-bus rounding, backend caps, and insufficient-fleet behavior.
- Concurrent reservation conflicts and rollback without partial state.
- Approval, rejection, expiry, movement, completion, and bus release.
- High-speed boundary processing without skipped events.
- Seek within and outside the loaded query window.
- Deterministic replay with recorded decisions.
- Databricks failure retaining a valid cached window without fixture fallback.
- REST/WebSocket snapshot consistency, reconnect, sequence gaps, and epoch reset.

End-to-end acceptance requires a real Databricks event from a filtered historical
query to become actionable, resolve to backend GTFS, create a feasible proposal,
reserve and move a simulated bus after approval, complete and return it, and
reproduce the same state after seek. Every displayed recommendation must trace to
its source event; every assignment and movement decision must trace to backend
GTFS, fleet, routing, and policy.

## 12. Confirmed Decisions And Open Inputs

Confirmed:

- Databricks supplies one event feed, queried by historical time window.
- The backend owns all fleet data and simulation state.
- A single event timestamp supports reactive operation.
- Optional `available_at` enables proactive operation.
- Databricks suggestions are capped by backend feasibility and fleet availability.
- The former eleven-table snapshot is not the target contract.

Inputs still required before live integration:

- Exact catalog, schema, and table/view name.
- Workspace host, scoped API token, and serverless SQL warehouse HTTP path for the
  SQL Statement Execution API.
- Whether `available_at` will be supplied.
- Canonical source timezone and timestamp encoding.
- Stable `event_id` generation if the source does not already provide it.
- Whether `destination_share` is emitted as a fraction or percentage points.
- Hub and route alias mappings.
- Demo query bounds and verified event presets.
- Final fleet configuration and approval mode.

Unresolved inputs must be explicit configuration or validation errors. They must
not silently change this contract.
