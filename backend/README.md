# Surge Bus Backend

The backend is a Python 3.13 FastAPI service managed with
[uv](https://docs.astral.sh/uv/).

## Local development

Install the locked dependencies and run the service:

```sh
uv sync --locked
uv run uvicorn app.main:app --reload
```

The API is available at `http://localhost:8000`. Its current health endpoints
are `GET /healthz` and the temporary compatibility route `GET /api/health`.

Configuration is read from environment variables:

```text
APP_ENV=development
FRONTEND_ORIGIN=http://localhost:3000
```

`APP_ENV` accepts `development`, `test`, or `production`.

## Checks

```sh
uv run ruff check .
uv run ruff format --check .
uv run mypy app tests
uv run pytest
```

From the repository root, start the backend and frontend together with:

```sh
docker compose up --build
```
