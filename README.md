# HyperSentry

HyperSentry is a real-time crypto intelligence and execution platform with:

- terminal UX for market and execution workflows
- `/alpha` decision cockpit for conviction, governance, and autonomous planning
- low-latency backend aggregation, alpha computation, and WS fanout

## Canonical Docs

- Architecture low-level design: `architecture.md`
- Deployment and rollout guide: `DEPLOYMENT.md`
- Improvement notes: `IMPROVEMENT_PLAN.md`

## Tech Stack

- Backend: FastAPI, asyncio/aiohttp, SQLAlchemy, Pydantic
- Frontend: Next.js, React, Zustand, Tailwind
- Data sources: Hyperliquid plus external venue/intel integrations

## Local Quick Start

Prerequisites:

- Node 18+
- Backend virtual environment exists at `backend/venv`

### 1) Backend

```bash
cd backend
./venv/bin/pip install -r requirements.txt
./venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 2) Frontend

```bash
cd web
npm install
npm run dev
```

Default local endpoints:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- WebSocket: `ws://localhost:8000/ws`

## Runtime Notes

- Use `useAlphaStore` and live stores for UI state; avoid placeholder data in production paths.
- WebSocket message types in active use include:
  - `agg_update`
  - `alpha_conviction`
  - `gov_update`
  - `exec_plan`
- Market freshness fields (`price_ts`, `book_ts`) are required for stale-state handling.

## Disclaimer

This software is for research and development use. Live trading carries substantial risk.
