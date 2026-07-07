# RDO ONE — Backend Guide (Final)

**Version:** 2.0  
**Stack:** Node.js 20 + Fastify + Redis + WebSocket  
**Frontend:** Vite + Vanilla JS (index.html) + React (lifi.jsx)  
**Exchanges:** Hyperliquid (BASIC mode) + Aster DEX (EXTRA mode)

---

## 1. Why a Backend Is Needed

The frontend uses `vite.config.js` proxy rules that only work in **development**. In production (static build on CDN), all proxy routes break with CORS errors.

| Feature | Breaks without backend |
|---|---|
| HL prices, order book, positions | CORS on `api.hyperliquid.xyz` |
| Aster prices, candles, depth | CORS on `fapi.asterdex.com` |
| Binance chart data | CORS on `api.binance.com` |
| CoinGecko market data | CORS + rate limits |
| News RSS feeds | CORS on all news sites |
| Real-time WebSocket | Direct works but doesn't scale |
| 1inch swap quotes | API key can't be in browser JS |

The backend is **not custodial** — it never holds user funds or private keys. It is purely a CORS proxy + Redis cache + WebSocket relay.

---

## 2. Architecture

```
Browser (Vite build — static files on CDN)
│
├── REST  →  /api/*  ──────────────────────────────────┐
│                                                       ▼
└── WS    →  /ws (HL relay)                   RDO ONE Backend
             /aster-stream (Aster relay)       Node.js + Fastify
                                               │
                                               ├── /api/hl/*         → https://api.hyperliquid.xyz
                                               ├── /api/binance/*    → https://api.binance.com
                                               ├── /api/coingecko/*  → https://api.coingecko.com
                                               ├── /api/feargreed/*  → https://api.alternative.me
                                               ├── /api/aster-fapi/* → https://fapi.asterdex.com
                                               ├── /api/lifi-api/*   → https://li.quest
                                               ├── /api/news         → 8 RSS feeds aggregated
                                               ├── /api/swap/*       → https://api.1inch.dev (with key)
                                               ├── /ws               → wss://api.hyperliquid.xyz/ws
                                               └── /aster-stream     → wss://fstream.asterdex.com/stream
```

---

## 3. Project Structure

```
rdo-one/
├── index.html                  ← Main trade terminal (HL + Aster)
├── lifi.html                   ← LI.FI widget page
├── public/
│   ├── markets.html            ← Markets page
│   ├── news.html               ← News page
│   ├── portfolio.html          ← Portfolio page
│   └── transfer.html           ← Transfer page
├── src/
│   ├── main.js                 ← Terminal logic (mode switching, charts, orders)
│   ├── trading.js              ← HL REST + WebSocket, order signing
│   ├── chart.js                ← Lightweight Charts wrapper
│   ├── wallet.js               ← EVM wallet connection
│   ├── deposit.js              ← Deposit modal
│   ├── i18n.js                 ← EN/RU/ZH translations
│   ├── toast.js                ← Toast notifications
│   └── styles.css              ← Full UI styles
├── vite.config.js              ← Dev proxy rules (matches production backend paths)
├── package.json
└── server/                     ← Production backend
    ├── index.js                ← Fastify entry point
    ├── package.json
    ├── .env.example
    ├── plugins/
    │   ├── redis.js            ← Redis connection (graceful fallback if unavailable)
    │   ├── cors.js             ← Domain-whitelist CORS
    │   └── rate-limit.js       ← 200 req/min per IP
    ├── routes/
    │   ├── proxy.js            ← All external API proxies
    │   ├── news.js             ← RSS aggregation → /api/news
    │   ├── swap.js             ← 1inch proxy (server-side API key)
    │   └── health.js           ← /health uptime check
    ├── ws/
    │   └── relay.js            ← WebSocket relay for HL + Aster
    └── lib/
        ├── cache.js            ← Redis TTL wrapper
        ├── fetcher.js          ← fetch with retry + timeout
        └── rss-parser.js       ← Zero-dependency RSS/Atom parser
```

---

## 4. Exchange API Reference

### 4.1 Hyperliquid (BASIC mode)

