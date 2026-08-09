import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config';

/**
 * The relay used to log through bare `console.*`, which put it in a different
 * shape from every other line the process emits: no level, no timestamp, no
 * request id, and invisible to anything that parses pino JSON. An upstream
 * that flaps all night was therefore unsearchable and unalertable.
 *
 * startWSRelay() installs the app's pino logger here. Until it does — and in
 * the unit test, which imports this module without a Fastify instance —
 * `console` stands in, so importing the module never depends on boot order.
 */
type RelayLogger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

const consoleLogger: RelayLogger = {
  info: (obj: unknown, msg?: string) => console.log('[WS]', msg ?? obj),
  warn: (obj: unknown, msg?: string) => console.warn('[WS]', msg ?? obj),
  error: (obj: unknown, msg?: string) => console.error('[WS]', msg ?? obj),
};

let log: RelayLogger = consoleLogger;

const HL_WS_URL       = 'wss://api.hyperliquid.xyz/ws';
const ASTER_WS_URL    = 'wss://fstream.asterdex.com/stream';
const RECONNECT_DELAY = 2000;
// How long an upstream has to stay unreachable before it stops being a blip
// and becomes a reportable outage. `close` fires on every failed reconnect —
// roughly every RECONNECT_DELAY — so this threshold is what keeps a two-minute
// venue hiccup from turning into 60 Sentry events.
const UPSTREAM_DOWN_ALERT_MS = 60_000;

export interface RelayMessage {
  method?: unknown;
  subscription?: unknown;
  params?: unknown;
}

/**
 * A topic is one upstream subscription: the routing key we index subscribers
 * by, plus the exact frames that turn it on and off upstream. The frames are
 * kept verbatim because the venue — not us — defines their shape, and the
 * re-subscribe loop after a reconnect replays them as-is.
 */
export interface Topic {
  key: string;
  subscribeFrame: string;
  unsubscribeFrame: string;
}

// Aster correlates responses by `id`; the value is opaque to us (we broadcast
// every non-attributable frame anyway), it only has to not collide.
let frameId = 0;

/**
 * Routing key for a Hyperliquid subscription object.
 *
 * Only `type` and `coin` go into the key: they are the only fields an inbound
 * message reproduces (`{ channel, data.coin }`), and a key we cannot re-derive
 * from a message is a key that never routes. Extra fields (`nSigFigs`, …) are
 * therefore *not* part of the key — two clients asking for the same book at
 * different precision share one upstream subscription and both get the frames,
 * which is what the old broadcast did anyway.
 */
function hlTopicKey(sub: Record<string, unknown>): string | null {
  const type = typeof sub.type === 'string' ? sub.type : null;
  if (!type) return null;
  const coin = typeof sub.coin === 'string' ? sub.coin : '';
  return (coin ? `${type}:${coin}` : type).toLowerCase();
}

/**
 * Parse a client frame into the topics it wants on/off, for either venue:
 *
 *   Hyperliquid  { method: 'subscribe',   subscription: { type, coin } }
 *   Aster        { method: 'SUBSCRIBE',   params: ['btcusdt@aggTrade', …] }
 *
 * Returns null for anything that is not a subscribe/unsubscribe — those frames
 * are not forwarded upstream, same as before.
 */
export function parseSubscriptionFrame(
  msg: RelayMessage,
): { action: 'subscribe' | 'unsubscribe'; topics: Topic[] } | null {
  const method = typeof msg?.method === 'string' ? msg.method.toLowerCase() : '';
  if (method !== 'subscribe' && method !== 'unsubscribe') return null;
  const action = method;

  if (msg.subscription && typeof msg.subscription === 'object') {
    const subscription = msg.subscription as Record<string, unknown>;
    const key = hlTopicKey(subscription);
    if (!key) return null;
    return {
      action,
      topics: [{
        key,
        subscribeFrame:   JSON.stringify({ method: 'subscribe',   subscription }),
        unsubscribeFrame: JSON.stringify({ method: 'unsubscribe', subscription }),
      }],
    };
  }

  if (Array.isArray(msg.params)) {
    const topics = msg.params
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .map((stream) => ({
        key: stream.toLowerCase(),
        subscribeFrame:   JSON.stringify({ method: 'SUBSCRIBE',   params: [stream], id: ++frameId }),
        unsubscribeFrame: JSON.stringify({ method: 'UNSUBSCRIBE', params: [stream], id: ++frameId }),
      }));
    return topics.length > 0 ? { action, topics } : null;
  }

  return null;
}

