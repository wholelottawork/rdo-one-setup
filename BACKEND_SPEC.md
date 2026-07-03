# RDO ONE — Backend Technical Specification

## Контекст

RDO ONE — торговый терминал для Hyperliquid perps. Сейчас это чистый фронтенд на Vite.
Все внешние API проксируются через `vite.config.js` — это работает только в dev-режиме.
В продакшне этих прокси нет, поэтому нужен бэкенд.

---

## Архитектура (обзор)

```
Browser (Vite build)
  │
  ├── Static files → CDN (Cloudflare Pages / Vercel / S3)
  │
  └── API calls → Backend Server
        │
        ├── /api/proxy/*   → внешние APIs (CoinGecko, Binance, HL, RSS)
        ├── /api/swap/*    → 1inch (серверный API ключ)
        ├── /api/news/*    → агрегация новостей с кэшем
        └── /ws            → WebSocket relay → Hyperliquid WS
```

Всё что касается депозитов (Jupiter, Wormhole, HL контракт) — **100% client-side**.
Пользователь сам подписывает транзакции своим кошельком. Мы не держим никаких ключей.

---

## Стек

| Компонент       | Технология           | Причина                                      |
|----------------|----------------------|----------------------------------------------|
| Runtime        | Node.js 20 LTS       | Совпадает с фронтендом (один язык)           |
| HTTP Server    | Fastify              | Быстрее Express, встроенная валидация        |
| Cache          | Redis                | TTL кэш для цен и новостей                  |
| WebSocket      | `ws` npm package     | Легковесный, без Socket.io overhead          |
| Deploy         | Railway или Fly.io   | $5–7/мес, деплой за 1 команду               |
| Reverse Proxy  | Nginx или Caddy      | SSL, gzip, маршрутизация static/api          |

---

## Компонент 1 — API Proxy Server

### Проблема
`vite.config.js` содержит 10 proxy правил. В dev они работают.
В продакшне (статичный билд) — не работают вообще. Все запросы с CORS падают.

### Решение
Fastify сервер, который:
1. Принимает запросы от браузера
2. Добавляет нужные заголовки (User-Agent, auth)
3. Проксирует к целевому API
4. Возвращает ответ с кэшем через Redis

### Эндпоинты

```
GET  /proxy/coingecko/*   → https://api.coingecko.com/*              TTL: 60s
GET  /proxy/binance/*     → https://api.binance.com/*                TTL: 5s
GET  /proxy/feargreed/*   → https://api.alternative.me/*             TTL: 1h
POST /proxy/hl/*          → https://api.hyperliquid.xyz/*            TTL: 2s
GET  /proxy/ctnews/*      → https://cointelegraph.com/*              TTL: 5min
GET  /proxy/cdnews/*      → https://www.coindesk.com/*               TTL: 5min
GET  /proxy/decnews/*     → https://decrypt.co/*                     TTL: 5min
GET  /proxy/beinnews/*    → https://beincrypto.com/*                 TTL: 5min
GET  /proxy/btcinews/*    → https://bitcoinist.com/*                 TTL: 5min
```

### Код (структура)

```
server/
├── index.js               # Fastify app, регистрация плагинов
├── plugins/
│   ├── redis.js           # Redis подключение + хелперы get/set TTL
│   └── cors.js            # CORS заголовки для фронтенда
├── routes/
│   ├── proxy.js           # Все proxy маршруты
│   ├── swap.js            # 1inch API (с серверным ключом)
│   ├── news.js            # Агрегация новостей
│   └── ws-relay.js        # WebSocket relay
└── lib/
    ├── cache.js            # Redis TTL wrapper
    └── fetch-proxy.js      # Общая функция fetch с retry
```

### Пример реализации proxy маршрута

