# Surge Bus Dispatch Backend
## Technical Specification — v1.0

## 1. Purpose

The backend simulates a transit operator dynamically deploying a configurable fleet of additional buses in response to predicted demand surges.

Demand predictions come from Databricks and contain:

- where a surge is predicted;
- when it is predicted;
- where passengers are predicted to travel.

The backend combines those predictions with TransLink's published transit network and schedule data to determine:

1. which existing bus route best serves the predicted demand;
2. when an additional one-time departure should occur;
3. which available simulated bus should operate it;
4. how that bus travels from its current location to the route;
5. how the bus progresses through the additional trip;
6. where the bus goes after completing the trip.

The frontend consumes the resulting simulation state and visualizes the predicted surge, selected route, additional departure, bus movement, and predicted destinations.

The backend is authoritative for simulation state and dispatch decisions.

---

## 2. Confirmed Requirements

The following are requirements provided for the project.

### Prediction input

Predictions originate from a Databricks table and/or model.

For each surge, the backend receives:

```text
surge location
estimated surge time
predicted destination
```

A prediction may potentially contain more than one predicted destination.

### Scheduling

The system determines which existing bus route should receive an additional bus.

The additional bus operates as a one-time additional departure around the existing scheduled service.

The additional trip does not modify or replace the published TransLink schedule.

### Fleet

The system has a configurable number of additional buses.

Buses may initially be at a depot or another configured location.

The system dispatches a bus, tracks it through its assignment, and then returns or repositions it.

### Simulation

The backend simulates time.

It tracks:

```text
current simulation time
bus locations
bus states
surge predictions
additional trips
trip progress
```

### Frontend output

The frontend must be able to display:

```text
additional departure time
assigned bus
current bus location
path from current bus location to service
selected bus route
route geometry
predicted surge location
predicted destination(s)
trip status
trip progress
```

### Technology

The backend will use:

```text
Python
FastAPI
Pydantic
strict static typing
Docker
```

The codebase must contain guardrails for AI-assisted development.

---

## 3. Explicit MVP Assumptions

These are implementation assumptions, not facts supplied by the prediction model.

They should be easy to change later.

### 3.1 Spare buses are simulated

The additional buses belong to our simulated fleet.

They are not intended to represent actual spare TransLink vehicles.

Example:

```text
bus-001
bus-002
bus-003
bus-004
bus-005
```

The number of buses is configurable.

### 3.2 Transit routes are real TransLink routes

Route, stop, geometry, and schedule information comes from TransLink GTFS Static data.

The backend does not manually hard-code TransLink routes.

### 3.3 Existing scheduled buses are not simulated

The system uses scheduled trips to understand existing service intervals, but does not need to animate every regularly scheduled TransLink bus.

Only the additional fleet needs to be simulated.

### 3.4 An additional bus follows an existing service pattern

For the MVP, an additional trip follows an existing GTFS route/direction/stop pattern.

It does not invent a completely new passenger route.

A route may have multiple directions or variants, so a dispatch identifies both the route and the selected service pattern.

### 3.5 Additional trips run between scheduled trips

The system attempts to place an additional departure between two existing scheduled departures.

It should avoid creating a departure effectively simultaneous with an existing scheduled trip.

Minimum separation from scheduled service is configurable.

### 3.6 Buses normally return to their home location

The default post-trip policy is:

```text
complete service
    ↓
return to home depot/location
    ↓
AVAILABLE
```

The architecture must also permit future repositioning policies.

### 3.7 Predictions may not contain passenger counts

Passenger count and prediction confidence are useful but are not required.

Required prediction information is limited to:

```text
location
time
destination(s)
```

If passenger count or confidence is available, the backend preserves it.

### 3.8 Databricks does not have to provide an ID

If Databricks provides a unique prediction ID, it is used.

Otherwise the backend generates a deterministic prediction key from the source data so that the same prediction cannot accidentally create multiple dispatches.

---

## 4. Non-Goals for MVP

The MVP does not attempt to:

- model the entire real TransLink vehicle fleet;
- reproduce actual TransLink depot operations;
- perform globally optimal fleet scheduling;
- predict passenger demand itself;
- modify the underlying TransLink schedule;
- simulate traffic at high physical fidelity;
- model drivers, shifts, breaks, fuel, charging, maintenance, or labour rules;
- automatically dispatch real vehicles;
- depend on TransLink GTFS-Realtime;
- use an LLM to make dispatch decisions.

The objective is a deterministic, explainable simulation of surge-responsive additional service.

---

## 5. System Architecture

```text
                  ┌────────────────────┐
                  │     Databricks     │
                  │ prediction output  │
                  └─────────┬──────────┘
                            │
                            ▼
                  ┌────────────────────┐
                  │ Prediction Adapter │
                  └─────────┬──────────┘
                            │
                            ▼
┌────────────────┐    ┌────────────────────┐
│ TransLink GTFS │───▶│   Dispatch Engine  │
│ Static         │    └─────────┬──────────┘
└────────────────┘              │
                                ▼
                      ┌────────────────────┐
                      │ Additional Trip    │
                      │     Created        │
                      └─────────┬──────────┘
                                │
                                ▼
                      ┌────────────────────┐
                      │ Simulation Engine  │
                      │                    │
                      │ buses              │
                      │ trip progress      │
                      │ simulation clock   │
                      └─────────┬──────────┘
                                │
                         REST + WebSocket
                                │
                                ▼
                      ┌────────────────────┐
                      │      Frontend      │
                      └────────────────────┘
```