**Base URL:** `https://api.hyperliquid.xyz`  
**Via backend:** `/api/hl/*`  
**Auth:** None for read endpoints. Write endpoints (order placement) require EIP-712 signed actions — signing happens in the browser wallet, the backend just relays.

All read endpoints are `POST /info` with a `type` field:

| Frontend call | Body `type` | What it returns | Cache TTL |
|---|---|---|---|
| `getMetaAndAssetCtxs()` | `metaAndAssetCtxs` | All markets metadata + funding, OI, volume | 5s |
| `getMarketPrice(sym)` | `allMids` | Mid prices for all markets | 2s |
| `getCandles(sym, interval)` | `candleSnapshot` | OHLCV candles for charts | 10s |
| `getL2Book(sym)` | `l2Book` | Order book bids/asks | 2s |
| `loadBalance(addr)` | `clearinghouseState` | Account equity, margin, positions | 3s |
| `getPositions(addr)` | `clearinghouseState` | Open perpetual positions | 3s |
| `getUserFills(addr)` | `userFills` | Trade history | 30s |
| `getOpenOrders(addr)` | `openOrders` | Active orders | 3s |
| `getFundingHistory(addr)` | `userFundingHistory` | Funding payments received | 30s |

Example request body:
```json
POST https://api.hyperliquid.xyz/info
{ "type": "candleSnapshot", "req": { "coin": "BTC", "interval": "1h", "startTime": 0, "endTime": 0 } }
```

**Order placement** uses `POST /exchange` — **never cached**, direct passthrough only:
```json
POST https://api.hyperliquid.xyz/exchange
{
  "action": { "type": "order", "orders": [...], "grouping": "na" },
  "nonce": 1700000000000,
  "signature": { "r": "0x...", "s": "0x...", "v": 27 }
}
```

Order signing flow (all in browser, `src/trading.js`):
1. Build action object with wire-format short keys: `a` (asset), `b` (isBuy), `p` (price), `s` (size), `r` (reduceOnly), `t` (orderType)
2. msgpack-encode the action
3. keccak256 hash of (action bytes + nonce as uint64 BE + vault byte `0x00`)
4. signTypedData with EIP-712 domain `{ name: "Exchange", version: "1", chainId: 1337, ... }` and type `Agent`
5. POST to `/api/hl/exchange` — backend relays directly to HL, no cache

**Hyperliquid WebSocket**

Upstream: `wss://api.hyperliquid.xyz/ws`  
Via backend relay: `ws://your-server.com/ws`

Subscribe message format:
```json
{ "method": "subscribe", "subscription": { "type": "allMids" } }
{ "method": "subscribe", "subscription": { "type": "l2Book", "coin": "BTC" } }
{ "method": "subscribe", "subscription": { "type": "trades", "coin": "BTC" } }
{ "method": "subscribe", "subscription": { "type": "candle", "coin": "BTC", "interval": "1m" } }
{ "method": "subscribe", "subscription": { "type": "userEvents", "user": "0x..." } }
{ "method": "subscribe", "subscription": { "type": "userFills", "user": "0x..." } }
```

Unsubscribe — same body with `"method": "unsubscribe"`.

The relay tracks active subscriptions. When the first client subscribes to a topic, the relay sends the subscribe message upstream. When the last client leaves, it sends unsubscribe. After a disconnect/reconnect, it re-subscribes all active topics automatically.

---

### 4.2 Aster DEX (EXTRA mode)

**Base REST URL:** `https://fapi.asterdex.com`  
**Via backend:** `/api/aster-fapi/*`  
**Base WS URL:** `wss://fstream.asterdex.com/stream`  
**Via backend relay:** `ws://your-server.com/aster-stream`

**Required headers — backend injects these on every request:**
```
Referer: https://www.asterdex.com/
Origin: https://www.asterdex.com
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36
```

Without these headers, Aster rejects requests with 403.

**REST endpoints:**

