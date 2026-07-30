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
    // PUT and DELETE are real here — /aster-signed/* has both (the listenKey
    // keepalive/close lifecycle), and /aster-creds and /aster-session are
    // deleted, not posted. Omitting them only went unnoticed because the
    // browser reaches all of this through Next's same-origin rewrite proxy,
    // where CORS never applies; a direct cross-origin caller would have been
    // preflight-rejected.
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    // The Aster trading session is an HttpOnly cookie. It rides the same-origin
    // rewrite today, so this stays false; flip it (and pin `origin` to an exact
    // allowlist, never `true`) only if the browser is ever pointed straight at
    // this backend.
    credentials: false,
  });
});
