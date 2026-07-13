import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { config } from '../config';

export default fp(async (fastify) => {
  const allowed = config.allowedOrigins;

  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Allow same-origin and configured origins (empty list ⇒ allow all)
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