| Frontend fetch path | Full endpoint | What it returns | Cache TTL |
|---|---|---|---|
| `/aster-fapi/fapi/v1/ticker/24hr` | `GET /fapi/v1/ticker/24hr` | All tickers: last price, 24h change %, volume | 5s |
| `/aster-fapi/fapi/v1/premiumIndex` | `GET /fapi/v1/premiumIndex` | Funding rates + mark price for all symbols | 5s |
| `/aster-fapi/fapi/v1/openInterest?symbol=BTCUSDT` | `GET /fapi/v1/openInterest` | Open interest for one symbol | 5s |
| `/aster-fapi/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=200` | `GET /fapi/v1/klines` | OHLCV candle data for chart | 10s |
| `/aster-fapi/fapi/v1/depth?symbol=BTCUSDT&limit=20` | `GET /fapi/v1/depth` | Order book: bids[] and asks[] | 2s |

**Klines response format** (same as Binance):
```json
[
  [1700000000000, "42000.00", "42500.00", "41800.00", "42200.00", "1234.56", ...],
  ...
]
// [openTime, open, high, low, close, volume, ...]
```

**Depth response:**
```json
{
  "bids": [["42000.00", "1.5"], ["41999.00", "2.1"], ...],
  "asks": [["42001.00", "0.8"], ["42002.00", "3.4"], ...]
}
```

**Supported symbols:**

Crypto (append `USDT`):
`BTC, ETH, SOL, BNB, XRP, DOGE, AVAX, ADA, LINK, DOT, SUI, APT, INJ, ARB, OP, PEPE, WIF, NEAR, ATOM, UNI`

Stock CFDs (append `USDT`):
`NVDA, TSLA, AAPL, MSFT, GOOGL, AMZN, META, COIN, MSTR, AMD`

All symbols must be passed as `BTCUSDT`, `NVDAUSDT`, etc.

**Exchange comparison:**

| | BASIC (Hyperliquid) | EXTRA (Aster DEX) |
|---|---|---|
| Collateral | USDC | USDT |
| Max leverage | 40x | 200x |
| Taker fee | 0.045% | 0.040% |
| Maker fee | 0.015% | 0.000% |
| Markets | ~50 crypto perps | 20 crypto + 10 stock CFDs |
| Min order | 10 USD | 5 USD |

---

### 4.3 LI.FI (Transfer page)

**What it is:** LI.FI is a cross-chain bridge + DEX aggregator. RDO ONE uses it on the Transfer page (`public/transfer.html`) to swap and bridge tokens across chains after withdrawing from HL or Aster.

**Base URL:** `https://li.quest`  
**Via backend:** `/api/lifi-api/*` → `/lifi-api/*` (dev proxy)  
**Auth:** None required for quote/route endpoints (public API)

**The only LI.FI endpoint used:**
```
GET /lifi-api/v1/quote
```

Query parameters:
| Param | Example | Description |
|---|---|---|
| `fromChain` | `42161` | Source chain ID |
| `toChain` | `1` | Destination chain ID |
| `fromToken` | `0xaf88d065...` | Source token contract address |
| `toToken` | `0xa0b86991...` | Destination token contract address |
| `fromAmount` | `5000000` | Amount in token's smallest unit (raw, no decimals) |
| `fromAddress` | `0xabc...` | User's wallet address (for routing) |
| `toAddress` | `0xabc...` | Recipient address (can differ from fromAddress) |
| `slippage` | `0.005` | 0.5% slippage tolerance |

**Quote response — fields the app uses:**
```json
{
  "transactionRequest": {
    "to": "0x...",       // LI.FI router contract
    "data": "0x...",     // encoded calldata — send as-is
    "value": "0",        // ETH value if bridging native
    "gasLimit": "350000"
  },
  "estimate": {
    "toAmount": "4985000",          // how much recipient gets (raw)
    "feeCosts": [{ "amountUSD": "1.20" }],
    "gasCosts": [{ "amountUSD": "0.80" }],
    "executionDuration": 45,         // seconds
    "approvalAddress": "0x..."       // spender for ERC20 approve
  },
  "action": {
    "fromToken": { "address": "0x...", "decimals": 6 },
    "toToken":   { "symbol": "ETH",   "decimals": 18 },
    "fromAmount": "5000000"
  },
  "includedSteps": [
    { "toolDetails": { "name": "Uniswap" }, "type": "swap" },
    { "toolDetails": { "name": "Stargate" }, "type": "cross" }
  ]
}
```

