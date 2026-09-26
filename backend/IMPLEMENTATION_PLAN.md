# Surge Bus Backend Implementation Plan

This plan splits [`SPEC.md`](SPEC.md) into small, dependency-ordered changes. Each
chunk should leave the backend runnable and should be reviewable independently.
Do not start a later chunk by bypassing an unfinished dependency.

## Working Rules

- Keep each chunk focused on one capability and its tests.
- Use deterministic fixtures and a fake simulation clock. Tests must not sleep.
- Keep FastAPI handlers thin; domain behavior belongs in domain and service code.
- Validate external data at integration boundaries.
- Run `ruff check`, `ruff format --check`, `mypy --strict`, and `pytest` after each
  chunk once those tools are introduced.
- Preserve the existing `/api/health` route until the frontend migrates to
  `/healthz`, or change both services in the same chunk.

## Dependency Map

```text
01 scaffold
 |-- 02 domain primitives
 |    |-- 03 repositories and fleet
 |    |-- 04 simulation clock
 |    `-- 05 prediction boundary
 |-- 06 GTFS parsing
 |    `-- 07 transit index
 `-- 08 simple routing

02 + 07 --> 09 route matching
04 + 07 --> 10 schedule gap and departure
03 + 08 + 10 --> 11 bus assignment
05 + 09 + 10 + 11 --> 12 dispatch orchestration
04 + 08 + 12 --> 13 movement and lifecycle
03..13 --> 14 REST API
13 + 14 --> 15 WebSocket updates
05 + 12 --> 16 Databricks adapter
01..16 --> 17 hardening and demo scenario
```

Chunks 03 through 08 can be developed in parallel after their listed
dependencies are complete. Chunks 09 and 10 can also be developed in parallel.

## Chunk 01: Python Service Scaffold

**Goal:** Replace the Node placeholder with the required Python/FastAPI runtime.

- Add `pyproject.toml` with locked application and development dependencies.
- Add `app/main.py` with `GET /healthz` and temporary `GET /api/health` support.
- Add typed settings for `APP_ENV` and `FRONTEND_ORIGIN`.
- Configure Ruff and strict mypy.
- Replace the Dockerfile with a non-root Python image, health check, and ASGI
  startup command.
- Add a minimal FastAPI test and document local commands.

**Done when:** Docker Compose starts, both health routes return 200, and lint,
format, type-check, and test commands pass.

## Chunk 02: Domain Primitives

**Goal:** Establish dependency-free, validated domain types.

- Add typed IDs, `GeoPoint`, GeoJSON `LineString`, and timezone-aware datetime
  validation.
- Add bus, prediction, transit route, service pattern, scheduled trip,
  additional trip, progress, and dispatch decision models and enums.
- Encode invariants that can be enforced within one entity.
- Keep domain models independent of FastAPI and integration libraries.

**Tests:** invalid coordinates, naive datetimes, invalid progress, empty
destinations, GeoJSON longitude/latitude ordering, and valid model construction.

## Chunk 03: In-Memory Repositories and Fleet

**Goal:** Create replaceable storage interfaces and initialize spare buses.

- Define repository protocols for buses, predictions, and additional trips.
- Implement in-memory repositories with deterministic list ordering.
- Add typed fleet settings and default-depot initialization.
- Enforce one active assignment per bus and assignment only to `AVAILABLE` buses.

**Tests:** fleet size/configured locations, get/list/not-found behavior, stable
ordering, assignment conflicts, and repository reset.

## Chunk 04: Simulation Clock

**Goal:** Make simulated time controllable without using wall-clock time in
business logic.

- Define `SimulationClock` and a controllable fake clock.
- Implement start, pause, resume, reset, and positive bounded speed changes.
- Isolate the monotonic wall-clock dependency inside the production clock.
- Add simulation state models and service methods, but not HTTP routes yet.

**Tests:** acceleration, pause, resume, reset, speed validation, and timezone
preservation. No test may use `sleep()`.

## Chunk 05: Prediction Boundary

**Goal:** Normalize and safely retain predictions independently of Databricks.

- Define the `PredictionSource` protocol.
- Implement static and mock prediction sources.
- Generate a stable prediction ID when the source does not supply one.
- Add prediction statuses and per-run duplicate evaluation protection.
- Preserve optional passenger count, confidence, and destination weights.

**Tests:** normalization, deterministic IDs, duplicate input, invalid input,
lookahead eligibility, and reset behavior.

## Chunk 06: GTFS File Parsing

**Goal:** Parse a fixed GTFS snapshot into validated records.

- Read routes, stops, trips, stop times, shapes, calendar, and calendar dates.
- Parse GTFS times beyond `24:00:00` as service-day offsets.
- Resolve active service for a configured simulation date.
- Filter to bus service and fail startup readiness on unusable GTFS data.
- Keep file and CSV concerns inside `integrations/gtfs`.

**Tests:** small fixture feed, calendar exceptions, malformed rows, missing files,
and after-midnight times.

## Chunk 07: Transit Index

**Goal:** Derive queryable service patterns and schedules from parsed GTFS data.

- Group trips by route, direction, ordered stop sequence, and shape.
- Build stop and route lookup indexes.
- Retain a timing template for each service pattern.
- Expose relevant scheduled departures without exposing mutable GTFS records.
- Ensure deterministic pattern IDs and result ordering.

**Tests:** pattern grouping, variants, directions, stop order, shape construction,
scheduled departures, and immutability at the service boundary.

## Chunk 08: Simple Routing Service

**Goal:** Provide replaceable deadhead and return routing for the MVP.

- Define the `RoutingService` protocol and typed `RoutingResult`.
- Implement straight-line geometry, haversine distance, and duration from a
  configured speed.
- Reject invalid speed and invalid locations.

**Tests:** distance sanity, endpoint ordering, duration, identical points, and
GeoJSON coordinate ordering.

## Chunk 09: Route Matching and Scoring

**Goal:** Find and rank service patterns that carry demand in the right direction.

- Find nearby origin stops within the configured radius.
- Find later destination stops within the configured radius.
- Support multiple weighted destinations.
- Calculate configured origin-proximity and destination-coverage components.
- Return all candidate score details with deterministic tie-breaking.

**Tests:** origin selection, destination selection, destination-before-origin
rejection, direction correctness, radius boundaries, weighted coverage, scoring,
and ties.

## Chunk 10: Schedule Gap and Departure Selection

**Goal:** Place a one-time departure around a surge without duplicating service.

- Find scheduled departures immediately around the target time.
- Apply minimum separation on both sides of the gap.
- Select the feasible instant closest to the predicted surge time.
- Enforce the maximum allowed difference from the surge time.
- Return a typed no-feasible-departure result instead of raising an incidental
  error.

**Tests:** centered surge, boundary clamping, exact scheduled time, insufficient
gap, missing previous/next service policy, and after-midnight service.

## Chunk 11: Bus Feasibility and Assignment

**Goal:** Select the available bus that can reach the service start in time.

- Route each available bus to the selected start stop.
- Reject non-available and late-arriving buses.
- Select shortest deadhead duration, then bus ID.
- Return the selected bus and its calculated deadhead path atomically enough for
  the in-memory implementation.

**Tests:** busy bus rejection, unreachable bus rejection, closest feasible bus,
deterministic tie, exact-time arrival, and no-bus-available result.

## Chunk 12: Dispatch Orchestration

**Goal:** Convert one actionable prediction into one explainable assignment.

- Coordinate matching, scoring, schedule-gap selection, and bus assignment.
- Include schedule-gap and deadhead components in final route scoring.
- Persist `DispatchDecision`, `AdditionalTrip`, and linked surge/bus updates.
- Produce explicit statuses for no route, no bus, and no feasible departure.
- Make repeated evaluation of the same prediction idempotent.
- Roll back or avoid partial state changes when creation fails.

**Tests:** successful dispatch, every failure status, duplicate evaluation,
deterministic replay, competing predictions, and no partial writes.

## Chunk 13: Movement and Bus Lifecycle

**Goal:** Advance assigned buses through deadhead, service, and return travel.

- Interpolate positions by distance along path geometry.
- Shift GTFS relative stop timing to the additional departure.
- Implement `DEADHEADING -> WAITING -> IN_SERVICE -> RETURNING -> AVAILABLE`.
- Generate the return-to-home path through `RoutingService`.
- Prevent early service, invalid transitions, and completed-trip reactivation.
- Expose current/next stops and normalized progress.

**Tests:** interpolation, zero-length segments, exact transition boundaries,
zero-duration waiting, service completion, return to depot, large time jumps,
pause behavior, and final assignment cleanup.

## Chunk 14: REST API and Read Models

**Goal:** Expose complete snapshots without moving business logic into handlers.

- Add explicit request/response schemas separate from domain entities.
- Add simulation, surge, bus, trip, route, `/state`, and `/readyz` endpoints.
- Add development-only surge injection guarded by `APP_ENV`.
- Add consistent not-found, conflict, validation, and integration error responses.
- Restrict CORS to configured frontend origins.

**Tests:** endpoint contracts, snake_case JSON, timezone serialization, production
injection rejection, error envelope, state snapshot consistency, and OpenAPI
generation.

## Chunk 15: WebSocket Updates

**Goal:** Stream incremental changes after the frontend loads `/state`.

- Add `/api/v1/ws/simulation` and a typed event envelope.
- Publish surge, dispatch, trip, availability, and throttled position events.
- Keep event generation separate from WebSocket connection management.
- Handle disconnects without affecting simulation state.

**Tests:** event schemas and ordering, simulation timestamps, disconnected
clients, multiple clients, and position update throttling.

## Chunk 16: Databricks Prediction Adapter

**Goal:** Load real predictions without coupling the application to a Databricks
schema or allowing failures to corrupt a run.

- Add typed Databricks settings and secret-safe logging.
- Map query rows to normalized predictions at the adapter boundary.
- Validate every row before repository insertion.
- Report adapter readiness/degradation.
- Retain already loaded predictions when a later load fails.
- Never fall back to mock data unless mock mode is explicitly configured.

**Tests:** row mapping, optional fields, invalid rows, connection/query failure,
duplicate rows, degraded readiness, and retained state.

## Chunk 17: Hardening and Reproducible Demo

**Goal:** Prove the complete definition of done with one deterministic scenario.

- Add a compact GTFS fixture and prediction fixture for the specification's
  end-to-end scenario.
- Exercise prediction evaluation, dispatch, movement, service, return, and reset.
- Add structured logs for the events listed in the specification.
- Verify readiness behavior and graceful shutdown.
- Add CI for formatting, linting, strict typing, tests, Docker build, and OpenAPI
  contract generation.
- Document exact demo startup, fixture, API, and reset commands.

**Done when:** The same inputs produce the same route, bus, departure, events, and
final state across repeated runs, all checks pass, and the Docker demo can be run
without Databricks.

## MVP Checkpoints

### Checkpoint A: Reliable Foundation

Complete chunks 01-08. The service starts in Docker and can load predictions,
fleet state, GTFS data, and calculate simple paths, but does not dispatch yet.

### Checkpoint B: Headless Dispatch Demo

Complete chunks 09-12. A deterministic test can turn a prediction into an
explainable additional trip with a selected route, departure, and bus.

### Checkpoint C: Frontend-Ready Simulation

Complete chunks 13-15. The frontend can bootstrap through `/state`, inspect route
and trip details, control simulation time, and receive live updates.

### Checkpoint D: Integrated Demo

Complete chunks 16-17. Databricks input is supported, failures are visible and
safe, and the complete reproducible demo and CI checks pass.

## Suggested First Vertical Slice

For the fastest visible result, implement chunks 01-05, then use hard-coded
domain fixtures temporarily in tests while completing 06-13. Do not add fixture
data as a silent runtime fallback. The first meaningful demo target is Checkpoint
B; API breadth before the dispatch core would create endpoints backed by fake or
unstable behavior.
