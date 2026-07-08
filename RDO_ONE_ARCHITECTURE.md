# RDO ONE — Full Architecture Reference

**Version:** 1.0  
**Stack:** Vite + Vanilla JS (frontend) · Node.js + Fastify + Redis (backend)  
**Exchanges:** Hyperliquid (BASIC) · Aster DEX (EXTRA)  
**Port (dev):** 5176

---

## 1. Project Overview

RDO ONE is a dual-exchange perpetuals trading terminal. It connects directly to two DEX perp protocols — Hyperliquid and Aster DEX — through a unified interface. Users switch between exchanges via the BASIC / EXTRA mode toggle without leaving the app.

**Design philosophy:** All signing happens in the browser. The backend is a stateless CORS proxy + Redis cache + WebSocket relay. It never touches private keys or holds funds.

---

## 2. Repository Structure

```
rdo-one/
│
├── index.html                  ← Main trade terminal (SPA entry point)
├── lifi.html                   ← LI.FI React widget page
├── vite.config.js              ← Dev proxy (mirrors production backend paths)
├── package.json
│
├── public/                     ← Static sub-pages (full HTML, no bundler)
│   ├── markets.html            ← Global market overview + ticker
│   ├── news.html               ← Crypto news aggregator (RSS feeds)
│   ├── portfolio.html          ← Wallet PnL tracker (HL + Aster)
│   └── transfer.html           ← LI.FI cross-chain bridge UI
│
├── src/
│   ├── main.js                 ← App bootstrap, mode switching, market dropdown, WS init
│   ├── trading.js              ← HL REST + WS, EIP-712 order signing, position management
│   ├── chart.js                ← Lightweight Charts v5 wrapper (candles + real-time ticks)
│   ├── wallet.js               ← MetaMask / Rabby / WalletConnect EVM connection
│   ├── walletconnect.js        ← WalletConnect v2 (WC modal + ethers provider)
│   ├── deposit.js              ← USDC deposit address modal
│   ├── onramp.js               ← Fiat on-ramp integration
│   ├── i18n.js                 ← EN / RU / ZH translations (data-i18n attributes)
│   ├── toast.js                ← Toast notification system
│   └── styles.css              ← Full design system (CSS custom properties)
│
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
    │   └── relay.js            ← WebSocket relay for HL + Aster streams
    └── lib/
        ├── cache.js            ← Redis TTL wrapper
        ├── fetcher.js          ← fetch() with retry + timeout
        └── rss-parser.js       ← Zero-dependency RSS/Atom parser
```

---

## 3. Frontend Architecture

### 3.1 App Layout (CSS Grid)

The main terminal uses a 5-row grid:

```
┌─────────────────────────────────────────────┐  ← 40px  .hdr
│ RDO ONE  BASIC EXTRA  Trade Markets ...     │
├──────────────────┬──────────────────────────┤
│                  │                          │
│   TradingView    │   Trade Panel (.tp-*)    │  ← 1fr   .main-row
│   Candle Chart   │   Order Book (.ob-*)     │
│                  │   Live Trades (.lt-*)    │
│                  ├──────────────────────────┤
│  X Tracker       │                          │
│  (.xt-*)         │                          │
├──────────────────┴──────────────────────────┤  ← 4px   resize handle
│  Positions  Balances  Open Orders  ...      │  ← 175px .btm-*
├─────────────────────────────────────────────┤  ← 22px  .sb (status bar)
│  Connected  ●  BTC-USDC  07:36:28 UTC       │
└─────────────────────────────────────────────┘
```

CSS variables controlling layout:
```css
--hdr:  40px;   /* top navigation bar */
--xt:   240px;  /* X Tracker sidebar width */
--tp:   268px;  /* trade panel width */
--tr:   280px;  /* trades/orderbook column width */
--btm:  175px;  /* bottom panel height */
--sb:   22px;   /* status bar height */
```

### 3.2 Mode Switching (BASIC ↔ EXTRA)

`src/main.js` — `setMode(mode)`:
- Switches CSS class on `<body>`: `body.mode-aster` overrides accent/buy colours
- Rebuilds market dropdown with the selected exchange's ticker list
- Disconnects existing WebSocket, connects to the mode's WS relay
- Fetches new candle data from the mode's API endpoint
- Updates all labels (funding, OI, volume) from the correct exchange

BASIC mode → Hyperliquid API (`/api/hl/*`)  
EXTRA mode → Aster DEX API (`/api/aster-fapi/*`)

### 3.3 Market Dropdown

`bindMarketBtn()` in `main.js`:
- Opens with blur backdrop (`#mktBackdrop`, z-index 499)
- Real-time search filter on `mktSearch` input
- Keyboard navigation: `↑↓` to move focus, `Enter` to select, `Esc` to close
- Hints bar at bottom showing keyboard shortcuts

