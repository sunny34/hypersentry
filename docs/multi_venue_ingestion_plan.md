# Multi-Venue Ingestion Plan (Hyperliquid + Binance + Coinbase)

## 1) Current State
- Hyperliquid real-time feed is ingested in backend aggregator via a single upstream websocket.
- Binance/Coinbase data is currently pulled by polling REST endpoints in aggregator external loop.
- Event bus publishes in-process first, with optional Kafka producer mirror (`EVENT_BUS_BACKEND=kafka`).
- Frontend/mobile now consume backend `/ws` rather than opening direct Hyperliquid sockets.

## 2) Target State
- One ingest layer per venue (no duplicate upstream sockets from UI clients).
- Kafka is the transport backbone for normalized market events.
- API/alpha services consume Kafka and update `global_state_store`.
- WS clients receive typed backend events only.

## 3) Proposed Kafka Topics
- `market.raw.hyperliquid`
- `market.raw.binance`
- `market.raw.coinbase`
- `market.norm.orderbook`
- `market.norm.trades`
- `market.norm.liquidations`
- `market.norm.oi_funding`
- `market.control.subscriptions` (optional demand-control channel)

Partitioning/keying:
- Key by normalized symbol (for example `BTC`, `ETH`) to preserve per-symbol ordering.

## 4) Normalized Event Contract
Define Pydantic models for normalized events under `backend/src/alpha_engine/models/`:
- `NormalizedTradeEvent`
- `NormalizedBookEvent`
- `NormalizedLiquidationEvent`
- `NormalizedOiFundingEvent`

Common fields:
- `venue`, `symbol`, `ts_exchange_ms`, `ts_ingest_ms`, `event_type`, `payload_version`

## 5) Ingestor Service Design
Create a dedicated `market_ingestor` process/container:
- Hyperliquid adapter:
  - `allMids`, `l2Book`, `trades`, `activeAssetCtx`, `liquidations`
- Binance adapter:
  - websocket for `aggTrade` + depth stream
  - open interest/funding via scheduled REST where websocket does not provide equivalent fidelity
- Coinbase adapter:
  - websocket `matches` + `level2`/`level2_batch`

Responsibilities:
- Connection lifecycle, heartbeats, reconnect backoff
- Symbol mapping and normalization
- Publish raw + normalized events to Kafka

## 6) Backend Consumer Layer
Add `AIOKafkaConsumer` workers in backend:
- Consumer group `hypersentry-market-consumers`
- Consume normalized topics
- Update `global_state_store`
- Emit typed app events (`agg_update`, `alpha_conviction`, `gov_update`, `exec_plan`) through event bus

## 7) Demand-Control (To Avoid Over-Subscription)
Implement optional subscription control:
- API collects active symbol demand from websocket subscriptions.
- API publishes desired symbol set diffs to `market.control.subscriptions`.
- Ingestor adjusts upstream subscriptions (batch/throttle) per venue.

## 8) Reliability/Observability Requirements
- Dead-letter topic for parse/schema failures
- Per-venue metrics:
  - connected state
  - message rate
  - lag to kafka
  - reconnect count
  - dropped messages
- Alerts:
  - stale symbol feed
  - high consumer lag
  - repeated reconnect loops

## 9) Rollout Plan
1. Ship normalized models + Kafka topics.
2. Add Binance/Coinbase ingestor adapters (raw + normalized publish).
3. Add backend Kafka consumers behind feature flags.
4. Shadow mode: compare Kafka-derived state vs current aggregator state.
5. Cut over reads to Kafka-derived state for selected symbols.
6. Gradually disable REST polling fallback.

## 10) Immediate Next Tasks
1. Add normalized Pydantic schemas and topic constants.
2. Scaffold `market_ingestor` package and Binance/Coinbase websocket clients.
3. Add consumer service with symbol-keyed handlers into backend startup.
4. Add `/aggregator/status` metrics for kafka consumer lag + venue ingest health.