```js
// routes/proxy.js
import { fetchWithCache } from '../lib/cache.js';

export default async function proxyRoutes(fastify) {

  // Hyperliquid — POST запросы
  fastify.post('/proxy/hl/*', async (req, reply) => {
    const path = req.params['*'];
    const cacheKey = `hl:${path}:${JSON.stringify(req.body)}`;

    return fetchWithCache(cacheKey, 2, async () => {
      const res = await fetch(`https://api.hyperliquid.xyz/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      return res.json();
    });
  });

  // CoinGecko — GET запросы с кэшем 60 сек
  fastify.get('/proxy/coingecko/*', async (req, reply) => {
    const path = req.params['*'];
    const qs   = new URLSearchParams(req.query).toString();
    const url  = `https://api.coingecko.com/${path}${qs ? '?' + qs : ''}`;
    const key  = `cg:${url}`;

    return fetchWithCache(key, 60, () => fetch(url).then(r => r.json()));
  });

  // RSS новости — GET с кэшем 5 минут
  const NEWS_TARGETS = {
    ctnews:  'https://cointelegraph.com',
    cdnews:  'https://www.coindesk.com',
    decnews: 'https://decrypt.co',
    beinnews:'https://beincrypto.com',
    btcinews:'https://bitcoinist.com',
  };

  for (const [prefix, target] of Object.entries(NEWS_TARGETS)) {
    fastify.get(`/proxy/${prefix}/*`, async (req, reply) => {
      const path = req.params['*'];
      const url  = `${target}/${path}`;
      const key  = `news:${url}`;

      const xml = await fetchWithCache(key, 300, async () => {
        const r = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)' }
        });
        return r.text(); // RSS возвращает XML
      });

      reply.header('Content-Type', 'application/rss+xml');
      return xml;
    });
  }
}
```

### Redis TTL хелпер

```js
// lib/cache.js
import { redis } from '../plugins/redis.js';

export async function fetchWithCache(key, ttlSeconds, fetcher) {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const data = await fetcher();
  await redis.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  return data;
}
```

---

## Компонент 2 — 1inch Proxy (серверный API ключ)

1inch требует API ключ. Его **нельзя** хранить во фронтенде — любой увидит в DevTools.
Сервер принимает запрос от браузера, подставляет ключ, проксирует к 1inch.

```
GET /api/swap/tokens?chainId=42161
GET /api/swap/quote?chainId=42161&src=ETH&dst=USDC&amount=X&from=0x...
GET /api/swap/swap?chainId=42161&src=ETH&dst=USDC&amount=X&from=0x...&slippage=1
```

```js
// routes/swap.js
const ONEINCH_KEY = process.env.ONEINCH_API_KEY;
const ONEINCH_BASE = 'https://api.1inch.dev/swap/v6.0';

export default async function swapRoutes(fastify) {

  fastify.get('/api/swap/quote', async (req, reply) => {
    const { chainId = 42161, src, dst, amount, from } = req.query;
    const url = `${ONEINCH_BASE}/${chainId}/quote?src=${src}&dst=${dst}&amount=${amount}`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${ONEINCH_KEY}` }
    });
    return res.json();
  });

  fastify.get('/api/swap/swap', async (req, reply) => {
    const { chainId = 42161, src, dst, amount, from, slippage = 1 } = req.query;
    const url = `${ONEINCH_BASE}/${chainId}/swap?src=${src}&dst=${dst}&amount=${amount}&from=${from}&slippage=${slippage}&disableEstimate=true`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${ONEINCH_KEY}` }
    });
    return res.json();
  });
}
```

---

## Компонент 3 — WebSocket Relay

Hyperliquid имеет WebSocket API: `wss://api.hyperliquid.xyz/ws`

**Проблема**: если 1000 пользователей одновременно, каждый держит своё WS подключение к HL.
HL может начать rate limit или дропать подключения.

**Решение**: один upstream WS → fanout к N клиентам.