---

## 6. Data Sources

### 6.1 Databricks

Databricks supplies dynamic surge predictions.

The rest of the application must not directly depend on Databricks-specific schemas or APIs.

All Databricks output passes through:

```python
class PredictionSource(Protocol):
    async def load_predictions(
        self,
        start_time: datetime,
        end_time: datetime,
    ) -> list[SurgePrediction]:
        ...
```

Possible implementations:

```text
DatabricksTablePredictionSource
DatabricksModelPredictionSource
StaticPredictionSource
MockPredictionSource
```

This allows the simulation to operate without Databricks during development and testing.

---

## 7. Normalized Prediction Schema

The application converts Databricks rows into the following internal representation.

```python
class GeoPoint(BaseModel):
    lat: float
    lon: float


class PredictedDestination(BaseModel):
    location: GeoPoint
    weight: float | None = None


class SurgePrediction(BaseModel):
    id: str
    location: GeoPoint
    predicted_time: datetime
    predicted_destinations: list[PredictedDestination]

    predicted_passenger_count: int | None = None
    confidence: float | None = None
```

Required source information:

```text
surge location
predicted surge time
at least one predicted destination
```

Optional source information:

```text
prediction ID
estimated passenger count
confidence
destination weights/probabilities
```

All datetimes must be timezone-aware.

---

## 8. TransLink Transit Data

The backend uses TransLink GTFS Static as the source of truth for the transit network and scheduled service.

Required GTFS files include:

```text
routes.txt
stops.txt
trips.txt
stop_times.txt
shapes.txt
calendar.txt
calendar_dates.txt
```

Additional GTFS files may be parsed if useful.

The backend derives:

```text
bus routes
route names
directions
service patterns
stops
stop coordinates
stop ordering
route geometry
scheduled trip times
active service for the simulation date
```

Only bus service relevant to the simulation needs to be indexed.

GTFS service times greater than `24:00:00` must be handled correctly rather than parsed as ordinary clock times.

GTFS data should be loaded before the simulation starts.

For reproducible demos, the GTFS dataset must remain fixed for the duration of a simulation run.

---

## 9. GTFS-Realtime

GTFS-Realtime is not required.

The MVP does not use actual vehicle positions to populate the additional fleet.

Future versions may optionally consume:

```text
vehicle positions
trip updates
service alerts
```

through a separate integration layer.

No core domain logic may depend on GTFS-Realtime being available.

---

## 10. Core Domain Models

### 10.1 Bus

```python
class BusStatus(str, Enum):
    AVAILABLE = "AVAILABLE"
    DEADHEADING = "DEADHEADING"
    WAITING = "WAITING"
    IN_SERVICE = "IN_SERVICE"
    RETURNING = "RETURNING"
    REPOSITIONING = "REPOSITIONING"
```

```python
class Bus:
    id: BusId
    status: BusStatus
    capacity: int | None

    current_location: GeoPoint
    home_location: GeoPoint

    assigned_trip_id: AdditionalTripId | None
```

Invariant:

```text
A bus can have at most one active assignment.
```

---

## 11. Transit Route

A GTFS route alone is not sufficient because a route can have multiple directions and variants.

```python
class TransitRoute:
    id: RouteId
    short_name: str
    long_name: str | None
```

Example:

```text
Route:
99
```

---

## 12. Service Pattern

A service pattern identifies the actual direction and stop sequence the additional bus follows.

```python
class ServicePattern:
    id: ServicePatternId

    route_id: RouteId

    direction_id: int | None
    headsign: str | None

    stop_ids: list[StopId]

    shape: GeoJsonLineString
```

An additional bus is assigned to a service pattern, not merely a route number.

---

## 13. Stop

```python
class Stop:
    id: StopId
    name: str
    location: GeoPoint
```

---

## 14. Scheduled Trip

Represents existing GTFS service.

```python
class ScheduledTrip:
    id: ScheduledTripId
    route_id: RouteId
    service_pattern_id: ServicePatternId

    stop_times: list[ScheduledStopTime]
```

These records are read-only.

Dynamic dispatching must never mutate them.

---

## 15. Additional Trip

This is the central domain object produced by the backend.

```python
class AdditionalTripStatus(str, Enum):
    PLANNED = "PLANNED"
    BUS_EN_ROUTE = "BUS_EN_ROUTE"
    READY = "READY"
    IN_SERVICE = "IN_SERVICE"
    COMPLETED = "COMPLETED"
    RETURNING = "RETURNING"
    CANCELLED = "CANCELLED"
```

```python
class AdditionalTrip:
    id: AdditionalTripId

    surge_id: SurgePredictionId

    bus_id: BusId

    route_id: RouteId
    service_pattern_id: ServicePatternId

    departure_time: datetime
    estimated_completion_time: datetime

    service_start_stop_id: StopId
    service_end_stop_id: StopId

    status: AdditionalTripStatus

    deadhead_path: Path
    service_path: Path

    predicted_destinations: list[PredictedDestination]

    progress: TripProgress
```

---

## 16. Dispatch Decision

The system must retain why a route and bus were selected.

