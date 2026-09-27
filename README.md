# DataBricksTeam13
Data Intelligence for Smarter Communities Hackathon

## Hub Pulse — Vancouver transit demand vs service

Our project lives in [`hub_pulse/`](hub_pulse/). It compares when people are actually at UBC, Waterfront Station and Park Royal Mall (21.5M hackathon visit pings) with when TransLink buses run (GTFS fall 2026 schedule, 2025 Transit Service Performance Review), all on Databricks:

- **SQL lakehouse pipeline** (`hub_pulse/sql/`): bronze → silver → gold Delta tables in `rgersxdatabricks_hackathon.hub_pulse`, plus `ai_forecast` and `ai_query` recommendations
- **Notebooks** (`hub_pulse/notebooks/`), **AI/BI dashboard** and **Genie space** builders (`hub_pulse/dashboard/`, `hub_pulse/genie/`)
- **Databricks App** (`hub_pulse/app/hub-pulse/`): an AppKit what-if service planner with Genie chat
- **Pitch deck** builder (`hub_pulse/deck/`) and scenario scripts (`hub_pulse/analysis/`)

Key finding: Park Royal and Waterfront can close most of their service gap by rescheduling at zero cost; UBC's peak buses are already over capacity, so it needs about 5% more midday service.

Start with [`hub_pulse/HANDOFF.md`](hub_pulse/HANDOFF.md) for setup, IDs and how to rebuild everything.

## Local services

The root-level `backend/` and `frontend/` services run together through Docker Compose.

The surge-dispatch backend is defined in [`backend/SPEC.md`](backend/SPEC.md).
Its dependency-ordered delivery chunks are tracked in
[`backend/IMPLEMENTATION_PLAN.md`](backend/IMPLEMENTATION_PLAN.md).

Start the services with:

```sh
docker compose up --build
```

Open `http://localhost:3001` to view the frontend. It verifies the backend through
`/healthz`; the backend is also available directly at
`http://localhost:8000/healthz`.
