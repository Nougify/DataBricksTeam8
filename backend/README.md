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
