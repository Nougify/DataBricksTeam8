# Hub Pulse Backend Implementation Plan — v2

This plan implements [`SPEC.md`](SPEC.md) v2.0 in dependency-ordered, reviewable
chunks. The spec is authoritative for schemas and behavior; this document defines
delivery order, dependencies, verification, and completion gates. Chunk numbers
replace the old v1 plan and are not a record of completed work.

## 1. Starting point

At this revision:

- Chunks 01 through 06 are complete. The Python 3.13/FastAPI service has typed v2 runtime
  configuration, shared REST/WebSocket origin policy, application lifespan
  ownership, consistent error envelopes, locked dependencies, and non-root Docker
  startup. `app/main.py` serves `/healthz`.
- The canonical v2 domain primitives, immutable schedules, internal dispatch
  metadata, public read schemas, and entity serializers are defined and tested.
- Typed, versioned data readers now sit behind validated fixture, exported-snapshot,
  and prepared parameterized Databricks adapters. Snapshot refresh is atomic,
  leakage-sensitive caches include version/as-of inputs, and failed refreshes retain
  the prior valid snapshot without fixture fallback.
- Deterministic repositories, one application-owned mutation coordinator, atomic
  cross-entity validation and rollback, typed v2 events, and process-local epoch
  and sequence ownership now provide the authoritative simulation mutation core.
- The bounded event-driven clock uses monotonic production time and deterministic
  fake time, processes prioritized semantic boundaries without skipping, and owns
  clock/entity/event commits atomically through the mutation coordinator.
- Strict GTFS parsing, calendar and exception resolution, representative service
  dates, stable service patterns, >24-hour schedules, route shapes, and hub
  catchment indexes now provide one immutable application-owned transit source.
- The v2 simulation APIs, analytics adapters, and WebSocket are still to be
  implemented. Existing models, coordinator, and clock do not establish v2 completion.
- Existing hub_pulse analysis can supply several read views, but the hourly
  rolling-origin forecast, trailing baseline, and evaluation artifacts are
  explicit data deliverables, not assumed available.

The next implementation step is **07**. Do not postpone forecast validation until
after building the dispatcher.

## 2. Working rules and completion gates

- Keep each chunk focused, runnable, and independently reviewable. Honor its
  prerequisites; an explicit fixture can substitute for an external artifact
  during development, not for the real-data completion gate.
- Keep domain behavior in services/domain code, API serialization in dedicated
  schemas, and source-specific logic at integration boundaries.
- Use deterministic fixtures, pinned source versions, and a fake simulation
  clock. Tests must not sleep to advance time or require shared workspace access.
- Maintain one application-owned mutation coordinator. Approval, expiry, seek,
  reservations, and snapshot/event ordering must share that authority.
- Implement only v2 public states/events. Do not build automatic dispatch or
  v1 start/reset endpoints and plan to retrofit approval and seek later.
- The frontend target is port 3001 with configurable REST/WebSocket URLs and
  allowed origins. Do not add compatibility routes without a concrete consumer.
- No silent fixture fallback, invented backtest metrics, future-observation
  leakage, or implicit conversion of pings to passengers.
- For Databricks execution, follow repository skill guidance, ask which CLI
  profile to use, and pass it explicitly. Use serverless-compatible pipelines;
  do not overwrite shared tables/notebooks or run a shared notebook's Run All
  without checking with the team.
- For implementation chunks, run from `backend`:

  ```sh
  uv run ruff check .
  uv run ruff format --check .
  uv run mypy --strict app tests
  uv run pytest
  ```

  Run relevant pipeline checks for data chunks and Docker/OpenAPI checks where
  specified. Documentation-only edits need documentation/diff checks.
- Record a chunk complete only after its tests and acceptance condition pass.
  If a schema/product decision blocks it, record the blocker rather than
  returning placeholder success responses.

## 3. Dependencies

Dependencies below are direct prerequisites; their dependencies are transitive.
Independent workstreams may proceed concurrently once prerequisites are met.
This does not require parallel agents or concurrent edits to shared notebooks.