### 3.4 Chart Module (`src/chart.js`)

Wraps Lightweight Charts v5:
- `initChart()` — creates chart instance, attaches ResizeObserver
- `setCandles(data, sym)` — loads historical OHLCV array
- `pushTick(sym, px)` — updates last candle in real-time from WebSocket
- Crosshair move → updates OHLC display in chart subheader
- Theme: pure black background, `#1f1f1f` grid lines

### 3.5 Trading Module (`src/trading.js`)

Handles all order placement for Hyperliquid:

1. **EIP-712 signing** — builds action object with wire-format keys, encodes with msgpack, keccak256 hashes, signs with `eth_signTypedData_v4`
2. **Order types** — Market / Limit, Buy / Sell, Reduce Only, TP/SL
3. **Position management** — loads `clearinghouseState`, renders open positions in bottom panel
4. **Real-time updates** — `userFills` and `userEvents` WebSocket subscriptions update UI without polling

### 3.6 Wallet Module (`src/wallet.js`)

- Detects MetaMask / Rabby / injected EVM provider
- Falls back to WalletConnect v2 via `src/walletconnect.js`
- On connect: sets HyperEVM chain (chainId 998), loads balances, subscribes to user WS events
- Address stored in memory only, never persisted

### 3.7 Internationalisation (`src/i18n.js`)

- Three locales: EN (default), RU, ZH
- All strings stored in a `TRANSLATIONS` map keyed by `data-i18n` attribute
- `applyLang(locale)` walks the DOM and replaces `textContent` / `placeholder`
- Language persisted to `localStorage`

---

## 4. Sub-pages

All four sub-pages are standalone HTML files in `/public/`. They share the same CSS variable system (black theme) and nav structure but have no dependency on the Vite build.

### 4.1 Markets (`markets.html`)

- **Ticker bar** — scrolling marquee of top pairs with price and 24h change (CoinGecko)
- **Market overview** — global market cap, 24h volume, BTC dominance, Fear & Greed index
- **Market Statistics** — BTC/ETH price, market cap, BTC volume (CoinGecko `/global`)
- **Trending** — top trending coins (CoinGecko `/trending`)
- **Top Gainers/Losers** — 24h movers (CoinGecko `/coins/markets`)
- **Converter** — live price calculator between any two assets

### 4.2 News (`news.html`)

- Fetches from `/api/news` (backend aggregates 8 RSS feeds)
- Sources: CoinDesk, Decrypt, The Block, BeInCrypto, CryptoSlate, Bitcoin.com, U.Today, Cointelegraph
- Frontend filters by category (DeFi, Bitcoin, Ethereum, Altcoins, Regulation, NFT)
- Source-filter chips let users show/hide individual publications
- Auto-refresh every 5 minutes

### 4.3 Portfolio (`portfolio.html`)

Two sections — BASIC (Hyperliquid) and EXTRA (Aster):

**Hyperliquid section:**
- Enter any 0x wallet address or connect Phantom/MetaMask
- Loads `clearinghouseState` → equity, positions, margin
- Fetches `userFills` → trade history for PnL calculation
- PnL calendar (daily heatmap), cumulative PnL chart (SVG)
- PnL distribution histogram
- Perps portfolio table (position, size, entry, mark, PnL, funding)

**Aster section:**
- Same layout, different API endpoints (`/api/aster-fapi/*`)
- HMAC signing for Aster authenticated endpoints (using `crypto.subtle` in browser)

### 4.4 Transfer (`transfer.html`)

Three tabs, all built on LI.FI:

| Tab | Function | API |
|---|---|---|
| **Withdraw** | Move funds from HL/Aster off-chain to any EVM chain | LI.FI quote → sign in wallet |
| **Send** | Cross-chain token send (wallet A → wallet B) | LI.FI route |
| **Between Accounts** | Move between your own HL and Aster accounts | Protocol-level transfer |

All LI.FI calls route through `/lifi-api/v1/*` (backend proxy preserves the LI.FI API key server-side).

---

## 5. Backend Proxy Routes

All routes are defined in `server/routes/proxy.js`.

