# ⚡️ HyperSentry: Institutional-Grade Alpha & Execution Terminal

HyperSentry is a high-performance, real-time intelligence and autonomous execution platform built for professional traders. It aggregates global market signals, geopolitical intelligence, and on-chain metrics into a unified Decision Cockpit.

[![System Status](https://img.shields.io/badge/System-Operational-emerald?style=flat-square&logo=statuspage)](https://hypersentry.ai)
[![License: Infrastructure](https://img.shields.io/badge/Stack-FastAPI_%7C_Next.js_%7C_Kafka-blue?style=flat-square)](https://github.com/sunnyjain/hypersentry)

---

## 🛰 Core Architecture

HyperSentry is designed with a **distributed, event-driven architecture** to ensure zero-lag execution and data integrity.

*   **Intelligence Engine**: Real-time ingestion from RSS, Telegram Alpha, Twitter, Polymarket, and WorldMonitor (Geopolitical/Infrastructure).
*   **Alpha Engine**: Continuous conviction scoring and automated plan generation via AI-driven synthesis.
*   **Execution Relay**: Hardened gateway for 1-click and autonomous trade execution via Hyperliquid.
*   **Event Bus**: Kafka-backed telemetry for reliable message fan-out to all UI components.

## 🛠 Tech Stack

| Component | Technology |
| :--- | :--- |
| **Frontend** | Next.js 14, React, Zustand, Framer Motion, TailwindCSS |
| **Backend** | FastAPI (Python 3.11), Gunicorn/Uvicorn, SQLAlchemy |
| **Message Bus** | Apache Kafka |
| **Task Queue** | Celery + Redis |
| **Database** | PostgreSQL (Persistence), Redis (Hot Cache) |
| **AI Layer** | Google Gemini (Sentiment & Strategy Reasoning) |

---

## 🚀 One-Click Deployment (Coolify)

HyperSentry is optimized for **Self-Hosted PaaS** environments like **Coolify**.

### Prerequisites
- A VPS with at least **4 vCPU / 8GB RAM**.
- Coolify instance installed.

### Setup Steps
1.  **New Service**: In Coolify, select **Docker Compose**.
2.  **Configuration**: Paste the contents of `docker-compose.prod.yml`.
3.  **Environment Variables**: Set the mandatory keys (see `.env.example`).
4.  **Domains**:
    *   Set `api.yourdomain.com` for the `api` service.
    *   Set `app.yourdomain.com` for the `web` service.
5.  **Deploy**: Hit "Deploy" and Coolify will automatically handle SSL certificates, internal networking, and load balancing.

---

## 📦 Local Development

### Prerequisites
- Docker & Docker Compose
- Node.js 18+
- Python 3.11+

### Quick Start
```bash
# Clone the repository
git clone https://github.com/sunnyjain/hypersentry.git
cd hypersentry

# Start the full stack
docker-compose up --build
```

The system will be available at:
- **Cockpit**: `http://localhost:3000`
- **API Engine**: `http://localhost:8000`
- **Live Trace**: `http://localhost:8000/docs`

---

## 🔐 Advanced Security

- **Hardened Execution**: Autonomous trading paths are guarded by admin-only session tokens.
- **Isolated Streams**: Public telemetry is separated from private account payloads via authenticated WebSocket channels.
- **Session Keys**: Uses Hyperliquid delegated signing/session model for non-custodial execution.

## 📜 Canonical Documentation

- [Architecture & Design](architecture.md)
- [Deployment Guide](DEPLOYMENT.md)
- [Improvement Roadmap](IMPROVEMENT_PLAN.md)
- [Audit Report](AUDIT_REPORT.md)

---

## ⚠️ Disclaimer

HyperSentry is institutional-grade software. All trading involves significant risk. The authors are not responsible for financial losses incurred through the use of this software.