| Chunk | Prerequisites | Deliverable |
|---|---|---|
| 01 | Existing scaffold | Runtime/configuration alignment |
| 02 | 01 | V2 domain and canonical API schemas |
| 03 | 02 | Versioned data interfaces and explicit fixtures |
| 04 | 02 | Repositories, mutation coordinator, event sequencing |
| 05 | 04 | Bounded event-driven clock |
| 06 | 02 | GTFS parsing and transit index |
| 07 | 02 | Deadhead/return routing abstraction |
| 08 | 03, 06 | Fleet, route loads, and capacity evidence |
| 09 | 03, 05 | As-of demand and surge detection |
| 10 | 06, 07, 08, 09 | Feasible route/departure candidates |
| 11 | 04, 10 | Atomic proposals and reservations |
| 12 | 05, 11 | Approval, rejection, expiry, alternatives |
| 13 | 07, 12 | Movement and bus return lifecycle |
| 14 | 09, 13 | Deterministic atomic seek |
| 15 | 08, 14 | Canonical core REST API and snapshots |
| 16 | 15 | WebSocket transport and resynchronization |
| 17 | 09, 15 | Forecast, origins, and hub status reads |
| 18 | 06, 08, 15 | Routes, loads, and map geometry |
| 19 | 03, 17 | Timeline, profile, and late-night views |
| 20 | 03, 15 | Remaining findings and proof views |
| 21 | 16, 17, 18, 19, 20 | Real-data integration and readiness |
| 22 | 21 | Reproducible demo, CI, and delivery acceptance |

Backend chunks can use explicit fixtures during development, but Checkpoint C and
chunk 21 require real data. Prepare adapter implementations in 03 and validate
each real artifact as it arrives; 21 is the integration gate, not the first time
anyone attempts Databricks ingestion.

## 4. Foundation and data contracts

### 01 — Align the existing service and runtime configuration

**Scope:** SPEC sections 2, 3, 11.

- Verify the existing FastAPI/uv/Docker scaffold and health routes; retain its
  working structure rather than recreating a Node-to-Python migration.
- Replace single `FRONTEND_ORIGIN` assumptions with typed `CORS_ORIGINS`, defaulting
  to both localhost and 127.0.0.1 on port 3001. Add REST CORS middleware and a
  reusable WebSocket origin validator for chunk 16.
- Add typed configuration for replay bounds/start, allowed speeds, manual
  approval, auto-pause, timeout, data mode, and pinned source versions. Add fleet,
  routing, and dispatch settings alongside their owning later chunks.
- Establish single-worker application lifespan ownership and consistent error
  envelopes, including FastAPI validation errors.

**Verify:** health contract, invalid settings, allowed/denied REST origins,
error envelopes, non-root container startup, and locked dependency installation.
**Done when:** the service boots with v2 defaults and the existing checks pass.

### 02 — Migrate domain primitives and define canonical read schemas

**Scope:** SPEC sections 3, 5, 6.3, 13.1.

- Evolve existing typed IDs, geography, service patterns, and immutable schedules.
  Add hub IDs, forecast vintage/bucket types, RouteRef, Clock, HubStatus, Surge,
  Bus, AdditionalTrip, and the explicit TripDetail extension.
- Add proposal/reservation states and links, surge windows/phases/multiple trips,
  origin shares, load evidence, timing, capacity, and replacement relationships.
- Preserve internal home locations, selected patterns, ordered stops, candidate
  scores, and failure reasons separately from the public DTOs.
- Define a single serializer per canonical entity for later REST/events. Define
  analytic DTOs with their owning endpoint chunks using these same primitives.
- Encode explicit nullability, Vancouver timestamps, offset-bearing bucket keys,
  valid shapes, load percentages above 100, and progress on the 0–1 scale.

**Verify:** v2 objects and state invariants, nullable destinations, multiple trip
links, timestamp/coordinate errors, load units, and exact serialized fields.
**Done when:** reusable v2 models pass tests without v1 public enum/field leakage.

