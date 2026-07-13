import Fastify from 'fastify';
import { config } from './config';
import { startWSRelay } from './ws/relay';

import redisPlugin from './plugins/redis';
import corsPlugin from './plugins/cors';
import rateLimitPlugin from './plugins/rate-limit';

import healthRoutes from './routes/health';
import hlRoutes from './routes/hl';
import asterRoutes from './routes/aster';
import marketDataRoutes from './routes/market-data';
import rssRoutes from './routes/rss';
import newsRoutes from './routes/news';
import swapRoutes from './routes/swap';

const app = Fastify({
  logger: {
    level: config.isProd ? 'warn' : 'info',
  },
});

// ── Plugins ──────────────────────────────────────────────────────────────────
await app.register(redisPlugin);
await app.register(corsPlugin);
await app.register(rateLimitPlugin);

// ── Routes ───────────────────────────────────────────────────────────────────
// The former routes/proxy.js is split by domain (hl / aster / market-data /
// rss), all still mounted under /api so every path stays byte-identical.
await app.register(healthRoutes);
await app.register(hlRoutes,         { prefix: '/api' });
await app.register(asterRoutes,      { prefix: '/api' });
await app.register(marketDataRoutes, { prefix: '/api' });
await app.register(rssRoutes,        { prefix: '/api' });
await app.register(newsRoutes,       { prefix: '/api/news' });
await app.register(swapRoutes,       { prefix: '/api/swap' });

// ── Start ────────────────────────────────────────────────────────────────────
try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`RDO ONE backend running on http://0.0.0.0:${config.port}`);
  startWSRelay(app.server);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
