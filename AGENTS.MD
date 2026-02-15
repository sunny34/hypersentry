# Rules of Engagement (ROE)

## Environment & Infrastructure
- **Runtime (Required)**: ALWAYS run the stack via Docker Compose. Do not run backend/frontend/worker directly on host.
- **Startup Command**: Use `docker compose up --build` (or `docker compose up -d --build`) from repo root.
- **Backend Entry Point**: `backend/main.py` via `api` service in Compose.
- **Python/Pip Usage**: If needed, run through container exec (example: `docker compose exec api python ...`, `docker compose exec api pip ...`). Do not use system python.
- **Frontend Port**: `3000`.
- **Backend Port**: `8000`.
- **WebSocket Endpoint**: `ws://localhost:8000/ws`.

## Common Commands
- **Start (foreground)**: `docker compose up --build`
- **Start (detached)**: `docker compose up -d --build`
- **Stop and remove containers**: `docker compose down`
- **Service status**: `docker compose ps`
- **Tail all logs**: `docker compose logs -f`
- **Tail API logs**: `docker compose logs -f api`
- **Open shell in API container**: `docker compose exec api bash`
- **Run python in API container**: `docker compose exec api python <script_or_args>`
- **Install package in API container**: `docker compose exec api pip install <package>`
- **Rebuild/start one service**: `docker compose up -d --build api`

## Architectural Standards
- **Decision Cockpit**: The primary intelligence interface is at `/alpha`.
- **Alpha Engine**: Central logic is in `src/alpha_engine/services/alpha_service.py`.
- **State Store**: Use `global_state_store` for real-time market data across services.
- **Models**: Always use Pydantic models from `src/alpha_engine/models/` for data consistency.
- **WebSocket Messages**: Use strict types: `alpha_conviction`, `gov_update`, `exec_plan`, `agg_update`.

## Debugging Workflow
- **Server Logs**: Check `backend/server.log` for Tracebacks or "Synthesized" logs.
- **Subscription Verification**: Ensure frontend `useAlphaStream.ts` sends `{type: "subscribe", coin: "BTC"}` immediately on connection.
- **Mode Switching**: Mode state is in `useModeStore.ts`. Confirmation is required for Autonomous mode.

## Critical Warnings
- **NO PLACEHOLDERS**: Never use dummy data in layouts; always hook up to `useAlphaStore`.
- **COMPOSE ONLY**: Do not start services outside Docker Compose.
