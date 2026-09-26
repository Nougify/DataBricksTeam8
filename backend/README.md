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
`production`; `DATA_MODE` accepts `fixture`, `exported_snapshot`, or `databricks`.
External data modes fail startup unless their required connection or snapshot
settings are supplied; they never fall back to fixture data.

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
