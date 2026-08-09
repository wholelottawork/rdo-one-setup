import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { scrubDeep } from './scrub';

/**
 * The money paths log at `info` even in production, where the root logger sits
 * at `warn` (src/index.ts).
 *
 * That level is right for volume — a trading UI polls hard, and `info` on
 * every request would bury everything under market-data noise inside a day.
 * But it also means the events that matter most are the ones that vanish:
 * nothing records that a withdrawal was accepted, that an order was placed,
 * or that a stop-loss went on. "Did the 3am withdrawal go through?" is not a
 * question to answer from Aster's UI and a guess.
 *
 * pino lets a child logger be MORE verbose than its parent, so this is a child
 * pinned to `info` rather than a global level change: money events always
 * ship, request noise stays at `warn`.
 *
 * Every payload is scrubbed on the way out (lib/scrub.ts). Callers are
 * expected to pass amounts and outcomes, never signatures — the scrub is the
 * backstop for when someone eventually passes the whole request object.
 */

const children = new WeakMap<FastifyBaseLogger, FastifyBaseLogger>();

function moneyLogger(fastify: FastifyInstance): FastifyBaseLogger {
  const existing = children.get(fastify.log);
  if (existing) return existing;
  // `audit: 'money'` is the field to grep/alert on: it selects exactly the
  // fund-moving events out of everything else in the same stream.
  const child = fastify.log.child({ audit: 'money' }, { level: 'info' });
  children.set(fastify.log, child);
  return child;
}

/** Fund-moving events. Kept as a closed union so the set is greppable and a
 *  typo becomes a type error rather than an event nobody alerts on. */
export type MoneyEvent =
  | 'withdraw.forwarded'    // verified and sent to Aster
  | 'withdraw.rejected'     // failed our own verification, never left the box
  | 'withdraw.result'       // what Aster said
  | 'order.placed'          // signed order passthrough accepted by Aster
  | 'order.rejected'        // Aster returned an error code
  | 'tpsl.armed'            // watch registered for a resting limit order
  | 'tpsl.placed'           // triggers actually placed after a fill
  | 'tpsl.expired'          // watch aged out unfilled, protections never needed
  | 'tpsl.failed';          // placement threw — user protection may be missing

export function moneyLog(
  fastify: FastifyInstance,
  event: MoneyEvent,
  fields: Record<string, unknown>,
): void {
  moneyLogger(fastify).info({ event, ...scrubDeep(fields) }, event);
}

/** Same stream, `warn` level — for money events that are a problem rather than
 *  a record. Kept here so both land under `audit: 'money'`. */
export function moneyWarn(
  fastify: FastifyInstance,
  event: MoneyEvent,
  fields: Record<string, unknown>,
): void {
  moneyLogger(fastify).warn({ event, ...scrubDeep(fields) }, event);
}