```python
class DispatchDecision:
    selected_route_id: RouteId
    selected_service_pattern_id: ServicePatternId
    selected_bus_id: BusId

    departure_time: datetime

    route_score: float

    candidate_scores: list[CandidateRouteScore]
```

This makes decisions reproducible and debuggable.

---

## 17. Simulation Clock

Simulation business logic must never directly use the wall clock.

Define:

```python
class SimulationClock(Protocol):
    def now(self) -> datetime:
        ...
```

Simulation state:

```python
class SimulationStatus(str, Enum):
    STOPPED = "STOPPED"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
```

The clock contains:

```text
current simulated time
simulation speed
simulation state
```

Examples:

```text
1x
10x
60x
300x
```

At 60x:

```text
1 real second = 1 simulated minute
```

Business logic must call:

```python
simulation_clock.now()
```

Never:

```python
datetime.now()
```

---

## 18. Prediction Processing

At simulation initialization, the backend loads predictions for the configured simulation window.

Example:

```text
simulation:
2026-09-26 15:00 → 21:00
```

The backend requests predictions covering that window.

Predictions remain `PENDING` until they enter the configurable dispatch lookahead window.

Example:

```text
simulation time:       17:00
surge time:            17:20
dispatch lookahead:    30 minutes

→ evaluate surge now
```

This makes replay deterministic.

Future implementations may poll Databricks continuously, but that is not required for the MVP.

---

## 19. Surge Status

```python
class SurgeStatus(str, Enum):
    PENDING = "PENDING"
    EVALUATING = "EVALUATING"
    DISPATCHED = "DISPATCHED"

    NO_MATCHING_ROUTE = "NO_MATCHING_ROUTE"
    NO_BUS_AVAILABLE = "NO_BUS_AVAILABLE"
    NO_FEASIBLE_DEPARTURE = "NO_FEASIBLE_DEPARTURE"

    EXPIRED = "EXPIRED"
```

---

## 20. Route Matching

For each surge, the dispatch engine identifies existing service patterns capable of carrying passengers from the surge area toward the predicted destination.

A candidate pattern must:

```text
have a stop sufficiently close to the surge location

AND

have a later stop sufficiently close to at least one predicted destination
```

The destination stop must occur after the origin stop in the selected service direction.

Distance thresholds are configurable.

Example:

```text
surge location
      │
      │ 140 m
      ▼
Route 25 Stop A
      │
      │
      │ existing route
      ▼
Route 25 Stop K
      │
      │ 200 m
      ▼
predicted destination
```

---

## 21. Route Scoring

Eligible patterns receive a deterministic score.

Relevant factors are:

```text
distance from surge to boarding stop
distance from route to predicted destination
number/weight of destinations served
gap in existing scheduled service
deadhead time for an available bus
```

If predicted passenger count is available, it may additionally influence dispatch priority.

The score must not depend on an LLM.

Configuration contains the scoring weights.

Example configuration structure:

```yaml
dispatch:
  weights:
    origin_proximity: 0.25
    destination_coverage: 0.35
    schedule_gap: 0.20
    deadhead_time: 0.20
```

The exact values are configuration, not business constants.

Changing weights must not require changing code.

---

## 22. Scheduled-Service Gap

For a candidate service pattern, determine the scheduled departures around the predicted surge.

Example:

```text
scheduled       17:10
surge           17:17
scheduled       17:20
```

The dispatch engine searches for a feasible additional departure within this interval.

An additional bus should not simply duplicate a scheduled departure.

Configurable parameters include:

```text
minimum separation from previous scheduled bus
minimum separation from next scheduled bus
maximum acceptable difference from predicted surge time
```

---

## 23. Additional Departure Selection

The preferred additional departure is the feasible time closest to the predicted surge time.

Conceptually:

```text
allowed interval:

previous scheduled departure
        +
minimum separation

          ↓

   [ feasible window ]

          ↑

next scheduled departure
        -
minimum separation
```

The selected time must also satisfy:

```text
assigned bus can reach the service starting point before departure
```

If no such time exists:

```text
NO_FEASIBLE_DEPARTURE
```

---

## 24. Bus Assignment

Only buses with:

```text
status == AVAILABLE
```

are candidates.

For every available bus, calculate:

```text
current location
        ↓
service starting location

deadhead path
deadhead distance
deadhead duration
arrival time
```

A bus is feasible only if:

```text
estimated arrival time <= additional departure time
```

Among feasible buses, the MVP selects the bus with the shortest deadhead time.

Tie-breaking must be deterministic, for example by bus ID.

---

## 25. Routing to Service

A routing abstraction determines how a bus moves from its current location to the selected route.

```python
class RoutingService(Protocol):
    async def get_path(
        self,
        origin: GeoPoint,
        destination: GeoPoint,
    ) -> RoutingResult:
        ...
```

Output:

```python
class RoutingResult:
    geometry: GeoJsonLineString
    distance_meters: float
    duration_seconds: float
```

The dispatch engine must not depend on a specific routing provider.

For the simplest demo implementation, a `SimpleRoutingService` may use a straight-line/polyline approximation plus configured travel speed.

It must be replaceable with a real road-routing service without changing dispatch logic.

---

## 26. Service Path

The passenger-service path comes from the selected GTFS service pattern.

It contains the relevant GTFS shape geometry.

