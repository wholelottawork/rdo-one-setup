import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config';
import { isSecretBodyPath, scrubDeep, scrubUrl } from '../lib/scrub';

/**
 * Opt-in request-BODY logging for debugging, default OFF.
 *
 * Fastify logs request metadata and never bodies, and that default is the
 * right one — this plugin exists so that the next person who needs to see a
 * body has a switch to flip instead of adding `log.info(req.body)` to a route
 * and shipping it. `LOG_REQUEST_BODIES=true` is a deliberate, temporary act
 * on a box you are already watching.
 *
 * Even with it on, the money routes' bodies are dropped rather than logged.
 * That is not belt-and-braces caution: /aster-withdraw's body is two EIP-712
 * signatures which TOGETHER ARE A WITHDRAWAL, replayable by anyone who reads
 * them until the nonce ages out (~2 minutes), and /aster-session's body is the
 * signature that mints a session cookie. There is no debugging value in those
 * bytes that is worth putting them in a file that survives rotation.
 *
 * Everything that does get logged still goes through lib/scrub.ts, so a
 * secret-shaped value on a route nobody thought to list is caught by shape.
 */
export default fp(async function requestLogPlugin(fastify: FastifyInstance) {
  if (!config.logRequestBodies) return;

  // At `warn` so it is impossible to leave on by accident in production
  // without the boot log saying so.
  fastify.log.warn(
    'LOG_REQUEST_BODIES=true — request bodies are being logged. ' +
    'Money-route bodies are still dropped. Turn this off when you are done.',
  );

  // A child pinned to `info`, not `req.log.info`. Production runs the root
  // logger at `warn`, so logging through the request logger would make this
  // flag do NOTHING in the only environment anyone would reach for it —
  // switched on, boot warning printed, and not a single body in the output.
  // Same mechanism as lib/money-log.ts, and for the same reason.
  const bodyLog = fastify.log.child({ debug: 'requestBody' }, { level: 'info' });

  fastify.addHook('preHandler', async (req: FastifyRequest) => {
    if (req.body === undefined || req.body === null) return;
    // `reqId` rather than the request logger's own bindings, so a body line can
    // still be tied back to the request it came from.
    if (isSecretBodyPath(req.url)) {
      bodyLog.info({ reqId: req.id, url: scrubUrl(req.url) }, 'request body withheld (money route)');
      return;
    }
    bodyLog.info({ reqId: req.id, url: scrubUrl(req.url), body: scrubDeep(req.body) }, 'request body');
  });
});
