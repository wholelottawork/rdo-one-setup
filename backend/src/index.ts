import Fastify from 'fastify';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config';
import { startWSRelay } from './ws/relay';
import { scrubUrl } from './lib/scrub';

import redisPlugin from './plugins/redis';
import corsPlugin from './plugins/cors';
import rateLimitPlugin from './plugins/rate-limit';
import requestLogPlugin from './plugins/request-log';

import healthRoutes from './routes/health';
import hlRoutes from './routes/hl';
import asterRoutes from './routes/aster';
import marketDataRoutes from './routes/market-data';
import rssRoutes from './routes/rss';
import newsRoutes from './routes/news';
import rpcRoutes from './routes/rpc';

const app = Fastify({
  // Behind nginx every request arrives from the proxy, so without this `req.ip`
  // is the proxy for everyone and plugins/rate-limit.ts keys its whole limit on
  // one value — a single global bucket that one person loading a page can trip
  // for every user, while providing no per-client abuse protection at all.
  // Requires nginx to set X-Forwarded-For; with a proxy that doesn't, this
  // would instead let a client spoof its own key, so the two go together.
  trustProxy: true,
  logger: {
    // `warn` in production is a volume decision, not a coverage one: a trading
    // UI polls hard enough that `info` per request buries everything else
    // within a day. The money paths opt back up to `info` through their own
    // child logger (lib/money-log.ts), so withdrawals, orders and TP/SL
    // placements are never the thing this level silences.
    level: config.logLevel || (config.isProd ? 'warn' : 'info'),
    // Fastify never logs request BODIES, and nothing here should add that —
    // the body of /aster-withdraw is two signatures that together are a live,
    // replayable withdrawal. What Fastify DOES log by default is the URL, and
    // on /aster-signed/* the URL carries the whole signed query string, so it
    // gets scrubbed rather than trusted.
    serializers: {
      req(req: FastifyRequest) {
        return {
          method: req.method,
          url: scrubUrl(req.url),
          hostname: req.hostname,
          remoteAddress: req.ip,
        };
      },
    },
    // Belt and braces for anything that reaches the logger as a structured
    // object rather than through the serializer above — an `{ err, req }`
    // pair, a hand-rolled log line, a future plugin.
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-mbx-apikey"]',
        'res.headers["set-cookie"]',
        'signature',
        'userSignature',
        'apiKey',
        'apiSecret',
        'privateKey',
        'agentKey',
        '*.signature',
        '*.userSignature',
        '*.apiKey',
        '*.apiSecret',
        '*.privateKey',
        '*.agentKey',
      ],
      censor: '[redacted]',
    },
  },
});

// ── Error reporting ──────────────────────────────────────────────────────────
// Fastify logs a thrown handler error at `error` already, but as a bare `err`
// with no route on it — which in a 10MB rotated log is a stack trace you cannot
// attribute to an endpoint. This adds the route, and draws the line between a
// 4xx (the client being told no: a bad signature, a stale nonce, a missing
// field — routine, and at `warn` so production's `warn` level still keeps it)
// and a 5xx, which is ours and gets `error`.
app.addHook('onError', async (req: FastifyRequest, _reply: FastifyReply, err: FastifyError) => {
  const line = {
    err,
    method: req.method,
    // Never the raw URL: on /aster-signed/* it carries the whole signed query
    // string, so an error line would log a live credential.
    url: scrubUrl(req.url),
    route: req.routeOptions?.url,
    statusCode: err.statusCode,
  };
  if (err.statusCode && err.statusCode < 500) app.log.warn(line, 'request rejected');
  else app.log.error(line, 'request failed');
});

// ── Plugins ──────────────────────────────────────────────────────────────────
await app.register(redisPlugin);
await app.register(corsPlugin);
await app.register(rateLimitPlugin);
// No-op unless LOG_REQUEST_BODIES=true. Registered after the others so its
// preHandler runs on requests that already passed CORS and the rate limit.
await app.register(requestLogPlugin);

// ── Routes ───────────────────────────────────────────────────────────────────
// The former routes/proxy.js is split by domain (hl / aster / market-data /
// rss), all still mounted under /api so every path stays byte-identical.
await app.register(healthRoutes);
await app.register(hlRoutes,         { prefix: '/api' });
await app.register(asterRoutes,      { prefix: '/api' });
await app.register(marketDataRoutes, { prefix: '/api' });
await app.register(rssRoutes,        { prefix: '/api' });
await app.register(newsRoutes,       { prefix: '/api/news' });
await app.register(rpcRoutes,        { prefix: '/api/rpc' });

// ── Shutdown ─────────────────────────────────────────────────────────────────
// Without this, SIGTERM kills the process outright and the registered onClose
// hooks never run: Redis is never quit, and the TP/SL watcher's interval can be
// killed mid-pass while holding the 30s Redis lock, so no instance places
// protections until the lock TTL expires.
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    // A second Ctrl-C during a slow close must not re-enter and interleave.
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received — shutting down`);
    app.close().then(
      () => process.exit(0),
      (err) => {
        app.log.error({ err }, 'error during shutdown');
        process.exit(1);
      },
    );
  });
}

// ── Last-resort error reporting ──────────────────────────────────────────────
// The onError hook above only sees errors raised inside a request. The TP/SL
// watcher's interval, the WS relay's socket callbacks and every other timer run
// outside one — an unhandled rejection there is invisible today and takes the
// process down under Node's default `--unhandled-rejections=throw`.
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'unhandled rejection');
});

process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'uncaught exception — exiting');
  // Exit rather than soldier on: the process state after an uncaught throw is
  // undefined, and `restart: unless-stopped` brings back a clean one. The log
  // line above is already written synchronously by pino, so it survives.
  process.exit(1);
});

// ── Start ────────────────────────────────────────────────────────────────────
try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  // Through the app logger, not console.log, and at `warn` so it survives
  // production's level: the first line in the container log should identify
  // the running build, and `docker compose logs backend | head` is where you
  // look when something is wrong right after a deploy.
  app.log.warn(
    { port: config.port, environment: config.nodeEnv, release: config.release || null },
    'RDO ONE backend listening',
  );
  startWSRelay(app.server, app.log);
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
