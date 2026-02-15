# HyperSentry — Production Readiness Audit Report

**Date:** 2026-02-12  
**Scope:** Full codebase (`backend/`, `web/`, root config)  
**Classification:** 🔴 CRITICAL | 🟡 HIGH | 🟠 MEDIUM | ⚪ LOW

---

## 🔴 CRITICAL FINDINGS

### 1. Hardcoded API Keys in `.env` Files (LEAKED SECRETS)

**Files:** `backend/.env`, `.env`, `web/.env.local`

All three `.env` files contain **real, live credentials** in plaintext:

| Secret | Value (Redacted) | Risk |
|---|---|---|
| `GEMINI_API_KEY` | `AIzaSyAif6Fl...` | Google AI abuse, billing charges |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-BgKwJ...` | OAuth hijacking, user impersonation |
| `TELEGRAM_BOT_TOKEN` | `8262058299:AAG...` | Bot takeover, spam, phishing |
| `TELEGRAM_CHAT_ID` | `305157936` | Targeted messaging |
| `GOOGLE_CLIENT_ID` | `231460654795-m9...` | OAuth phishing |
| `JWT_SECRET_KEY` | `hypersentry-local-...` | **Session forgery** — anyone can mint admin tokens |
| `ENCRYPTION_KEY` | `SEl47r2JVdMA9N...` | **Full decryption** of all stored user API keys |

**Impact:** If this repo is EVER pushed to a public GitHub (or has been), all credentials are compromised.

**Action Required:**
1. **Immediately rotate ALL keys** — Gemini, Google OAuth, Telegram Bot, JWT Secret, Encryption Key
2. Verify `.env` files are in `.gitignore` (✅ they are) but run `git log --all -- .env backend/.env web/.env.local` to confirm they were **never** committed
3. Use a secrets manager (Vault, Railway secrets, or at minimum `doppler`) for production

### 2. Hardcoded WalletConnect Project ID in Source Code

**File:** `web/app/providers.tsx:30`
```typescript
projectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || '3a8170812b534d0ff9d794f35a9cc25e',
```
This WalletConnect project ID is hardcoded as a **fallback** directly in committed source code. Anyone reading the repo gets your WC project ID.

**Fix:** Remove the fallback. If `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` is not set, show an error or disable wallet connect.

### 3. Weak JWT Secret Key with Fallback Default

**File:** `backend/auth.py:25` and `backend/config.py:46`
```python
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
# and
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-this-in-production-min-32-chars") 
```
Two different fallback defaults exist for the same key. If the env var is ever unset, tokens are signed with a publicly known secret. **Any attacker can forge admin JWTs.**

**Fix:** Remove default values. Crash on startup if `JWT_SECRET_KEY` is not set in production.

### 4. Open Proxy Endpoint (SSRF Vulnerability)

**File:** `backend/src/routers/intel.py:280-318` — `/intel/proxy`

```python
@router.get("/proxy")
async def proxy_web(url: str):
    allowed_domains = ["polymarket.com", "gamma-api.polymarket.com", "clob.polymarket.com"]
    if not any(domain in url for domain in allowed_domains):
        raise HTTPException(...)
```

**Vulnerability:** The domain check uses `in` which is trivially bypassed:
- `https://evil.com/?redirect=polymarket.com` → passes the check
- `https://polymarket.com.evil.com/steal` → passes the check
- `https://evil.com/polymarket.com` → passes the check

**This is a Server-Side Request Forgery (SSRF) vulnerability** that can be used to:
- Scan internal network services
- Access cloud metadata endpoints (`169.254.169.254`)
- Proxy malicious content through your server

**Fix:** Use proper URL parsing:
```python
from urllib.parse import urlparse
parsed = urlparse(url)
if parsed.hostname not in allowed_domains:
    raise HTTPException(...)
```

### 5. Encryption Key Auto-Generation (Data Loss Risk)

**File:** `backend/src/security.py:9-15`
```python
if not _env_key:
    _key = Fernet.generate_key()
    print("WARNING: ENCRYPTION_KEY not found...")
```
If `ENCRYPTION_KEY` is not set, a random key is generated. All encrypted API keys become **permanently unrecoverable** on restart. In production, this should be a hard crash, not a warning.

---

## 🟡 HIGH FINDINGS

### 6. Execution Engine Returns `mock_success` — Never Actually Trades

**File:** `backend/src/execution.py`

The entire `ArbExecutor` is a simulation. Both `_execute_hl()` and `_execute_binance()`:
- Fetch prices correctly from real APIs
- But return `{"status": "mock_success"}` instead of placing orders
- Line 92: `if hl_res.get("status") == "mock_success"` — trades are only recorded if they "mock succeeded"

**This means the "Execute" button in ArbScanner does nothing.** Users clicking "Execute" see success but no orders are placed.

