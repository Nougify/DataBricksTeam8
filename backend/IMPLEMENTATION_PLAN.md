# Surge Bus Backend Implementation Plan

This plan implements `backend/SPEC.md` v3.0. It replaces the former multi-table
forecast snapshot plan with one bounded Databricks dispatch-event query and a
backend-owned simulated fleet.

## 1. Current State

Completed foundations:

- FastAPI service, validated settings, CORS, health, Docker baseline, coordinator,
  event sequencing, bounded clock, GTFS index, and replaceable routing.
- Canonical dispatch-event imports with proactive/reactive timing, derived surge
  ratio, suggested-bus rounding, deterministic grouping, source metadata, and
  strict row validation.
- Fixture, exported-event, and bounded parameterized Databricks source modes with
  atomic event-window replacement and no fallback after source failure.
- Actionable-time visibility masking in `/state` and dispatch-event reads.
- Basic source hub and route alias resolution against backend GTFS.
- Deterministic backend-owned fleet initialization and immutable reset state.
- Event, bus, trip, and route read endpoints, expanded metadata, epoch-reset seek,
  and atomic idempotent approval/rejection for proposals that already exist.

Partial or superseded implementation still present:

- Event visibility is correct, but activation is not a coordinator-owned boundary
  and does not create proposals or mutate event status.
- Hub and route aliases resolve, but destination, direction, service-pattern, and
  service-date feasibility do not.
- Generated fixture buses work, but `fleet_config_path` is not loaded or validated.
- Approval and rejection work, but no production service creates, expires, or
  automatically approves proposals.
- Seek resets state but does not replay events, movement, or recorded decisions.
- Legacy v2 forecast/surge models, repository links, API schemas, and event names
  remain in the runtime.
- The root frontend remains a health-only page and `/ws` is not implemented.

The next implementation step is **03 - Event Repository, Activation, And Clock
Boundaries**, followed by completion of **04-07** before movement and replay. Do
not build additional forecast/origin/analytics endpoints against the superseded
contract.

### 1.1 Implementation Status

| Chunk | Status | Work left |
|---|---|---|
| 01 Event contract migration | Mostly complete | Migrate trips/repositories from `Surge` and `surge_id` to dispatch events |
| 02 Filtered event adapters and cache | Mostly complete | Finalize live query details and test real export/Databricks rows |
| 03 Event repository and activation | Partial | Coordinator activation boundaries, deduplication, status changes, and events |
| 04 GTFS recommendation mapping | Partial | Destination, direction, pattern, and service-date resolution |
| 05 Backend fleet configuration | Partial | File-backed fleet loading and validation |
| 06 Proposal and approval | Partial | Proposal creation, reservation, expiry, automatic approval, and fleet caps |
| 07 Routing foundations | Partial | Deadhead, service, and return itinerary composition |
| 08 Movement lifecycle | Not started | Bus/trip progression, interpolation, completion, and release |
| 09 Deterministic seek | Partial | Replay boundaries and recorded human decisions through the target |
| 10 REST and WebSocket | Partial | Canonical v3 trip schemas, `/ws`, reconnect, gap, and reset handling |
| 11 Real-data gate | Not started | Validate selected profile, warehouse, source, mappings, and demo window |
| 12 Demo acceptance | Not started | Operational frontend, end-to-end automation, Docker smoke tests, and CI |

### 1.2 Remaining Critical Path

Complete the following in dependency order:

1. Replace the runtime's legacy `Surge` entity and `surge_id` links with canonical
   `DispatchEvent` and `dispatch_event_id` entities. Update repositories, event
   payloads, serializers, and validation together.
2. Register deterministic event activation and target-time clock boundaries. Store
   active event state in the coordinator, deduplicate activation, update status,
   and publish changes only after commit.
3. Finish source recommendation mapping for destinations, direction, service
   patterns, and representative service dates. Preserve typed visible failures.
4. Load and validate explicit fleet configuration, including unique IDs, positive
   capacities, known initial locations, home locations, and empty/custom fleets.
5. Implement event-to-proposal creation: recommendation fallback, bus ranking,
   suggestion/policy/fleet caps, stable IDs, atomic reservation, timeout expiry,
   rollback, and automatic approval mode.
6. Compose deadhead, service, and return paths and times. Apply proactive lateness
   policy without rejecting normal reactive post-event arrivals.
7. Implement movement boundaries and interpolation through reserved, deadheading,
   waiting, in-service, returning, completed, and available states.
8. Make seek rebuild state and replay all canonical boundaries and eligible human
   decisions through the target while preserving old state on load/replay failure.
9. Finish REST schemas and implement `/ws` bootstrap, epoch/sequence ordering,
   reconnect, gap recovery, reset, and error events.