### 03 — Versioned data interfaces, adapters, and fixture mode

**Scope:** SPEC sections 4, 11.

- Define typed read interfaces for forecast vintages, actuals, trailing baselines,
  origins, dimensions, route loads, retrospective views, and evaluation artifacts.
- Implement explicit fixture and exported-snapshot adapters; prepare parameterized
  Databricks queries/schema mappings behind the same interfaces.
- Validate timestamps, vintage keys, intervals, training cutoffs, provenance,
  freshness, and usable coverage before installing a snapshot.
- Key caches by source/model version and as-of/vintage parameters. Keep source
  credentials server-side and snapshot installation atomic.
- Build a small deterministic fixture with a surge, ordinary hours, missing data,
  multiple origins, and representative route load evidence. Label fixture mode.

**Verify:** malformed/duplicate data, no available artifact, as-of cache isolation,
mode selection, integration failure retaining the prior snapshot, and no fallback.
**Done when:** backend consumers can use typed data without direct SQL knowledge.

## 5. Authoritative simulation core

### 04 — Repositories, mutation coordinator, and event sequencing

**Scope:** SPEC sections 2, 7, 10.

- Add deterministic in-memory repositories for buses, surges, trips, and decisions.
- Coordinate multi-entity commits, conflict checks, snapshot reads, and eventual
  seek swaps through one application-owned authority.
- Define typed internal v2 events, process-local seq/epoch ownership, and an
  event sink abstraction. Commit before publishing; allocate snapshot last_seq
  consistently with all committed events represented in the snapshot.
- Support staged state construction and failure rollback without partial writes.

**Verify:** concurrent mutations, stable ordering, rollback, one bus reservation,
atomic snapshots, increasing sequences, and no events for failed transactions.
**Done when:** later services cannot bypass atomic updates or event ordering.

### 05 — Bounded event-driven simulation clock

**Scope:** SPEC section 6.4.

- Add production/fake clocks, PAUSED startup, MANUAL approval, exact allowed
  speeds, pause/resume/settings, and configurable min/max bounds.
- Build chronological event-boundary stepping and hooks for issuances, proposal
  auto-pause, expiry, movement, and hourly demand. Later chunks register handlers.
- Stop at max_time; preserve time on pause. Keep wall-clock dependencies inside
  the production clock and provide test control of elapsed time.

**Verify:** 1–3600x stepping, unsupported speeds, idempotent controls, max bound,
pause freezing, DST elapsed-time behavior, and stopping at a registered boundary.
**Done when:** large steps cannot skip semantic boundaries; no start/reset API
or public STOPPED state is introduced.

### 06 — GTFS parsing, patterns, and transit index

**Scope:** SPEC sections 6.1, 8.

- Load the pinned GTFS files, calendars/exceptions, >24-hour service times,
  directions, shapes, and ordered stop-time templates.
- Preserve GTFS route IDs and map line keys/colors/modes and hub catchments.
  Index all supported display modes, with Bus-only dispatch eligibility.
- Implement explicit representative service-day mapping when replay dates are
  outside feed coverage; retain and disclose its provenance.
- Build immutable route/pattern/stop/departure lookups with deterministic IDs.

**Verify:** direction variants, calendars, midnight/service-day boundaries,
representative mapping, missing files, immutable records, and route identity.
**Done when:** services query transit patterns without parsing GTFS themselves.

### 07 — Replaceable deadhead and return routing

**Scope:** SPEC section 6.5.

- Implement RoutingService returning path, distance, and duration; initial routing
  may use a labeled straight-line approximation and configurable positive speed.
- Keep geometry order and units consistent, handle coincident endpoints, and
  expose provider/approximation provenance for evidence and demo labels.

**Verify:** distance sanity, timing, invalid coordinates/speed, identical points,
and valid nonempty GeoJSON paths.
**Done when:** switching providers does not require changes to dispatch logic.

### 08 — Fleet configuration, route loads, and capacity evidence

**Scope:** SPEC sections 6.2–6.3, 9.8, 11.