**Execution flow (in browser, no backend needed):**
1. Call `/lifi-api/v1/quote` → get `transactionRequest`
2. Check ERC20 allowance: `eth_call` → `allowance(owner, approvalAddress)`
3. If insufficient: `eth_sendTransaction` → `approve(approvalAddress, fromAmount)` → poll receipt
4. `eth_sendTransaction` with the `transactionRequest` data → poll receipt

**Supported chains (hardcoded in transfer.html):**

| Chain | Chain ID | Tokens |
|---|---|---|
| Arbitrum | 42161 | ETH, USDC, USDT, ARB, WBTC |
| Ethereum | 1 | ETH, USDC, USDT, WBTC |
| Base | 8453 | ETH, USDC, cbBTC |
| Optimism | 10 | ETH, USDC, USDT, OP |
| Polygon | 137 | POL, USDC, USDT, WBTC |
| BNB Chain | 56 | BNB, USDT, USDC, ETH |
| Avalanche | 43114 | AVAX, USDC, USDT |

**Key token addresses (Arbitrum — most relevant):**
```
USDC: 0xaf88d065e77c8cc2239327c5edb3a432268e5831
USDT: 0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9
ETH:  0x0000000000000000000000000000000000000000 (native)
WBTC: 0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f
ARB:  0x912ce59144191c1204e64559fe8253a0e49e6548
```

---

### 4.4 Transfer Page — Three Tabs

**Tab 1: Withdraw**

Withdraw from HL (USDC) or Aster (USDT) and receive any token on any chain.

Flow when destination is USDC on Arbitrum (same token, no swap):
```
1. Sign EIP-712 withdrawal in wallet → POST /hl/exchange (type: withdraw3)
   OR  sign Aster HMAC withdrawal  → POST /aster-fapi/v1/withdraw
2. Done — funds arrive on Arbitrum in ~2 min
```

Flow when destination is a different token or chain (LI.FI involved):
```
1. Withdraw from HL/Aster → wallet receives USDC/USDT on Arbitrum
2. Poll wallet balance every 12s until USDC/USDT arrives (up to 6-10 min)
3. GET /lifi-api/v1/quote → get route for USDC/USDT → target token/chain
4. ERC20 approve (if needed) → eth_sendTransaction with LI.FI calldata
5. Poll tx receipt → done
```

**Tab 2: Send**

Arbitrary cross-chain transfer using LI.FI only. Funds come from the user's connected wallet (not HL or Aster).

Flow:
```
1. User picks from chain/token, to chain/token, amount, destination address
2. GET /lifi-api/v1/quote (debounced 650ms) → show estimated receive amount, fee, gas, route, ETA
3. User clicks Send → ERC20 approve if needed → eth_sendTransaction
```

Quote is shown in real time as the user types. The send button is disabled until a valid quote exists.

**Tab 3: Between Accounts**

One-click fully automated transfer between HL and Aster accounts. Handles the full sequence.

HL → Aster flow (4 steps):
```
1. Withdraw USDC from Hyperliquid (EIP-712 signed, POST /hl/exchange)
2. Poll wallet every 12s until USDC arrives on Arbitrum (~2-6 min)
3. GET /lifi-api/v1/quote for USDC → USDT on Arbitrum → swap via LI.FI
4. GET Aster deposit address (HMAC signed) → send USDT to it via ERC20 transfer
```

Aster → HL flow (4 steps):
```
1. Withdraw USDT from Aster (HMAC signed, POST /aster-fapi/v1/withdraw)
2. Poll wallet every 12s until USDT arrives on Arbitrum (~5-10 min)
3. GET /lifi-api/v1/quote for USDT → USDC on Arbitrum → swap via LI.FI
4. Hyperliquid auto-detects USDC on Arbitrum and credits the account
```

User signs 2-3 wallet transactions total (withdrawal EIP-712 + ERC20 approve + swap tx).

**Aster API authentication (used in Transfer page):**

