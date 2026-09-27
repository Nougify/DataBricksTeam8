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