- Validate depot/route-sourced fleet definitions, capacity, starting/home locations,
  and donor eligibility against transit/data references.
- Provide deterministic initial fleet construction for startup and seek.
- Map TSPR day-type/period loads with TSPR_2025_TYPICAL basis. Implement shared
  thresholds and null behavior; low load alone must not create spare buses.
- Define/version the recipient and donor before/after capacity calculation before
  claiming load reductions. Missing inputs yield explicit nulls and explanation.
- Produce forecast/load evidence structures consumed by proposal assembly.

**Verify:** source discriminators, no inferred vehicles, above-100% loads, missing
statistics, capacity accounting, and stable fleet construction.
**Done when:** proposals can identify where a real configured simulated bus comes
from and substantiate its capacity impact. Real fleet configuration is a team gate.

### 09 — As-of demand, origins, and surge detection

**Scope:** SPEC sections 4, 5.1, 6.2.

- Select forecast vintages available by the captured simulation time. Implement
  stable surge-window grouping/identity and revision deduplication.
- Attach baseline, peak-hour magnitude, origin shares, drivers known at issuance,
  and deterministic severity/lead time. Preserve selected target/vintage internally.
- Advance UPCOMING/ACTIVE/RESOLVED phases and reveal actuals only after resolution,
  for the same target hour used in the forecast magnitude.
- Build shared demand queries with current-hour masking, sample/null handling,
  and no future origin/baseline reads. Add hourly boundary callbacks to 05.

**Verify:** exact boundaries, duplicate/revised vintages, no future leakage,
peak-hour ties, empty destinations, missing actuals, and non-hub default exclusion.
**Done when:** an explicit fixture or real adapter can drive truthful hub demand
and eligible surges without using retrospective indexes for detection.

### 10 — Route matching and feasible departure candidates

**Scope:** SPEC sections 6.1–6.2.

- Match boarding and later destination stops; require evidence for transfer
  connections rather than treating a regional centroid as a direct destination.
- Score normalized proximity, destination shares, schedule gap, and deadhead
  components with configured weights and stable route/pattern/bus ties.
- Choose a departure near the surge start with separation from scheduled and
  committed additional trips. Document missing-adjacent-service policy.
- Consider AVAILABLE buses only; enforce arrival before departure and strictly
  before the surge. Require a positive approval window before dispatch.
- Return typed candidates and precise failure reasons without mutating state.

**Verify:** reverse-direction rejection, radius limits, weighted coverage, schedule
gaps, competing departures, unreachable buses, ties, and deadline equality.
**Done when:** a deterministic feasible plan includes paths, all four movement
times, capacity evidence, and internal decision scores.

### 11 — Atomic proposals and reservations

**Scope:** SPEC sections 5, 6.2–6.3.

- Assemble canonical PROPOSED trips with rationale/evidence, reserve buses, and
  link surges in one commit. Publish trip/bus/surge events in defined order.
- Support capped multiple trips per surge, accounting for existing commitments.
  Do not derive bus counts by interpreting pings as passengers.
- Enforce stable proposal identity on repeated ingestion and map precise internal
  failure reasons to public v2 statuses. Implement surge status precedence.

**Verify:** competing proposals, multi-trip links, no double reservation, caps,
duplicate input, no partial state/events, and public failure-state mapping.
**Done when:** the engine proposes and reserves but cannot move an unapproved bus.

### 12 — Human decisions, expiry, and alternative proposals

**Scope:** SPEC sections 6.3, 7.

- Serialize approve/reject with expiry; require matching epoch before looking up
  state conflicts, and expire at equality before processing approval.
- Default expiry to min(proposed_at + 30 minutes, dispatch_time). Pause freezes it.
- Keep approved future buses RESERVED with assigned rather than proposed links.
  Implement idempotent APPROVED approval without duplicate events.
- Release rejected/expired reservations, retain rationale/audit, and produce
  bounded distinct alternatives with replaces_trip_id. Add cancellation of
  approved pre-service trips; movement consequences are completed in 13.
- Register auto-pause on newly proposed trips at the exact simulated instant.