The service path is distinct from the deadhead path.

```text
bus current position
        │
        │ deadhead_path
        ▼
service start
        │
        │ service_path
        ▼
route destination
```

The frontend receives both.

---

## 27. Bus Lifecycle

Normal lifecycle:

```text
AVAILABLE
   │
   │ assigned
   ▼
DEADHEADING
   │
   │ reaches service start
   ▼
WAITING
   │
   │ departure time
   ▼
IN_SERVICE
   │
   │ reaches final stop
   ▼
RETURNING
   │
   │ reaches home location
   ▼
AVAILABLE
```

If the bus reaches the service start exactly when service begins, the `WAITING` stage may effectively have zero duration.

---

## 28. Position Simulation

Every active bus has a time-indexed path.

The simulation engine calculates its position from:

```text
current simulation time
segment start time
segment end time
path geometry
```

Position is interpolated along the geometry.

The simulation's internal update interval and frontend update interval may differ.

For example:

```text
simulation calculation:
frequent internal ticks

frontend:
position update every configurable interval
```

No unit test should depend on real-time sleeping.

---

## 29. Service Timing

Where GTFS stop timing information is available, simulated trip progress should use the scheduled relative travel time between stops.

The additional trip may shift the original timing template to its new departure time.

Example GTFS pattern:

```text
Stop A     +00 min
Stop B     +04 min
Stop C     +09 min
Stop D     +14 min
```

Additional departure:

```text
17:16
```

Simulated times become:

```text
Stop A     17:16
Stop B     17:20
Stop C     17:25
Stop D     17:30
```

This preserves realistic route timing without needing to predict traffic.

---

## 30. Post-Trip Behaviour

Default:

```text
service ends
      ↓
RoutingService calculates path to home location
      ↓
RETURNING
      ↓
home location reached
      ↓
AVAILABLE
```

The architecture must permit later policies such as:

```text
remain at terminal
reposition to another depot
reposition toward expected demand
```

without modifying the basic simulation engine.

---

## 31. API Conventions

Base path:

```text
/api/v1
```

JSON uses snake_case.

All timestamps use ISO 8601 with timezone.

Coordinates use:

```json
{
  "lat": 49.123,
  "lon": -123.123
}
```

GeoJSON coordinates follow the GeoJSON convention:

```text
[longitude, latitude]
```

This distinction must be covered by tests.

---

## 32. `GET /api/v1/state`

### Purpose

Returns the complete current frontend simulation snapshot.

This is the primary frontend bootstrap endpoint.

### Response

```json
{
  "simulation": {
    "current_time": "2026-09-26T17:12:00-07:00",
    "speed": 60,
    "status": "RUNNING"
  },

  "surges": [
    {
      "id": "surge-123",

      "location": {
        "lat": 49.263,
        "lon": -123.115
      },

      "predicted_time": "2026-09-26T17:18:00-07:00",

      "predicted_destinations": [
        {
          "location": {
            "lat": 49.264,
            "lon": -123.249
          },
          "weight": null
        }
      ],

      "status": "DISPATCHED",

      "additional_trip_id": "trip-456"
    }
  ],

  "buses": [
    {
      "id": "bus-003",

      "status": "DEADHEADING",

      "location": {
        "lat": 49.250,
        "lon": -123.100
      },

      "assigned_trip_id": "trip-456"
    }
  ],

  "additional_trips": [
    {
      "id": "trip-456",

      "surge_id": "surge-123",

      "bus_id": "bus-003",

      "route_id": "route-id",

      "service_pattern_id": "pattern-id",

      "departure_time": "2026-09-26T17:16:00-07:00",

      "status": "BUS_EN_ROUTE"
    }
  ]
}
```

---

## 33. `GET /api/v1/surges`

### Purpose

Returns the normalized surge predictions being considered by the backend.

### Response

```json
[
  {
    "id": "surge-123",

    "location": {
      "lat": 49.263,
      "lon": -123.115
    },

    "predicted_time": "2026-09-26T17:18:00-07:00",

    "predicted_destinations": [
      {
        "location": {
          "lat": 49.264,
          "lon": -123.249
        },

        "weight": null
      }
    ],

    "predicted_passenger_count": null,
    "confidence": null,

    "status": "DISPATCHED",

    "additional_trip_id": "trip-456"
  }
]
```

---

## 34. `GET /api/v1/surges/{surge_id}`

### Purpose

Returns complete information and decision state for one surge.

### Response

```json
{
  "id": "surge-123",

  "location": {
    "lat": 49.263,
    "lon": -123.115
  },

  "predicted_time": "2026-09-26T17:18:00-07:00",

  "predicted_destinations": [
    {
      "location": {
        "lat": 49.264,
        "lon": -123.249
      },

      "weight": null
    }
  ],

  "status": "DISPATCHED",

  "additional_trip_id": "trip-456"
}
```

---

## 35. Development-Only `POST /api/v1/surges`

### Purpose

Injects a simulated prediction without Databricks.

This endpoint exists for development and demos.

It must be disabled in production mode.

### Request

```json
{
  "location": {
    "lat": 49.263,
    "lon": -123.115
  },

  "predicted_time": "2026-09-26T17:18:00-07:00",

  "predicted_destinations": [
    {
      "location": {
        "lat": 49.264,
        "lon": -123.249
      }
    }
  ]
}
```