10. Replace the root health-only frontend with clock controls, event/proposal
    decisions, fleet movement, trip lifecycle, source provenance, and reconnect
    handling. Add the Nginx WebSocket proxy.
11. Select an explicit Databricks profile and validate the live/exported event
    contract, table/view, warehouse, aliases, source version policy, and demo range.
12. Add end-to-end event-to-return, WebSocket, Docker, and CI acceptance coverage.

## 2. Working Rules

- Complete chunks in dependency order.
- A real Databricks event feed or versioned export of that same feed is required
  for delivery; fixtures prove mechanics only.
- Query Databricks with bound time-window parameters. Never query once per tick.
- Do not use an event before `available_at ?? event_time`.
- Do not silently fall back to fixtures after external-source failure.
- Install query results and seek results atomically; retain prior valid state on
  failure.
- Databricks never owns buses, reservations, dispatch state, or movement.
- GTFS and configured fleet data are authoritative for backend feasibility.
- A recommendation that cannot be mapped fails visibly rather than being replaced
  by invented data.
- Keep one coordinator authority for clock and all runtime mutations.
- Update schemas, fixtures, tests, `SPEC.md`, and this plan together when the
  contract changes.
- For Databricks operations, ask which CLI profile to use and pass it explicitly.

Each chunk is complete only when code, tests, typing, formatting, and relevant
documentation pass. Required checks are:

```text
uv run ruff check .
uv run ruff format --check .
uv run mypy --strict app tests
uv run pytest
```

## 3. Dependencies

```text
01 Event contract migration
  |
  +--> 02 Filtered event adapters and cache
  |      |
  |      +--> 03 Event repository, activation, and clock boundaries
  |              |
  04 GTFS recommendation mapping ----------------+
  05 Backend fleet configuration ----------------+--> 06 Proposal and approval
  07 Routing and movement foundations -----------+          |
                                                            v
                                                    08 Movement lifecycle
                                                            |
  02 + 03 + 06 + 08 --------------------------------------> 09 Deterministic seek
                                                            |
                                                    10 REST and WebSocket
                                                            |
                                                    11 Real-data gate
                                                            |
                                                    12 Demo acceptance
```

Chunks 04 and 07 adapt existing GTFS/routing work and can proceed in parallel with
02 after the canonical event model in 01 is fixed. Only one chunk should be marked
in progress in the tracked task list at a time.

## 4. Contract And Data Source

### 01 - Event Contract Migration

**Scope:** SPEC sections 3-5 and 10.

- Add canonical `DispatchEvent`, `EventRecommendation`, and event-source metadata.
- Represent `event_time`, optional `available_at`, derived `actionable_at`, and
  reactive/proactive mode.
- Represent predicted/normal people, suggested buses, priority, source hub, route,
  destination, shares, and optional evidence.
- Link proposals and trips by `dispatch_event_id` instead of forecast-derived
  surge identity.
- Replace snapshot-oriented settings with event-source mode, table/view identity,
  query-window, mapping, and source-version settings.
- Remove mandatory forecast, actual, baseline, origin, route-load, analytical, and
  evaluation models from the operational import path.
- Keep hub geometry, GTFS, fleet, routing, and runtime entities backend-owned.

**Verify:** strict row validation, timestamp offsets, `available_at <= event_time`,
fraction/percentage policy, suggested-bus rounding, duplicate keys, and canonical
serialization.

**Done when:** the code has one canonical event model matching SPEC v3 and no core
runtime interface requires the former `DataSnapshot`.

### 02 - Filtered Event Adapters And Cache

**Depends on:** 01.

- Define an `EventSource.load_window(start, end)` protocol.
- Implement explicit fixture, exported-event, and Databricks adapters.
- Use one fixed parameterized query against a validated configured table/view.
- Map the current Databricks fields into canonical events and group rows by
  `event_id`.
- Require rows in one event to agree on event-level fields.
- Resolve identical duplicates and reject conflicting duplicate recommendation
  keys.
- Record source identity/version, query bounds, row count, loaded time, and
  provenance.
- Cache bounded windows atomically and retain the prior valid window on refresh
  failure.
- Never fall back to fixture mode after a Databricks or export failure.

**Verify:** exact query and parameter binding, unsafe identifiers, empty windows,
optional columns, grouping, deterministic ordering, malformed rows, provider
failure, and atomic replacement.

**Done when:** a bounded fixture/export/live query produces the same validated
event-window object.

### 03 - Event Repository, Activation, And Clock Boundaries

**Depends on:** 02.

- Replace forecast-vintage selection and surge detection with event activation.
- Keep loaded future events private until `actionable_at`.
- Activate same-time events by action time, target time, descending priority, then
  stable event ID.
- Add boundaries for `actionable_at`, `event_time`, proposal expiry, dispatch,
  movement, completion, and return.
