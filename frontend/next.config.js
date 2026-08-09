// This app talks to the Fastify backend (../backend/, see
// backend/routes/proxy.js + news.js + swap.js) instead of hitting upstream
// APIs directly — that backend is what adds Redis caching,
// per-IP rate limiting, and Aster's signed-endpoint agent auth, all of which
// this app's original direct-to-upstream rewrites had none of (e.g. the bare
// CoinGecko rewrite was getting Cloudflare-403'd with no cache to fall back
// on). In dev this points at :3001. Next serializes rewrites during a
// production build, so Docker must supply BACKEND_URL as a build argument.
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

const { PHASE_PRODUCTION_BUILD } = require('next/constants');

// NEXT_PUBLIC_* values are inlined into the client bundle by `next build` and
// are never re-read at runtime, so a production image built without
// NEXT_PUBLIC_HL_WS_URL ships the dev fallback (ws://localhost:3001/ws) baked
// in — every visitor's browser then tries to open a socket to their own
// machine. The price stream is dead, the chart never ticks, and nothing in the
// UI says why. Failing the build here is the only place that failure is still
// cheap and visible. (In Docker this must be a build ARG, not a runtime env.)
function assertBuildTimeEnv() {
  const raw = (process.env.NEXT_PUBLIC_HL_WS_URL || '').trim();
  if (!raw) {
    throw new Error(
      'NEXT_PUBLIC_HL_WS_URL is not set.\n' +
      'It is inlined at build time, so it cannot be supplied later as a runtime ' +
      'env var — pass it to `next build` (Docker: a build ARG).\n' +
      'Example: NEXT_PUBLIC_HL_WS_URL=wss://your-domain.example/ws\n' +
      'See frontend/.env.example.'
    );
  }
  let hostname;
  try {
    hostname = new URL(raw).hostname.toLowerCase();
  } catch {
    throw new Error(`NEXT_PUBLIC_HL_WS_URL is not a valid URL: ${raw}`);
  }
  if (['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(hostname)) {
    throw new Error(
      `NEXT_PUBLIC_HL_WS_URL points at ${hostname} (${raw}).\n` +
      'That value gets baked into the browser bundle, where "localhost" means ' +
      "the visitor's own machine, not the server — the Hyperliquid price " +
      'stream would silently never connect.\n' +
      'Set it to the public WebSocket origin of the backend relay.'
    );
  }
}

// Note: WalletConnect is deliberately NOT checked. Running without
// NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is a supported configuration — the
// option is hidden from the wallet chooser and injected wallets still work.

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits a self-contained server + minimal node_modules under
  // .next/standalone/ for a small runtime image. No effect on `next dev`.
  output: 'standalone',
  // Two lockfiles exist (repo root and here), so Next would otherwise infer
  // the repo root as the tracing root and nest the output at
  // .next/standalone/frontend/server.js. The root package.json declares no
  // workspaces and every frontend dependency resolves inside frontend/
  // node_modules, so pinning the root here is safe and keeps the entrypoint
  // at the predictable .next/standalone/server.js.
  outputFileTracingRoot: __dirname,
  turbopack: {},
  // Some proxied paths carry a trailing slash the upstream actually wants
  // (e.g. /beinnews/feed/ -> beincrypto.com/feed/, which 301s without one).
  // Without this, Next's own trailing-slash normalization 308s those
  // requests to the no-slash form BEFORE the rewrite ever runs, adding an
  // extra hop that isn't reliably followed browser-side — skip it so the
  // rewrite is the only redirect in play.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      // Hyperliquid — this app calls both /hl/* and /api/hl/* depending on
      // the file, so both are routed to the same backend route.
      { source: '/api/hl/:path*', destination: `${BACKEND_URL}/api/hl/:path*` },
      { source: '/hl/:path*',     destination: `${BACKEND_URL}/api/hl/:path*` },
      { source: '/hl-testnet/:path*', destination: `${BACKEND_URL}/api/hl-testnet/:path*` },
      // Binance spot REST — proxied/cached by the backend.
      { source: '/api/binance/:path*', destination: `${BACKEND_URL}/api/binance/:path*` },
      { source: '/binance/:path*',     destination: `${BACKEND_URL}/api/binance/:path*` },
      // Binance FUTURES REST (fapi.binance.com — open interest, long/short
      // ratio) has no equivalent route on the backend yet, so this one stays
      // a direct passthrough rather than a fabricated backend route.
      { source: '/fapi/:path*', destination: 'https://fapi.binance.com/:path*' },
      // CoinGecko
      { source: '/api/coingecko/:path*', destination: `${BACKEND_URL}/api/coingecko/:path*` },
      { source: '/coingecko/:path*',     destination: `${BACKEND_URL}/api/coingecko/:path*` },
      // Fear & Greed
      { source: '/api/feargreed/:path*', destination: `${BACKEND_URL}/api/feargreed/:path*` },
      { source: '/feargreed/:path*',     destination: `${BACKEND_URL}/api/feargreed/:path*` },
      // Aster DEX — public market data, bulk OI, and the signed V3 endpoints
      // (account/positions/agent-approval) all live on the backend.
      { source: '/aster-fapi/:path*',       destination: `${BACKEND_URL}/api/aster-fapi/:path*` },
      { source: '/aster-oi-bulk',           destination: `${BACKEND_URL}/api/aster-oi-bulk` },
      { source: '/aster-signed/:path*',     destination: `${BACKEND_URL}/api/aster-signed/:path*` },
      // Trading session for the signed routes — one wallet signature in, an
      // HttpOnly cookie back out (backend/src/lib/aster-session.ts).
      { source: '/aster-session',           destination: `${BACKEND_URL}/api/aster-session` },
      { source: '/aster-agent-address',     destination: `${BACKEND_URL}/api/aster-agent-address` },
      { source: '/aster-leverage-brackets', destination: `${BACKEND_URL}/api/aster-leverage-brackets` },
      { source: '/aster-approve-agent',     destination: `${BACKEND_URL}/api/aster-approve-agent` },
      // Aster V3 withdrawal — the browser signs both signatures itself, the
      // backend only verifies and forwards (see backend/src/lib/aster-withdraw.ts).
      { source: '/aster-withdraw',          destination: `${BACKEND_URL}/api/aster-withdraw` },
      { source: '/aster-withdraw-fee',      destination: `${BACKEND_URL}/api/aster-withdraw-fee` },
      // Aster V1 (API key + HMAC) — credentials are stored and signed
      // server-side; the browser never holds a withdrawal-capable secret.
      { source: '/aster-creds',             destination: `${BACKEND_URL}/api/aster-creds` },
      { source: '/aster-deposit-address',   destination: `${BACKEND_URL}/api/aster-deposit-address` },
      { source: '/aster-tpsl-watch',        destination: `${BACKEND_URL}/api/aster-tpsl-watch` },
      // LI.FI
      { source: '/lifi-api/:path*', destination: `${BACKEND_URL}/api/lifi-api/:path*` },
      // 1inch swap (server-side API key)
      { source: '/swap/:path*', destination: `${BACKEND_URL}/api/swap/:path*` },
      // News — aggregated feed, per-source RSS proxies, and the article
      // image proxy (sidesteps ORB on CDNs like CoinDesk's Sanity host)
      { source: '/news',            destination: `${BACKEND_URL}/api/news` },
      { source: '/img-proxy',       destination: `${BACKEND_URL}/api/img-proxy` },
      { source: '/ctnews/:path*',   destination: `${BACKEND_URL}/api/ctnews/:path*` },
      { source: '/cdnews/:path*',   destination: `${BACKEND_URL}/api/cdnews/:path*` },
      { source: '/decnews/:path*',  destination: `${BACKEND_URL}/api/decnews/:path*` },
      { source: '/blknews/:path*',  destination: `${BACKEND_URL}/api/blknews/:path*` },
      { source: '/bwknews/:path*',  destination: `${BACKEND_URL}/api/bwknews/:path*` },
      { source: '/btcmnews/:path*', destination: `${BACKEND_URL}/api/btcmnews/:path*` },
      { source: '/beinnews/:path*', destination: `${BACKEND_URL}/api/beinnews/:path*` },
      { source: '/btcinews/:path*', destination: `${BACKEND_URL}/api/btcinews/:path*` },
    ];
  },
  webpack(config) {
    config.resolve.fallback = { ...config.resolve.fallback, global: false };
    return config;
  },
};

module.exports = (phase) => {
  if (phase === PHASE_PRODUCTION_BUILD) assertBuildTimeEnv();
  return nextConfig;
};
