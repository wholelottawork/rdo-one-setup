# RDO ONE — Complete Backend Implementation Guide

**Version:** 1.0  
**Target:** Developers building the production backend for RDO ONE trading terminal  
**Frontend repo:** `rdo-one-setup` (Vite + vanilla JS + React for Li.Fi widget)

---

## Table of Contents

1. [Why a Backend is Needed](#1-why-a-backend-is-needed)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Stack](#3-technology-stack)
4. [Project Structure](#4-project-structure)
5. [Component 1 — API Proxy Server](#5-component-1--api-proxy-server)
6. [Component 2 — WebSocket Relay](#6-component-2--websocket-relay)
7. [Component 3 — News Aggregation Service](#7-component-3--news-aggregation-service)
8. [Component 4 — 1inch Swap Proxy](#8-component-4--1inch-swap-proxy)
9. [Component 5 — Deposit Flow (Client-Side Modules)](#9-component-5--deposit-flow-client-side-modules)
10. [Caching Strategy](#10-caching-strategy)
11. [Environment Variables](#11-environment-variables)
12. [Database](#12-database)
13. [Deployment](#13-deployment)
14. [Security](#14-security)
15. [Development Phases](#15-development-phases)

---

## 1. Why a Backend is Needed

The current frontend uses `vite.config.js` proxy rules that only work in **development mode**. In production (static build deployed to CDN), all proxy routes return 404 and the app breaks entirely.

**What breaks in production without a backend:**

| Feature | Why It Breaks |
|---|---|
| Hyperliquid prices & order book | CORS — browser can't call HL API directly |
| Binance price data | CORS |
| CoinGecko market data | CORS + rate limits without server-side caching |
| News feeds (CoinTelegraph, CoinDesk, etc.) | CORS on RSS endpoints |
| 1inch swap quotes | API key can't be exposed client-side |
| Real-time WebSocket data | Needs relay for stability at scale |

The backend is **not** a custodial system. It does not hold user funds or private keys. It is purely:
- A **CORS proxy** for external APIs
- A **cache layer** to reduce API calls and improve speed
- A **WebSocket relay** for real-time market data
- A **secure wrapper** for API keys that can't be client-side

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER (Users)                         │
│  Vite build (static HTML/JS/CSS)  ·  Hosted on Cloudflare CDN  │
└─────────────┬─────────────────────────────────┬─────────────────┘
              │ HTTP /api/*                      │ WS /ws
              ▼                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                       RDO ONE Backend                           │
│                     (Node.js + Fastify)                         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │  API Proxy   │  │  WS Relay    │  │  News Aggregator   │    │
│  │  + Cache     │  │  (HL, Binance│  │  (RSS + rss2json)  │    │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬──────────┘    │
│         │                 │                     │               │
│         └─────────────────┼─────────────────────┘              │
│                           ▼                                     │
│                    ┌─────────────┐                              │
│                    │    Redis    │  (caching layer)             │
│                    └─────────────┘                              │
└──────────┬──────────────────────────────────────────────────────┘
           │ Outbound requests
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      External APIs                              │
│  Hyperliquid API  ·  Binance  ·  CoinGecko  ·  RSS Feeds       │
│  alternative.me  ·  1inch  ·  Jupiter  ·  Wormhole             │
└─────────────────────────────────────────────────────────────────┘
```

**Key principle:** The deposit flow (Jupiter swap, Wormhole bridge, HL contract call) is **100% client-side**. Users sign transactions with their own wallets. The backend never touches private keys.

---

## 3. Technology Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | **Node.js 20 LTS** | Same ecosystem as frontend (JS everywhere) |
| HTTP framework | **Fastify v4** | 2× faster than Express, built-in schema validation, plugin system |
| WebSocket | **`ws` npm package** | Lightweight, no Socket.io overhead needed |
| Cache | **Redis 7** | Millisecond TTL cache, pub/sub for WebSocket fanout |
| Process manager | **PM2** | Zero-downtime restarts, log management |
| Reverse proxy | **Caddy** or **Nginx** | SSL termination, static file serving |
| Deployment | **Railway** or **Fly.io** | $5–7/month, Git push deploy |

**Why Fastify over Express:**
- Built-in JSON schema validation (prevents bad data)
- Hooks system (request lifecycle plugins)
- 3× faster JSON serialization via `fast-json-stringify`
- Better TypeScript support if you want to migrate later

---

## 4. Project Structure

Reorganize the repository into a monorepo:

```
rdo-one/
│
├── client/                    ← Frontend (current codebase, renamed)
│   ├── src/
│   │   ├── main.js            ← Trading terminal JS
│   │   ├── lifi.jsx           ← Li.Fi widget
│   │   ├── deposit-evm.js     ← NEW: EVM deposit module
│   │   └── deposit-sol.js     ← NEW: Solana deposit module
│   ├── public/
│   │   ├── portfolio.html
│   │   ├── news.html
│   │   └── markets.html
│   ├── index.html
│   └── vite.config.js         ← Remove all proxy rules (backend handles them)
│
└── server/                    ← NEW: Backend
    ├── index.js               ← Entry point, registers all plugins and routes
    ├── package.json
    ├── .env                   ← Never commit this
    ├── .env.example           ← Commit this
    │
    ├── plugins/
    │   ├── redis.js           ← Redis connection singleton
    │   ├── cors.js            ← CORS configuration
    │   └── rate-limit.js      ← Rate limiting per IP
    │
    ├── routes/
    │   ├── proxy.js           ← All HTTP proxy routes
    │   ├── swap.js            ← 1inch proxy (server-side API key)
    │   ├── news.js            ← News aggregation endpoint
    │   └── health.js          ← Health check endpoint
    │
    ├── ws/
    │   └── relay.js           ← WebSocket relay to Hyperliquid
    │
    └── lib/
        ├── cache.js           ← Redis TTL wrapper
        ├── fetcher.js         ← HTTP fetch with retry + timeout
        └── rss-parser.js      ← XML RSS → JSON parser
```

---

## 5. Component 1 — API Proxy Server

### What It Does

Receives requests from the browser, adds required headers (auth, User-Agent), calls the target API, caches the response in Redis, returns it to the browser.

### Required Routes

These are all the proxy routes currently in `vite.config.js` that need to move to the backend:

| Frontend path | Target | Cache TTL | Notes |
|---|---|---|---|
| `POST /api/hl/*` | `https://api.hyperliquid.xyz/*` | 2s | Critical path — prices, positions |
| `GET /api/binance/*` | `https://api.binance.com/*` | 5s | Candlestick data for charts |
| `GET /api/coingecko/*` | `https://api.coingecko.com/*` | 60s | Market cap, global data |
| `GET /api/feargreed/*` | `https://api.alternative.me/*` | 1 hour | Fear & Greed index |
| `GET /api/news/ct/*` | `https://cointelegraph.com/*` | 5 min | RSS feed |
| `GET /api/news/cd/*` | `https://www.coindesk.com/*` | 5 min | RSS feed |
| `GET /api/news/dec/*` | `https://decrypt.co/*` | 5 min | RSS feed |
| `GET /api/news/bein/*` | `https://beincrypto.com/*` | 5 min | RSS feed |
| `GET /api/news/btci/*` | `https://bitcoinist.com/*` | 5 min | RSS feed |

### Implementation

**`server/index.js`** — Entry point:

```javascript
import Fastify from 'fastify';
import { startWSRelay } from './ws/relay.js';

const app = Fastify({ logger: true });

// Plugins
await app.register(import('./plugins/redis.js'));
await app.register(import('./plugins/cors.js'));
await app.register(import('./plugins/rate-limit.js'));

// Routes
await app.register(import('./routes/proxy.js'),  { prefix: '/api' });
await app.register(import('./routes/swap.js'),   { prefix: '/api/swap' });
await app.register(import('./routes/news.js'),   { prefix: '/api/news' });
await app.register(import('./routes/health.js'));

// Start
const PORT = process.env.PORT || 3001;
await app.listen({ port: PORT, host: '0.0.0.0' });

// WebSocket relay (attaches to same HTTP server)
startWSRelay(app.server);
```

**`server/plugins/redis.js`**:

```javascript
import fp from 'fastify-plugin';
import Redis from 'ioredis';

export default fp(async (fastify) => {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  redis.on('error', (err) => fastify.log.error('Redis error:', err));

  fastify.decorate('redis', redis);
  fastify.addHook('onClose', async () => redis.quit());
});
```

**`server/lib/cache.js`** — TTL caching helper:

```javascript
export async function withCache(redis, key, ttlSeconds, fetcher) {
  // Try cache first
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached);
  }

  // Cache miss — fetch fresh data
  const data = await fetcher();
  
  // Store in cache (fire-and-forget, don't block response)
  redis.set(key, JSON.stringify(data), 'EX', ttlSeconds).catch(() => {});
  
  return data;
}
```

**`server/lib/fetcher.js`** — HTTP fetch with retry and timeout:

```javascript
export async function fetchJSON(url, options = {}, retries = 2) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 8000);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)',
        ...options.headers,
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.json();
  } catch (err) {
    if (retries > 0 && !err.message.includes('aborted')) {
      await new Promise(r => setTimeout(r, 500));
      return fetchJSON(url, options, retries - 1);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 8000);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)',
        ...options.headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}
```

**`server/routes/proxy.js`** — All proxy routes:

```javascript
import { withCache } from '../lib/cache.js';
import { fetchJSON, fetchText } from '../lib/fetcher.js';

export default async function proxyRoutes(fastify) {

  // ── Hyperliquid API (POST requests) ────────────────────────────────────────
  // Used by: trading terminal (prices, order book, positions, fills, meta)
  // Cache key includes request body so different queries don't collide
  fastify.post('/hl/*', async (req, reply) => {
    const path      = req.params['*'];
    const body      = req.body;
    const cacheKey  = `hl:${path}:${JSON.stringify(body)}`;
    const ttl       = body?.type === 'metaAndAssetCtxs' ? 5 : 2; // prices 5s, others 2s

    const data = await withCache(fastify.redis, cacheKey, ttl, () =>
      fetchJSON(`https://api.hyperliquid.xyz/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

    return data;
  });

  // ── Binance (GET — candlestick data for charts) ────────────────────────────
  fastify.get('/binance/*', async (req, reply) => {
    const path     = req.params['*'];
    const qs       = new URLSearchParams(req.query).toString();
    const url      = `https://api.binance.com/${path}${qs ? '?' + qs : ''}`;
    const cacheKey = `binance:${url}`;

    const data = await withCache(fastify.redis, cacheKey, 5, () => fetchJSON(url));
    return data;
  });

  // ── CoinGecko (GET — market data, global stats) ────────────────────────────
  fastify.get('/coingecko/*', async (req, reply) => {
    const path     = req.params['*'];
    const qs       = new URLSearchParams(req.query).toString();
    const url      = `https://api.coingecko.com/${path}${qs ? '?' + qs : ''}`;
    const cacheKey = `cg:${url}`;

    const data = await withCache(fastify.redis, cacheKey, 60, () => fetchJSON(url));
    return data;
  });

  // ── Fear & Greed Index (long TTL — only updates daily) ────────────────────
  fastify.get('/feargreed/*', async (req, reply) => {
    const path     = req.params['*'];
    const qs       = new URLSearchParams(req.query).toString();
    const url      = `https://api.alternative.me/${path}${qs ? '?' + qs : ''}`;
    const cacheKey = `fg:${url}`;

    const data = await withCache(fastify.redis, cacheKey, 3600, () => fetchJSON(url));
    return data;
  });

  // ── News RSS feeds (XML text, 5-minute cache) ─────────────────────────────
  const NEWS_SOURCES = {
    'ct':   'https://cointelegraph.com',
    'cd':   'https://www.coindesk.com',
    'dec':  'https://decrypt.co',
    'bein': 'https://beincrypto.com',
    'btci': 'https://bitcoinist.com',
  };

  for (const [id, base] of Object.entries(NEWS_SOURCES)) {
    fastify.get(`/news-proxy/${id}/*`, async (req, reply) => {
      const path     = req.params['*'];
      const url      = `${base}/${path}`;
      const cacheKey = `rss:${url}`;

      const xml = await withCache(fastify.redis, cacheKey, 300, () => fetchText(url));
      
      reply.header('Content-Type', 'application/rss+xml; charset=utf-8');
      return xml;
    });
  }
}
```

### Frontend URL Updates

After deploying the backend, update all frontend API calls from Vite proxy paths to backend paths:

```javascript
// Before (only works in dev):
const res = await fetch('/hl/info', { method: 'POST', ... });

// After (works in production):
const API_BASE = import.meta.env.VITE_API_URL || '';
const res = await fetch(`${API_BASE}/api/hl/info`, { method: 'POST', ... });
```

Add to `client/.env.production`:
```
VITE_API_URL=https://api.rdoone.com
```

---

## 6. Component 2 — WebSocket Relay

### Why It's Needed

Hyperliquid provides a WebSocket API at `wss://api.hyperliquid.xyz/ws` for real-time:
- Live price updates (all markets)
- Order book changes (bids/asks)
- Trade fills (live trades ticker)
- User-specific data (positions, orders)

**Problem at scale:** If 500 users are on the terminal simultaneously, each client opens its own direct WebSocket connection to HL. At some point HL may rate-limit or drop connections.

**Solution:** One persistent connection from our backend to HL, fanning out messages to all connected browser clients.

### Hyperliquid WebSocket API

**Connection:** `wss://api.hyperliquid.xyz/ws`

**Subscribe to all mid prices:**
```json
{ "method": "subscribe", "subscription": { "type": "allMids" } }
```

**Subscribe to order book for a coin:**
```json
{ "method": "subscribe", "subscription": { "type": "l2Book", "coin": "BTC" } }
```

**Subscribe to recent trades:**
```json
{ "method": "subscribe", "subscription": { "type": "trades", "coin": "BTC" } }
```

**Subscribe to user data (requires address):**
```json
{ "method": "subscribe", "subscription": { "type": "userEvents", "user": "0x..." } }
```

### Implementation

**`server/ws/relay.js`**:

```javascript
import { WebSocketServer, WebSocket } from 'ws';

const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws';
const RECONNECT_DELAY = 2000; // ms before reconnect attempt

export function startWSRelay(httpServer) {
  // Browser-facing WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Track all connected browser clients
  const clients = new Set();

  // Track subscriptions: "subscription_json_string" → Set<WebSocket>
  const subscriptions = new Map();

  // ── Upstream connection to Hyperliquid ──────────────────────────────────────
  let upstream = null;
  let reconnectTimer = null;

  function connectUpstream() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    
    upstream = new WebSocket(HL_WS_URL);

    upstream.on('open', () => {
      console.log('[WS Relay] Connected to Hyperliquid upstream');
      
      // Re-subscribe to everything after reconnect
      for (const subKey of subscriptions.keys()) {
        if (subscriptions.get(subKey).size > 0) {
          upstream.send(JSON.stringify({
            method: 'subscribe',
            subscription: JSON.parse(subKey),
          }));
        }
      }
    });

    upstream.on('message', (rawData) => {
      const msgStr = rawData.toString();

      // Fan out to all connected browser clients
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msgStr);
        }
      }
    });

    upstream.on('error', (err) => {
      console.error('[WS Relay] Upstream error:', err.message);
    });

    upstream.on('close', () => {
      console.warn('[WS Relay] Upstream disconnected — reconnecting in 2s');
      reconnectTimer = setTimeout(connectUpstream, RECONNECT_DELAY);
    });
  }

  connectUpstream();

  // ── Browser client connections ──────────────────────────────────────────────
  wss.on('connection', (clientWS, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[WS Relay] Client connected: ${ip}, total: ${clients.size + 1}`);
    clients.add(clientWS);

    clientWS.on('message', (rawData) => {
      // Client is sending a subscription request
      // Forward to upstream
      try {
        const msg = JSON.parse(rawData.toString());

        if (msg.method === 'subscribe' && msg.subscription) {
          const subKey = JSON.stringify(msg.subscription);

          // Track which clients want this subscription
          if (!subscriptions.has(subKey)) {
            subscriptions.set(subKey, new Set());
          }
          subscriptions.get(subKey).add(clientWS);

          // Only send to upstream if this is the first subscriber
          if (subscriptions.get(subKey).size === 1) {
            if (upstream?.readyState === WebSocket.OPEN) {
              upstream.send(rawData.toString());
            }
          }
        }

        if (msg.method === 'unsubscribe' && msg.subscription) {
          const subKey = JSON.stringify(msg.subscription);
          subscriptions.get(subKey)?.delete(clientWS);

          // If no more clients want this, unsubscribe upstream too
          if (subscriptions.get(subKey)?.size === 0) {
            subscriptions.delete(subKey);
            if (upstream?.readyState === WebSocket.OPEN) {
              upstream.send(rawData.toString());
            }
          }
        }

      } catch {
        // Non-JSON message — forward as-is
        if (upstream?.readyState === WebSocket.OPEN) {
          upstream.send(rawData.toString());
        }
      }
    });

    clientWS.on('close', () => {
      clients.delete(clientWS);
      
      // Remove from all subscription sets
      for (const [subKey, subClients] of subscriptions.entries()) {
        subClients.delete(clientWS);
        if (subClients.size === 0) {
          subscriptions.delete(subKey);
          // Optionally: unsubscribe from upstream when no clients remain
        }
      }

      console.log(`[WS Relay] Client disconnected: ${ip}, total: ${clients.size}`);
    });

    clientWS.on('error', (err) => {
      console.error('[WS Relay] Client error:', err.message);
      clients.delete(clientWS);
    });

    // Send current upstream connection status
    clientWS.send(JSON.stringify({
      channel: 'relay',
      data: { status: upstream?.readyState === WebSocket.OPEN ? 'connected' : 'connecting' }
    }));
  });

  console.log('[WS Relay] Browser WebSocket server started at /ws');
}
```

### Frontend Update

Update `client/src/main.js` to use backend WebSocket relay instead of direct HL connection:

```javascript
// Before:
const ws = new WebSocket('wss://api.hyperliquid.xyz/ws');

// After:
const WS_URL = import.meta.env.VITE_WS_URL || 
  (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
const ws = new WebSocket(WS_URL);
```

Add to `client/.env.production`:
```
VITE_WS_URL=wss://api.rdoone.com/ws
```

---

## 7. Component 3 — News Aggregation Service

### Overview

The news page (`public/news.html`) aggregates RSS feeds from 8 sources. Currently the frontend fetches them directly (via Vite proxy in dev, via rss2json.com for Cloudflare-blocked sources).

In production, the backend should:
1. Pre-fetch all RSS feeds every 5 minutes (background job)
2. Merge, deduplicate, and sort articles
3. Serve a single `/api/news` endpoint returning JSON
4. Handle Cloudflare-blocked sources via rss2json.com

### RSS Sources

| Source | URL | Method | Category |
|---|---|---|---|
| CoinTelegraph | `https://cointelegraph.com/rss` | Direct HTTP | General |
| CoinDesk | `https://www.coindesk.com/arc/outboundfeeds/rss/` | Direct HTTP | General |
| Decrypt | `https://decrypt.co/feed` | Direct HTTP | General |
| BeInCrypto | `https://beincrypto.com/feed/` | Direct HTTP | General |
| Bitcoinist | `https://bitcoinist.com/feed/` | Direct HTTP | Bitcoin |
| CryptoSlate | `https://cryptoslate.com/feed/` | rss2json.com | General |
| Blockworks | `https://blockworks.co/feed` | rss2json.com | DeFi |
| Bitcoin Magazine | `https://bitcoinmagazine.com/.rss/full/` | rss2json.com | Bitcoin |

### RSS Parser

**`server/lib/rss-parser.js`**:

```javascript
// Minimal XML → JSON parser for RSS 2.0 and Atom feeds
// No dependencies — pure regex and string parsing

export function parseRSS(xml) {
  const articles = [];
  
  // Try RSS 2.0 format
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    
    const title   = extractTag(block, 'title');
    const link    = extractTag(block, 'link') || extractAttr(block, 'link', 'href');
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published');
    const desc    = extractTag(block, 'description') || extractTag(block, 'summary');
    const image   = extractOGImage(block);
    const author  = extractTag(block, 'author') || extractTag(block, 'dc:creator');
    
    if (title && link) {
      articles.push({
        title:   cleanHTML(title),
        link:    link.trim(),
        pubDate: pubDate ? new Date(pubDate.trim()).toISOString() : new Date().toISOString(),
        desc:    cleanHTML(desc || '').slice(0, 200),
        image,
        author:  cleanHTML(author || ''),
      });
    }
  }

  // Try Atom format if no RSS items found
  if (articles.length === 0) {
    const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
    while ((match = entryRegex.exec(xml)) !== null) {
      const block = match[1];
      const title   = extractTag(block, 'title');
      const link    = extractAttr(block, 'link', 'href');
      const pubDate = extractTag(block, 'published') || extractTag(block, 'updated');
      const desc    = extractTag(block, 'summary') || extractTag(block, 'content');
      
      if (title && link) {
        articles.push({
          title:   cleanHTML(title),
          link:    link.trim(),
          pubDate: pubDate ? new Date(pubDate.trim()).toISOString() : new Date().toISOString(),
          desc:    cleanHTML(desc || '').slice(0, 200),
          image:   extractOGImage(block),
          author:  '',
        });
      }
    }
  }

  return articles;
}

function extractTag(xml, tag) {
  // Handle CDATA and regular content
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  if (!match) return null;
  return (match[1] || match[2] || '').trim();
}

function extractAttr(xml, tag, attr) {
  const regex = new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["']`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractOGImage(block) {
  // Try media:content
  const mediaMatch = block.match(/<media:content[^>]+url=["']([^"']+)["']/i);
  if (mediaMatch) return mediaMatch[1];
  
  // Try media:thumbnail
  const thumbMatch = block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
  if (thumbMatch) return thumbMatch[1];
  
  // Try enclosure
  const enclosureMatch = block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image/i);
  if (enclosureMatch) return enclosureMatch[1];

  return null;
}

function cleanHTML(str) {
  return str
    .replace(/<[^>]+>/g, '')   // strip HTML tags
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

### News Route

**`server/routes/news.js`**:

```javascript
import { parseRSS } from '../lib/rss-parser.js';
import { fetchText, fetchJSON } from '../lib/fetcher.js';

const R2J = 'https://api.rss2json.com/v1/api.json?rss_url=';

const SOURCES = [
  { id: 'ct',   name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss',                       type: 'direct' },
  { id: 'cd',   name: 'CoinDesk',      url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',     type: 'direct' },
  { id: 'dec',  name: 'Decrypt',       url: 'https://decrypt.co/feed',                             type: 'direct' },
  { id: 'bein', name: 'BeInCrypto',    url: 'https://beincrypto.com/feed/',                        type: 'direct' },
  { id: 'btci', name: 'Bitcoinist',    url: 'https://bitcoinist.com/feed/',                        type: 'direct' },
  { id: 'cs',   name: 'CryptoSlate',   url: 'https://cryptoslate.com/feed/',                       type: 'r2j' },
  { id: 'bwk',  name: 'Blockworks',    url: 'https://blockworks.co/feed',                          type: 'r2j' },
  { id: 'btcm', name: 'Bitcoin Mag',   url: 'https://bitcoinmagazine.com/.rss/full/',              type: 'r2j' },
];

// Fetch one source and normalize to article array
async function fetchSource(source) {
  try {
    if (source.type === 'direct') {
      const xml      = await fetchText(source.url, { timeout: 6000 });
      const articles = parseRSS(xml);
      return articles.map(a => ({ ...a, source: source.name, sourceId: source.id }));
    }

    if (source.type === 'r2j') {
      const json = await fetchJSON(R2J + encodeURIComponent(source.url), { timeout: 8000 });
      if (!json?.items) return [];
      return json.items.map(item => ({
        title:   item.title   || '',
        link:    item.link    || '',
        pubDate: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        desc:    (item.description || '').replace(/<[^>]+>/g, '').slice(0, 200),
        image:   item.thumbnail || item.enclosure?.link || null,
        author:  item.author  || '',
        source:  source.name,
        sourceId: source.id,
      }));
    }
  } catch (err) {
    console.warn(`[News] Failed to fetch ${source.name}: ${err.message}`);
    return [];
  }
  return [];
}

// Merge, deduplicate by URL, sort by date
function mergeArticles(articleArrays) {
  const seen = new Set();
  const all  = [];

  for (const articles of articleArrays) {
    for (const article of articles) {
      if (!article.link || seen.has(article.link)) continue;
      seen.add(article.link);
      all.push(article);
    }
  }

  return all.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
}

export default async function newsRoutes(fastify) {

  // GET /api/news — all articles merged
  fastify.get('/', async (req, reply) => {
    const CACHE_KEY = 'news:all';
    const CACHE_TTL = 300; // 5 minutes

    const cached = await fastify.redis.get(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }

    // Fetch all sources in parallel, don't fail if some sources fail
    const results = await Promise.allSettled(SOURCES.map(fetchSource));
    const articleArrays = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    const failedSources = SOURCES
      .filter((_, i) => results[i].status === 'rejected')
      .map(s => s.name);

    const articles = mergeArticles(articleArrays);

    const response = {
      articles,
      count:         articles.length,
      sources:       SOURCES.length,
      sourcesFailed: failedSources,
      updatedAt:     new Date().toISOString(),
    };

    await fastify.redis.set(CACHE_KEY, JSON.stringify(response), 'EX', CACHE_TTL);
    return response;
  });

  // GET /api/news?source=ct — filter by source
  // GET /api/news?category=bitcoin — filter by keyword category
  // These are handled client-side via query on the merged response
}
```

### Frontend Integration

Update `public/news.html` to use the backend endpoint instead of fetching RSS directly:

```javascript
// Replace the current SOURCES config and fetchAll() with:
async function fetchAll() {
  const res  = await fetch('/api/news');
  const data = await res.json();
  
  allArticles = data.articles;
  
  statusEl.textContent = `${data.sources - data.sourcesFailed.length}/${data.sources} sources · ${data.count} articles` +
    (data.sourcesFailed.length ? ` · failed: ${data.sourcesFailed.join(', ')}` : '');
  
  renderGrid(allArticles);
}
```

---

## 8. Component 4 — 1inch Swap Proxy

### Why Server-Side

The 1inch API requires an API key (`Authorization: Bearer YOUR_KEY`). Exposing this key in the frontend JavaScript means anyone can:
- Inspect the key in browser DevTools
- Use the key for their own projects (burning your quota)
- Get your account banned for abuse

The backend receives requests from the browser, injects the key, and proxies to 1inch.

### Get a Free API Key

1. Register at [portal.1inch.dev](https://portal.1inch.dev)
2. Create an app → get API key (free tier: 100 req/min)

### Implementation

**`server/routes/swap.js`**:

```javascript
const ONEINCH_BASE = 'https://api.1inch.dev/swap/v6.0';
const ONEINCH_KEY  = process.env.ONEINCH_API_KEY;

const ONEINCH_HEADERS = {
  'Authorization': `Bearer ${ONEINCH_KEY}`,
  'Accept':        'application/json',
};

export default async function swapRoutes(fastify) {

  // GET /api/swap/tokens?chainId=42161 — list available tokens on chain
  fastify.get('/tokens', async (req, reply) => {
    const { chainId = 42161 } = req.query;
    const cacheKey = `1inch:tokens:${chainId}`;
    
    const cached = await fastify.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const res  = await fetch(`${ONEINCH_BASE}/${chainId}/tokens`, { headers: ONEINCH_HEADERS });
    const data = await res.json();

    // Token list changes rarely — cache for 1 hour
    await fastify.redis.set(cacheKey, JSON.stringify(data), 'EX', 3600);
    return data;
  });

  // GET /api/swap/quote?chainId=42161&src=ETH&dst=USDC&amount=1000000000000000000&from=0x...
  // Returns estimated output amount WITHOUT building a transaction
  fastify.get('/quote', async (req, reply) => {
    const { chainId = 42161, src, dst, amount, from } = req.query;

    if (!src || !dst || !amount) {
      return reply.code(400).send({ error: 'src, dst, amount are required' });
    }

    const url = `${ONEINCH_BASE}/${chainId}/quote?src=${src}&dst=${dst}&amount=${amount}` +
      (from ? `&from=${from}` : '');
    
    // Short cache — quotes change with market prices
    const cacheKey = `1inch:quote:${chainId}:${src}:${dst}:${amount}`;
    const cached = await fastify.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const res  = await fetch(url, { headers: ONEINCH_HEADERS });
    const data = await res.json();

    await fastify.redis.set(cacheKey, JSON.stringify(data), 'EX', 10); // 10s cache
    return data;
  });

  // GET /api/swap/build?chainId=42161&src=ETH&dst=USDC&amount=X&from=0x...&slippage=1
  // Returns transaction data that the frontend submits to the user's wallet
  // IMPORTANT: never cache this — it's signed and time-sensitive
  fastify.get('/build', async (req, reply) => {
    const { chainId = 42161, src, dst, amount, from, slippage = 1 } = req.query;

    if (!src || !dst || !amount || !from) {
      return reply.code(400).send({ error: 'src, dst, amount, from are required' });
    }

    const url = `${ONEINCH_BASE}/${chainId}/swap` +
      `?src=${src}&dst=${dst}&amount=${amount}&from=${from}&slippage=${slippage}&disableEstimate=true`;

    const res  = await fetch(url, { headers: ONEINCH_HEADERS });
    const data = await res.json();

    if (data.error) {
      return reply.code(400).send(data);
    }

    // Return only the tx data — never cache swap transactions
    return {
      toAmount: data.toAmount,
      tx: {
        to:       data.tx.to,
        data:     data.tx.data,
        value:    data.tx.value,
        gasPrice: data.tx.gasPrice,
        gas:      data.tx.gas,
      }
    };
  });
}
```

---

## 9. Component 5 — Deposit Flow (Client-Side Modules)

This is the most complex feature but requires **minimal backend work**. All actual blockchain transactions happen in the browser, signed by the user's wallet.

### What the Backend Provides

- **1inch swap quotes and transaction data** (Component 4 above)
- **Arbitrum RPC proxy** (optional — avoids exposing third-party RPC URLs)
- Nothing else — Jupiter, Wormhole, and the HL contract are all called client-side

### Path B: EVM → USDC on Arbitrum → HL Perps

**`client/src/lib/deposit-evm.js`**:

```javascript
import { ethers } from 'ethers';

const HL_DEPOSIT = '0x2Df1c51E09aECF9d4A91F401B2FDC7765A0d15c'; // Arbitrum
const USDC_ARB   = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // USDC on Arbitrum
const ARB_CHAIN  = 42161;

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const HL_ABI = [
  'function deposit(uint64 usdAmount) external',
];

// Step 1: get swap quote for any token → USDC on Arbitrum
export async function getSwapQuote(tokenIn, amountIn, walletAddress) {
  const res = await fetch(
    `/api/swap/quote?chainId=${ARB_CHAIN}&src=${tokenIn}&dst=${USDC_ARB}&amount=${amountIn}&from=${walletAddress}`
  );
  return res.json();
}

// Step 2: build and execute swap tx via 1inch
export async function swapToUSDC(tokenIn, amountIn, walletAddress, signer, onStatus) {
  onStatus('Getting best swap route...');
  
  const res = await fetch(
    `/api/swap/build?chainId=${ARB_CHAIN}&src=${tokenIn}&dst=${USDC_ARB}&amount=${amountIn}&from=${walletAddress}&slippage=1`
  );
  const swapData = await res.json();
  
  if (swapData.error) throw new Error(swapData.error);
  
  onStatus('Confirm the swap in your wallet...');
  
  const tx = await signer.sendTransaction({
    to:    swapData.tx.to,
    data:  swapData.tx.data,
    value: BigInt(swapData.tx.value || '0'),
  });
  
  onStatus('Swap in progress...');
  const receipt = await tx.wait();
  
  return swapData.toAmount; // USDC amount in 6-decimal units
}

// Step 3: approve USDC and call HL deposit contract
export async function depositToHLPerps(usdcAmount, signer, onStatus) {
  const address = await signer.getAddress();
  const usdc    = new ethers.Contract(USDC_ARB, ERC20_ABI, signer);
  const hl      = new ethers.Contract(HL_DEPOSIT, HL_ABI, signer);

  // Check existing allowance
  const allowance = await usdc.allowance(address, HL_DEPOSIT);
  
  if (allowance < BigInt(usdcAmount)) {
    onStatus('Approve USDC spending (confirm in wallet)...');
    const approveTx = await usdc.approve(HL_DEPOSIT, ethers.MaxUint256);
    await approveTx.wait();
  }

  onStatus('Confirm deposit to HL Perps (confirm in wallet)...');
  const depositTx = await hl.deposit(usdcAmount);

  onStatus('Deposit processing...');
  await depositTx.wait();

  onStatus('Done! Funds should appear in HL Perps within seconds.');
}

// Full flow: any EVM token → HL Perps
export async function depositEVMToHL(tokenIn, amountIn, provider, onStatus) {
  // Ensure user is on Arbitrum
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(ARB_CHAIN)) {
    onStatus('Switching to Arbitrum network...');
    await provider.send('wallet_switchEthereumChain', [
      { chainId: '0x' + ARB_CHAIN.toString(16) }
    ]);
  }

  const signer     = await provider.getSigner();
  const address    = await signer.getAddress();
  const isUSDC     = tokenIn.toLowerCase() === USDC_ARB.toLowerCase();
  const isETH      = tokenIn === ethers.ZeroAddress;

  let usdcAmount;

  if (isUSDC) {
    // Already USDC — skip swap
    usdcAmount = amountIn;
  } else {
    // Swap to USDC first
    usdcAmount = await swapToUSDC(tokenIn, amountIn, address, signer, onStatus);
  }

  await depositToHLPerps(usdcAmount, signer, onStatus);
}
```

### Path A: Solana → USDC → Arbitrum → HL Perps

**`client/src/lib/deposit-sol.js`**:

```javascript
import { Connection, VersionedTransaction } from '@solana/web3.js';
import { depositToHLPerps } from './deposit-evm.js';
import { ethers } from 'ethers';

const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const USDC_SOL   = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_RPC    = 'https://api.mainnet-beta.solana.com';

// Step 1: Jupiter swap SOL/SPL → USDC on Solana
export async function jupiterSwap(inputMint, outputMint, amount, walletPublicKey, onStatus) {
  onStatus('Getting Jupiter swap route...');

  // Quote
  const quoteRes = await fetch(
    `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`
  );
  const quote = await quoteRes.json();
  if (quote.error) throw new Error(quote.error);

  onStatus(`Best route found. You receive ~${(quote.outAmount / 1e6).toFixed(2)} USDC. Confirm in Phantom...`);

  // Build swap transaction
  const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse:    quote,
      userPublicKey:    walletPublicKey,
      wrapAndUnwrapSol: true,
    }),
  });
  const { swapTransaction } = await swapRes.json();

  // Deserialize and sign with Phantom
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  const signedTx = await window.solana.signTransaction(tx);

  // Send
  onStatus('Sending swap transaction...');
  const connection = new Connection(SOL_RPC, 'confirmed');
  const txid = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  onStatus('Waiting for Solana confirmation...');
  await connection.confirmTransaction(txid, 'confirmed');

  return { txid, outAmount: quote.outAmount }; // outAmount in USDC micro-units (6 decimals)
}

// Step 2: Bridge USDC from Solana → Arbitrum via Wormhole SDK
// Requires: npm install @wormhole-foundation/sdk @wormhole-foundation/sdk/solana @wormhole-foundation/sdk/evm
export async function bridgeUSDCToArbitrum(amount, evmRecipientAddress, onStatus) {
  const { wormhole }  = await import('@wormhole-foundation/sdk');
  const { default: solana } = await import('@wormhole-foundation/sdk/solana');
  const { default: evm }    = await import('@wormhole-foundation/sdk/evm');

  onStatus('Connecting to Wormhole bridge...');

  const wh       = await wormhole('Mainnet', [solana, evm]);
  const srcChain = wh.getChain('Solana');
  const dstChain = wh.getChain('Arbitrum');

  const sender = {
    chain:   srcChain,
    address: window.solana.publicKey.toString(),
    signer:  {
      chain:       'Solana',
      address:     () => window.solana.publicKey.toString(),
      signAndSend: async (txs) => {
        const signed = await window.solana.signAllTransactions(txs.map(t => t.transaction));
        const connection = new Connection(SOL_RPC, 'confirmed');
        return Promise.all(signed.map(tx => connection.sendRawTransaction(tx.serialize())));
      },
    },
  };

  onStatus('Approve the Wormhole transfer in Phantom...');

  const transfer = wh.tokenTransfer(
    srcChain.parseAddress(USDC_SOL),
    amount,
    sender,
    { chain: 'Arbitrum', address: evmRecipientAddress },
    false // manual relay (user completes on destination)
  );

  const srcTxids = await (await transfer).initiateTransfer(sender.signer);
  onStatus(`Transfer sent (${srcTxids[0].slice(0, 8)}...). Waiting for Wormhole Guardians (~2–5 min)...`);

  await (await transfer).fetchAttestation(300_000); // wait up to 5 min

  onStatus('Confirm receipt on Arbitrum in MetaMask...');
  // User needs MetaMask connected too for this step
  const evmProvider = new ethers.BrowserProvider(window.ethereum);
  const evmSigner   = await evmProvider.getSigner();
  const dstTxids    = await (await transfer).completeTransfer(evmSigner);

  onStatus(`USDC arrived on Arbitrum! Tx: ${dstTxids[0].slice(0, 10)}...`);
  return amount;
}

// Full Solana → HL Perps flow
export async function depositSolanaToHL(inputMint, solAmount, evmProvider, onStatus) {
  const walletPublicKey = window.solana.publicKey.toString();
  const evmSigner       = await evmProvider.getSigner();
  const evmAddress      = await evmSigner.getAddress();

  // 1. Jupiter: SOL → USDC on Solana
  const { outAmount } = await jupiterSwap(inputMint, USDC_SOL, solAmount, walletPublicKey, onStatus);

  // 2. Wormhole: USDC Solana → USDC Arbitrum
  await bridgeUSDCToArbitrum(outAmount, evmAddress, onStatus);

  // 3. HL deposit contract (Arbitrum)
  await depositToHLPerps(outAmount, evmSigner, onStatus);
}
```

---

## 10. Caching Strategy

| Data Type | Key Pattern | TTL | Reason |
|---|---|---|---|
| HL REST API (prices) | `hl:info:metaAndAssetCtxs:{}` | 5s | Fast-changing market data |
| HL REST API (fills) | `hl:info:userFillsByTime:*` | 30s | PnL history, doesn't change often |
| Binance candles | `binance:/api/v3/klines*` | 10s | Chart data updates every few seconds |
| CoinGecko prices | `cg:*` | 60s | Less critical, rate limited API |
| Fear & Greed | `fg:*` | 3600s | Updates once per day |
| RSS news feeds | `rss:*` | 300s | Refresh every 5 minutes is enough |
| Aggregated news | `news:all` | 300s | One combined response |
| 1inch token list | `1inch:tokens:*` | 3600s | Token list rarely changes |
| 1inch quotes | `1inch:quote:*` | 10s | Price-sensitive, short window |

### Redis Key Naming Convention

```
{service}:{path_or_type}:{hash_of_params}

Examples:
  hl:clearinghouseState:0xabc123
  binance:/api/v3/klines:BTCUSDT:1m:500
  news:all
  1inch:quote:42161:ETH:USDC:1000000000000000000
```

---

## 11. Environment Variables

**`server/.env.example`** (commit this, not `.env`):

```env
# ── Server ─────────────────────────────────────────────────────────────────────
PORT=3001
NODE_ENV=production

# ── CORS ───────────────────────────────────────────────────────────────────────
# Comma-separated list of allowed frontend origins
ALLOWED_ORIGINS=https://rdoone.com,https://www.rdoone.com

# ── Redis ──────────────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── 1inch (get free key at portal.1inch.dev) ──────────────────────────────────
ONEINCH_API_KEY=your_key_here

# ── Arbitrum RPC (Alchemy free tier: 300M compute units/month) ────────────────
ARBITRUM_RPC=https://arb-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY

# ── Solana RPC (Helius free tier recommended over public mainnet-beta) ─────────
SOLANA_RPC=https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY

# ── Rate Limiting ──────────────────────────────────────────────────────────────
RATE_LIMIT_MAX=200          # requests per window
RATE_LIMIT_WINDOW_MS=60000  # 1 minute window
```

---

## 12. Database

**Currently: No database needed.**

All data comes from external APIs. Redis handles caching.

**If you add these features later, add PostgreSQL:**

| Feature | What to store |
|---|---|
| User accounts | Saved HL addresses, watchlists, preferences |
| Alert system | Price alerts per user |
| Analytics | Aggregate usage stats (no PII) |
| News bookmarks | Saved articles per user |

**Recommended:** [Supabase](https://supabase.com) (free tier: 500MB, built-in auth) or [Neon](https://neon.tech) (serverless Postgres, very cheap).

---

## 13. Deployment

### Option A — Railway (Recommended for start)

Cheapest option with minimal configuration.

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# In the server/ directory:
cd server
railway init
railway add redis    # one click Redis plugin

# Deploy
railway up

# Set environment variables
railway variables set ONEINCH_API_KEY=xxx
railway variables set ALLOWED_ORIGINS=https://rdoone.com
```

Railway auto-detects Node.js, runs `npm start`, provides HTTPS domain and Redis.  
**Cost:** ~$5–7/month for server + $0 for Redis (included)

### Option B — Fly.io

Better for apps that need global edge deployment.

**`server/fly.toml`**:
```toml
app = "rdo-one-api"
primary_region = "iad"

[http_service]
  internal_port = 3001
  force_https   = true

[env]
  NODE_ENV = "production"
  PORT     = "3001"

[[vm]]
  cpu_kind = "shared"
  cpus     = 1
  memory_mb = 256
```

```bash
fly auth login
fly launch          # creates app from fly.toml
fly redis create    # managed Redis
fly secrets set ONEINCH_API_KEY=xxx
fly deploy
```

**Cost:** ~$3/month for server + $3/month for Redis = ~$6/month

### Option C — VPS (Full Control)

For teams wanting complete control. Cheapest at scale.

**Recommended VPS:** Hetzner CX21 (2 cores, 4GB RAM, €3.79/month)

**Setup script:**
```bash
# On fresh Ubuntu 22.04 server
apt update && apt upgrade -y
apt install -y nginx certbot python3-certbot-nginx

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install Redis
apt install -y redis-server
systemctl enable redis-server

# Install PM2
npm install -g pm2

# Clone and setup
git clone https://github.com/your-repo/rdo-one.git
cd rdo-one/server
npm install
cp .env.example .env
nano .env   # fill in your values

# Start with PM2
pm2 start index.js --name rdo-one-api
pm2 startup
pm2 save
```

**`/etc/nginx/sites-available/rdoone.com`:**
```nginx
server {
    listen 80;
    server_name rdoone.com www.rdoone.com api.rdoone.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name rdoone.com www.rdoone.com;
    ssl_certificate     /etc/letsencrypt/live/rdoone.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rdoone.com/privkey.pem;

    # Serve frontend static files
    root /var/www/rdo-one/client/dist;
    try_files $uri $uri/ /index.html;

    # Proxy API requests to Node.js backend
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket relay
    location /ws {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;  # keep WS connections alive for 24h
    }

    # Enable gzip
    gzip on;
    gzip_types text/css application/javascript application/json;
}
```

```bash
# Get SSL certificate
certbot --nginx -d rdoone.com -d www.rdoone.com -d api.rdoone.com

# Build frontend
cd /var/www/rdo-one/client
npm run build

# Reload Nginx
systemctl reload nginx
```

---

## 14. Security

### Critical Rules

1. **Never store private keys.** All transactions are signed by users in their own wallets. The backend is stateless regarding user funds.

2. **Protect API keys.** `.env` is never committed to git. Use environment variables on the hosting platform. Rotate keys if exposed.

3. **CORS whitelist.** Only allow requests from your actual domain. Never use `*` in production:

```javascript
// server/plugins/cors.js
import fp from 'fastify-plugin';
import cors from '@fastify/cors';

export default fp(async (fastify) => {
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  
  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowed.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
  });
});
```

4. **Rate limiting.** Prevent abuse of the proxy endpoints:

```javascript
// server/plugins/rate-limit.js
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

export default fp(async (fastify) => {
  await fastify.register(rateLimit, {
    global: true,
    max:    200,           // 200 requests
    timeWindow: '1 minute',
    redis: fastify.redis,  // use Redis for distributed rate limiting
    keyGenerator: (req) => req.ip, // limit per IP
    errorResponseBuilder: () => ({
      error: 'Too many requests',
      statusCode: 429,
    }),
  });
});
```

5. **Input validation.** Validate all query parameters before forwarding to external APIs. Never pass raw user input directly to a URL:

```javascript
// Bad — SQL injection / SSRF risk:
const url = `https://api.external.com/${req.params['*']}`;

// Good — validate and whitelist:
const ALLOWED_PATHS = new Set(['info', 'meta', 'clearinghouseState']);
const path = req.params['*'];
if (!ALLOWED_PATHS.has(path.split('?')[0])) {
  return reply.code(400).send({ error: 'Invalid path' });
}
```

6. **Health endpoint** — no sensitive data:

```javascript
// server/routes/health.js
export default async function healthRoutes(fastify) {
  fastify.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));
}
```

7. **Redis security.** Bind Redis to localhost only (never expose port 6379 to the internet):
```
# /etc/redis/redis.conf
bind 127.0.0.1
requirepass your_strong_redis_password
```

---

## 15. Development Phases

### Phase 1 — API Proxy (Week 1) — CRITICAL

This unblocks production deployment. Without it, the app doesn't work in production.

**Tasks:**
- [ ] Set up Fastify server with Redis
- [ ] Implement all proxy routes from `vite.config.js`
- [ ] Add CORS and rate limiting plugins
- [ ] Deploy to Railway or Fly.io
- [ ] Update frontend `vite.config.js`: remove all proxy rules
- [ ] Update frontend API calls to use `VITE_API_URL` prefix
- [ ] Verify all pages work in production

**Acceptance criteria:** Open the production URL in a browser with DevTools open. No CORS errors in the console. All API calls return data.

---

### Phase 2 — WebSocket Relay (Week 2)

Improves stability and enables scaling.

**Tasks:**
- [ ] Implement WS relay in `server/ws/relay.js`
- [ ] Test reconnection logic (manually kill the upstream connection)
- [ ] Update frontend to use `/ws` instead of direct HL WebSocket
- [ ] Load test: simulate 100 concurrent connections
- [ ] Monitor memory usage with 1000 clients

**Acceptance criteria:** Disconnect the backend from Hyperliquid WS. Verify it reconnects within 3 seconds. Verify frontend prices resume updating.

---

### Phase 3 — News Aggregation (Week 2–3)

Moves news fetching to server, enables caching and better reliability.

**Tasks:**
- [ ] Implement RSS parser (no external deps)
- [ ] Implement `/api/news` endpoint
- [ ] Add background refresh (cron job every 5 min)
- [ ] Update `public/news.html` to use `/api/news`
- [ ] Handle source failures gracefully (partial results)

**Acceptance criteria:** Open news page. Check that articles appear within 1s (served from cache). Shut down one RSS source — page still loads with other sources.

---

### Phase 4 — 1inch Proxy + EVM Deposit (Week 3–4)

Enables the full deposit flow for EVM users.

**Tasks:**
- [ ] Get 1inch API key from portal.1inch.dev
- [ ] Implement `server/routes/swap.js`
- [ ] Write `client/src/lib/deposit-evm.js`
- [ ] Add deposit modal UI with progress states
- [ ] Test on Arbitrum testnet (Sepolia) with testnet USDC
- [ ] Get HL deposit contract address from official HL docs and verify ABI
- [ ] Test full flow: ETH → USDC → HL deposit

**Acceptance criteria:** Connect MetaMask on Arbitrum. Click Deposit to Perps. Confirm 2 transactions (approve + deposit). Verify USDC appears in HL perps balance.

---

### Phase 5 — Solana Deposit Flow (Week 5–8)

Most complex phase. Requires coordination between Phantom (Solana) and MetaMask (Arbitrum).

**Tasks:**
- [ ] Install Wormhole SDK: `npm install @wormhole-foundation/sdk`
- [ ] Write `client/src/lib/deposit-sol.js`
- [ ] Test Jupiter swap integration on mainnet with small amounts
- [ ] Test Wormhole bridge (allow 5–10 min for attestation)
- [ ] Handle edge cases: partial bridge, user closes browser mid-flow
- [ ] Add recovery UI: detect incomplete bridges and allow resuming

**Acceptance criteria:** Connect Phantom on Solana. Click "Deposit SOL to Perps". Sign 2 Phantom transactions (swap + bridge initiation). Sign 1 MetaMask transaction (bridge completion). Sign 2 MetaMask transactions (USDC approve + HL deposit). Funds appear in HL perps.

---

## Summary

| Component | Files | Est. Time | Priority |
|---|---|---|---|
| API Proxy | `server/routes/proxy.js` | 2 days | 🔴 Must-have |
| WebSocket Relay | `server/ws/relay.js` | 2 days | 🟠 High |
| News Aggregation | `server/routes/news.js` | 2 days | 🟡 Medium |
| 1inch Proxy | `server/routes/swap.js` | 1 day | 🟡 Medium |
| EVM Deposit | `client/src/lib/deposit-evm.js` | 3 days | 🟢 Next |
| Solana Deposit | `client/src/lib/deposit-sol.js` | 2 weeks | 🔵 Later |

Total estimated: **~4–6 weeks** for a full production-ready backend with all deposit flows.

The app can go to production after **Phase 1 alone** (2–3 days). All other phases are improvements.

---

## 16. Component 6 — Multi-Wallet Connection

### Overview

The current terminal only detects `window.ethereum` (MetaMask) and `window.solana` (Phantom) by sniffing browser globals. This breaks for users with Coinbase Wallet, Rainbow, Trust Wallet, OKX, Backpack, or any mobile wallet connecting via QR code.

**The fix:** Replace raw `window.ethereum` / `window.solana` checks with a proper wallet connection library that handles all wallet types through a single interface.

**Backend requirement:** None. Wallet connection is 100% client-side. The only server-side requirement is storing your WalletConnect Project ID as an environment variable (it's public but should be tied to your domain).

---

### Supported Wallets After Implementation

**EVM wallets (Arbitrum, Ethereum, etc.):**

| Wallet | How it connects | Mobile support |
|---|---|---|
| MetaMask | Browser extension | Yes (MetaMask mobile) |
| Coinbase Wallet | Browser extension / WC | Yes |
| Rainbow | WalletConnect QR | Yes |
| Trust Wallet | WalletConnect QR | Yes |
| Zerion | WalletConnect QR | Yes |
| OKX Wallet | Browser extension / WC | Yes |
| Rabby | Browser extension | No |
| Phantom (EVM) | Browser extension / WC | Yes |
| Safe (Gnosis) | WalletConnect QR | No |
| 1inch Wallet | WalletConnect QR | Yes |
| Any WC v2 wallet | WalletConnect QR | Varies |

**Solana wallets:**

| Wallet | Adapter package | Mobile support |
|---|---|---|
| Phantom | `@solana/wallet-adapter-phantom` | Yes |
| Solflare | `@solana/wallet-adapter-solflare` | Yes |
| Backpack | `@solana/wallet-adapter-backpack` | Yes |
| OKX Wallet | `@solana/wallet-adapter-okx` | Yes |
| Coinbase Wallet | `@solana/wallet-adapter-coinbase` | Yes |
| Glow | `@solana/wallet-adapter-glow` | No |
| Torus | `@solana/wallet-adapter-torus` | No |

---

### Recommended Approach: Reown AppKit

**Why Reown AppKit (formerly Web3Modal v3):**
- Single library covers both EVM **and** Solana — one modal for all chains
- Works with **vanilla JS** — no React required for the main terminal
- Automatically includes WalletConnect v2 (QR code for mobile wallets)
- Free — only requires a Project ID from their dashboard
- The pre-built modal UI matches the dark theme the terminal already uses
- Actively maintained by the WalletConnect team

**Get your Project ID (free):**
1. Go to [cloud.reown.com](https://cloud.reown.com)
2. Sign up → Create Project
3. Set "Allowed Domains" to your production domain (e.g. `rdoone.com`)
4. Copy the Project ID

---

### Installation

```bash
cd client
npm install @reown/appkit @reown/appkit-adapter-wagmi @reown/appkit-adapter-solana wagmi viem @solana/wallet-adapter-wallets
```

**Full dependency list to add to `client/package.json`:**
```json
{
  "dependencies": {
    "@reown/appkit": "^1.6.0",
    "@reown/appkit-adapter-wagmi": "^1.6.0",
    "@reown/appkit-adapter-solana": "^1.6.0",
    "wagmi": "^2.14.0",
    "viem": "^2.21.0",
    "@solana/wallet-adapter-wallets": "^0.19.0",
    "@solana/web3.js": "^1.95.0"
  }
}
```

---

### Setup — `client/src/lib/wallet.js`

This file initializes AppKit once and exports a `wallet` object that every other module uses to get signers and public keys.

```javascript
import { createAppKit } from '@reown/appkit';
import { WagmiAdapter }  from '@reown/appkit-adapter-wagmi';
import { SolanaAdapter } from '@reown/appkit-adapter-solana';
import { arbitrum, mainnet } from '@reown/appkit/networks';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  BackpackWalletAdapter,
  OKXWalletAdapter,
  CoinbaseWalletAdapter as SolanaCoinbaseWalletAdapter,
} from '@solana/wallet-adapter-wallets';

// ── Config ─────────────────────────────────────────────────────────────────────
const PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

if (!PROJECT_ID) {
  console.error('VITE_WALLETCONNECT_PROJECT_ID is not set. Wallet connection will not work.');
}

const METADATA = {
  name:        'RDO ONE',
  description: 'RDO ONE Trading Terminal',
  url:          location.origin,
  icons:       [`${location.origin}/favicon.ico`],
};

// ── EVM adapter (wagmi) ────────────────────────────────────────────────────────
const wagmiAdapter = new WagmiAdapter({
  projectId: PROJECT_ID,
  networks:  [arbitrum, mainnet],
});

// ── Solana adapter ─────────────────────────────────────────────────────────────
const solanaAdapter = new SolanaAdapter({
  wallets: [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    new BackpackWalletAdapter(),
    new OKXWalletAdapter(),
    new SolanaCoinbaseWalletAdapter(),
  ],
});

// ── Create AppKit instance (one per app) ───────────────────────────────────────
export const appkit = createAppKit({
  adapters:  [wagmiAdapter, solanaAdapter],
  networks:  [arbitrum, mainnet],
  projectId: PROJECT_ID,
  metadata:  METADATA,
  features: {
    analytics:     false,
    email:         false,    // disable email/social login
    onramp:        false,    // disable built-in onramp (we have our own)
    swaps:         false,    // disable built-in swaps
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent':           '#50d2c1',
    '--w3m-background-color': '#0f1a1e',
    '--w3m-border-radius-master': '4px',
  },
  defaultNetwork: arbitrum,
});

// ── Wallet state helpers ───────────────────────────────────────────────────────

// Returns current EVM address or null
export function getEVMAddress() {
  return appkit.getAddress('eip155') || null;
}

// Returns current Solana address or null
export function getSolanaAddress() {
  return appkit.getAddress('solana') || null;
}

// Returns connected chain ID (EVM) or null
export function getChainId() {
  return appkit.getCaipNetwork()?.id || null;
}

// Returns true if any wallet is connected
export function isConnected() {
  return appkit.getIsConnected();
}

// Open the wallet connection modal
export function openConnectModal() {
  appkit.open();
}

// Open account/disconnect modal
export function openAccountModal() {
  appkit.open({ view: 'Account' });
}

// Disconnect all wallets
export function disconnect() {
  appkit.disconnect();
}

// Get wagmi config (needed for viem actions and deposit flow)
export const wagmiConfig = wagmiAdapter.wagmiConfig;

// ── Event subscriptions ────────────────────────────────────────────────────────
// Call these to react to wallet events anywhere in the app

export function onWalletConnected(callback) {
  // AppKit fires 'accountsChanged' when a wallet connects or switches
  return appkit.subscribeEvents((event) => {
    if (event.data.event === 'CONNECT_SUCCESS') {
      callback({
        evmAddress:    getEVMAddress(),
        solanaAddress: getSolanaAddress(),
        chainId:       getChainId(),
      });
    }
  });
}

export function onWalletDisconnected(callback) {
  return appkit.subscribeEvents((event) => {
    if (event.data.event === 'DISCONNECT_SUCCESS') {
      callback();
    }
  });
}

export function onAccountChanged(callback) {
  return appkit.subscribeAccount((account) => {
    callback({
      address:   account.address,
      isConnected: account.isConnected,
      chainId:   getChainId(),
    });
  });
}
```

---

### Connect Button Integration

Replace the current MetaMask/Phantom connect buttons with a single AppKit button. AppKit provides a built-in web component that requires zero additional code:

**Option A — Use the built-in AppKit button (easiest):**

Add to any HTML page where wallet connection is needed:

```html
<!-- In the <head> — AppKit registers the custom element automatically -->
<!-- No additional script needed — it's included when you import wallet.js -->

<!-- In your navbar or header: -->
<appkit-button />

<!-- With custom label: -->
<appkit-button label="Connect Wallet" />

<!-- Account button (shows address when connected): -->
<appkit-account-button />

<!-- Network switcher: -->
<appkit-network-button />
```

**Option B — Custom button that opens the AppKit modal (matches your existing UI):**

```javascript
// In any page's JS:
import { openConnectModal, openAccountModal, isConnected, getEVMAddress, onAccountChanged } from './lib/wallet.js';

const btn = document.getElementById('wallet-btn');

function updateWalletBtn() {
  if (isConnected()) {
    const addr = getEVMAddress();
    btn.textContent = addr ? addr.slice(0, 6) + '...' + addr.slice(-4) : 'Connected';
    btn.onclick = openAccountModal;
  } else {
    btn.textContent = 'Connect Wallet';
    btn.onclick = openConnectModal;
  }
}

// React to wallet events
onAccountChanged(updateWalletBtn);

// Initial state
updateWalletBtn();
```

---

### Updating the Deposit Flow to Use AppKit

The existing `deposit-evm.js` uses `window.ethereum` directly. Replace it with wagmi's `getWalletClient` so it works with any connected wallet:

**Updated `client/src/lib/deposit-evm.js`:**

```javascript
import { getWalletClient, getPublicClient, switchChain } from '@wagmi/core';
import { createWalletClient, custom, publicActions } from 'viem';
import { arbitrum } from 'viem/chains';
import { wagmiConfig, getEVMAddress } from './wallet.js';

const HL_DEPOSIT = '0x2Df1c51E09aECF9d4A91F401B2FDC7765A0d15c';
const USDC_ARB   = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

const ERC20_ABI = [
  { name: 'approve',   type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
];

const HL_ABI = [
  { name: 'deposit', type: 'function', inputs: [{ name: 'usdAmount', type: 'uint64' }], outputs: [] },
];

// Works with ANY wallet connected via AppKit (MetaMask, WalletConnect, Coinbase, etc.)
export async function depositEVMToHL(tokenIn, amountIn, onStatus) {
  const address = getEVMAddress();
  if (!address) throw new Error('No EVM wallet connected');

  // Switch to Arbitrum if needed (works for all wallet types)
  onStatus('Switching to Arbitrum...');
  await switchChain(wagmiConfig, { chainId: arbitrum.id });

  // Get wallet client from wagmi (works with any connected wallet)
  const walletClient = await getWalletClient(wagmiConfig, { chainId: arbitrum.id });
  const publicClient = getPublicClient(wagmiConfig, { chainId: arbitrum.id });

  const isUSDC = tokenIn.toLowerCase() === USDC_ARB.toLowerCase();
  let usdcAmount = BigInt(amountIn);

  if (!isUSDC) {
    onStatus('Getting best swap route...');
    const res = await fetch(
      `/api/swap/build?chainId=${arbitrum.id}&src=${tokenIn}&dst=${USDC_ARB}&amount=${amountIn}&from=${address}&slippage=1`
    );
    const swapData = await res.json();
    if (swapData.error) throw new Error(swapData.error);

    onStatus('Confirm swap in your wallet...');
    const swapTxHash = await walletClient.sendTransaction({
      to:    swapData.tx.to,
      data:  swapData.tx.data,
      value: BigInt(swapData.tx.value || '0'),
    });

    onStatus('Waiting for swap confirmation...');
    await publicClient.waitForTransactionReceipt({ hash: swapTxHash });
    usdcAmount = BigInt(swapData.toAmount);
  }

  // Check allowance
  const allowance = await publicClient.readContract({
    address: USDC_ARB,
    abi:     ERC20_ABI,
    functionName: 'allowance',
    args:    [address, HL_DEPOSIT],
  });

  if (allowance < usdcAmount) {
    onStatus('Approve USDC spending (confirm in wallet)...');
    const approveTxHash = await walletClient.writeContract({
      address:      USDC_ARB,
      abi:          ERC20_ABI,
      functionName: 'approve',
      args:         [HL_DEPOSIT, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
  }

  onStatus('Confirm HL deposit in your wallet...');
  const depositTxHash = await walletClient.writeContract({
    address:      HL_DEPOSIT,
    abi:          HL_ABI,
    functionName: 'deposit',
    args:         [usdcAmount],
  });

  onStatus('Deposit processing...');
  await publicClient.waitForTransactionReceipt({ hash: depositTxHash });
  onStatus('Done! Funds appear in HL Perps within seconds.');
}
```

**Updated `client/src/lib/deposit-sol.js`** — use the adapter instead of `window.solana`:

```javascript
import { appkit, getSolanaAddress } from './wallet.js';

// Get the active Solana wallet adapter from AppKit
function getSolanaWallet() {
  const adapter = appkit.getWalletProvider('solana');
  if (!adapter) throw new Error('No Solana wallet connected');
  return adapter;
}

export async function jupiterSwap(inputMint, outputMint, amount, onStatus) {
  const wallet    = getSolanaWallet();
  const publicKey = getSolanaAddress();
  if (!publicKey) throw new Error('No Solana wallet connected');

  onStatus('Getting Jupiter swap route...');

  const quoteRes = await fetch(
    `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`
  );
  const quote = await quoteRes.json();
  if (quote.error) throw new Error(quote.error);

  onStatus(`Route found. ~${(quote.outAmount / 1e6).toFixed(2)} USDC. Confirm in wallet...`);

  const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: publicKey, wrapAndUnwrapSol: true }),
  });
  const { swapTransaction } = await swapRes.json();

  const { VersionedTransaction, Connection } = await import('@solana/web3.js');
  const tx       = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  
  // Use adapter.signTransaction — works for Phantom, Solflare, Backpack, OKX, etc.
  const signedTx = await wallet.signTransaction(tx);

  onStatus('Sending swap transaction...');
  const connection = new Connection(import.meta.env.VITE_SOLANA_RPC || 'https://api.mainnet-beta.solana.com', 'confirmed');
  const txid = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: false, maxRetries: 3 });

  onStatus('Waiting for Solana confirmation...');
  await connection.confirmTransaction(txid, 'confirmed');

  return { txid, outAmount: quote.outAmount };
}
```

---

### Adding WalletConnect Project ID to Environment

**`client/.env.example`:**
```env
# WalletConnect / Reown Project ID (get free at cloud.reown.com)
# Set "Allowed Domains" to your production domain in the Reown dashboard
VITE_WALLETCONNECT_PROJECT_ID=your_project_id_here

# Backend API
VITE_API_URL=https://api.rdoone.com
VITE_WS_URL=wss://api.rdoone.com/ws

# Solana RPC (optional override — defaults to public mainnet-beta)
VITE_SOLANA_RPC=https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
```

**`client/.env.development`:**
```env
VITE_WALLETCONNECT_PROJECT_ID=your_project_id_here
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001/ws
```

**`client/.env.production`:**
```env
VITE_WALLETCONNECT_PROJECT_ID=your_project_id_here
VITE_API_URL=https://api.rdoone.com
VITE_WS_URL=wss://api.rdoone.com/ws
```

---

### Adding AppKit to Each Page

Since the terminal uses multiple separate HTML pages (not a SPA), initialize AppKit once in a shared entry point and import it on each page.

**`client/src/lib/wallet.js`** is the single initialization file — it only needs to be imported once per page. Import it at the top of each page's JS:

```javascript
// In portfolio.html's <script type="module">:
import { openConnectModal, onAccountChanged, getEVMAddress, getSolanaAddress } from '/src/lib/wallet.js';

// In index.html's main JS:
import { onAccountChanged, getEVMAddress } from '/src/lib/wallet.js';
```

AppKit registers its web components globally when the module loads. After that, `<appkit-button />` works anywhere in the DOM.

---

### Wallet Detection Flow (What Replaces `window.ethereum`)

The current code does:
```javascript
// OLD — only works for MetaMask
if (window.ethereum) {
  const provider = new ethers.BrowserProvider(window.ethereum);
  await window.ethereum.request({ method: 'eth_requestAccounts' });
}

// OLD — only works for Phantom
if (window.solana?.isPhantom) {
  await window.solana.connect();
}
```

Replace with:
```javascript
// NEW — works for all wallets
import { openConnectModal, getEVMAddress, getSolanaAddress, onAccountChanged, isConnected } from './lib/wallet.js';

// To trigger connection:
openConnectModal(); // opens modal with all wallet options

// To get current address (after connection):
const evmAddr    = getEVMAddress();   // "0x..." or null
const solanaAddr = getSolanaAddress(); // "base58..." or null

// To react when user connects:
onAccountChanged(({ address, isConnected }) => {
  if (isConnected) {
    console.log('Connected:', address);
    // reload balances, positions, etc.
  }
});
```

---

### Portfolio Page Integration

The portfolio page (`public/portfolio.html`) currently auto-connects by checking `window.solana` and `window.ethereum`. Replace the auto-connect logic with AppKit events:

```javascript
// At the bottom of portfolio.html's <script type="module">
import {
  openConnectModal,
  onWalletConnected,
  onWalletDisconnected,
  getEVMAddress,
  getSolanaAddress,
  isConnected,
} from '/src/lib/wallet.js';

// Connect button
document.getElementById('connect-btn').onclick = openConnectModal;

// React to connection
onWalletConnected(({ evmAddress, solanaAddress }) => {
  if (evmAddress) {
    setEVMAddr(evmAddress, 'wallet');     // existing function
    loadEVMBalance(evmAddress);           // existing function
  }
  if (solanaAddress) {
    setSolanaAddr(solanaAddress, 'wallet'); // existing function
  }
});

onWalletDisconnected(() => {
  evmAddr  = null;
  pubkey   = null;
  // reset UI...
});

// Restore session on page load
window.addEventListener('load', () => {
  if (isConnected()) {
    const evm    = getEVMAddress();
    const solana = getSolanaAddress();
    if (evm)    { setEVMAddr(evm, 'wallet'); loadEVMBalance(evm); }
    if (solana) { setSolanaAddr(solana, 'wallet'); }
  }

  // Keep URL param auto-load working
  const urlHL = new URLSearchParams(location.search).get('hl');
  if (urlHL) {
    document.getElementById('hl-addr-input').value = urlHL;
    loadHLData(urlHL);
  }
});
```

---

### Testing Checklist for Wallet Connect

Before shipping, verify each wallet type works for the deposit flow:

**EVM wallets:**
- [ ] MetaMask (browser extension) — connect, switch to Arbitrum, send tx
- [ ] WalletConnect QR code — test with Rainbow or Trust Wallet on phone
- [ ] Coinbase Wallet (browser extension)
- [ ] OKX Wallet (browser extension)
- [ ] Phantom in EVM mode (browser extension, select Ethereum network)

**Solana wallets:**
- [ ] Phantom (browser extension)
- [ ] Solflare (browser extension)
- [ ] Backpack (browser extension)
- [ ] OKX Wallet — Solana mode

**Edge cases:**
- [ ] User has multiple wallet extensions installed — does the modal show all of them?
- [ ] User disconnects mid-deposit — does the error message make sense?
- [ ] User switches account in MetaMask during a session — does the UI update?
- [ ] User is on wrong network — does it prompt to switch to Arbitrum?
- [ ] Mobile user with no extension — does WalletConnect QR appear?

---

### npm install Summary for Component 6

```bash
# From the client/ directory:
npm install \
  @reown/appkit \
  @reown/appkit-adapter-wagmi \
  @reown/appkit-adapter-solana \
  wagmi \
  viem \
  @solana/wallet-adapter-wallets \
  @solana/web3.js
```

No backend packages needed — wallet connection is entirely client-side.

---

## 17. Two-Mode Terminal — Hyperliquid + Aster

### Overview

RDO ONE supports two execution engines. Users pick their mode based on what they need:

| | Hyperliquid Mode | Aster Mode |
|---|---|---|
| Max leverage | 50x | 1001x |
| Stock perps | No | Yes (NVDA, TSLA, etc.) |
| Custody model | Non-custodial — user signs every order | Semi-custodial — backend signs orders |
| Builder fee | Up to 0.1% per trade (Builder Codes) | Configurable feeRate per order |
| Base taker fee | 0.04% | 0.04% (USDT-perps) |
| Collateral | USDC | USDT / USD1 |
| Settlement chain | HyperCore (HL L1) | Aster L1 / BNB Chain |

**Key point for UX:** Funds live on different chains. Switching modes requires a cross-chain bridge transfer (~10–20 minutes). Users pick a mode and stay there — the two modes serve different user types, not the same user switching back and forth constantly.

---

### Architecture — Two-Mode Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                    RDO ONE Terminal                             │
│                                                                 │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐  │
│  │    HYPERLIQUID MODE     │  │       ASTER MODE            │  │
│  │                         │  │                             │  │
│  │  • Up to 50x leverage   │  │  • Up to 1001x leverage     │  │
│  │  • User signs orders    │  │  • Backend signs orders     │  │
│  │  • Builder Code fee     │  │  • Builder feeRate          │  │
│  │  • USDC collateral      │  │  • USDT collateral          │  │
│  │  • Non-custodial        │  │  • Semi-custodial           │  │
│  └────────────┬────────────┘  └──────────────┬──────────────┘  │
│               │                              │                 │
│               └──────────┬───────────────────┘                 │
│                          │                                     │
│               ┌──────────▼───────────┐                         │
│               │   Portfolio Page      │                         │
│               │  (shows both modes)   │                         │
│               └──────────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

---

### Builder Fees — Both Modes

#### Hyperliquid Builder Codes

Add `builder` field to every order. No extra user approval flow needed beyond the one-time `ApproveBuilderFee`.

**Setup (one time — your builder wallet):**
- Deposit 100 USDC into your HL perps account at app.hyperliquid.xyz
- Your builder wallet address is what you put in the `b` field

**Every order includes:**
```javascript
const order = {
  coin:    'BTC',
  is_buy:  true,
  sz:      0.01,
  limit_px: 65000,
  order_type: { limit: { tif: 'Gtc' } },
  reduce_only: false,
  // Builder fee — 0.05% on this order (50 = 5 bps = 0.05%)
  builder: {
    b: '0xYourBuilderWalletAddress',
    f: 50,  // tenths of a basis point. Max: 100 = 0.1%
  }
};
```

**Fee calculation:** `trade_size_usd × (f / 100000)`
- $10,000 trade with `f: 50` = $10,000 × 0.0005 = **$5 earned**

**User one-time approval** (gasless signature, done once on first trade):
```javascript
const approveAction = {
  type: 'approveBuilderFee',
  hyperliquidChain: 'Mainnet',
  signatureChainId: '0xa4b1',  // Arbitrum
  maxFeeRate: '0.1%',          // max you're allowed to charge this user
  builder: '0xYourBuilderAddress',
  nonce: Date.now(),
};
// User signs this with their wallet — no gas, instant
```

#### Aster Builder Fees

Set via `feeRate` field on every order. Capped by user-approved `maxFeeRate`.

```javascript
await fetch('https://fapi.asterdex.com/fapi/v3/order', {
  method: 'POST',
  body: JSON.stringify({
    symbol:    'BTCUSDT',
    side:      'BUY',
    type:      'LIMIT',
    quantity:  0.01,
    price:     65000,
    builder:   '0xYourBuilderAddress',
    feeRate:   '0.0005',   // 0.05% — must be <= user's approved maxFeeRate
    // signed by your backend signer key for this user
  })
});
```

---

### Portfolio Page — Dual Mode Display

The portfolio page reads from both APIs simultaneously and shows combined stats.

**`client/src/lib/portfolio-dual.js`:**

```javascript
import { getEVMAddress } from './wallet.js';

const HL_API   = 'https://api.hyperliquid.xyz/info';
const ASTER_API = 'https://fapi.asterdex.com';

// Fetch both accounts in parallel
export async function loadDualPortfolio(address) {
  const [hlResult, asterResult] = await Promise.allSettled([
    loadHLAccount(address),
    loadAsterAccount(address),
  ]);

  return {
    hl:    hlResult.status    === 'fulfilled' ? hlResult.value    : null,
    aster: asterResult.status === 'fulfilled' ? asterResult.value : null,
  };
}

async function loadHLAccount(address) {
  const res = await fetch(HL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'clearinghouseState', user: address }),
  });
  const data = await res.json();

  const balance    = parseFloat(data.marginSummary?.accountValue || 0);
  const unrealPnl  = parseFloat(data.marginSummary?.totalUnrealizedPnl || 0);
  const positions  = (data.assetPositions || [])
    .filter(p => parseFloat(p.position?.szi) !== 0)
    .map(p => ({
      coin:   p.position.coin,
      size:   parseFloat(p.position.szi),
      pnl:    parseFloat(p.position.unrealizedPnl),
      entry:  parseFloat(p.position.entryPx),
      liqPx:  parseFloat(p.position.liquidationPx || 0),
    }));

  return { balance, unrealPnl, positions, mode: 'hyperliquid' };
}

async function loadAsterAccount(address) {
  // Aster requires agent auth — use your backend proxy to protect signer key
  const res = await fetch(`/api/aster/account?user=${address}`);
  const data = await res.json();

  const balance   = parseFloat(data.totalWalletBalance || 0);
  const unrealPnl = parseFloat(data.totalUnrealizedProfit || 0);
  const positions = (data.positions || [])
    .filter(p => parseFloat(p.positionAmt) !== 0)
    .map(p => ({
      coin:  p.symbol.replace('USDT', ''),
      size:  parseFloat(p.positionAmt),
      pnl:   parseFloat(p.unrealizedProfit),
      entry: parseFloat(p.entryPrice),
      liqPx: parseFloat(p.liquidationPrice || 0),
    }));

  return { balance, unrealPnl, positions, mode: 'aster' };
}
```

**Portfolio HTML structure:**

```html
<div class="dual-portfolio">

  <!-- Combined header -->
  <div class="portfolio-total">
    <span class="total-label">Total Portfolio</span>
    <span class="total-value" id="combined-balance">$—</span>
    <span class="total-pnl"  id="combined-pnl">—</span>
  </div>

  <!-- Two mode cards side by side -->
  <div class="mode-cards">

    <div class="mode-card" id="hl-card">
      <div class="mode-header">
        <img src="/icons/hyperliquid.svg" /> Hyperliquid
        <span class="mode-badge">50x</span>
      </div>
      <div class="mode-balance" id="hl-balance">$—</div>
      <div class="mode-pnl"     id="hl-pnl">—</div>
      <div class="mode-positions" id="hl-positions"><!-- positions list --></div>
      <button onclick="openTransfer('hl-to-aster')">Transfer to Aster →</button>
    </div>

    <div class="mode-card" id="aster-card">
      <div class="mode-header">
        <img src="/icons/aster.svg" /> Aster
        <span class="mode-badge">1001x</span>
      </div>
      <div class="mode-balance" id="aster-balance">$—</div>
      <div class="mode-pnl"     id="aster-pnl">—</div>
      <div class="mode-positions" id="aster-positions"><!-- positions list --></div>
      <button onclick="openTransfer('aster-to-hl')">Transfer to Hyperliquid →</button>
    </div>

  </div>
</div>
```

---

### Transfer Between Modes

There is no direct bridge between HyperCore (HL) and Aster's chain. Funds must travel through the EVM bridge. Total time: **10–20 minutes**.

#### HL → Aster Flow

```
Step 1: withdraw3 (HL API)           → USDC lands on Arbitrum   (~5 min, $1 fee)
Step 2: Li.Fi bridge                 → USDC lands on BNB/Aster   (~5 min, gas)
Step 3: Aster deposit API            → balance in Aster perps    (instant)
```

**`client/src/lib/transfer.js`:**

```javascript
import { getWalletClient, getPublicClient } from '@wagmi/core';
import { wagmiConfig, getEVMAddress } from './wallet.js';
import { arbitrum } from 'viem/chains';

const HL_CHAIN_ID  = '0xa4b1';  // Arbitrum (42161) — HL withdrawal destination
const HL_API       = 'https://api.hyperliquid.xyz/exchange';

// ── Step 1: Withdraw USDC from HL perps to Arbitrum ──────────────────────────
export async function withdrawFromHL(amountUsdc, onStatus) {
  const address      = getEVMAddress();
  const walletClient = await getWalletClient(wagmiConfig, { chainId: arbitrum.id });

  onStatus('Withdrawing from Hyperliquid...');

  const action = {
    type:            'withdraw3',
    hyperliquidChain: 'Mainnet',
    signatureChainId: HL_CHAIN_ID,
    amount:           String(amountUsdc),
    time:             Date.now(),
    destination:      address,
  };

  // EIP-712 sign the withdrawal action
  const signature = await walletClient.signTypedData({
    domain: {
      name:              'Exchange',
      version:           '1',
      chainId:           42161,
      verifyingContract: '0x0000000000000000000000000000000000000000',
    },
    types: {
      'HyperliquidTransaction:Withdraw': [
        { name: 'hyperliquidChain', type: 'string' },
        { name: 'destination',       type: 'string' },
        { name: 'amount',            type: 'string' },
        { name: 'time',              type: 'uint64'  },
      ],
    },
    primaryType: 'HyperliquidTransaction:Withdraw',
    message: {
      hyperliquidChain: 'Mainnet',
      destination:      address,
      amount:           String(amountUsdc),
      time:             BigInt(action.time),
    },
  });

  await fetch(HL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce: action.time, signature }),
  });

  onStatus('Withdrawal submitted. USDC arriving on Arbitrum in ~5 minutes...');

  // Poll Arbitrum USDC balance until it increases
  await waitForArbUSDC(address, amountUsdc * 0.98, onStatus); // 98% = accounting for $1 HL fee
}

// ── Step 2: Bridge Arbitrum USDC → Aster chain via Li.Fi ─────────────────────
export async function bridgeToAster(amountUsdc, onStatus) {
  onStatus('Opening bridge to Aster...');
  // Reuse existing Li.Fi iframe — point it to Aster destination chain
  // Or call Li.Fi SDK directly for programmatic bridging
  const ASTER_CHAIN_ID = 56; // BNB Chain (or Aster L1 chain ID when confirmed)
  const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

  // Open Li.Fi widget pre-filled for this exact bridge
  window.open(
    `/lifi.html?mode=deposit&fromToken=${USDC_ARB}&fromChain=42161&toChain=${ASTER_CHAIN_ID}&amount=${amountUsdc}`,
    '_blank'
  );
  // Alternative: integrate Li.Fi SDK directly and skip the iframe
}

// ── Step 3: Deposit into Aster perps (via your backend proxy) ─────────────────
export async function depositToAster(amountUsdt, onStatus) {
  onStatus('Depositing into Aster perps...');
  const res = await fetch('/api/aster/deposit', {
    method: 'POST',
    body: JSON.stringify({ amount: amountUsdt }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  onStatus('Done! Balance updated in Aster perps.');
}

// ── Full HL → Aster transfer ───────────────────────────────────────────────────
export async function transferHLtoAster(amountUsdc, onStatus) {
  await withdrawFromHL(amountUsdc, onStatus);
  await bridgeToAster(amountUsdc, onStatus);
  // Step 3 (Aster deposit) triggered after bridge completes
}

// ── Poll Arbitrum USDC balance until funds arrive ─────────────────────────────
async function waitForArbUSDC(address, minAmount, onStatus) {
  const ARB_RPC  = 'https://arb1.arbitrum.io/rpc';
  const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
  const callData = '0x70a08231' + address.replace('0x', '').padStart(64, '0');

  for (let i = 0; i < 60; i++) {  // poll for up to 10 minutes
    await new Promise(r => setTimeout(r, 10_000)); // wait 10s
    const res  = await fetch(ARB_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: USDC_ARB, data: callData }, 'latest'] }),
    });
    const data = await res.json();
    const bal  = parseInt(data.result || '0x0', 16) / 1e6;
    onStatus(`Waiting for USDC on Arbitrum... (${bal.toFixed(2)} USDC)`);
    if (bal >= minAmount) return bal;
  }
  throw new Error('Timeout waiting for USDC on Arbitrum');
}
```

---

### Transfer UI — Step Progress Modal

```html
<div class="transfer-modal" id="transfer-modal">
  <div class="transfer-header">
    <span id="transfer-title">Transfer HL → Aster</span>
    <button onclick="closeTransfer()">✕</button>
  </div>

  <div class="transfer-amount">
    <input type="number" id="transfer-amount" placeholder="Amount USDC" />
    <span class="transfer-bal">Available: <span id="transfer-avail">—</span></span>
  </div>

  <div class="transfer-steps">
    <div class="step" id="step-1">
      <span class="step-icon">○</span>
      <span class="step-label">Withdraw from Hyperliquid</span>
      <span class="step-detail">~5 min · $1 fee</span>
    </div>
    <div class="step" id="step-2">
      <span class="step-icon">○</span>
      <span class="step-label">Bridge to Aster chain</span>
      <span class="step-detail">~5 min · gas fee</span>
    </div>
    <div class="step" id="step-3">
      <span class="step-icon">○</span>
      <span class="step-label">Deposit to Aster Perps</span>
      <span class="step-detail">Instant</span>
    </div>
  </div>

  <div class="transfer-warning">
    ⚠ Total time ~10–20 min. Do not close this page during transfer.
  </div>

  <div class="transfer-status" id="transfer-status"></div>

  <button class="transfer-btn" id="transfer-confirm-btn" onclick="startTransfer()">
    Confirm Transfer
  </button>
</div>
```

**Step icon states during transfer:**
- `○` — pending
- `⏳` — in progress
- `✓` — complete
- `✕` — failed

---

### Backend Routes Needed for Aster Mode

Add these to `server/routes/proxy.js`:

```javascript
// Proxy Aster account data (hides signer auth from frontend)
fastify.get('/aster/account', async (req, reply) => {
  const { user } = req.query;
  // Fetch user's Aster account using their registered agent signer
  // (signer key looked up from your secure key store by user address)
  const signerKey = await getSignerKey(user);  // your key management function
  const headers   = buildAsterAuthHeaders(signerKey, user);

  const res  = await fetch(`${ASTER_BASE}/fapi/v1/account`, { headers });
  return res.json();
});

// Proxy Aster positions
fastify.get('/aster/positions', async (req, reply) => {
  const { user } = req.query;
  const signerKey = await getSignerKey(user);
  const headers   = buildAsterAuthHeaders(signerKey, user);

  const res  = await fetch(`${ASTER_BASE}/fapi/v1/positionRisk`, { headers });
  return res.json();
});
```

---

### First-Time Setup Flow — Both Modes

When a user connects their wallet for the first time, check which modes they've approved and prompt for any missing approvals:

```javascript
async function checkAndSetupModes(address) {
  const [hlApproved, asterApproved] = await Promise.all([
    checkHLBuilderApproval(address),
    checkAsterAgentApproval(address),
  ]);

  if (!hlApproved) {
    showSetupStep('Activate Hyperliquid trading (1 signature, no gas)');
    await approveHLBuilderFee(address);
  }

  if (!asterApproved) {
    showSetupStep('Activate Aster trading (2 signatures, no gas)');
    await approveAsterAgent(address);
    await approveAsterBuilder(address);
  }
}

async function checkHLBuilderApproval(address) {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type:    'maxBuilderFee',
      user:    address,
      builder: YOUR_BUILDER_ADDRESS,
    }),
  });
  const data = await res.json();
  return data > 0; // returns approved maxFeeRate or 0 if not approved
}
```

---

### User Experience Summary

```
First visit:
  1. Connect wallet (AppKit — any wallet)
  2. One-time setup screen:
     • Sign 1 message → Hyperliquid mode active
     • Sign 2 messages → Aster mode active
     (All gasless, takes ~30 seconds total)

Trading:
  • Pick mode from top nav: [HYPERLIQUID] [ASTER]
  • Trade normally — you earn builder fees on every fill

Portfolio page:
  • See both mode balances side by side
  • Combined PnL across both accounts
  • Positions from both modes in one list

Transfer between modes:
  • Click [Transfer HL → Aster] or [Transfer Aster → HL]
  • Enter amount
  • ~10–20 min, walk-through step progress UI
  • No manual bridge site needed — all inside the terminal
```

---

### Development Phases for Two-Mode System

| Phase | Task | Time |
|---|---|---|
| 1 | HL Builder Codes — add `builder` field to every order, `ApproveBuilderFee` on first trade | 2 days |
| 2 | Portfolio dual display — fetch both APIs, combined totals UI | 3 days |
| 3 | Aster agent setup — backend key management, agent/builder approval flow | 1 week |
| 4 | Aster order routing — backend signs orders with signer key, feeRate included | 1 week |
| 5 | HL → Aster transfer — withdraw3 + Li.Fi bridge + Aster deposit | 1 week |
| 6 | Aster → HL transfer — Aster withdrawal + Li.Fi bridge + HL deposit contract | 1 week |
| 7 | Transfer progress UI — step tracking, recovery for interrupted transfers | 3 days |

**Total: ~5–6 weeks** to have both modes fully operational with transfers.
