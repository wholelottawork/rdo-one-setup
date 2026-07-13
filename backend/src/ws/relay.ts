import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Server } from 'node:http';

const HL_WS_URL       = 'wss://api.hyperliquid.xyz/ws';
const ASTER_WS_URL    = 'wss://fstream.asterdex.com/stream';
const RECONNECT_DELAY = 2000;

interface RelayMessage {
  method?: string;
  subscription?: unknown;
}

function createRelay(
  wss: WebSocketServer,
  upstreamUrl: string,
  upstreamHeaders: Record<string, string> = {},
  pingEveryMs = 0,
): void {
  const clients       = new Set<WebSocket>();
  const subscriptions = new Map<string, Set<WebSocket>>();
  let upstream: WebSocket | null       = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  function connect(): void {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    upstream = new WebSocket(upstreamUrl, { headers: upstreamHeaders });

    upstream.on('open', () => {
      console.log(`[WS] Connected to ${upstreamUrl}`);
      // Re-subscribe everything after reconnect
      for (const [subKey, subs] of subscriptions) {
        if (subs.size > 0) {
          upstream?.send(JSON.stringify({ method: 'subscribe', subscription: JSON.parse(subKey) }));
        }
      }
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
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      }
    });

    upstream.on('error', (err: Error) => console.error(`[WS] Upstream error (${upstreamUrl}):`, err.message));

    upstream.on('close', () => {
      console.warn(`[WS] Upstream closed — reconnecting in ${RECONNECT_DELAY}ms`);
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
    });
  }

  connect();

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);

    ws.on('message', (raw: RawData) => {
      try {
        const msg = JSON.parse(raw.toString()) as RelayMessage;

        if (msg.method === 'subscribe' && msg.subscription) {
          const key = JSON.stringify(msg.subscription);
          if (!subscriptions.has(key)) subscriptions.set(key, new Set());
          subscriptions.get(key)!.add(ws);
          // Subscribe upstream only on first subscriber
          if (subscriptions.get(key)!.size === 1 && upstream?.readyState === WebSocket.OPEN) {
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

export function startWSRelay(httpServer: Server): void {
  // noServer + manual dispatch: with two WebSocketServers sharing one HTTP
  // server via { server, path }, each one's upgrade handler calls
  // abortHandshake(400) on requests meant for the other, so every client got
  // a 400 + socket destroy right after the successful handshake.
  const hlWss = new WebSocketServer({ noServer: true });
  createRelay(hlWss, HL_WS_URL, {}, 50_000);

  const asterWss = new WebSocketServer({ noServer: true });
  createRelay(asterWss, ASTER_WS_URL, {
    'Referer': 'https://www.asterdex.com/',
    'Origin': 'https://www.asterdex.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  httpServer.on('upgrade', (req, socket, head) => {
    const path = req.url?.split('?')[0];
    if (path === '/ws') {
      hlWss.handleUpgrade(req, socket, head, (ws) => hlWss.emit('connection', ws, req));
    } else if (path === '/aster-stream') {
      asterWss.handleUpgrade(req, socket, head, (ws) => asterWss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  console.log('[WS] Relay servers started at /ws (Hyperliquid) and /aster-stream (Aster)');
}
