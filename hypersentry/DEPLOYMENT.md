# HyperSentry Deployment & Migration Guide

Since your Railway free tier has expired, we are migrating to a more robust, distributed free-tier stack. This setup ensures high-availability for your trading bot while staying within zero-cost limits.

## 🏗️ Architecture Overview

1.  **Frontend**: [Vercel](https://vercel.com) (Optimized Next.js hosting)
2.  **Backend**: [Koyeb](https://www.koyeb.com) (High-performance instance-based hosting, supports WebSockets)
3.  **Database**: [Neon.tech](https://neon.tech) (Serverless PostgreSQL)
4.  **Redis**: [Upstash](https://upstash.com) (Serverless Redis for Celery/Aggregator)

---

## 🚀 Phase 1: Database & Redis (The Foundation)

### 1. Neon PostgreSQL
1.  Sign up at [neon.tech](https://neon.tech).
2.  Create a new project named `hypersentry`.
3.  Copy the **Connection String** (Pooled connection is recommended).
    *   *Example*: `postgresql://user:pass@ep-hostname.aws.neon.tech/neondb?sslmode=require`

### 2. Upstash Redis
1.  Sign up at [upstash.com](https://upstash.com).
2.  Create a new **Redis** database.
3.  Copy the **Redis URL**.
    *   *Example*: `redis://default:pass@hostname.upstash.io:6379`

---

## 📡 Phase 2: Backend Migration (Koyeb)

Koyeb is superior to Render's free tier because it doesn't "sleep" and has full WebSocket support.

1.  Sign up at [koyeb.com](https://www.koyeb.com).
2.  Create a new **App** and connect your GitHub repository.
3.  **Service Configuration**:
    *   **Repository Folder**: `backend`
    *   **Instance Type**: `Nano` (Free)
    *   **Environment Variables**:
        *   `ENVIRONMENT`: `production`
        *   `DATABASE_URL`: (Paste your Neon URL)
        *   `REDIS_URL`: (Paste your Upstash URL)
        *   `ALLOWED_ORIGINS`: `https://your-vercel-domain.vercel.app`
        *   `FRONTEND_URL`: `https://your-vercel-domain.vercel.app`
        *   `HL_ACCOUNT_ADDRESS`: (Your Hyperliquid Address)
        *   `HL_PRIVATE_KEY`: (Your Hyperliquid Private Key)
        *   `JWT_SECRET_KEY`: (A random 32-char string)
        *   `GEMINI_API_KEY`: (Your Google AI Key)
    *   **Run Command**: `uvicorn main:app --host 0.0.0.0 --port 8000`
    *   **Ports**: Set to `8000` (HTTP).

---

## 🎨 Phase 3: Frontend Migration (Vercel)

Vercel is the gold standard for Next.js.

1.  Sign up at [vercel.com](https://vercel.com).
2.  Import your GitHub repository.
3.  **Project Configuration**:
    *   **Root Directory**: `web`
    *   **Environment Variables**:
        *   `NEXT_PUBLIC_API_URL`: `https://your-koyeb-app-domain.koyeb.app`
4.  Deploy!

---

## 🛠️ Post-Migration Check

1.  **CORS Check**: Ensure the `ALLOWED_ORIGINS` in Koyeb matches your final Vercel URL exactly (no trailing slash).
2.  **WebSocket Sync**: Open the browser console in the Vercel app. You should see `📡 Aggregator Packet Received` if the Koyeb backend is reachable.
3.  **Database Migrations**: You may need to run your initial DB migrations. Since Koyeb doesn't easily allow interactive shells on the free tier, ensure your `main.py` calls `init_db()` or equivalent on startup.

---

**Note**: I have already refactored the code to use centralized environment variables, so once you set these up, everything will sync automatically.
