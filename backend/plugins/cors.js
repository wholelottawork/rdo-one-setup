import fp from 'fastify-plugin';
import cors from '@fastify/cors';

export default fp(async (fastify) => {
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Allow same-origin and configured origins
      if (!origin || allowed.length === 0 || allowed.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
    methods: ['GET', 'POST'],
    credentials: false,
  });
});