Aster uses HMAC-SHA256 signing — all signed in browser using `crypto.subtle`, no server involved:
```js
// Build query string with timestamp
const qs = `asset=USDT&amount=100&address=0x...&timestamp=${Date.now()}`;

// Import secret key
const k = await crypto.subtle.importKey('raw', enc.encode(secret),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

// Sign and hex-encode
const sig = await crypto.subtle.sign('HMAC', k, enc.encode(qs));
const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');

// Request
POST /aster-fapi/v1/withdraw?${qs}&signature=${hex}
Headers: { 'X-MBX-APIKEY': apiKey }
```

Aster deposit address endpoint:
```
GET /aster-fapi/v1/capital/deposit/address?coin=USDT&network=ARBITRUM&timestamp=...&signature=...
Headers: { 'X-MBX-APIKEY': apiKey }
Response: { address: "0x..." }
```

**Progress tracker UI:**

All multi-step flows show a live step tracker with animated dots:
- Spinning dot = step in progress
- Green check = step complete
- Red X = step failed
- Each step has a real-time status message that updates as it progresses

---

## 5. Backend Routes (All Routes)

### REST — all prefixed with `/api/` in production

```
POST /api/hl/exchange          → https://api.hyperliquid.xyz/exchange      (NO CACHE — orders/cancels)
POST /api/hl/*                 → https://api.hyperliquid.xyz/*              (cached, TTL by type)
GET  /api/binance/*            → https://api.binance.com/*                  5s cache
GET  /api/coingecko/*          → https://api.coingecko.com/*                60s cache
GET  /api/feargreed/*          → https://api.alternative.me/*               3600s cache
GET  /api/aster-fapi/*         → https://fapi.asterdex.com/*                5s cache (+ Aster headers)
POST /api/aster-fapi/*         → https://fapi.asterdex.com/*                no cache (+ Aster headers)
GET  /api/lifi-api/*           → https://li.quest/*                         10s cache
GET  /api/news                 → aggregates 8 RSS feeds → JSON              300s cache
GET  /api/swap/quote           → https://api.1inch.dev/swap/v6.0/*          10s cache
GET  /api/swap/build           → https://api.1inch.dev/swap/v6.0/*          NO CACHE (builds tx)
GET  /api/swap/tokens          → https://api.1inch.dev/swap/v6.0/*          3600s cache
GET  /health                   → { status, uptime, timestamp }
```

Legacy dev-proxy paths (still work via Vite in dev — not needed in production):
```
/hl/*          → Hyperliquid
/aster-fapi/*  → Aster DEX
/coingecko/*   → CoinGecko
/binance/*     → Binance
/feargreed/*   → Fear & Greed
/lifi-api/*    → LI.FI
/ctnews/*      → CoinTelegraph RSS
/cdnews/*      → CoinDesk RSS
/decnews/*     → Decrypt RSS
/blknews/*     → The Block RSS
/bwknews/*     → Blockworks RSS
/btcmnews/*    → Bitcoin Magazine RSS
/beinnews/*    → BeInCrypto RSS
/btcinews/*    → Bitcoinist RSS
/aster-stream  → Aster WS (dev only, Vite proxies WS)
```

### WebSocket

```
ws://server/ws              → relay to wss://api.hyperliquid.xyz/ws
ws://server/aster-stream    → relay to wss://fstream.asterdex.com/stream
```

Both relays:
- Maintain one persistent upstream connection per exchange
- Fan out all messages to all connected browser clients
- Track active subscriptions — only forwards unique subscribe/unsubscribe calls upstream
- Auto-reconnect on upstream disconnect (2s delay)
- Re-subscribe all active topics after reconnect

---

## 6. Caching Strategy

| Data | TTL | Reason |
|---|---|---|
| HL `/exchange` | NONE | State-changing — never cache |
| HL `allMids` | 2s | Real-time prices |
| HL `l2Book` | 2s | Order book changes fast |
| HL `clearinghouseState` | 3s | Position/balance |
| HL `openOrders` | 3s | Order status |
| HL `metaAndAssetCtxs` | 5s | Market metadata |
| HL `candleSnapshot` | 10s | Chart candles |
| HL `userFills` | 30s | Trade history |
| HL `userFundingHistory` | 30s | Funding history |
| Aster `depth` | 2s | Order book |
| Aster `ticker/24hr` | 5s | Prices |
| Aster `premiumIndex` | 5s | Funding rates |
| Aster `openInterest` | 5s | OI |
| Aster `klines` | 10s | Chart candles |
| Binance klines | 5s | Sparkline data |
| LI.FI routes | 10s | Bridge routes |
| CoinGecko | 60s | Market overview |
| 1inch quotes | 10s | Price-sensitive |
| News RSS (aggregated) | 300s | 5 min is fresh enough |
| Fear & Greed | 3600s | Updates once per day |
| 1inch token list | 3600s | Rarely changes |