**Action:** Either:
- Implement real execution (use `exchange.market_open()` for HL, signed Binance API for Binance)
- Or clearly label this as "Paper Trading" in the UI and remove the "Execute" button

### 7. Twitter Provider Returns Fake Data

**File:** `backend/src/intel/providers/twitter.py:20-29`
```python
if not self.api_key:
    return [
        self.normalize(
            raw_id="mock_1",
            title="HYPE token seeing unusual CVD divergence.",
            url="https://twitter.com/mock/status/1",
            ...
        )
    ]
```
When `TWITTER_API_KEY` is not set (which it never is based on your `.env`), the provider returns **fabricated intelligence** that gets mixed into the real feed. Users see fake "alpha" alongside real Polymarket and RSS data.

**Fix:** Return `[]` when no API key is present (like TelegramProvider already does correctly).

### 8. Nexus Engine Has Synthetic Fallback Signals

**File:** `backend/src/intel/nexus.py:188-204`
```python
if not nexus_output:
    # Add a few high-fidelity mock signals to ensure the UI isn't empty
    major_tickers = [("BTC", 8, "Institutional Accumulation"), ...]
```
When no real confluence is detected, the Nexus fabricates signals for BTC, ETH, SOL with fake alpha scores and fake recommendations like "STRONG BUY". These are tagged `is_synthetic: True` but the frontend **does not check this flag**.

**Fix:** Remove synthetic signals. Show an empty state instead: "No Alpha Confluence Detected. Monitoring..."

### 9. InstitutionalDescription Component is 100% Mock

**File:** `web/components/trading/InstitutionalDescription.tsx:21-39`

This entire component returns hardcoded fake data after an artificial 800ms delay:
```typescript
setData({
    marketCap: '$1.42B',        // Fake
    fdv: '$4.8B',               // Fake  
    holdingsConc: 12.4,         // Fake
    ...
});
```
Users see fabricated market caps, FDVs, and holder concentration data for every token. This is misleading.

**Fix:** Integrate CoinGecko or DefiLlama API, or remove the component.

### 10. MicrostructureHUD Falls Back to Mock Predictions

**File:** `web/components/trading/MicrostructureHUD.tsx:132-134`
```typescript
// Fallback Mock if no signal
const predScore = 0.5;
scoreParts.push({ source: 'Prediction', score: predScore, weight: 1.0, reason: 'Market Neutral' });
```

### 11. DecisionNexus War Room Falls Back to Mock Debate

**File:** `web/components/trading/DecisionNexus.tsx:100-107`
```typescript
// Fallback mock for demo if backend fails
transcript = [
    { agent: 'bull', text: `${debateToken} support structure...`, evidence: "CVD Divergence" },
    ...
];
```

---

## 🟠 MEDIUM FINDINGS

### 12. Bare `except` Blocks (11 instances)

**Files:** `trading.py`, `nexus.py`, `manager.py`, `microstructure.py`, `twap_detector.py`, `backtest.py`

Bare `except:` catches **everything** including `KeyboardInterrupt`, `SystemExit`, and `MemoryError`. This masks real bugs and makes debugging impossible.

**Fix:** Replace all `except:` with `except Exception as e:` and log the error.

### 13. Debate Context is Static

**File:** `backend/src/routers/intel.py:270-271`
```python
# Mock context for now - in production we'd pass recent prices/news
context = f"Asset {symbol} is experiencing high volatility near local resistance."
```
The AI debate agents always receive the same generic context regardless of actual market conditions. They should receive:
- Real-time price and volume
- Recent news headlines about the asset
- Current CVD/order flow data
- Prediction market probabilities

### 14. `deobfuscate` Endpoint Returns ALL Signals

**File:** `backend/src/routers/intel.py:258-259`
```python
from src.intel.nexus import nexus
return nexus.get_alpha_confluence()  # Returns EVERYTHING
```
When a user burns a trial credit to "reveal one signal", they actually receive **all unobfuscated signals**. This defeats the entire premium model.

**Fix:** Only return the specific signal matching `token_obfuscated`.

### 15. No API Rate Limiting on Endpoints

There is no rate limiting middleware on any endpoint. An attacker can:
- Spam `/intel/debate/{symbol}` to burn your Gemini API quota
- DDoS `/intel/nexus` or `/intel/latest` 
- Brute-force the `/intel/deobfuscate` endpoint

**Fix:** Add `slowapi` or a custom rate limiter middleware.

### 16. Admin Emails Hardcoded in Source Code

**File:** `backend/auth.py:85-90`
```python
ADMIN_EMAILS = ["sunny@hypersentry.ai", "jainsunny34@gmail.com", ...]
ADMIN_ADDRESSES = ["0xd2f4197554Af1834b87C440DCDc57c0dd8dE881A", ...]
```
Admin lists should be in a database or config, not source code.