- Deduplicate repeated loads and polling by stable source event ID.
- Derive usable simulation bounds from configured bounds and event coverage.

**Verify:** reactive and proactive timing, no early visibility, same-time ordering,
high-speed jumps, zero-event windows, repeated loads, and no duplicate activation.

**Done when:** advancing the clock deterministically activates only eligible source
events without consulting Databricks per tick.

## 5. Backend-Owned Feasibility

### 04 - GTFS Recommendation Mapping

**Depends on:** 01.

- Preserve immutable GTFS routes, stops, trips, patterns, schedules, and shapes.
- Add explicit source hub and route alias maps.
- Resolve source destination labels to eligible stops/areas where required.
- Return typed invalid-source outcomes for unknown hubs, routes, destinations, or
  incompatible direction/service patterns.
- Do not silently choose an unrelated route.

**Verify:** all configured aliases, unknown values, stable pattern ordering,
representative service dates, over-midnight schedules, and destination matching.

**Done when:** each valid source recommendation resolves to deterministic backend
GTFS candidates or a precise visible failure.

### 05 - Backend Fleet Configuration

**Depends on:** 01.

- Keep fleet identity, capacity, initial location, and status entirely in backend
  configuration.
- Validate stable unique bus IDs, positive capacity, known initial locations, and
  configured fleet size.
- Maintain immutable initial state for reset and seek.
- Cap per-event assignments by source suggestion, backend policy, and available
  feasible buses.
- Remove Databricks/TSPR fleet and load dependencies from dispatch feasibility.

**Verify:** empty/small fleets, duplicate buses, invalid capacity/location, reset,
and deterministic available-bus ordering.

**Done when:** the simulation can create, reserve, release, and reset its own buses
without fleet information from Databricks.

### 06 - Proposal, Reservation, And Approval

**Depends on:** 03, 04, 05, and 07.

- For each actionable event, sort recommendations and feasible buses
  deterministically.
- Select the highest-priority feasible recommendation and create no more than its
  rounded `extra_bus_trips_est`, the backend per-event cap, and the available
  feasible-bus count. Treat lower-priority recommendations as fallbacks rather
  than cumulative demand.
- Store source event, priority, recommendation, target event time, GTFS choice,
  bus, ETA, capacity, and rationale on every proposal.
- Reserve buses atomically with proposal creation.
- Support manual approval/rejection/expiry and immediate automatic approval.
- Permit honest post-event ETA for reactive events; apply configured target/lateness
  policy to proactive events.
- Release reservations exactly once after rejection, expiry, cancellation, or
  failed commit.

**Verify:** zero suggestions, fractional suggestions, insufficient fleet,
same-priority ties, concurrent conflicts, rollback, reactive approval, proactive
lateness, rejection, expiry, and idempotent decisions.

**Done when:** one event can safely create and decide feasible backend-owned bus
proposals without partial state.

### 07 - Routing And Movement Foundations

**Depends on:** 01; reusable work already exists.

- Retain replaceable routing with a deterministic straight-line fallback.
- Build deadhead, service, and return paths from backend locations and GTFS.
- Compute travel times and distance from the selected provider.
- Support proactive arrival targets and reactive dispatch after event start.

**Verify:** zero-distance legs, provider failure, stable paths/times, and both timing
modes.

**Done when:** every feasible proposal has backend-computed paths and lifecycle
times independent of Databricks.

### 08 - Movement Lifecycle

**Depends on:** 06 and 07.

- Advance approved buses through reserved, deadheading, waiting when proactive,
  in-service, return, and available states.
- Interpolate location and heading from simulation time and backend paths.
- Process all crossed movement boundaries at accelerated speed.
- Publish trip and bus updates only after atomic commits.
- Report added capacity from assigned backend buses without claiming observed
  ridership or real-world load reduction.

**Verify:** boundary times, proactive waiting, reactive late arrival, interpolation,
completion, cancellation, return, high-speed jumps, and exactly-once release.

**Done when:** approved simulated buses visibly complete a full dispatch lifecycle.

## 6. Replay And Interfaces

### 09 - Deterministic Seek

**Depends on:** 02, 03, 06, and 08.

- Pause and increment epoch before rebuilding.
- Reuse the loaded event window when it covers the target.
- Load and validate a new bounded window atomically when it does not.
- Restore initial fleet/runtime state and replay canonical event/lifecycle
  boundaries through the target.
- Reapply recorded human decisions at or before the target and discard later ones.
- Keep old state if query, validation, or replay fails.
- Emit reset only after the rebuilt state commits.

**Verify:** forward/backward seek, window changes, same-target repetition, recorded
decisions, pending reservations, in-flight buses, failed queries, epoch changes,
and stable IDs/state.

