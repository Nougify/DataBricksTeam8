# Surge Bus Backend

The backend is a Python 3.13 FastAPI service managed with
[uv](https://docs.astral.sh/uv/).

## Local development

Install the locked dependencies and run the service:

```sh
uv sync --locked
uv run uvicorn app.main:app --reload
```

The API is available at `http://localhost:8000`. Its health endpoint is
`GET /healthz`.

Configuration is read from environment variables:

```text
APP_ENV=development
CORS_ORIGINS=["http://localhost:3001","http://127.0.0.1:3001"]
DATA_MODE=fixture
```

Copy the values relevant to your environment from `.env.example`. Collection
settings use JSON syntax. `APP_ENV` accepts `development`, `test`, or
`production`; `DATA_MODE` accepts `fixture`, `exported_events`, or `databricks`.
External data modes fail startup unless their required connection or snapshot
settings are supplied; they never fall back to fixture data.

Databricks mode connects directly through the SQL Statement Execution REST API;
the Databricks CLI is not required by the running service. Configure
`DATABRICKS_HOST`, `DATABRICKS_HTTP_PATH`, and `DATABRICKS_TOKEN` together with
`DATA_CATALOG`, `DATA_SCHEMA`, `DISPATCH_EVENTS_TABLE`, and
`DATA_SOURCE_VERSION`. The token should have only the workspace and table access
needed to execute the bounded read query on the selected warehouse.

GTFS dispatch paths can be persisted in `data/recommendation_mappings.json` and
enabled with `RECOMMENDATION_MAPPINGS_PATH`. Records are keyed by source hub and
route key and contain the canonical route, pattern, source stop, and terminal
stop. The backend validates the artifact against `GTFS_FEED_VERSION`, tries saved
paths first, and falls back to dynamic GTFS resolution when a saved pattern has
no service for the event date.

## Fleet configuration

Set `FLEET_CONFIG_PATH` to a JSON file to use an explicit backend-owned fleet.
Relative paths are resolved from the process working directory. The file is
authoritative when configured; `FLEET_SIZE`, `DEFAULT_BUS_CAPACITY`, and
`DEFAULT_FLEET_LOCATION_ID` only control the generated development fleet used
when no file is set.

```json
{
  "buses": [
    {
      "id": "bus-01",
      "capacity": 50,
      "initial_location_id": "ubc",
      "home_location_id": "ubc"
    }
  ]
}
```

Bus IDs must be unique, capacities must be positive integers, and location IDs
must name hubs in the loaded GTFS-backed transit index. `{ "buses": [] }` is a
valid empty fleet. `config/fleet.json` is the bundled reproducible example and is
copied into the backend container.

Routing uses `ROUTING_PROVIDER` and `ROUTING_SPEED_KPH` for deadhead and return
legs. Service paths and durations come from the selected GTFS pattern. Set
`PROACTIVE_LATENESS_TOLERANCE_SECONDS` to the maximum accepted late arrival for
proactive plans; reactive plans report post-event lateness without rejecting a
route for lateness alone.

## Proposal lifecycle

Actionable events select the first feasible recommendation and rank GTFS
candidate/bus combinations deterministically. Proposal count is capped by the
rounded source suggestion, `MAX_BUSES_PER_EVENT`, and available fleet. In
`APPROVAL_MODE=MANUAL`, buses remain reserved until approval, rejection, or
`APPROVAL_TIMEOUT_MINUTES`; `AUTO_PAUSE_ON_PROPOSAL=true` pauses at creation. In
`APPROVAL_MODE=AUTOMATIC`, feasible trips are approved immediately. Manual
approval replans at the current simulation time and cancels safely if the route is
no longer feasible.

Approved trips advance through deadheading, proactive waiting when needed,
in-service travel, completion, and return using semantic simulation-clock
boundaries. Bus API reads interpolate location and heading along the persisted
deadhead, GTFS service, and return paths. Completed trips retain their bus through
the return leg; the bus becomes available at home, while cancellation releases it
at its current projected location.

## Deterministic seek

Clock seek rebuilds from the configured initial fleet and replays event,
proposal-expiry, recorded manual-decision, and movement boundaries through the
target. Successful seek installs a paused next epoch and emits one reset; replay
transitions are not published individually. Seeking backward permanently discards
manual decisions after the target. Failed source loads, replay conflicts, or
concurrent state/window changes leave the previous simulation state intact.

## WebSocket events

Connect to `GET /ws` with an `Origin` listed in `CORS_ORIGINS`. The first JSON
frame is the same atomic snapshot returned by `GET /api/v1/state`; later frames
are ordered event envelopes carrying `epoch` and `seq`. On reconnect, sequence
gap, or `system.reset`, treat a fresh state snapshot as authoritative. Slow
connections are closed instead of silently dropping events.

## Checks

```sh
uv run ruff check .
uv run ruff format --check .
uv run mypy --strict app tests
uv run pytest
```

From the repository root, start the backend and frontend together with:

```sh
docker compose up --build
```
