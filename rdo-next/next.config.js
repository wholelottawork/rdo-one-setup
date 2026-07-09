// This app talks to the SAME Fastify backend the root Next.js app uses
// (server/, see ../server/routes/proxy.js + news.js + swap.js) instead of
// hitting upstream APIs directly — that backend is what adds Redis caching,
// per-IP rate limiting, and Aster's signed-endpoint agent auth, all of which
// this app's original direct-to-upstream rewrites had none of (e.g. the bare
// CoinGecko rewrite was getting Cloudflare-403'd with no cache to fall back
// on). In dev this points at :3001; in production set BACKEND_URL.
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

/** @type {import('next').NextConfig} */
const nextConfig = {
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
      { source: '/aster-leverage-brackets', destination: `${BACKEND_URL}/api/aster-leverage-brackets` },
      { source: '/aster-register-agent',    destination: `${BACKEND_URL}/api/aster-register-agent` },
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

module.exports = nextConfig;
