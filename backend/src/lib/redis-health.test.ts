// Run: npm test   (tsx strips the types, no test framework)
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { trackRedisHealth } from './redis-health.ts';

const lines: string[] = [];
const log = { info: (m: string) => lines.push(`info ${m}`), warn: (m: string) => lines.push(`warn ${m}`) };

const client = new EventEmitter();
const health = trackRedisHealth(client, log);

// Boot with Redis down: nothing has said `ready`, so nothing is usable yet.
assert.equal(health.ok, false, 'starts unusable until Redis says ready');

// The regression this whole change exists for: Redis coming up AFTER boot must
// flip the flag with no restart. The old code captured a boolean here and every
// Redis-backed route stayed 503 forever.
client.emit('ready');
assert.equal(health.ok, true, 'ready after a failed boot connect must flip it live');

// And the inverse — a Redis that dies under a running process must flip it
// back, or guards meant to fail closed pass and the call underneath 500s.
client.emit('close');
assert.equal(health.ok, false, 'close must flip it back');

client.emit('ready');
assert.equal(health.ok, true, 'reconnect is usable again');
client.emit('end');
assert.equal(health.ok, false, 'end must flip it back');

// Reads are live, not snapshots: a value read before a transition must not be
// what a later read returns.
const before = health.ok;
client.emit('ready');
assert.equal(before, false, 'a copied read is a snapshot');
assert.equal(health.ok, true, 'the property itself is live');

// Only transitions log. ioredis emits `close` on every reconnect attempt, so
// logging every event would be an endless stream while Redis is down.
const noise = lines.length;
client.emit('ready');
client.emit('ready');
assert.equal(lines.length, noise, 'repeated same-state events must not log');
client.emit('close');
client.emit('close');
client.emit('end');
assert.equal(lines.length, noise + 1, 'a run of down events is one transition');

assert.deepEqual(
  lines.map((l) => l.split(' ')[0]),
  ['info', 'warn', 'info', 'warn', 'info', 'warn'],
  'transitions alternate up/down and are logged at the right level',
);

console.log('redis-health: all checks passed');