### Response

The created `SurgePrediction`.

---

## 36. `GET /api/v1/buses`

### Purpose

Returns the simulated additional fleet.

### Response

```json
[
  {
    "id": "bus-001",

    "status": "AVAILABLE",

    "location": {
      "lat": 49.273,
      "lon": -123.101
    },

    "home_location": {
      "lat": 49.273,
      "lon": -123.101
    },

    "assigned_trip_id": null
  },

  {
    "id": "bus-003",

    "status": "IN_SERVICE",

    "location": {
      "lat": 49.261,
      "lon": -123.142
    },

    "home_location": {
      "lat": 49.273,
      "lon": -123.101
    },

    "assigned_trip_id": "trip-456"
  }
]
```

---

## 37. `GET /api/v1/buses/{bus_id}`

### Purpose

Returns detailed information about one simulated bus.

### Response

```json
{
  "id": "bus-003",

  "status": "IN_SERVICE",

  "location": {
    "lat": 49.261,
    "lon": -123.142
  },

  "home_location": {
    "lat": 49.273,
    "lon": -123.101
  },

  "assigned_trip_id": "trip-456",

  "trip_progress": {
    "percent_complete": 0.42,
    "current_stop_id": "stop-A",
    "next_stop_id": "stop-B"
  }
}
```

---

## 38. `GET /api/v1/additional-trips`

### Purpose

Returns one-time additional trips generated by the dispatch engine.

### Response

```json
[
  {
    "id": "trip-456",

    "surge_id": "surge-123",

    "bus": {
      "id": "bus-003"
    },

    "route": {
      "id": "route-id",
      "short_name": "25",
      "headsign": "Destination"
    },

    "departure_time": "2026-09-26T17:16:00-07:00",

    "estimated_completion_time": "2026-09-26T18:02:00-07:00",

    "status": "BUS_EN_ROUTE",

    "surge_location": {
      "lat": 49.263,
      "lon": -123.115
    },

    "predicted_destinations": [
      {
        "location": {
          "lat": 49.264,
          "lon": -123.249
        },

        "weight": null
      }
    ],

    "deadhead_path": {
      "type": "LineString",
      "coordinates": [
        [-123.100, 49.250],
        [-123.115, 49.263]
      ]
    },

    "service_path": {
      "type": "LineString",
      "coordinates": []
    },

    "progress": {
      "percent_complete": 0.0
    }
  }
]
```

This endpoint directly supplies the core information required by the frontend.

---

## 39. `GET /api/v1/additional-trips/{trip_id}`

### Purpose

Returns detailed information about a particular additional bus assignment.

### Response

```json
{
  "id": "trip-456",

  "surge_id": "surge-123",

  "bus": {
    "id": "bus-003",

    "current_location": {
      "lat": 49.258,
      "lon": -123.121
    }
  },

  "route": {
    "id": "route-id",
    "short_name": "25",
    "long_name": "Example Route",

    "direction_id": 0,
    "headsign": "Destination"
  },

  "departure_time": "2026-09-26T17:16:00-07:00",

  "estimated_completion_time": "2026-09-26T18:02:00-07:00",

  "status": "BUS_EN_ROUTE",

  "surge": {
    "location": {
      "lat": 49.263,
      "lon": -123.115
    },

    "predicted_time": "2026-09-26T17:18:00-07:00",

    "predicted_destinations": [
      {
        "location": {
          "lat": 49.264,
          "lon": -123.249
        }
      }
    ]
  },

  "deadhead_path": {
    "type": "LineString",
    "coordinates": []
  },

  "service_path": {
    "type": "LineString",
    "coordinates": []
  },

  "progress": {
    "percent_complete": 0.18,

    "current_stop_id": "stop-A",
    "next_stop_id": "stop-B"
  },

  "decision": {
    "route_score": 0.84,

    "reason_components": {
      "origin_proximity": 0.92,
      "destination_coverage": 0.88,
      "schedule_gap": 0.74,
      "deadhead_time": 0.80
    }
  }
}
```

---

## 40. `GET /api/v1/routes`

### Purpose

Returns lightweight TransLink bus route information derived from GTFS.

### Response

```json
[
  {
    "id": "route-id",
    "short_name": "25",
    "long_name": "Example Route"
  }
]
```

This endpoint should not return the full GTFS dataset.

---

## 41. `GET /api/v1/routes/{route_id}`

### Purpose

Returns the service patterns, stops, shapes, and relevant scheduled departures for one route.

### Response

```json
{
  "id": "route-id",

  "short_name": "25",
  "long_name": "Example Route",

  "service_patterns": [
    {
      "id": "pattern-id",

      "direction_id": 0,
      "headsign": "Destination",

      "stops": [
        {
          "id": "stop-A",

          "name": "Example Stop",

          "location": {
            "lat": 49.263,
            "lon": -123.115
          }
        }
      ],

      "shape": {
        "type": "LineString",
        "coordinates": []
      },

      "scheduled_departures": [
        {
          "trip_id": "gtfs-trip-1",
          "departure_time": "2026-09-26T17:10:00-07:00"
        },

        {
          "trip_id": "gtfs-trip-2",
          "departure_time": "2026-09-26T17:20:00-07:00"
        }
      ]
    }
  ]
}
```

---

