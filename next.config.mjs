// All /api/* traffic is served by the Fastify backend (server/), which is the
// single proxy+cache layer (see BACKEND_SPEC.md). In dev we rewrite to it on
// :3001; in production put nginx/Caddy in front routing /api and /ws to the
// backend and everything else here — or keep this rewrite and set BACKEND_URL.
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Some proxied paths (e.g. news source feeds) carry a trailing slash the
  // upstream actually wants — without this, Next's own trailing-slash
  // normalization 308s those requests before the rewrite even runs.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` },
    ];
  },
};

export default nextConfig;
