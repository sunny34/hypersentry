# HyperSentry Project Infrastructure

This artifact provides a comprehensive map of the HyperSentry project for the Antigravity AI assistant.

## Project Summary
HyperSentry is a real-time Hyperliquid trading intelligence platform featuring wallet monitoring, whale TWAP detection, and automated copy trading.

## Core Backend (FastAPI)
- **`main.py`**: The main entry point. Initializes FastAPI, database, and background monitors.
- **`config.py`**: Centralized configuration management using environment variables.
- **`auth.py`**: Authentication logic handling Google OAuth2 and JWT session management.
- **`database.py`**: SQLAlchemy engine and session factory.
- **`models.py`**: Database schema (Users, Wallets, UserTwaps, ActiveTrades).
- **`schemas.py`**: Pydantic models for API request/response validation.

## Distributed Processing (Celery)
- **`celery_app.py`**: Celery worker configuration using Redis as the broker.
- **`tasks.py`**: Background tasks for parallel wallet restoration, position syncing, and TWAP scanning.

## Shared Source (`src/`)
- **`manager.py`**: The `TraderManager` singleton that orchestrates all active monitors.
- **`client_wrapper.py`**: High-level wrapper for the Hyperliquid SDK.
- **`notifications.py`**: Telegram bot integration for real-time alerts.
- **`strategies/`**:
    - `copy_trader.py`: Logic for mirroring wallet trades.
    - `twap_detector.py`: Scans for large algorithmic orders on HypurrScan.
    - `bridge_monitor.py`: Tracks large inflows/outflows from the Hyperliquid bridge.

## API Routers (`routers/`)
- `auth.py`, `wallets.py`, `twap.py`, `bridges.py`, `settings.py`, `trading.py`, `backtest.py`, `market.py`.

## Frontends
- **`web/`**: Next.js 16 dashboard with real-time updates via WebSockets and Tailwind CSS.
- **`mobile/`**: React Native (Expo) mobile application.

## Deployment
- `Dockerfile.backend` / `Dockerfile.frontend`: Container definitions.
- `docker-compose.yml`: Local orchestrator for Redis, DB, and app services.