**Verify:** approve/expiry races, double clicks, stale epochs, rejection conflicts,
alternative exhaustion, link transitions, cancellation, and 3600x auto-pause.
**Done when:** no lifecycle bypass can dispatch before human approval.

### 13 — Movement, service, and return lifecycle

**Scope:** SPEC sections 6.3–6.5.

- Start deadhead at dispatch_time, wait after arrival, run shifted GTFS timing
  after departure, and mark service completion independently of bus return.
- Interpolate location/heading and normalized service progress; derive current
  and next stops for TripDetail.
- Return completed/cancelled moved buses home before clearing assignments;
  unmoved cancellation releases immediately. In-service trips finish.
- Register all boundaries with 05, generate canonical events, and expose a
  telemetry sampling hook without making movement depend on broadcast cadence.

**Verify:** deferred movement, zero-duration waiting, identical path points,
large jumps, heading/progress, completion, cancellation return, and final cleanup.
**Done when:** approval can run a full service/return cycle using a fake clock.

### 14 — Atomic deterministic seek

**Scope:** SPEC section 6.4.

- Build a replacement state at T from pinned data/configuration, reset buses,
  discard user decisions, and recreate not-ended surges detected by T.
- Repropose feasible UPCOMING windows with proposed_at = T and a fresh valid
  deadline. Never give an active window a new pre-surge proposal.
- Preserve speed/status/settings; suppress reconstruction auto-pause and creation
  event floods. Swap once, increment epoch once, and emit state.reset.
- Keep original state on invalid range, missing data, or construction failure.
  Reuse the pure builder for non-current hub status reads without committing it.

**Verify:** same-T domain equality excluding epoch/seq, backward/forward seek,
discarded decisions, failed rebuild rollback, racing approval, and running seek.
**Done when:** seek is reproducible for any supported T, not just the start preset.

## 6. Frontend-facing interfaces

### 15 — Core REST, metadata, and atomic snapshots

**Scope:** SPEC sections 7, 9.1–9.2, 11.

- Expose `/meta`, `/hubs`, `/state`, `/surges`, `/buses`, `/additional-trips`,
  `/additional-trips/{trip_id}`, and `/simulation` under `/api/v1`.
- Add time/speed/settings PUTs, pause/resume POSTs, and approve/reject POSTs with
  exact response objects, filters, error codes, and nullable stale-conflict trip.
- Build snapshots atomically with epoch/last_seq. Share canonical serializers
  with mutation responses and the event payloads already produced by services.
- Publish actual bounds/configuration/provenance in meta, and `/readyz` component
  health. Keep suggested presets disabled or omitted until verified.
- Generate OpenAPI and contract fixtures for frontend integration.

**Verify:** every core endpoint, filters, errors, explicit nulls, cross-endpoint
entity equality, TripDetail extension, atomic watermark, and valid presets.
**Done when:** the UI can inspect/control a fixture-backed manual simulation using
the v2 contract; this is not yet a real-data demo completion claim.

### 16 — WebSocket transport and client resynchronization

**Scope:** SPEC section 10.

- Expose `/api/v1/ws/simulation` with allowed-origin validation and the complete
  typed event vocabulary, seq, epoch, simulation_time, and canonical upserts.
- Batch positions and limit ticks/positions to 4/s wall time; coalesce progress
  telemetry without dropping lifecycle or hourly transitions.
- Isolate slow/disconnected clients from simulation; require reconnect/refetch
  rather than a server replay buffer.
- Verify connect-buffer-snapshot ordering, filtering by watermark/epoch, reset
  during refetch, and fresh counter baselines after server restart.

**Verify:** bootstrap race, seek while fetching, event ordering, idempotent event
suppression, telemetry limits, multiple clients, and connection cleanup.
**Done when:** the UI reconstructs consistent state after reconnect and seek.

### 17 — Operational hub status, forecast, and origins reads

**Scope:** SPEC sections 9.3–9.5.

- Add `/hubs/{hub_id}/status`, `/forecast`, and `/origins` with captured/default at,
  range validation, and shared demand service semantics.