```js
// routes/ws-relay.js
import WebSocket, { WebSocketServer } from 'ws';

const HL_WS = 'wss://api.hyperliquid.xyz/ws';

export function startWSRelay(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  // Один upstream к HL
  let upstream = null;
  const clients = new Set();
  const subscriptions = new Map(); // subscription → Set<client>

  function connectUpstream() {
    upstream = new WebSocket(HL_WS);

    upstream.on('message', (data) => {
      // Рассылаем всем подключённым клиентам
      const msg = data.toString();
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      });
    });

    upstream.on('close', () => {
      // Реконнект через 2 секунды
      setTimeout(connectUpstream, 2000);
    });
  }

  connectUpstream();

  wss.on('connection', (ws) => {
    clients.add(ws);

    ws.on('message', (data) => {
      // Клиент хочет подписаться — пересылаем в upstream
      if (upstream?.readyState === WebSocket.OPEN) {
        upstream.send(data.toString());
      }
    });

    ws.on('close', () => clients.delete(ws));
  });
}
```

**Во фронтенде** потом меняем:
```js
// было
const ws = new WebSocket('wss://api.hyperliquid.xyz/ws');
// стало
const ws = new WebSocket('wss://your-backend.com/ws');
```

---

## Компонент 4 — Deposit Flow (CLIENT-SIDE, не бэкенд)

Это критически важно: **мы не держим ключи пользователей**. Все транзакции подписываются в браузере кошельком пользователя.

Нужно написать JS модули для фронтенда.

### Путь B: EVM → USDC on Arbitrum → HL Perps

Файл: `src/lib/deposit-evm.js`

```js
import { ethers } from 'ethers';

// Контракты на Arbitrum
const HL_DEPOSIT_CONTRACT = '0x2Df1c51E09aECF9d4A91F401B2FDC7765A0d15c';
const USDC_ARBITRUM       = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const ARBITRUM_CHAIN_ID   = 42161;

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
];

const HL_ABI = [
  'function deposit(uint64 usdAmount) external',
];

// Шаг 1: получить котировку свапа (через наш сервер, там хранится 1inch ключ)
export async function getSwapQuote({ tokenIn, amountIn, walletAddress }) {
  const res = await fetch(
    `/api/swap/quote?chainId=42161&src=${tokenIn}&dst=${USDC_ARBITRUM}&amount=${amountIn}&from=${walletAddress}`
  );
  return res.json(); // { toAmount, estimatedGas, ... }
}

// Шаг 2: выполнить свап ETH/токен → USDC через 1inch
export async function swapToUSDC({ tokenIn, amountIn, walletAddress, signer, onStatus }) {
  onStatus('Получаем маршрут свапа...');

  const swapData = await fetch(
    `/api/swap/swap?chainId=${ARBITRUM_CHAIN_ID}&src=${tokenIn}&dst=${USDC_ARBITRUM}&amount=${amountIn}&from=${walletAddress}&slippage=1`
  ).then(r => r.json());

  onStatus('Подтвердите свап в кошельке...');

  const tx = await signer.sendTransaction({
    to:   swapData.tx.to,
    data: swapData.tx.data,
    value: BigInt(swapData.tx.value || '0'),
  });

  onStatus('Свап выполняется...');
  await tx.wait();

  return swapData.toAmount; // сколько USDC получили
}

// Шаг 3: задепозитить USDC в HL Perps
export async function depositToHLPerps({ usdcAmount, signer, onStatus }) {
  const usdc = new ethers.Contract(USDC_ARBITRUM, ERC20_ABI, signer);
  const hl   = new ethers.Contract(HL_DEPOSIT_CONTRACT, HL_ABI, signer);

  // Проверить текущий allowance
  const address    = await signer.getAddress();
  const allowance  = await usdc.allowance(address, HL_DEPOSIT_CONTRACT);

  if (allowance < BigInt(usdcAmount)) {
    onStatus('Подтвердите approve USDC в кошельке...');
    const approveTx = await usdc.approve(HL_DEPOSIT_CONTRACT, usdcAmount);
    await approveTx.wait();
  }

  onStatus('Подтвердите депозит в HL в кошельке...');
  const depositTx = await hl.deposit(usdcAmount);

  onStatus('Депозит выполняется...');
  await depositTx.wait();

  onStatus('Готово! Средства в HL Perps.');
}

// Полный флоу Path B
export async function depositEVMToHL({ tokenIn, amountIn, walletAddress, provider, onStatus }) {
  // Проверить что юзер на Arbitrum
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(ARBITRUM_CHAIN_ID)) {
    await provider.send('wallet_switchEthereumChain', [
      { chainId: '0x' + ARBITRUM_CHAIN_ID.toString(16) }
    ]);
  }

  const signer = await provider.getSigner();
  const isUSDC = tokenIn.toLowerCase() === USDC_ARBITRUM.toLowerCase();

  let finalUSDCAmount = amountIn;

  if (!isUSDC) {
    finalUSDCAmount = await swapToUSDC({ tokenIn, amountIn, walletAddress, signer, onStatus });
  }

  await depositToHLPerps({ usdcAmount: finalUSDCAmount, signer, onStatus });
}
```