## 42. `GET /api/v1/simulation`

### Purpose

Returns simulation clock information.

### Response

```json
{
  "current_time": "2026-09-26T17:12:00-07:00",
  "speed": 60,
  "status": "RUNNING"
}
```

---

## 43. `POST /api/v1/simulation/start`

### Purpose

Starts a simulation.

### Request

```json
{
  "start_time": "2026-09-26T15:00:00-07:00"
}
```

`start_time` may be optional if configured server-side.

### Response

```json
{
  "current_time": "2026-09-26T15:00:00-07:00",
  "speed": 60,
  "status": "RUNNING"
}
```

---

## 44. `POST /api/v1/simulation/pause`

### Purpose

Pauses simulated time.

### Response

Returns simulation state.

---

## 45. `POST /api/v1/simulation/resume`

### Purpose

Resumes simulated time.

### Response

Returns simulation state.

---

## 46. `POST /api/v1/simulation/reset`

### Purpose

Returns the simulation to its configured initial state.

Reset:

```text
simulation time
bus locations
bus statuses
dispatches
trip progress
surge processing states
```

Predictions and static GTFS data are reloaded or restored as appropriate.

---

## 47. `PUT /api/v1/simulation/speed`

### Request

```json
{
  "speed": 60
}
```

### Response

```json
{
  "current_time": "2026-09-26T17:12:00-07:00",
  "speed": 60,
  "status": "RUNNING"
}
```

Speed must be positive and constrained by configurable maximums.

---

## 48. `WS /api/v1/ws/simulation`

### Purpose

Provides incremental real-time updates after the frontend retrieves `/state`.

Frontend flow:

```text
GET /api/v1/state
        ↓
render initial state
        ↓
connect WebSocket
        ↓
apply incremental events
```

All WebSocket events use:

```json
{
  "type": "event.name",
  "simulation_time": "2026-09-26T17:13:20-07:00",
  "data": {}
}
```

---

## 49. WebSocket Events

### `bus.position_updated`

```json
{
  "type": "bus.position_updated",

  "simulation_time": "2026-09-26T17:13:20-07:00",

  "data": {
    "bus_id": "bus-003",

    "location": {
      "lat": 49.258,
      "lon": -123.121
    },

    "status": "DEADHEADING"
  }
}
```

### `surge.detected`

```json
{
  "type": "surge.detected",

  "simulation_time": "2026-09-26T17:05:00-07:00",

  "data": {
    "surge_id": "surge-123"
  }
}
```

### `dispatch.created`

```json
{
  "type": "dispatch.created",

  "simulation_time": "2026-09-26T17:05:01-07:00",

  "data": {
    "trip_id": "trip-456",
    "surge_id": "surge-123",
    "bus_id": "bus-003",
    "route_id": "route-id",

    "departure_time": "2026-09-26T17:16:00-07:00"
  }
}
```

### `trip.started`

```json
{
  "type": "trip.started",

  "simulation_time": "2026-09-26T17:16:00-07:00",

  "data": {
    "trip_id": "trip-456",
    "bus_id": "bus-003"
  }
}
```

### `trip.completed`

```json
{
  "type": "trip.completed",

  "simulation_time": "2026-09-26T18:02:00-07:00",

  "data": {
    "trip_id": "trip-456",
    "bus_id": "bus-003"
  }
}
```

### `bus.available`

Sent once the bus finishes returning/repositioning.

---

## 50. Error Response

All API errors use a consistent structure.

```json
{
  "error": {
    "code": "BUS_NOT_FOUND",
    "message": "Bus bus-999 does not exist.",
    "details": {}
  }
}
```

Typical HTTP statuses:

```text
400   invalid operation
404   entity not found
409   conflicting simulation state
422   schema validation error
503   external integration unavailable
```

Internal Python exceptions and stack traces must never be returned directly to clients.

---

## 51. Databricks Failure Behaviour

A Databricks failure must not crash an active simulation.

On load failure:

```text
log failure
mark prediction source unhealthy
retain existing loaded predictions
return integration health information
```

No new predictions are invented.

The system must not silently fall back to fake predictions except when explicitly running in mock/development mode.

---

## 52. Duplicate Prediction Protection

A prediction may only trigger dispatch evaluation once for a particular simulation run unless explicitly reset.

If Databricks supplies:

```text
prediction_id
```

use it.

Otherwise generate a stable hash from normalized source fields.

---

## 53. Core Invariants

The backend must enforce:

```text
One bus cannot have two active assignments.

Only AVAILABLE buses may receive new assignments.

An additional trip references exactly one surge.

An additional trip references exactly one bus.

Scheduled GTFS trips are immutable.

A duplicated prediction must not create duplicated dispatches.

A bus cannot enter service before reaching its service start location.

A bus cannot enter service before its departure time.

A COMPLETED trip cannot return to an active state.

Simulation logic must use SimulationClock.

External data must be validated before entering the domain layer.

A route candidate must serve origin before destination.

A bus must be able to reach the service start before the selected departure.

Databricks failure must not corrupt simulation state.
```

---

## 54. Configuration

Application configuration comes from environment variables and typed settings.

Suggested settings:

