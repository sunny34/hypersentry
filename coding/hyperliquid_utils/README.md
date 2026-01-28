# 🛡️ HyperSentry

> Real-time Hyperliquid trading intelligence platform

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/yourusername/hypersentry)
[![Python](https://img.shields.io/badge/python-3.11+-green.svg)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![License](https://img.shields.io/badge/license-MIT-purple.svg)](LICENSE)

## ✨ Features

- **🔍 Wallet Watcher** - Monitor any public wallet's positions in real-time
- **🐋 Whale TWAP Detector** - Track large TWAP orders across tokens
- **📱 Telegram Alerts** - Instant notifications for trading signals
- **⚡ Copy Trading** - Mirror positions from tracked wallets (optional)
- **🎨 Modern Dashboard** - Beautiful Next.js UI with real-time updates

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        HyperSentry                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Next.js   │───▶│   FastAPI   │───▶│   Celery Workers    │  │
│  │  Dashboard  │    │     API     │    │  (Background Jobs)  │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│                            │                     │              │
│                            ▼                     ▼              │
│                     ┌─────────────┐       ┌───────────┐         │
│                     │  PostgreSQL │       │   Redis   │         │
│                     └─────────────┘       └───────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- Docker & Docker Compose (recommended)
- Redis (for Celery workers)

### Option 1: Docker (Recommended)

```bash
# Clone the repo
git clone https://github.com/yourusername/hypersentry.git
cd hypersentry

# Copy environment files
cp .env.example .env
cp web/.env.local.example web/.env.local

# Edit .env with your credentials
nano .env

# Start all services
docker-compose up --build
```

**Services:**
- 🌐 Dashboard: http://localhost:3000
- 🔌 API: http://localhost:8000
- 📊 API Docs: http://localhost:8000/docs

### Option 2: Manual Setup

```bash
# Backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Start Redis (required for Celery)
redis-server

# Start API
python main.py

# Start Celery worker (new terminal)
celery -A celery_app worker --loglevel=info

# Frontend
cd web
npm install
npm run dev
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `HL_ACCOUNT_ADDRESS` | Your Hyperliquid wallet address | For trading |
| `HL_PRIVATE_KEY` | API wallet private key | For trading |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather | For alerts |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID | For alerts |
| `REDIS_URL` | Redis connection URL | Yes |
| `DATABASE_URL` | PostgreSQL connection URL | Optional |
| `ENVIRONMENT` | `development` or `production` | No |

## 🚂 Deploy to Railway

1. **Create Railway Project**
   - Go to [railway.app](https://railway.app) and create a new project

2. **Add Services**
   - **Backend**: Deploy from GitHub, set Dockerfile to `Dockerfile.backend`
   - **Worker**: Deploy from GitHub, set start command to `celery -A celery_app worker --loglevel=info`
   - **Frontend**: Deploy from GitHub, set Dockerfile to `Dockerfile.frontend`
   - **Redis**: Add Redis from Railway's add-on marketplace
   - **PostgreSQL**: Add PostgreSQL from Railway's add-on marketplace

3. **Set Environment Variables**
   - Copy values from `.env.example` to Railway's environment variables
   - Railway auto-injects `REDIS_URL` and `DATABASE_URL` from add-ons
   - Set `NEXT_PUBLIC_API_URL` in frontend to your backend service URL

4. **Deploy!**
   - Railway will build and deploy automatically on git push

## 📁 Project Structure

```
hypersentry/
├── main.py              # FastAPI application
├── config.py            # Configuration management
├── celery_app.py        # Celery configuration
├── tasks.py             # Background tasks
├── src/
│   ├── manager.py       # Core trading manager
│   ├── client_wrapper.py# Hyperliquid SDK wrapper
│   ├── notifications.py # Telegram notifications
│   └── strategies/      # Trading strategies
│       ├── copy_trader.py
│       └── twap_detector.py
├── web/                 # Next.js frontend
│   ├── app/
│   └── components/
├── Dockerfile.backend   # Backend Docker image
├── Dockerfile.frontend  # Frontend Docker image
└── docker-compose.yml   # Local development stack
```

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | System status |
| GET | `/health` | Health check |
| GET | `/wallets` | List watched wallets |
| POST | `/wallets/add` | Add wallet to watch |
| DELETE | `/wallets/{address}` | Stop watching wallet |
| POST | `/wallets/upload_csv` | Batch import wallets |
| GET | `/twap` | Get watched tokens |
| GET | `/twap/active` | Get active TWAP orders |
| POST | `/twap/add` | Watch token for TWAPs |
| DELETE | `/twap/{token}` | Stop watching token |

## ⚠️ Disclaimer

This software is for educational purposes only. Trading cryptocurrencies involves significant risk. Use at your own risk.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

**Built with 💚 for the Hyperliquid ecosystem**