---

### Путь A: Solana → USDC → Bridge → Arbitrum → HL Perps

Файл: `src/lib/deposit-sol.js`

```js
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const SOL_MINT   = 'So11111111111111111111111111111111111111112';
const USDC_SOL   = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC на Solana

// ─── Шаг 1: Jupiter Swap SOL → USDC on Solana ────────────────────────────────
export async function jupiterSwap({ inputMint, outputMint, amount, walletPublicKey, onStatus }) {
  onStatus('Получаем маршрут Jupiter...');

  // Получить котировку
  const quoteRes = await fetch(
    `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`
  );
  const quote = await quoteRes.json();

  onStatus(`Маршрут найден. Вы получите ~${quote.outAmount / 1e6} USDC. Подтвердите...`);

  // Получить транзакцию
  const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse:   quote,
      userPublicKey:   walletPublicKey,
      wrapAndUnwrapSol: true,
    }),
  });
  const { swapTransaction } = await swapRes.json();

  // Десериализовать и подписать через Phantom
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  const signedTx = await window.solana.signTransaction(tx);

  const connection = new Connection(SOLANA_RPC, 'confirmed');
  const txid = await connection.sendRawTransaction(signedTx.serialize());

  onStatus('Свап выполняется...');
  await connection.confirmTransaction(txid, 'confirmed');

  return { txid, outAmount: quote.outAmount }; // outAmount в USDC lamports
}

// ─── Шаг 2: Bridge USDC Solana → Arbitrum через Wormhole ─────────────────────
// Использует @wormhole-foundation/sdk
// ВАЖНО: требует у юзера и Phantom (Solana) и MetaMask (Arbitrum) одновременно

import { wormhole } from '@wormhole-foundation/sdk';
import solana from '@wormhole-foundation/sdk/solana';
import evm from '@wormhole-foundation/sdk/evm';

export async function bridgeUSDCToArbitrum({ amount, solWallet, evmSigner, onStatus }) {
  onStatus('Инициализация Wormhole...');

  const wh = await wormhole('Mainnet', [solana, evm]);
  const srcChain = wh.getChain('Solana');
  const dstChain = wh.getChain('Arbitrum');

  const sender   = new solana.PhantomWallet(window.solana);
  const receiver = { address: await evmSigner.getAddress() };

  onStatus('Подтвердите исходящий трансфер в Phantom...');

  const xfer = await wh.tokenTransfer(
    { chain: 'Solana', token: { address: USDC_SOL }, amount },
    { chain: 'Arbitrum', address: receiver.address },
    false // не автоматический relay
  );

  const srcTxids = await xfer.initiateTransfer(sender);
  onStatus(`Бридж инициирован (${srcTxids[0]}). Ждём подтверждений Wormhole (~2-5 мин)...`);

  // Ждём VAA (Verifiable Action Approval) от Wormhole Guardian сети
  await xfer.fetchAttestation(60_000); // ждём до 60 сек (обычно быстрее)

  onStatus('Подтвердите получение в MetaMask (Arbitrum)...');
  const dstTxids = await xfer.completeTransfer(evmSigner);

  onStatus(`USDC получен на Arbitrum! Tx: ${dstTxids[0]}`);
  return dstTxids[0];
}

// ─── Полный флоу Solana → HL Perps ───────────────────────────────────────────
export async function depositSolanaToHL({ solAmount, solWallet, evmProvider, onStatus }) {
  const walletPublicKey = solWallet.publicKey.toString();
  const evmSigner = await evmProvider.getSigner();

  // 1. Jupiter: SOL → USDC on Solana
  const { outAmount } = await jupiterSwap({
    inputMint: SOL_MINT,
    outputMint: USDC_SOL,
    amount: solAmount,    // в lamports (1 SOL = 1_000_000_000)
    walletPublicKey,
    onStatus,
  });

  // 2. Wormhole: USDC Solana → USDC Arbitrum
  await bridgeUSDCToArbitrum({
    amount: outAmount,
    solWallet,
    evmSigner,
    onStatus,
  });

  // 3. HL Deposit Contract (из deposit-evm.js)
  const { depositToHLPerps } = await import('./deposit-evm.js');
  await depositToHLPerps({ usdcAmount: outAmount, signer: evmSigner, onStatus });
}
```