- Return HISTORY/CURRENT/FORECAST rows with exact requested historical vintage,
  latest available future issuance, offset-bearing time, and hour_complete.
- Mask partial actuals; preserve null missing vintages and unavailable-source
  errors. Never substitute a more informed forecast for a missing historic one.
- Return all 36 origins, correct regional denominators, null remote centroids,
  direct line keys, and low_sample behavior. Support actual/typical bases.
- Assemble live HubStatus counts/next surge; historical at uses the pure builder.

**Verify:** boundaries, DST buckets, forecast horizons/history limits, zero versus
missing input, source granularity, and REST/state/hourly-event HubStatus equality.
**Done when:** forecast and origin charts are supported without future actuals.

### 18 — Routes, loads, and map geometry

**Scope:** SPEC sections 8, 9.8.

- Expose `/routes`, `/routes/load`, and `/routes/{route_id}`; register load before
  the route-ID handler. Reuse shared load and configured fleet services.
- Support hub filtering, optional simplified LineString/MultiLineString shapes,
  null unrequested geometry, and full RouteRef fields.
- Implement dated departure windows, midnight crossing, hub catchment stop IDs,
  and disclosed representative schedules. Preserve internal pattern detail.

**Verify:** route ID named load handling, shape size, no disconnected joins,
explicit/default windows, >24-hour departures, and available spare counts.
**Done when:** maps and need-versus-spare views use traceable transit/load data.

### 19 — Timeline, hourly profile, and late-night views

**Scope:** SPEC sections 9.6, 9.9–9.10.

- Add `/timeline`, hub `/hourly-profile`, and hub `/late-night` through existing
  gold/query logic mapped to exact v2 response models.
- Label centered daily indexes as retrospective and keep them out of runtime
  surge decisions. Zero-fill valid profiles to exactly 24 typical hours.
- Select current/next night, preserve DST instant buckets, mask incomplete/future
  actuals, and compute daily-share denominators from as-of actuals/forecasts.
- Keep top_nights explicitly retrospective; missing forecast coverage yields
  null shares rather than future observed totals. Label typical GTFS supply.

**Verify:** 05:00 rollover, DST nights, missing denominators, zero total, valid
profile zero-fill versus absent artifacts, and retrospective labeling/isolation.
**Done when:** priority-two planning and timeline panels have truthful data.

### 20 — Events, findings, recommendations, and model proof reads

**Scope:** SPEC sections 9.7, 9.11–9.16.

- Add `/events`, hub `/overview`, `/route-crowding`, `/recommendations`, plus
  `/findings`, `/backtest`, and `/validation` with explicit response schemas.
- Preserve per-KPI source/period, crowding sort/null rules, valid unambiguous
  recommendation seek links, and versioned scenarios.ts findings.
- Implement curated event ingestion with source URLs/known-at metadata; empty
  results are valid until curation is supplied.
- Serve evaluation artifacts through 03, returning BACKTEST_UNAVAILABLE when
  absent. Return computed validation profiles/correlations, not draft constants.

**Verify:** endpoint schemas, deterministic ordering, evidence periods, seek-link
bounds, event overlap/filtering, and missing-artifact errors. Fixture tests do not
certify real metrics.
**Done when:** remaining panels and proof APIs expose the prescribed contracts.

## 7. Integration, rollout, and acceptance

### 21 — Real-data integration and readiness gate

**Scope:** SPEC sections 4, 11, 13.3.

- Load actuals, origins, baselines, forecast vintages, evaluation outputs, and
  existing gold outputs through the adapters; pin the snapshot, GTFS mapping,
  model version, evaluation period, and configured real demo fleet.
- Validate table/schema mappings, all analytical queries, coverage, and source
  attribution. Distinguish optional missing analytics from simulation blockers.
- Select actual usable bounds and verified demo presets that produce feasible
  proposals with the chosen model/fleet. Refresh meta from those artifacts.
