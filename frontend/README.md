# Surge Bus Frontend

The frontend is a Next.js 16 application for the surge-dispatch simulation.

## Local development

Install dependencies and start the development server:

```sh
npm ci
npm run dev
```

Open `http://localhost:3001`. By default, the app connects to the backend at
`http://localhost:8000/api/v1` and `ws://localhost:8000/ws`. Override these with
the `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_WS_URL` values documented in
`.env.example`.

## Docker Compose

From the repository root, build and start both services:

```sh
docker compose up --build
```

The frontend runs as a standalone Next.js server in the `frontend` container and
is published at `http://localhost:3001`.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```