---

## Компонент 5 — Deposit UI (фронтенд)

Файл: `src/components/DepositModal.jsx`

```jsx
import { useState } from 'react';
import { depositEVMToHL }     from '../lib/deposit-evm.js';
import { depositSolanaToHL }  from '../lib/deposit-sol.js';
import { ethers }             from 'ethers';

const STEPS = {
  idle:    { label: 'Готов к депозиту',    color: '#878c8f' },
  swap:    { label: 'Свап токена...',       color: '#f7931a' },
  bridge:  { label: 'Бридж в Arbitrum...', color: '#9b59b6' },
  deposit: { label: 'Депозит в HL...',     color: '#50d2c1' },
  done:    { label: '✓ Готово!',           color: '#1fa67d' },
  error:   { label: 'Ошибка',              color: '#ed7088' },
};

export function DepositModal({ hlAddress, onClose }) {
  const [status, setStatus]   = useState('idle');
  const [statusMsg, setMsg]   = useState('');
  const [amount, setAmount]   = useState('');
  const [source, setSource]   = useState('evm'); // 'evm' | 'solana'

  async function handleDeposit() {
    try {
      if (source === 'evm') {
        const provider = new ethers.BrowserProvider(window.ethereum);
        await depositEVMToHL({
          tokenIn:       ethers.ZeroAddress, // ETH
          amountIn:      ethers.parseEther(amount).toString(),
          walletAddress: hlAddress,
          provider,
          onStatus:      (msg) => { setMsg(msg); },
        });
      } else {
        const evmProvider = new ethers.BrowserProvider(window.ethereum);
        await depositSolanaToHL({
          solAmount:   Math.floor(parseFloat(amount) * 1e9),
          solWallet:   window.solana,
          evmProvider,
          onStatus:    (msg) => { setMsg(msg); },
        });
      }
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setMsg(err.message);
    }
  }

  return (
    <div className="deposit-modal">
      <h2>Deposit to HL Perps</h2>
      <div>Destination: {hlAddress}</div>

      <select value={source} onChange={e => setSource(e.target.value)}>
        <option value="evm">EVM кошелёк (ETH/USDC on Arbitrum)</option>
        <option value="solana">Phantom (SOL)</option>
      </select>

      <input
        type="number"
        placeholder={source === 'evm' ? 'Сумма ETH' : 'Сумма SOL'}
        value={amount}
        onChange={e => setAmount(e.target.value)}
      />

      <div style={{ color: STEPS[status]?.color }}>
        {statusMsg || STEPS[status]?.label}
      </div>

      <button onClick={handleDeposit} disabled={status === 'swap' || status === 'bridge' || status === 'deposit'}>
        Deposit
      </button>
    </div>
  );
}
```

---

## Переменные окружения

```env
# server/.env

# 1inch API (бесплатный ключ на portal.1inch.dev)
ONEINCH_API_KEY=your_key_here

# Redis
REDIS_URL=redis://localhost:6379

# Порт сервера
PORT=3001

# CORS — откуда разрешены запросы (URL фронтенда)
ALLOWED_ORIGIN=https://rdoone.com

# Solana RPC (можно оставить mainnet-beta для начала, потом Helius/Alchemy)
SOLANA_RPC=https://api.mainnet-beta.solana.com

# Arbitrum RPC (Alchemy бесплатно 300M req/мес)
ARBITRUM_RPC=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
```

