import 'dotenv/config';
import Fastify from 'fastify';
import { startWSRelay } from './ws/relay.js';

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
  },
});

// ── Plugins ────────────────────────────────────────────────────────────────────
await app.register(import('./plugins/redis.js'));
await app.register(import('./plugins/cors.js'));
await app.register(import('./plugins/rate-limit.js'));

// ── Routes ─────────────────────────────────────────────────────────────────────
await app.register(import('./routes/health.js'));
await app.register(import('./routes/proxy.js'),  { prefix: '/api' });
await app.register(import('./routes/news.js'),   { prefix: '/api/news' });
await app.register(import('./routes/swap.js'),   { prefix: '/api/swap' });

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3001');

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`RDO ONE backend running on http://0.0.0.0:${PORT}`);
  startWSRelay(app.server);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