```text
APP_ENV

SIMULATION_START_TIME
SIMULATION_SPEED
SIMULATION_MAX_SPEED

FLEET_SIZE
DEFAULT_BUS_CAPACITY

DEFAULT_DEPOT_LAT
DEFAULT_DEPOT_LON

DISPATCH_LOOKAHEAD_MINUTES

ORIGIN_STOP_RADIUS_METERS
DESTINATION_STOP_RADIUS_METERS

MIN_SCHEDULE_SEPARATION_SECONDS

GTFS_SOURCE

DATABRICKS_HOST
DATABRICKS_HTTP_PATH
DATABRICKS_TOKEN
DATABRICKS_TABLE

FRONTEND_ORIGIN
```

Secrets must never be committed to source control.

---

## 55. Fleet Configuration

Individual buses may optionally have their own starting locations.

Example:

```yaml
fleet:
  buses:
    - id: bus-001
      home_location:
        lat: 49.1
        lon: -123.1

    - id: bus-002
      home_location:
        lat: 49.1
        lon: -123.1
```

If individual locations are omitted, all buses use the default depot.

---

## 56. Persistence

MVP simulation state may remain in memory.

This includes:

```text
buses
surges
additional trips
current simulation state
```

Restarting the backend may therefore reset the simulation.

Static GTFS parsing results may be cached locally for faster startup.

Repository interfaces must isolate storage from business logic so that SQLite/PostgreSQL can be introduced later without rewriting the dispatcher.

---

## 57. Backend Structure

Recommended repository structure:

```text
app/
├── api/
│   ├── routes/
│   │   ├── buses.py
│   │   ├── routes.py
│   │   ├── simulation.py
│   │   ├── surges.py
│   │   └── trips.py
│   │
│   ├── schemas/
│   └── websocket.py
│
├── domain/
│   ├── bus.py
│   ├── location.py
│   ├── prediction.py
│   ├── route.py
│   ├── simulation.py
│   └── trip.py
│
├── services/
│   ├── dispatch_engine.py
│   ├── simulation_engine.py
│   ├── prediction_service.py
│   └── routing_service.py
│
├── integrations/
│   ├── databricks/
│   ├── gtfs/
│   └── routing/
│
├── repositories/
│   ├── buses.py
│   ├── predictions.py
│   └── trips.py
│
├── config/
│   └── settings.py
│
└── main.py

tests/
├── unit/
├── integration/
└── fixtures/

AGENTS.md
Dockerfile
docker-compose.yml
pyproject.toml
README.md
```

---

## 58. Layer Responsibilities

### API

Responsible only for:

```text
HTTP/WebSocket handling
validation
authentication if added
calling application services
serializing responses
```

API handlers must not contain dispatch algorithms.

### Domain

Contains:

```text
types
entities
enums
state transitions
domain invariants
```

It must not import FastAPI or Databricks libraries.

### Services

Contains:

```text
dispatch logic
route selection
fleet assignment
simulation behavior
```

### Integrations

Contains external-system-specific implementation.

Examples:

```text
Databricks schema translation
GTFS parsing
road routing
```

---

## 59. Type-Safety Requirements

Python must run under strict static type checking.

All public functions require explicit argument and return types.

Avoid untyped domain structures such as:

```python
dict
list[dict]
Any
```

Prefer:

```text
Pydantic models
dataclasses
Enums
Protocols
typed IDs
explicit collection types
```

`Any` is not permitted in core domain or service code without a documented reason.

All external inputs are validated at integration boundaries.

All datetime values must be timezone-aware.

---

## 60. FastAPI Requirements

All endpoints use explicit request and response models.

FastAPI's generated OpenAPI document is part of the API contract.

Endpoints should normally contain approximately:

```python
async def endpoint(...) -> ResponseModel:
    result = await service.perform_operation(...)
    return ResponseModel.from_domain(result)
```

Business logic does not belong in route handlers.

---

## 61. Docker

The application must run as a Docker container.

Expected execution:

```text
docker compose up
```

Container requirements:

```text
non-root runtime user
locked Python dependencies
health check
configured through environment variables
no credentials baked into image
FastAPI served through an ASGI server
```

Default application port:

```text
8000
```

---

## 62. Health Endpoints

### `GET /healthz`

Indicates whether the application process is functioning.

Response:

```json
{
  "status": "ok"
}
```

### `GET /readyz`

Indicates whether required application resources are initialized.

Example:

```json
{
  "status": "ready",

  "components": {
    "gtfs": "ready",
    "prediction_source": "ready",
    "simulation": "ready"
  }
}
```

Databricks may be reported as degraded without killing an already-running simulation containing loaded predictions.

---

## 63. Logging

Use structured logging.

Important events include:

```text
simulation_started
simulation_paused
simulation_reset

prediction_loaded
prediction_evaluated

route_candidates_generated
route_selected

bus_selected
dispatch_created

bus_departed
trip_started
trip_completed

bus_return_started
bus_available

databricks_error
gtfs_load_error
routing_error
```

Dispatch logs should contain IDs and numeric score components rather than only human-readable text.

---

## 64. Tests

Core unit tests must cover at minimum:

```text
GTFS route matching

origin stop selection

destination stop selection

route direction correctness

route with destination before origin is rejected

route scoring

schedule-gap calculation

additional departure selection

busy bus cannot be selected

unreachable bus cannot be selected

closest feasible bus is selected

duplicate prediction protection

bus state transitions

simulation clock acceleration

simulation pause

simulation reset

bus position interpolation

additional trip completion

return to depot

Databricks failure

invalid Databricks data

timezone handling

GTFS times after midnight

GeoJSON longitude/latitude ordering
```