---

## 7. Environment Variables

`server/.env.example`:
```env
PORT=3001
NODE_ENV=production

# Comma-separated frontend origins — leave empty to allow all (dev only)
ALLOWED_ORIGINS=https://rdoone.com,https://www.rdoone.com

# Redis connection string
REDIS_URL=redis://localhost:6379

# 1inch API key — get free at portal.1inch.dev
ONEINCH_API_KEY=your_key_here

# Rate limiting
RATE_LIMIT_MAX=200
RATE_LIMIT_WINDOW_MS=60000
```

Redis is **optional** — if it can't connect, the server falls back to no-cache mode (every request hits upstream). Everything still works, just slower under load.

---

## 8. Running Locally

**Frontend (dev):**
```bash
cd rdo-one
npm install
npm run dev
# Opens http://localhost:5176
```

Vite's dev proxy handles all `/api/*` paths — same paths the production backend uses.

**Backend (dev):**
```bash
cd rdo-one/server
npm install
cp .env.example .env
npm run dev   # --watch flag for auto-reload
# Listens on http://localhost:3001
# Test: curl http://localhost:3001/health
```

**Production build:**
```bash
cd rdo-one
npm run build
# Outputs to dist/ — deploy this to CDN
```

---

## 9. Deployment

### Railway (easiest — ~$5-7/month)

```bash
npm install -g @railway/cli
cd rdo-one/server
railway login
railway init
# Add Redis plugin from Railway dashboard
railway variables set ONEINCH_API_KEY=xxx
railway variables set ALLOWED_ORIGINS=https://rdoone.com
railway up
```

Railway auto-detects Node.js, runs `npm start`, provides an HTTPS domain.

---

### Fly.io

Create `server/fly.toml`:
```toml
app = "rdo-one-api"
primary_region = "iad"

[http_service]
  internal_port = 3001
  force_https   = true

[[vm]]
  cpu_kind  = "shared"
  cpus      = 1
  memory_mb = 256
```

```bash
fly auth login
fly launch
fly redis create
fly secrets set ONEINCH_API_KEY=xxx ALLOWED_ORIGINS=https://rdoone.com
fly deploy
```

---

### VPS (Hetzner CX21 — €3.79/month)

```bash
# Node 20 + Redis + Nginx + PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs redis-server nginx
npm install -g pm2

# Clone and start backend
git clone https://github.com/wholelottawork/rdo-one-setup.git
cd rdo-one-setup/server
npm install
cp .env.example .env
nano .env   # fill in values

pm2 start index.js --name rdo-one-api
pm2 startup && pm2 save
```

Nginx config (`/etc/nginx/sites-available/rdoone`):
```nginx
server {
    listen 443 ssl http2;
    server_name rdoone.com www.rdoone.com;
    ssl_certificate     /etc/letsencrypt/live/rdoone.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rdoone.com/privkey.pem;

    # Frontend static files
    root /var/www/rdo-one/dist;
    index index.html;
    try_files $uri $uri/ /index.html;

    # Backend REST
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    }

    location /health {
        proxy_pass http://localhost:3001;
    }

    # HL WebSocket relay
    location /ws {
        proxy_pass         http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_read_timeout 86400s;
    }

    # Aster WebSocket relay
    location /aster-stream {
        proxy_pass         http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_read_timeout 86400s;
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
}

server {
    listen 80;
    server_name rdoone.com www.rdoone.com;
    return 301 https://$host$request_uri;
}
```

Get SSL cert: `certbot --nginx -d rdoone.com -d www.rdoone.com`

---

## 10. Frontend URL Mapping

Same URL paths in dev (Vite proxy) and production (backend). No code changes needed between environments.