- Exercise provider loss: retain cached coverage, expose degraded health, return
  explicit missing-data errors, and roll back failed seeks without state loss.

**Verify:** a real historical forecast drives a proposal, all required panels use
real/versioned artifacts, no mock fallback occurs, and evaluation is reproducible.
**Done when:** the full simulation and analytics run with real exported or live
Databricks-backed inputs. A cached exported snapshot is valid real data, not a mock.

### 22 — Reproducible demo, CI, and final acceptance

**Scope:** SPEC sections 11–12.

- Automate the end-to-end scenario: paused startup, forecast/origins, proposal
  auto-pause, preview, rejection/alternative, approval, deferred deadhead, service,
  return, actual resolution, seek, reconnect, and scorecard.
- Retain a small explicit offline fixture test suite as well as instructions for
  reproducing the real snapshot/demo. Document commands, versions, and setup.
- Finish structured logs, graceful shutdown, readiness, source attribution,
  single-worker deployment, and HTTPS/WSS configuration if hosting is selected.
- Add CI for lint/format/strict typing/tests, Docker build, and OpenAPI breaking
  change checks. Confirm the frontend mocks/client incorporate SPEC 13.2 changes.

**Done when:** SPEC 12.2 is reproducible, required checks pass, a fresh developer
can run the demo, and the team can trace every displayed recommendation/metric
to its source artifact and method.

## 8. Checkpoints and scope control

| Checkpoint | Required work | What it proves |
|---|---|---|
| A — V2 foundation | 01–09 using explicit fixtures | Canonical models, coordinator, clock, data/transit interfaces, and as-of demand |
| B — Manual replay engine | A + 10–14 | Propose/approve/reject/expire/move/return/seek with deterministic state |
| C — Priority-one frontend demo | B + 15–17 and verified real inputs/preset | Interactive real hourly forecast, origins, manual dispatch, and reconnect/seek |
| D — Planning and proof | C + 18–20 | Maps/loads, timeline, planner, late-night, findings, and real scorecard |
| E — Delivery-ready | D + 21–22 | Full integration, degradation behavior, reproducibility, and CI |

For the fastest useful slice, exercise one hub, one eligible pattern, and a small
explicit fleet through chunks 01–17. Use the same v2 interfaces for fixtures and
real inputs, then expand coverage to all three hubs. Do not
mistake a fixture-only Checkpoint B for the real-data Checkpoint C.

If time is short, prioritize SPEC 12.1: finish the priority-one slice first, then
routes/load, timeline, hourly profile, late-night, and real backtest before the
remaining analytics. Within chunk 20, the backtest endpoint can be delivered
first. Keep incomplete features visibly unavailable rather than inventing data.

## 9. Decision register and frontend coordination

| Decision / input | Needed by | Action |
|---|---|---|
| Databricks profile and artifact destinations | 21 | Ask team; explicit profile, serverless, shared-workspace coordination |
| Timestamp ambiguity/source granularity | 09, 17, 21 | Record normalization and partial-hour policy |
| Model/training and baseline warm-up | 09, 17, 20, 21 | Choose/version method; derive actual replay coverage |
| Fleet count/capacity/source/locations | 08; real gate 21 | Supply explicit configuration, including donor eligibility |
| Before/after load model | 08, 11 | Document formula/inputs or expose null estimates with explanation |
| GTFS representative service-day mapping | 06 | Pin and disclose mapping outside feed validity |
| Approval timeout/mapping | 12 | Use spec default and RESERVED-until-dispatch behavior; align frontend |
| Curated event owner/storage | 20 | Assign curator and source-backed CSV/table location |
| Frontend contract clarifications | 02, 15–17 | Sync mocks: hourly time keys, nullable partials, load >100, hour_complete, stale trip null, bootstrap buffering |
| Verified preset times | 21 | Demonstrate model-triggered feasible proposals before publishing presets |
| Hosting | 22 | Choose public HTTPS/WSS provider supporting one authoritative process |

Unresolved choices must not silently change SPEC.md. Record the agreed decision
there and update schemas, fixtures, and tests together when the contract changes.