| Route | Upstream | Cache TTL | Notes |
|---|---|---|---|
| `POST /api/hl/info` | `https://api.hyperliquid.xyz/info` | 2–30s by type | Never cached: `order`, `cancel`, `userFills` |
| `POST /api/hl/exchange` | `https://api.hyperliquid.xyz/exchange` | None | Direct passthrough, order placement |
| `GET /api/binance/klines` | `https://api.binance.com/api/v3/klines` | 10s | Chart candle fallback |
| `GET /api/coingecko/*` | `https://api.coingecko.com/api/v3/*` | 30–300s | Rate limit sensitive |
| `GET /api/feargreed/*` | `https://api.alternative.me/fng/*` | 300s | Slow-changing index |
| `GET /api/aster-fapi/*` | `https://fapi.asterdex.com/*` | 2–10s | Injects Aster Referer/Origin headers |
| `GET /api/news` | 8× RSS feeds | 300s | Aggregated, parsed, sorted by date |
| `GET /api/swap/*` | `https://api.1inch.dev/*` | 0s | 1inch API key injected server-side |
| `GET /lifi-api/*` | `https://li.quest/*` | 0s | LI.FI API key injected server-side |

### WebSocket Relays

| Endpoint | Upstream | Purpose |
|---|---|---|
| `ws://server/ws` | `wss://api.hyperliquid.xyz/ws` | HL price ticks, order book, user events |
| `ws://server/aster-stream` | `wss://fstream.asterdex.com/stream` | Aster price ticks, book, trades |

Relay behaviour: fan-out (N browser clients → 1 upstream connection). Tracks subscriptions per topic — subscribes upstream only when first client joins, unsubscribes when last client leaves. Auto-reconnects on upstream disconnect.

---

## 6. Exchange API Reference

### 6.1 Hyperliquid

**Base:** `https://api.hyperliquid.xyz`  
**All reads:** `POST /info` with `{ "type": "..." }` body

| type field | Returns | Cache |
|---|---|---|
| `metaAndAssetCtxs` | All markets, funding rates, OI, volume | 5s |
| `allMids` | Mid prices for all markets | 2s |
| `candleSnapshot` | OHLCV for chart | 10s |
| `l2Book` | Order book bids/asks | 2s |
| `clearinghouseState` | Account equity, positions, margin | 3s |
| `userFills` | Full trade history | 30s |
| `openOrders` | Active orders | 3s |
| `userFundingHistory` | Funding payments | 30s |

**Order placement:** `POST /exchange` — EIP-712 signed payload, no cache.

Order signing steps (all browser-side, `src/trading.js`):
1. Build action with wire-format short keys (`a`, `b`, `p`, `s`, `r`, `t`)
2. msgpack-encode action
3. keccak256 hash of (encoded bytes + nonce uint64 BE + vault byte `0x00`)
4. `eth_signTypedData_v4` with EIP-712 domain `{ name: "Exchange", version: "1", chainId: 1337 }`
5. POST to `/api/hl/exchange`

### 6.2 Aster DEX

**Base REST:** `https://fapi.asterdex.com`  
**Base WS:** `wss://fstream.asterdex.com/stream`  
**Required headers (injected by backend):** `Referer`, `Origin`, `User-Agent` matching `asterdex.com`

| Endpoint | Returns | Cache |
|---|---|---|
| `GET /fapi/v1/ticker/24hr` | All tickers: price, 24h change, volume | 5s |
| `GET /fapi/v1/premiumIndex` | Funding rates + mark price | 5s |
| `GET /fapi/v1/openInterest?symbol=` | Open interest | 5s |
| `GET /fapi/v1/klines?symbol=&interval=&limit=` | OHLCV candles (Binance format) | 10s |
| `GET /fapi/v1/depth?symbol=&limit=` | Order book bids/asks | 2s |

**Withdrawals** use HMAC-SHA256 authentication (browser `crypto.subtle`).

### 6.3 LI.FI

**Proxy path:** `/lifi-api/v1/*`  
**Upstream:** `https://li.quest/v1/*`  

Key endpoints used:
```
GET  /quote?fromChain=&toChain=&fromToken=&toToken=&fromAmount=&fromAddress=
GET  /routes
POST /transactions
```

---

## 7. Design System

All colours flow through CSS custom properties in `src/styles.css`:

```css
:root {
  /* Backgrounds */
  --hl-bg-page:        #000000;   /* pure black page */
  --hl-bg-elevated:    #0d0d0d;   /* panels, dropdowns */
  --hl-bg-overlay:     #161616;   /* hover states in lists */

  /* Accent */
  --hl-accent:         #50d2c1;   /* teal — HL mode */
  /* Aster override: body.mode-aster { --hl-accent: #a78bfa } */

  /* Trade colours (Bloom-inspired) */
  --hl-buy:            #7cffc0;   /* mint green — buy side text */
  --hl-sell:           #ff7caa;   /* pink — sell side text */

  /* Text hierarchy */
  --hl-text-primary:   #ffffff;
  --hl-text-secondary: #878c8f;
  --hl-text-muted:     #6b7173;

  /* Borders */
  --hl-border:         #1f1f1f;

  /* Radius */
  --hl-radius:         6px;       /* buttons, inputs */
  --hl-radius-panel:   10px;      /* dropdowns, cards */
}
```