Tests must use deterministic timestamps.

Unit tests must not call:

```text
sleep()
```

to advance simulation time.

Use a fake/test simulation clock instead.

---

## 65. AI-Assisted Development Guardrails

The repository must contain an `AGENTS.md`.

It should instruct AI coding agents to follow the rules below.

### Architecture

Do not:

```text
put business logic in FastAPI handlers
access Databricks directly outside its adapter
access GTFS files from the dispatch engine
use wall-clock time in simulation logic
introduce global mutable application state
couple domain models to API response models
```

### Business Logic

Do not silently modify:

```text
route eligibility
route scoring
departure-time selection
bus assignment
simulation state transitions
prediction interpretation
API response contracts
```

Changes to these areas require corresponding tests.

### Determinism

Dispatch decisions must be deterministic for identical:

```text
predictions
GTFS data
configuration
fleet state
simulation time
```

No generative AI model or LLM may participate in runtime dispatch decisions.

### Types

Do not introduce:

```python
Any
dict[str, Any]
# type: ignore
```

to bypass typing failures unless there is a documented integration-boundary reason.

Do not weaken static-analysis configuration to make generated code pass.

### Error Handling

Do not:

```text
add broad exception swallowing
silently return fake data
hide integration failures
catch Exception without re-raising/logging at a defined boundary
```

### Tests

An AI coding agent may not:

```text
delete a failing test to make CI pass
weaken assertions without justification
disable test suites
remove type checking
skip tests to hide regressions
```

Every bug fix should include a regression test.

### Dependencies

Do not add a new runtime dependency without documenting:

```text
why it is needed
where it is used
whether an existing dependency can solve the problem
```

---

## 66. Static Analysis / CI

Every pull request must pass:

```text
ruff check
ruff format --check
mypy --strict
pytest
```

Pyright strict may be substituted for mypy if the project chooses Pyright.

Generated OpenAPI should also be checked for accidental breaking changes once the frontend begins relying on it.

---

## 67. Security

MVP may run without user authentication if deployed only in a controlled hackathon/demo environment.

At minimum:

```text
CORS restricted to expected frontend origins
Databricks credentials only through environment/secrets
development surge injection disabled outside development
no stack traces exposed to clients
input schemas validated
no arbitrary SQL from HTTP requests
```

The frontend must never receive Databricks credentials or direct Databricks access.

---

## 68. TransLink Data Compliance

TransLink GTFS data is external data.

The project must review and satisfy TransLink's current attribution and usage terms before public deployment or distribution.

The backend should keep GTFS ingestion isolated so that data-source changes do not affect core dispatch logic.

---

## 69. MVP End-to-End Scenario

Initial state:

```text
Simulation time: 17:00

Additional fleet:

bus-001    AVAILABLE
bus-002    AVAILABLE
bus-003    AVAILABLE
bus-004    AVAILABLE
bus-005    AVAILABLE
```

Prediction:

```text
Surge location:
Location A

Predicted time:
17:18

Predicted destination:
Location B
```

Backend:

```text
1. Maps Location A to nearby GTFS stops.

2. Finds service patterns that contain those stops.

3. Finds which candidate patterns subsequently travel near Location B.

4. Looks at normal scheduled departures.

5. Finds an appropriate gap around 17:18.

6. Calculates which available buses can reach the service start.

7. Scores candidate routes.

8. Selects a service pattern.

9. Selects an available bus.

10. Creates an additional departure at 17:16.

11. Calculates a deadhead path.

12. Changes bus state to DEADHEADING.
```

Frontend displays:

```text
Predicted surge
17:18

Predicted destination
Location B

Additional service
Route X

Additional departure
17:16

Assigned bus
bus-003

Status
Bus travelling to route
```

As simulated time progresses:

```text
17:12   DEADHEADING
17:15   WAITING
17:16   IN_SERVICE
17:45   IN_SERVICE
18:02   RETURNING
18:20   AVAILABLE
```

Bus movement is sent through the WebSocket.

---

## 70. Primary Frontend Contract

The frontend primarily needs four interfaces:

```text
GET /api/v1/state

GET /api/v1/additional-trips/{trip_id}

GET /api/v1/routes/{route_id}

WS /api/v1/ws/simulation
```

Everything required to render the main simulation should be available through those interfaces.

The frontend is not responsible for route selection, bus assignment, schedule-gap calculations, or simulation physics.

---

## 71. Definition of Done

The MVP is complete when a developer can:

```text
start the backend in Docker

load TransLink GTFS

configure N simulated spare buses

load surge predictions from Databricks or a mock source

start a simulated clock

observe a prediction become actionable

observe the dispatcher select an existing route

observe an available bus receive the assignment

observe an additional departure be generated between scheduled trips

retrieve the decision through the REST API

observe the bus moving toward the route

observe the bus operating the additional service

receive position/state changes through WebSocket

observe the bus finish service

observe the bus return/reposition

observe the bus become available again

reset the simulation and reproduce the same result from the same inputs

run the full type-check/lint/test suite successfully
```

That constitutes the v1 surge-responsive bus-dispatch simulation backend.