**Done when:** identical event rows, GTFS, fleet, settings, and decisions reproduce
identical state at the same simulation time.

### 10 - REST And WebSocket

**Depends on:** 09.

- Implement the SPEC v3 core REST surface and atomic `/state` snapshots.
- Expose only events actionable by the captured `at` time.
- Return source/query-window, GTFS, fleet, and readiness metadata without secrets.
- Replace surge/forecast event vocabulary with dispatch-event vocabulary.
- Preserve epoch, sequence, bootstrap, reconnect, gap recovery, and reset behavior.
- Keep route geometry and schedules sourced from backend GTFS.
- Remove obsolete forecast/origin/analytics endpoints from the required MVP.

**Verify:** schemas, filters, stable ordering, visibility masking, mutation errors,
snapshot/event consistency, reconnect races, sequence gaps, and reset buffering.

**Done when:** the frontend can run the complete event-to-dispatch workflow through
documented REST and WebSocket contracts.

## 7. Integration And Acceptance

### 11 - Real Databricks Readiness Gate

**Depends on:** 02, 04, 05, and 10.

- Confirm the explicit Databricks profile and serverless SQL warehouse.
- Confirm catalog/schema/table or view and least-privilege read permissions.
- Validate bound window queries against real rows.
- Confirm event ID stability, timezone, optional availability semantics,
  destination-share scale, duplicate policy, and source refresh/version behavior.
- Pin and validate hub/route/destination aliases, GTFS version, fleet config, and
  one reactive or proactive demo window.
- Exercise source loss and cached-window readiness without fixture fallback.

**Verify:** at least one real row drives a feasible backend proposal; unknown source
values fail visibly; filtering excludes out-of-window rows; provider loss preserves
only valid covered state.

**Done when:** the live parameterized query or a versioned export of the same feed
drives the full backend workflow with no mock data substituted.

### 12 - Reproducible Demo And Final Acceptance

**Depends on:** 11.

- Automate startup, event activation, proposal auto-pause, approval or rejection,
  dispatch, movement, completion, return, seek, reset, and reconnect.
- Demonstrate suggested buses being capped by the simulated fleet.
- Demonstrate source recommendation validation against backend GTFS.
- Preserve source-event and backend-decision provenance in UI and logs.
- Document exact query bounds, source version, GTFS version, fleet config, settings,
  and commands.
- Add CI for lint, formatting, strict typing, tests, Docker build, and API contract
  compatibility.

**Done when:** a fresh developer can reproduce the real historical demo and trace
every recommendation to Databricks and every bus action to backend-owned data and
policy.

## 8. Checkpoints And Scope

| Checkpoint | Required work | What it proves |
|---|---|---|
| A - Event foundation | 01-03 with fixtures | One bounded feed, correct activation, no early visibility |
| B - Manual dispatch | A + 04-08 | Backend GTFS/fleet can safely execute a recommendation |
| C - Replayable interface | B + 09-10 | Seek, snapshots, WebSocket, and UI contracts are deterministic |
| D - Real-data demo | C + 11 | A filtered Databricks event drives a real proposal |
| E - Delivery-ready | D + 12 | The demo is reproducible, observable, and tested |

The fastest useful slice is one real event, one hub, one resolvable route, and two
or three simulated buses. Expand event windows, hubs, and routes only after that
slice completes. Forecast charts, origins, backtests, and broad analytics are
outside the critical path and must not delay Checkpoint D.

## 9. Decision Register

| Decision/input | Status | Required action |
|---|---|---|
| Single filtered dispatch-event feed | Decided | Implement SPEC v3 contract |
| Backend-owned simulated fleet | Decided | Configure buses locally; no Databricks fleet dependency |
| Reactive events without `available_at` | Decided | Activate at `event_time` |
| Proactive events with `available_at` | Decided | Activate earlier; target `event_time` |
| Databricks source location | Open | Confirm catalog, schema, table/view, profile, and warehouse |
| Event IDs | Open | Confirm source field or deterministic generation policy |
| Timestamp encoding | Open | Confirm timezone and normalize explicitly |
| Destination share scale | Open | Confirm fraction versus percentage points |
| Hub/route aliases | Open | Supply canonical mapping and validate coverage |
| Duplicate/source-version policy | Open | Confirm refresh and conflicting-row behavior |
| Query bounds | Open | Choose demo range and seek window policy |
| Fleet configuration | Open | Choose bus IDs, capacities, and initial locations |
| Approval mode | Open | Choose manual or automatic demo behavior |
| Reactive lateness | Open | Configure allowed post-event dispatch behavior |
| Human decisions during seek | Decided | Replay decisions at/before target; discard later decisions |

Open inputs must be resolved before chunk 11. They may not be hidden behind fixture
defaults in a production or judged demo.
