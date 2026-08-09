// Run: npm test   (tsx strips the types, no test framework)
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import {
  parseSubscriptionFrame,
  deriveTopicKeys,
  createSubscriptionRegistry,
  clientIp,
  type Topic,
  type RelayMessage,
} from './relay.ts';

// ── Client frames → topics ───────────────────────────────────────────────────

const hl = parseSubscriptionFrame({ method: 'subscribe', subscription: { type: 'l2Book', coin: 'BTC' } });
assert.ok(hl, 'a Hyperliquid subscribe must parse');
assert.equal(hl.action, 'subscribe');
assert.equal(hl.topics.length, 1);
assert.equal(hl.topics[0].key, 'l2book:btc');
// The upstream frame must stay the exact object the client sent — the venue
// defines its shape, and the reconnect loop replays it verbatim.
assert.deepEqual(
  JSON.parse(hl.topics[0].subscribeFrame),
  { method: 'subscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
);
assert.deepEqual(
  JSON.parse(hl.topics[0].unsubscribeFrame),
  { method: 'unsubscribe', subscription: { type: 'l2Book', coin: 'BTC' } },
);

// A coinless channel keys on the type alone.
assert.equal(parseSubscriptionFrame({ method: 'subscribe', subscription: { type: 'allMids' } })!.topics[0].key, 'allmids');

// Aster: uppercase method, several streams in one frame.
const aster = parseSubscriptionFrame({ method: 'SUBSCRIBE', params: ['btcusdt@aggTrade', 'ETHUSDT@depth'], id: 1 } as RelayMessage);
assert.ok(aster, 'an Aster SUBSCRIBE must parse');
assert.deepEqual(aster.topics.map((t) => t.key), ['btcusdt@aggtrade', 'ethusdt@depth']);
assert.deepEqual(JSON.parse(aster.topics[0].subscribeFrame).params, ['btcusdt@aggTrade']);
assert.equal(JSON.parse(aster.topics[1].unsubscribeFrame).method, 'UNSUBSCRIBE');

// Anything that is not a subscribe/unsubscribe is not forwarded upstream.
assert.equal(parseSubscriptionFrame({ method: 'ping' }), null);
assert.equal(parseSubscriptionFrame({ method: 'subscribe' }), null, 'no subscription and no params');
assert.equal(parseSubscriptionFrame({ method: 'subscribe', subscription: { coin: 'BTC' } }), null, 'no type = no key');
assert.equal(parseSubscriptionFrame({ method: 'SUBSCRIBE', params: [] }), null, 'empty params');

// ── Upstream messages → topic keys ───────────────────────────────────────────

assert.deepEqual(deriveTopicKeys({ channel: 'l2Book', data: { coin: 'BTC', levels: [] } }), ['l2book:btc']);
assert.deepEqual(deriveTopicKeys({ channel: 'trades', data: [{ coin: 'BTC' }, { coin: 'BTC' }] }), ['trades:btc']);
assert.deepEqual(deriveTopicKeys({ channel: 'allMids', data: { mids: { BTC: '1' } } }), ['allmids']);
assert.deepEqual(deriveTopicKeys({ stream: 'BTCUSDT@aggTrade', data: {} }), ['btcusdt@aggtrade']);

// Unattributable frames — these MUST end up broadcast, never dropped.
assert.equal(deriveTopicKeys('not an object'), null);
assert.equal(deriveTopicKeys(null), null);
assert.equal(deriveTopicKeys({ result: null, id: 1 }), null, 'Aster ack has no stream');
assert.deepEqual(deriveTopicKeys({ channel: 'pong' }), ['pong'], 'unknown channel keys to itself; nobody holds it');

// ── Registry: the P0-5 leak ──────────────────────────────────────────────────

function topic(key: string): Topic {
  return { key, subscribeFrame: `sub:${key}`, unsubscribeFrame: `unsub:${key}` };
}

let sent: string[] = [];
const registry = createSubscriptionRegistry<string>({
  sendUpstream: (frame) => sent.push(frame),
  maxPerClient: 3,
});

const btc = topic('l2book:btc');
const eth = topic('l2book:eth');

// Upstream subscribe only on the first subscriber of a topic.
registry.add('a', btc);
registry.add('b', btc);
assert.deepEqual(sent, ['sub:l2book:btc'], 'the second subscriber must not re-subscribe upstream');

// One of two leaving keeps the topic alive.
registry.remove('a', btc.key);
assert.deepEqual(sent, ['sub:l2book:btc'], 'a topic with subscribers left must stay subscribed');
assert.equal(registry.topicCount, 1);

// The last one leaving unsubscribes upstream AND drops the key. This is the
// regression: the old close path deleted the client from the Set and left an
// empty key behind, subscribed upstream forever.
registry.remove('b', btc.key);
assert.deepEqual(sent, ['sub:l2book:btc', 'unsub:l2book:btc']);
assert.equal(registry.topicCount, 0, 'an empty topic must not linger in the map');

// A hard disconnect must do the same for every topic the client held.
sent = [];
registry.add('a', btc);
registry.add('a', eth);
registry.add('b', eth);
registry.removeClient('a');
assert.deepEqual(sent, ['sub:l2book:btc', 'sub:l2book:eth', 'unsub:l2book:btc']);
assert.equal(registry.topicCount, 1, 'eth still has b');
assert.equal(registry.countFor('a'), 0, 'a disconnected client holds nothing');

registry.removeClient('b');
assert.equal(registry.topicCount, 0, 'the map must return to zero once everyone is gone');
assert.deepEqual(sent.at(-1), 'unsub:l2book:eth');

// Re-subscribe after an upstream reconnect replays exactly the live topics.
sent = [];
registry.add('a', btc);
registry.add('b', eth);
assert.deepEqual(registry.resubscribeFrames(), ['sub:l2book:btc', 'sub:l2book:eth']);

// ── Registry: routing ────────────────────────────────────────────────────────

assert.deepEqual([...registry.targetsFor(['l2book:btc'])!], ['a'], 'only BTC watchers get BTC');
assert.deepEqual([...registry.targetsFor(['l2book:eth'])!], ['b']);
assert.equal(registry.targetsFor(null), null, 'null keys = broadcast');
assert.equal(registry.targetsFor(['allmids']), null, 'a topic nobody holds = broadcast');
assert.equal(registry.targetsFor(['l2book:btc', 'allmids']), null, 'partially unknown = broadcast, never half-delivered');
assert.equal(registry.targetsFor([]), null);

registry.add('b', btc);
assert.deepEqual([...registry.targetsFor(['l2book:btc'])!].sort(), ['a', 'b']);

// ── Registry: the per-connection cap ─────────────────────────────────────────

sent = [];
const limited: string[] = [];
const capped = createSubscriptionRegistry<string>({
  sendUpstream: (frame) => sent.push(frame),
  maxPerClient: 2,
  onLimit: (_client, key) => limited.push(key),
});

capped.add('a', topic('t1'));
capped.add('a', topic('t2'));
capped.add('a', topic('t1'));           // already held — not a new topic, must not count
assert.equal(capped.countFor('a'), 2);
assert.deepEqual(limited, []);

capped.add('a', topic('t3'));           // over the cap
assert.equal(capped.countFor('a'), 2, 'the cap must hold');
assert.deepEqual(limited, ['t3']);
assert.deepEqual(sent, ['sub:t1', 'sub:t2'], 'a rejected subscription must not reach upstream');

// The cap is per connection, not global.
capped.add('b', topic('t3'));
assert.equal(capped.countFor('b'), 1);
assert.deepEqual(sent.at(-1), 'sub:t3');

// Dropping a topic frees a slot again.
capped.remove('a', 't1');
capped.add('a', topic('t4'));
assert.equal(capped.countFor('a'), 2);

// ── Client IP ────────────────────────────────────────────────────────────────

function req(headers: Record<string, string | string[]>, remoteAddress?: string): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

// Behind nginx every connection's remoteAddress is the proxy, so a cap keyed on
// it would be one global counter. The first X-Forwarded-For hop is the client.
assert.equal(clientIp(req({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, '10.0.0.1')), '203.0.113.9');
assert.equal(clientIp(req({ 'x-forwarded-for': ' 203.0.113.9 ' }, '10.0.0.1')), '203.0.113.9');
assert.equal(clientIp(req({ 'x-forwarded-for': ['203.0.113.9', '198.51.100.4'] })), '203.0.113.9');
assert.equal(clientIp(req({}, '198.51.100.7')), '198.51.100.7', 'no proxy = the socket peer');
assert.equal(clientIp(req({ 'x-forwarded-for': '' }, '198.51.100.7')), '198.51.100.7', 'an empty header is not an IP');
assert.equal(clientIp(req({})), 'unknown');

console.log('relay.test.ts — all assertions passed');