**Nav active state** — Bloom pill style: `background: #1f1f1f`, `border-radius: 7px`, `font-weight: 600`. Same applied to nav, bottom tabs, all sub-pages.

**Blur backdrops** — All dropdowns (market, mode, language) dim the rest of the UI via a fixed-position div with `backdrop-filter: blur(4px)`.

---

## 8. Development Setup

### Prerequisites

- Node.js 20+
- npm 9+
- Redis (optional — backend degrades gracefully without it)

### Frontend (dev mode)

```bash
cd rdo-one
npm install
npm run dev       # http://localhost:5176
```

Vite proxies all `/api/*`, `/ws`, `/aster-stream`, `/lifi-api/*` to `http://localhost:3001` (the backend dev server).

### Backend (dev mode)

```bash
cd rdo-one/server
cp .env.example .env
# fill in ONEINCH_KEY, LIFI_KEY, REDIS_URL
npm install
node index.js     # http://localhost:3001
```

### Build (production)

```bash
cd rdo-one
npm run build     # outputs to dist/
```

Serve `dist/` from any static host (Vercel, Cloudflare Pages, Nginx). The backend must be deployed separately and accessible at the configured `VITE_API_BASE` URL.

---

## 9. Data Flow Diagram

```
Browser
│
│   User opens terminal
│   ↓
├── GET /api/hl/info { type: "metaAndAssetCtxs" }
│        → Backend → api.hyperliquid.xyz → Redis cache 5s
│        → Populates market list + stats in UI
│
├── WS /ws
│        → Backend relay → wss://api.hyperliquid.xyz/ws
│        → Subscribes: allMids, l2Book, trades, candle
│        → chart.js.pushTick() on every price update
│
├── User selects market (e.g. ETH)
│   ↓
│   main.js: selectMarket("ETH")
│   ↓
│   WS: unsubscribe BTC, subscribe ETH
│   REST: fetch candles → chart.js.setCandles()
│   REST: fetch order book → render bids/asks
│
├── User connects wallet
│   ↓
│   wallet.js: eth_requestAccounts
│   → HyperEVM chain switch (chainId 998)
│   → loadBalance() → clearinghouseState
│   → WS subscribe userEvents, userFills
│
└── User places order
    ↓
    trading.js: buildAction() → msgpack → keccak256
    → eth_signTypedData_v4 (browser signs locally)
    → POST /api/hl/exchange (backend passthrough)
    → HL confirms → userFills WS event → UI updates
```

---

## 10. Key Dependencies

| Package | Version | Purpose |
|---|---|---|
| `vite` | ^5.4 | Dev server + bundler |
| `lightweight-charts` | ^5.2 | TradingView-style candle charts |
| `@lifi/widget` | ^4.1 | LI.FI cross-chain bridge React widget |
| `ethers` | ^6.13 | EVM wallet interaction, EIP-712 signing |
| `@walletconnect/ethereum-provider` | ^2.23 | WalletConnect v2 support |
| `react` / `react-dom` | ^19.2 | Used only for lifi.html page |
| `fastify` | ^4 | Backend HTTP server |
| `ioredis` | ^5 | Redis client |
| `@fastify/websocket` | ^8 | WebSocket plugin |
| `@fastify/cors` | ^9 | CORS plugin |
| `@fastify/rate-limit` | ^9 | Rate limiting |

---

## 11. Deployment

### Railway / Render

1. Connect GitHub repo
2. Set root directory to `rdo-one/server`
3. Build command: `npm install`
4. Start command: `node index.js`
5. Set env vars: `PORT`, `REDIS_URL`, `ONEINCH_KEY`, `LIFI_KEY`, `ALLOWED_ORIGINS`

### Fly.io

```toml
# fly.toml
[build]
  builder = "heroku/buildpacks:20"

[[services]]
  internal_port = 3001
  protocol = "tcp"
  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
```

### VPS (Nginx + PM2)

```nginx
server {
  listen 443 ssl;
  server_name api.rdoone.com;

  location / {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";  # required for WS
  }
}
```

```bash
pm2 start server/index.js --name rdo-backend
pm2 save
```

---

## 12. Environment Variables

```env
# server/.env
PORT=3001
REDIS_URL=redis://localhost:6379
ONEINCH_KEY=your_1inch_api_key
LIFI_KEY=your_lifi_api_key
ALLOWED_ORIGINS=https://rdoone.com,https://www.rdoone.com
NODE_ENV=production
```

```env
# rdo-one/.env (Vite frontend build)
VITE_API_BASE=https://api.rdoone.com
VITE_WS_BASE=wss://api.rdoone.com
```