/**
 * Topic key(s) an inbound upstream message belongs to, or null when it cannot
 * be attributed — control frames, pongs, subscription acks, error envelopes and
 * anything a venue adds later. Callers must broadcast on null (and on keys they
 * do not know), because dropping an unattributable frame silently kills the
 * feed.
 */
export function deriveTopicKeys(msg: unknown): string[] | null {
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as { stream?: unknown; channel?: unknown; data?: unknown };

  // Aster combined stream: { stream: 'btcusdt@aggTrade', data: {...} }
  if (typeof m.stream === 'string' && m.stream.length > 0) return [m.stream.toLowerCase()];

  // Hyperliquid: { channel: 'l2Book' | 'trades' | 'allMids' | …, data }
  if (typeof m.channel !== 'string' || m.channel.length === 0) return null;
  const channel = m.channel.toLowerCase();
  const data    = m.data;

  if (Array.isArray(data)) {
    // trades: one frame can carry several fills, in practice all one coin.
    const coins = new Set<string>();
    for (const entry of data) {
      const coin = (entry as { coin?: unknown } | null)?.coin;
      if (typeof coin !== 'string') return null;
      coins.add(coin.toLowerCase());
    }
    return coins.size > 0 ? [...coins].map((coin) => `${channel}:${coin}`) : null;
  }

  const coin = data && typeof data === 'object' ? (data as { coin?: unknown }).coin : undefined;
  if (typeof coin === 'string') return [`${channel}:${coin.toLowerCase()}`];

  // allMids and friends: the channel alone is the topic. Unknown channels land
  // here too and fall through to a broadcast, since no client holds that key.
  return [channel];
}

/**
 * Who is subscribed to what, and the upstream side effects of that changing.
 * Generic over the client type so it can be exercised without real sockets.
 *
 * The invariant: a key exists in the map iff at least one client holds it. The
 * bug this fixes (P0-5) was the close path deleting the client from each Set
 * but leaving the empty key — and never telling upstream — so every market any
 * user ever opened stayed subscribed for the life of the process.
 */
export function createSubscriptionRegistry<C>(opts: {
  sendUpstream: (frame: string) => void;
  maxPerClient: number;
  onLimit?: (client: C, key: string) => void;
}) {
  const byTopic  = new Map<string, { topic: Topic; subscribers: Set<C> }>();
  const byClient = new Map<C, Set<string>>();

  function keysOf(client: C): Set<string> {
    let keys = byClient.get(client);
    if (!keys) { keys = new Set(); byClient.set(client, keys); }
    return keys;
  }

  function add(client: C, topic: Topic): void {
    const keys = keysOf(client);
    if (!keys.has(topic.key) && keys.size >= opts.maxPerClient) {
      opts.onLimit?.(client, topic.key);
      return;
    }
    keys.add(topic.key);

    const existing = byTopic.get(topic.key);
    if (existing) {
      existing.subscribers.add(client);
      return;
    }
    byTopic.set(topic.key, { topic, subscribers: new Set([client]) });
    opts.sendUpstream(topic.subscribeFrame);
  }

  function remove(client: C, key: string): void {
    byClient.get(client)?.delete(key);
    const entry = byTopic.get(key);
    if (!entry) return;
    entry.subscribers.delete(client);
    if (entry.subscribers.size > 0) return;
    byTopic.delete(key);
    opts.sendUpstream(entry.topic.unsubscribeFrame);
  }

  /** Close path: drop every topic this client held, unsubscribing the ones it was last on. */
  function removeClient(client: C): void {
    const keys = byClient.get(client);
    if (keys) for (const key of [...keys]) remove(client, key);
    byClient.delete(client);
  }

  /**
   * Subscribers for an inbound message's keys, or null meaning "broadcast".
   * Every key must be known — a partially-known multi-coin frame is safer
   * broadcast than half-delivered.
   */
  function targetsFor(keys: string[] | null): Set<C> | null {
    if (!keys || keys.length === 0) return null;
    const targets = new Set<C>();
    for (const key of keys) {
      const entry = byTopic.get(key);
      if (!entry) return null;
      for (const client of entry.subscribers) targets.add(client);
    }
    return targets;
  }

  /** Frames to replay after an upstream reconnect. */
  function resubscribeFrames(): string[] {
    return [...byTopic.values()].map((entry) => entry.topic.subscribeFrame);
  }

  return {
    add,
    remove,
    removeClient,
    targetsFor,
    resubscribeFrames,
    get topicCount() { return byTopic.size; },
    countFor(client: C) { return byClient.get(client)?.size ?? 0; },
  };
}