---

## Деплой

### Структура репозитория

```
rdo-one/
├── client/          ← текущий Vite проект (переименовать src → client)
│   ├── src/
│   ├── public/
│   ├── index.html
│   └── vite.config.js  ← убрать все proxy (они теперь на сервере)
│
└── server/          ← новый Node.js сервер
    ├── index.js
    ├── routes/
    ├── plugins/
    ├── lib/
    ├── .env
    └── package.json
```

### package.json для server

```json
{
  "name": "rdo-one-server",
  "type": "module",
  "scripts": {
    "start": "node index.js",
    "dev":   "node --watch index.js"
  },
  "dependencies": {
    "fastify":         "^4.26",
    "@fastify/cors":   "^9.0",
    "ioredis":         "^5.3",
    "ws":              "^8.17",
    "undici":          "^6.6"
  }
}
```

### Railway деплой (рекомендуется для старта)

```bash
# Один раз
railway login
railway init

# Каждый деплой
railway up
```

Railway автоматически:
- Видит `package.json` → запускает `npm start`
- Генерирует HTTPS домен
- Можно добавить Redis plugin в один клик

### Nginx конфиг (если VPS)

```nginx
server {
  listen 443 ssl;
  server_name api.rdoone.com;

  # Статика
  location / {
    root /var/www/rdo-one/dist;
    try_files $uri $uri/ /index.html;
  }

  # API сервер
  location /api/ {
    proxy_pass http://localhost:3001;
    proxy_set_header Host $host;
  }

  # WebSocket relay
  location /ws {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

---

## Фазы разработки

### Фаза 1 — API Proxy (блокирует продакшн деплой) — 2-3 дня
- [ ] Fastify сервер с Redis
- [ ] Все proxy маршруты из vite.config.js
- [ ] CORS настройка
- [ ] Деплой на Railway
- [ ] Обновить фронтенд: `/proxy/hl/` вместо `/hl/`

### Фаза 2 — Path B: EVM депозит — 3-5 дней
- [ ] 1inch proxy маршрут (с API ключом)
- [ ] `deposit-evm.js` модуль
- [ ] UI: DepositModal компонент с прогресс индикатором
- [ ] Тестирование на Arbitrum testnet (Sepolia)

### Фаза 3 — WebSocket Relay — 2 дня
- [ ] WS relay сервер
- [ ] Обновить фронтенд на `/ws` вместо прямого HL WS

### Фаза 4 — Path A: Solana депозит — 1-2 недели
- [ ] Jupiter swap интеграция
- [ ] Wormhole SDK bridge
- [ ] Full flow тестирование
- [ ] Edge cases (частичные бриджи, реконнект и т.д.)

---

## Зависимости (npm)

### Server
```
npm install fastify @fastify/cors ioredis ws undici
```

### Client (добавить)
```
npm install ethers @solana/web3.js @wormhole-foundation/sdk @wormhole-foundation/sdk/solana @wormhole-foundation/sdk/evm
```

---

## Важные адреса (Arbitrum Mainnet)

| Контракт             | Адрес                                        |
|---------------------|----------------------------------------------|
| HL Deposit Contract  | `0x2Df1c51E09aECF9d4A91F401B2FDC7765A0d15c` |
| USDC (Arbitrum)      | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| WETH (Arbitrum)      | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` |

**⚠️ Проверить адрес HL Deposit Contract через официальную документацию HL перед деплоем в продакшн.**

---

## Безопасность

1. **Никаких приватных ключей пользователей на сервере.** Все транзакции — только через `wallet.signTransaction()` в браузере.
2. **1inch API ключ** — только на сервере, в `.env`, не в git.
3. **Rate limiting** на все proxy маршруты (fastify-rate-limit).
4. **CORS** — разрешать запросы только с вашего домена.
5. **Redis** — не открывать наружу, только localhost соединение.
6. **Arbitrum RPC** — использовать Alchemy/Infura, не публичный endpoint в продакшне.