| Frontend code | Dev (Vite proxy) | Prod (Fastify backend) |
|---|---|---|
| `fetch('/api/hl/info', { method: 'POST', body: ... })` | → `api.hyperliquid.xyz/info` | → `/api/hl/*` route |
| `fetch('/api/hl/exchange', { method: 'POST', body: ... })` | → `api.hyperliquid.xyz/exchange` | → `/api/hl/exchange` (no cache) |
| `fetch('/aster-fapi/fapi/v1/ticker/24hr')` | → `fapi.asterdex.com/fapi/v1/ticker/24hr` | → `/api/aster-fapi/*` |
| `fetch('/aster-fapi/fapi/v1/klines?symbol=BTCUSDT&interval=1m')` | → `fapi.asterdex.com/...` | → `/api/aster-fapi/*` |
| `fetch('/api/binance/api/v3/klines?...')` | → `api.binance.com/api/v3/klines` | → `/api/binance/*` |
| `fetch('/api/coingecko/api/v3/global')` | → `api.coingecko.com/...` | → `/api/coingecko/*` |
| `fetch('/api/news')` | N/A (no Vite rule for this) | → `/api/news` aggregated RSS |
| `new WebSocket(hlWsUrl())` | `wss://api.hyperliquid.xyz/ws` (direct) | `wss://rdoone.com/ws` (relay) |

The `hlWsUrl()` function in `trading.js`:
```js
function hlWsUrl() {
  if (import.meta.env.PROD) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }
  return 'wss://api.hyperliquid.xyz/ws';
}
```

---

## 11. News Aggregation (`/api/news`)

Aggregates 8 RSS feeds in parallel, deduplicates by URL, sorts by date newest-first.

| Source | RSS URL |
|---|---|
| CoinTelegraph | `https://cointelegraph.com/rss` |
| CoinDesk | `https://www.coindesk.com/arc/outboundfeeds/rss/` |
| Decrypt | `https://decrypt.co/feed` |
| BeInCrypto | `https://beincrypto.com/feed/` |
| Bitcoinist | `https://bitcoinist.com/feed/` |
| CryptoSlate | via `rss2json.com` → `cryptoslate.com/feed/` |
| Blockworks | via `rss2json.com` → `blockworks.co/feed` |
| Bitcoin Magazine | via `rss2json.com` → `bitcoinmagazine.com/.rss/full/` |

Response:
```json
{
  "articles": [
    {
      "title": "...",
      "url": "https://...",
      "source": "CoinTelegraph",
      "publishedAt": "2024-01-01T12:00:00Z",
      "image": "https://..."
    }
  ],
  "count": 80,
  "sources": 8,
  "sourcesFailed": 0,
  "updatedAt": "2024-01-01T12:05:00Z"
}
```

---

## 12. Security

1. **No private keys server-side** — all EIP-712 signing happens in browser wallet (MetaMask/Rabby)
2. **CORS whitelist** — only requests from `ALLOWED_ORIGINS` accepted in production
3. **Rate limiting** — 200 req/min per IP via Redis, returns 429 with `Retry-After`
4. **`/exchange` never cached** — order placement always goes directly to HL
5. **Aster spoofed headers server-side** — `Origin: https://www.asterdex.com` never exposed to browser
6. **1inch API key server-side only** — never appears in browser JS bundle
7. **Redis on localhost only** — bind `127.0.0.1:6379`, never expose to internet
8. **`.env` in `.gitignore`** — only `.env.example` committed to repo

---

## 13. Quick Start

```bash
# Clone
git clone https://github.com/wholelottawork/rdo-one-setup.git
cd rdo-one-setup

# Frontend (dev)
cd rdo-one
npm install
npm run dev
# → http://localhost:5176

# Backend (separate terminal)
cd rdo-one/server
npm install
cp .env.example .env
npm run dev
# → http://localhost:3001
# → curl http://localhost:3001/health
```

**`server/package.json` dependencies:**
```json
{
  "dependencies": {
    "fastify": "^4",
    "@fastify/cors": "^9",
    "@fastify/rate-limit": "^9",
    "dotenv": "^16",
    "fastify-plugin": "^4",
    "ioredis": "^5",
    "ws": "^8"
  }
}
```
