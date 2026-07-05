import { WebSocketServer, WebSocket } from 'ws';

const HL_WS_URL       = 'wss://api.hyperliquid.xyz/ws';
const ASTER_WS_URL    = 'wss://fstream.asterdex.com/stream';
const RECONNECT_DELAY = 2000;

function createRelay(wss, upstreamUrl, upstreamHeaders = {}) {
  const clients       = new Set();
  const subscriptions = new Map();
  let upstream        = null;
  let reconnectTimer  = null;

  function connect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    upstream = new WebSocket(upstreamUrl, { headers: upstreamHeaders });

    upstream.on('open', () => {
      console.log(`[WS] Connected to ${upstreamUrl}`);
      // Re-subscribe everything after reconnect
      for (const [subKey, subs] of subscriptions) {
        if (subs.size > 0) {
          upstream.send(JSON.stringify({ method: 'subscribe', subscription: JSON.parse(subKey) }));
        }
      }
    });

    upstream.on('message', (raw) => {
      const msg = raw.toString();
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      }
    });

    upstream.on('error', (err) => console.error(`[WS] Upstream error (${upstreamUrl}):`, err.message));

    upstream.on('close', () => {
      console.warn(`[WS] Upstream closed — reconnecting in ${RECONNECT_DELAY}ms`);
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
    });
  }

  connect();

  wss.on('connection', (ws, req) => {
    clients.add(ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.method === 'subscribe' && msg.subscription) {
          const key = JSON.stringify(msg.subscription);
          if (!subscriptions.has(key)) subscriptions.set(key, new Set());
          subscriptions.get(key).add(ws);
          // Subscribe upstream only on first subscriber
          if (subscriptions.get(key).size === 1 && upstream?.readyState === WebSocket.OPEN) {
            upstream.send(raw.toString());
          }
        }

        if (msg.method === 'unsubscribe' && msg.subscription) {
          const key = JSON.stringify(msg.subscription);
          subscriptions.get(key)?.delete(ws);
          if (subscriptions.get(key)?.size === 0) {
            subscriptions.delete(key);
            if (upstream?.readyState === WebSocket.OPEN) upstream.send(raw.toString());
          }
        }

      } catch {
        // non-JSON — forward as-is
        if (upstream?.readyState === WebSocket.OPEN) upstream.send(raw.toString());
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      for (const subs of subscriptions.values()) subs.delete(ws);
    });

    ws.on('error', () => clients.delete(ws));

    ws.send(JSON.stringify({
      channel: 'relay',
      data: { status: upstream?.readyState === WebSocket.OPEN ? 'connected' : 'connecting' },
    }));
  });
}

export function startWSRelay(httpServer) {
  // Hyperliquid WebSocket relay
  const hlWss = new WebSocketServer({ server: httpServer, path: '/ws' });
  createRelay(hlWss, HL_WS_URL);

  // Aster WebSocket relay
  const asterWss = new WebSocketServer({ server: httpServer, path: '/aster-stream' });
  createRelay(asterWss, ASTER_WS_URL, {
    'Referer': 'https://www.asterdex.com/',
    'Origin': 'https://www.asterdex.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  console.log('[WS] Relay servers started at /ws (Hyperliquid) and /aster-stream (Aster)');
}
