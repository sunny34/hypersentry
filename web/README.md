# Alpha Terminal: Institutional-Grade Trading Intelligence

Alpha Terminal is a high-performance trading interface designed for the Hyperliquid ecosystem. It combines real-time data streaming, AI-driven market analysis, and low-latency execution tools to provide traders with institutional-grade intelligence.

## 🚀 Key Features

- **Intelligence Aggregator**: Real-time news feed from global sources with sentiment analysis and confidence scoring.
- **AI Intelligence Hub**: Powered by Gemini 2.0 Flash, providing structured market analysis, directional bias, and conviction levels.
- **Insider Intelligence**: Real-time monitoring of Hyperliquid WebSocket streams for whale trades ($1M+), massive liquidations, and liquidity walls.
- **1-Click Terminal**: Authorized agent-based trading for low-latency, one-click execution without per-trade wallet confirmations.
- **Predictive Risk Hub**: Intelligent position sizing and automated safety guards (Take-Profit/Stop-Loss) based on account risk profile.
- **Smart 1% Risk**: Automated position sizing to ensure no more than 1% of equity is at risk on a single trade.

## 🛠 Tech Stack

- **Frontend**: Next.js 14, React, Framer Motion, Tailwind CSS.
- **Icons/UI**: Lucide React, Glassmorphism aesthetics.
- **Data**: Hyperliquid WebSocket API, CryptoCompare Aggregated News API.
- **Intelligence**: Gemini 2.0 Flash for market analysis.
- **Authentication**: Wagmi, RainbowKit.

## ⚡️ Quick Start

### 1. Environment Configuration
Create a `.env.local` file in the `web` directory:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=your_id
```

### 2. Development Mode
```bash
npm install
npm run dev
```

### 3. Production Build
```bash
npm run build
npm start
```

## 🧠 Intelligence Components

### News Hub (`NewsFeed.tsx`)
Aggregates news and assigns confidence scores. High-conviction news (>=85%) can be set to "Auto-Pilot" for automated execution when the 1-Click Terminal is active.

### AI Node (`AIAnalysis.tsx`)
Fetches deep analysis from the backend engine. Provides directional bias (Long/Short/Neutral/Close) and reasoning based on technical indicators like RSI, MACD, and Trend analysis.

### Insider Feed (`InsiderIntelligence.tsx`)
Monitors the order flow for institutional "Whale" moves ($1M+) and massive liquidations. Provides visual alerts within the terminal for immediate awareness of market-moving events.

## 🛡 Risk Management

The terminal emphasizes capital preservation:
- **Safety Guards**: Interactive TP/SL setting with AI-suggested levels.
- **Risk Advisory**: Visual warnings when position exposure or leverage exceeds safety thresholds.
- **Smart Sizing**: Automated calculation of lot sizes based on stop-loss distance and account risk.

---
*Built for High-Frequency Alpha.*
