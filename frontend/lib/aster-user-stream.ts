// Aster futures user-data stream (docs: futures-v3/user-data-streams).
// Lifecycle: POST listenKey → connect wss://fstream.asterdex.com/ws/<key> →
// PUT listenKey every ≤60min (we use 30) → DELETE on teardown. The key dies
// server-side 60min after the last keepalive, and the server pushes
// `listenKeyExpired` when it does — on either expiry or socket close we
// re-mint and reconnect. A single connection is also capped at 24h by the
// server, which lands on the same reconnect path.
//
// listenKey calls go through the backend's /aster-signed/* passthrough so
// they're signed by the user's approved Aster agent (USER_STREAM auth) —
// the browser never sees agent credentials. If the agent isn't approved yet
// the POST 4xx's; we retry rather than give up (approval may land while the
// terminal is open).

const ASTER_WS = 'wss://fstream.asterdex.com/ws';

export interface AsterUserStreamHandlers {
  onAccountUpdate?: (data: any) => void; // ACCOUNT_UPDATE → msg.a (balances/positions)
  onOrderUpdate?: (data: any) => void;   // ORDER_TRADE_UPDATE → msg.o
  onMarginCall?: (data: any) => void;    // MARGIN_CALL → full msg
}

export function startAsterUserStream(
  userAddress: string,
  handlers: AsterUserStreamHandlers,
): () => void {
  let ws: WebSocket | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;

  async function signedCall(method: 'POST' | 'PUT' | 'DELETE', path: string) {
    const res = await fetch(`/aster-signed${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: userAddress }),
    });
    if (!res.ok) throw new Error(`listenKey ${method} failed: ${res.status}`);
    return res.json();
  }

  async function connect() {
    if (!alive) return;
    let key: string;
    try {
      const d = await signedCall('POST', '/fapi/v3/listenKey');
      key = d?.listenKey;
      if (!key) throw new Error('no listenKey in response');
    } catch {
      // Agent not approved yet, or a transient backend error — retry rather
      // than giving up; teardown clears `alive` and cancels this timer.
      retryTimer = setTimeout(connect, 15_000);
      return;
    }
    if (!alive) return;

    ws = new WebSocket(`${ASTER_WS}/${key}`);
    ws.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        switch (msg.e) {
          case 'ACCOUNT_UPDATE':
            handlers.onAccountUpdate?.(msg.a);
            break;
          case 'ORDER_TRADE_UPDATE':
            handlers.onOrderUpdate?.(msg.o);
            break;
          case 'MARGIN_CALL':
            handlers.onMarginCall?.(msg);
            break;
          case 'listenKeyExpired':
            // Key is dead — close and let the reconnect path re-mint it.
            ws?.close();
            break;
        }
      } catch {}
    };
    ws.onclose = () => {
      if (keepalive) {
        clearInterval(keepalive);
        keepalive = null;
      }
      if (alive) retryTimer = setTimeout(connect, 3000);
    };
    // Server sends ping frames every 5min and drops sockets that don't pong
    // within 15min — browsers auto-pong, nothing to do here. The listenKey
    // keepalive is ours: PUT every 30min (server limit is 60).
    keepalive = setInterval(async () => {
      try {
        await signedCall('PUT', '/fapi/v3/listenKey');
      } catch {}
    }, 30 * 60_000);
  }

  connect();

  return () => {
    alive = false;
    if (retryTimer) clearTimeout(retryTimer);
    if (keepalive) clearInterval(keepalive);
    ws?.close();
    signedCall('DELETE', '/fapi/v3/listenKey').catch(() => {});
  };
}