### 17. `print()` Statements Instead of `logger`

**Files:** `security.py`, `manager.py`, `rss.py`, `telegram.py`

Four files use `print()` for error/warning output instead of Python's `logging` module. These won't appear in structured production logs.

### 18. `datetime.utcnow()` is Deprecated

**File:** `backend/auth.py:41`
```python
expire = datetime.utcnow() + ...
```
`datetime.utcnow()` is deprecated in Python 3.12+. Use `datetime.now(timezone.utc)`.

---

## ⚪ LOW FINDINGS

### 19. Inconsistent API_URL Defaults

Some frontend files use `http://127.0.0.1:8000`, others use `http://localhost:8000`. While functionally equivalent, inconsistency suggests copy-paste debt.

### 20. Hardcoded `$10` Trade Size in ArbScanner

**File:** `web/components/trading/ArbScanner.tsx:96`
```typescript
size_usd: 10, // Hardcoded $10 for safety test
```

### 21. `as any` Type Assertions

Multiple components use `as any` to bypass TypeScript type checking. This should be cleaned up with proper interfaces.

### 22. Unused Import: `Mic` in DecisionNexus

**File:** `web/components/trading/DecisionNexus.tsx` — `Mic` is imported but never used.

---

## 🧠 AI NEXUS — AREAS OF IMPROVEMENT

### Current State Assessment

The Decision Nexus currently:
- ✅ Correlates TWAPs, news, and prediction markets
- ✅ Has bull/bear AI debate
- ✅ Has global pulse scoring
- ❌ Uses static debate context
- ❌ Falls back to fake signals when empty
- ❌ No memory/learning across sessions
- ❌ No real-time streaming of analysis

### Recommendations to Make it Best-in-Industry

#### 1. **Context-Rich Debate System**
Feed the debate agents REAL market data:
```python
context = {
    "price": current_price,
    "24h_change": pct_change,
    "cvd": cvd_data,
    "recent_news": [headline1, headline2...],
    "prediction_odds": polymarket_prob,
    "orderbook_imbalance": bid_ask_ratio,
    "funding_rate": funding
}
```
This transforms the debate from "generic AI theater" to "intelligence you can't get anywhere else."

#### 2. **Multi-Agent Consensus Score**
After the debate, add a "Jury Agent" that reads both arguments and produces:
- A final verdict score (1-10)
- Confidence level
- Specific price levels to watch
- Recommended position sizing

#### 3. **Signal Attribution & Backtesting**
Track the accuracy of every Nexus signal over time:
- When a "STRONG BUY" signal fires, record the price
- Track 1h, 4h, 12h, 24h performance
- Display hit rate on the UI: "Nexus accuracy: 73% on BUY signals (last 30 days)"
- This is what separates toys from production tools

#### 4. **Streaming Analysis (SSE)**
Replace polling with Server-Sent Events for:
- War Room debate (stream tokens as AI generates them)
- Global Pulse updates (push to frontend in real-time)
- Breaking signal alerts

#### 5. **Cross-Asset Correlation Matrix**
Build a live correlation heatmap showing:
- BTC/ETH correlation strength
- Which altcoins lead/lag BTC
- Unusual decorrelation events (alpha opportunity)

#### 6. **Institutional Flow Profiling**
Enhance CVD/order flow with:
- Large order detection (> $100k)
- Time-weighted accumulation patterns
- Whale wallet activity correlation

#### 7. **Configurable Alert System**
Let users set conditions:
- "Alert me when Nexus score > 7 for SOL"
- "Alert when Bull/Bear consensus flips"
- Push via Telegram bot, email, or browser notification

---

## Summary Action Items (Priority Order)

| # | Action | Severity | Effort |
|---|---|---|---|
| 1 | Rotate ALL leaked secrets immediately | 🔴 CRITICAL | 1 hour |
| 2 | Fix proxy SSRF vulnerability | 🔴 CRITICAL | 15 min |
| 3 | Remove/crash on missing JWT_SECRET_KEY default | 🔴 CRITICAL | 5 min |
| 4 | Remove fake Twitter provider data | 🟡 HIGH | 10 min |
| 5 | Remove synthetic Nexus signals | 🟡 HIGH | 10 min |
| 6 | Label ArbExecutor as paper trading | 🟡 HIGH | 30 min |
| 7 | Fix deobfuscate to return single signal | 🟠 MEDIUM | 30 min |
| 8 | Add API rate limiting | 🟠 MEDIUM | 1 hour |
| 9 | Feed real context to debate agents | 🟠 MEDIUM | 2 hours |
| 10 | Replace InstitutionalDescription with real data | 🟡 HIGH | 2 hours |
| 11 | Fix bare except blocks | 🟠 MEDIUM | 30 min |
| 12 | Replace print() with logger | ⚪ LOW | 15 min |