/**
 * Client IP for the per-IP connection cap. Behind nginx every connection's
 * `remoteAddress` is the proxy, which would make the cap a single global
 * counter — so prefer the first `X-Forwarded-For` hop (the original client).
 * This only becomes accurate once nginx actually sets the header (task 10).
 */
export function clientIp(req: IncomingMessage): string {
  const header = req.headers['x-forwarded-for'];
  const raw    = Array.isArray(header) ? header[0] : header;
  const first  = raw?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

interface Relay {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
}

function createRelay(
  upstreamUrl: string,
  upstreamHeaders: Record<string, string> = {},
  pingEveryMs = 0,
): Relay {
  const wss             = new WebSocketServer({ noServer: true });
  const clients         = new Set<WebSocket>();
  const ipOf            = new Map<WebSocket, string>();
  const connectionsByIp = new Map<string, number>();
  let upstream: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  // Outage tracking for the alert below: when the upstream first went away,
  // and whether this outage has already been reported (once, not per retry).
  let downSince: number | null = null;
  let reportedDown = false;

  function sendUpstream(frame: string): void {
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(frame);
  }

  const registry = createSubscriptionRegistry<WebSocket>({
    sendUpstream,
    maxPerClient: config.ws.maxSubscriptionsPerConnection,
    onLimit: (ws, key) => {
      log.warn(
        {
          upstream: upstreamUrl,
          ip: ipOf.get(ws) ?? 'unknown',
          cap: config.ws.maxSubscriptionsPerConnection,
          topic: key,
        },
        'ws subscription cap hit — dropping topic',
      );
    },
  });

  function broadcast(msg: string): void {
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }

  function connect(): void {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    upstream = new WebSocket(upstreamUrl, { headers: upstreamHeaders });

    upstream.on('open', () => {
      if (reportedDown) {
        log.warn({ upstream: upstreamUrl, downForMs: Date.now() - (downSince ?? Date.now()) },
          'ws upstream recovered');
      }
      downSince = null;
      reportedDown = false;
      log.info({ upstream: upstreamUrl }, 'ws upstream connected');
      // Re-subscribe everything after reconnect
      for (const frame of registry.resubscribeFrames()) upstream?.send(frame);
      // Hyperliquid closes any connection it hasn't SENT to within 60s —
      // quiet channels (a lone l2Book on an illiquid coin) would otherwise
      // get killed mid-session and flap every reconnect cycle. The python
      // SDK pings every ~50s; do the same. Aster doesn't need this (its
      // server pings us and ws auto-pongs), so it's opt-in per relay.
      if (pingEveryMs > 0) {
        pingTimer = setInterval(() => {
          if (upstream?.readyState === WebSocket.OPEN) {
            upstream.send(JSON.stringify({ method: 'ping' }));
          }
        }, pingEveryMs);
      }
    });

    upstream.on('message', (raw: RawData) => {
      const msg = raw.toString();

      let targets: Set<WebSocket> | null = null;
      try {
        targets = registry.targetsFor(deriveTopicKeys(JSON.parse(msg)));
      } catch {
        targets = null; // unparseable — treat as unattributable
      }

      // null = could not attribute it to a topic anyone holds: control frames,
      // pongs, acks, errors. Those must still reach everyone.
      for (const client of targets ?? clients) {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      }
    });

    // `error` rather than `warn`: a venue socket dropping is routine and
    // reconnects on its own, but the message is the only clue to WHY (DNS,
    // TLS, 429) when it stops coming back.
    upstream.on('error', (err: Error) =>
      log.error({ upstream: upstreamUrl, err: err.message }, 'ws upstream error'));

    upstream.on('close', () => {
      log.warn({ upstream: upstreamUrl, reconnectInMs: RECONNECT_DELAY }, 'ws upstream closed — reconnecting');
      // Routine flapping is noise; an upstream that has been unreachable for
      // minutes is a dead price feed, which the UI shows as a chart that
      // simply stopped ticking with no error anywhere. That gets ONE `error`
      // line per outage — not one per retry, which at a 2s reconnect would be
      // 30 lines a minute and unreadable — so `level=error upstream=...` in
      // the log is a real signal rather than something you learn to skip.
      if (!downSince) downSince = Date.now();
      if (!reportedDown && Date.now() - downSince >= UPSTREAM_DOWN_ALERT_MS) {
        reportedDown = true;
        log.error(
          { upstream: upstreamUrl, downForMs: Date.now() - downSince },
          'ws upstream down past alert threshold — price feed is stale',
        );
      }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
    });
  }

  connect();

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ip = clientIp(req);
    clients.add(ws);
    ipOf.set(ws, ip);
    connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);

    let closed = false;
    function cleanup(): void {
      if (closed) return;
      closed = true;
      clients.delete(ws);
      // Unsubscribe upstream from anything this client was the last holder of.
      registry.removeClient(ws);
      ipOf.delete(ws);
      const remaining = (connectionsByIp.get(ip) ?? 1) - 1;
      if (remaining > 0) connectionsByIp.set(ip, remaining);
      else connectionsByIp.delete(ip);
    }

    ws.on('message', (raw: RawData) => {
      try {
        const msg   = JSON.parse(raw.toString()) as RelayMessage;
        const frame = parseSubscriptionFrame(msg);
        if (!frame) return;

        for (const topic of frame.topics) {
          if (frame.action === 'subscribe') registry.add(ws, topic);
          else registry.remove(ws, topic.key);
        }
      } catch {
        // non-JSON — forward as-is. Deliberate escape hatch; it cannot create a
        // subscription (both venues only accept JSON control frames), so it
        // cannot be used to get around the per-connection cap.
        sendUpstream(raw.toString());
      }
    });

    ws.on('close', cleanup);
    ws.on('error', cleanup);

    ws.send(JSON.stringify({
      channel: 'relay',
      data: { status: upstream?.readyState === WebSocket.OPEN ? 'connected' : 'connecting' },
    }));
  });

  return {
    handleUpgrade(req, socket, head) {
      const ip   = clientIp(req);
      const open = connectionsByIp.get(ip) ?? 0;
      if (open >= config.ws.maxConnectionsPerIp) {
        log.warn(
          { path: req.url?.split('?')[0], ip, open, cap: config.ws.maxConnectionsPerIp },
          'ws connection rejected — per-IP cap reached',
        );
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
  };
}

export function startWSRelay(httpServer: Server, logger?: RelayLogger): void {
  if (logger) log = logger;

  // noServer + manual dispatch: with two WebSocketServers sharing one HTTP
  // server via { server, path }, each one's upgrade handler calls
  // abortHandshake(400) on requests meant for the other, so every client got
  // a 400 + socket destroy right after the successful handshake.
  const hl = createRelay(HL_WS_URL, {}, 50_000);

  const aster = createRelay(ASTER_WS_URL, {
    'Referer': 'https://www.asterdex.com/',
    'Origin': 'https://www.asterdex.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  httpServer.on('upgrade', (req, socket, head) => {
    const path = req.url?.split('?')[0];
    if (path === '/ws') {
      hl.handleUpgrade(req, socket, head);
    } else if (path === '/aster-stream') {
      aster.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  // `warn`, like the backend's own listening line: a boot banner that is
  // invisible at production's log level is a boot banner that cannot answer
  // "did the relay actually come up?" after a bad deploy.
  log.warn({ endpoints: ['/ws', '/aster-stream'] },
    'ws relay servers started at /ws (Hyperliquid) and /aster-stream (Aster)');
}
