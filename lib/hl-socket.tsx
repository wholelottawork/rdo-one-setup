'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { hlWsUrl, type OrderBook } from './hyperliquid';

export interface Trade {
  px: number;
  sz: number;
  side: 'buy' | 'sell';
  time: number;
}

export type HLConnStatus = 'connecting' | 'live' | 'reconnecting';

interface HLSocketValue {
  status: HLConnStatus;
  prices: Record<string, number>;
  subscribeTrades: (symbol: string, cb: (t: Trade) => void) => () => void;
}

const HLSocketContext = createContext<HLSocketValue | null>(null);

/**
 * One shared price/trade WebSocket for the whole terminal — replaces
 * trading.js's startPriceStream(), whose DOM writes (#wsDot/#wsStatus) are
 * now just `status` state consumed wherever needed.
 *
 * No fixed symbol list: `allMids` already carries every market HL offers, so
 * `prices` covers all of them without us hardcoding which ones to keep.
 * Trade subscriptions are per-coin and dynamic — sent the moment the first
 * `subscribeTrades(symbol, ...)` listener registers, and unsubscribed when
 * the last one unmounts — so switching to *any* market HL lists (not just a
 * pre-picked subset) gets a live trades feed, not just the top N.
 */
export function HLSocketProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<HLConnStatus>('connecting');
  const [prices, setPrices] = useState<Record<string, number>>({});
  const tradeListeners = useRef(new Map<string, Set<(t: Trade) => void>>());
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let alive = true;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const ws = new WebSocket(hlWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('live');
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }));
        // Re-subscribe any coins that already had listeners before a reconnect
        tradeListeners.current.forEach((_listeners, coin) => {
          ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin } }));
        });
      };

      ws.onmessage = ({ data }) => {
        try {
          const msg = JSON.parse(data);
          if (msg.channel === 'allMids') {
            setPrices(prev => {
              const next = { ...prev };
              let changed = false;
              Object.entries(msg.data.mids as Record<string, string>).forEach(([sym, raw]) => {
                const px = parseFloat(raw);
                if (px && next[sym] !== px) { next[sym] = px; changed = true; }
              });
              return changed ? next : prev;
            });
          }
          if (msg.channel === 'trades') {
            (msg.data ?? []).forEach((t: { coin: string; px: string; sz: string; side: string; time: number }) => {
              const listeners = tradeListeners.current.get(t.coin);
              listeners?.forEach(cb => cb({
                px: +t.px, sz: +t.sz, side: t.side === 'B' ? 'buy' : 'sell', time: t.time,
              }));
            });
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        setStatus('reconnecting');
        if (alive) reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const subscribeTrades = useCallback((symbol: string, cb: (t: Trade) => void) => {
    const isNewCoin = !tradeListeners.current.has(symbol);
    if (isNewCoin) tradeListeners.current.set(symbol, new Set());
    const listeners = tradeListeners.current.get(symbol)!;
    listeners.add(cb);

    if (isNewCoin && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin: symbol } }));
    }

    return () => {
      listeners.delete(cb);
      if (listeners.size === 0) {
        tradeListeners.current.delete(symbol);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ method: 'unsubscribe', subscription: { type: 'trades', coin: symbol } }));
        }
      }
    };
  }, []);

  return (
    <HLSocketContext.Provider value={{ status, prices, subscribeTrades }}>
      {children}
    </HLSocketContext.Provider>
  );
}

export function useHLSocket() {
  const ctx = useContext(HLSocketContext);
  if (!ctx) throw new Error('useHLSocket must be used within HLSocketProvider');
  return ctx;
}

/**
 * Per-symbol order-book stream, opened on demand by whichever component is
 * showing a book — mirrors trading.js's startBookStream (one dedicated
 * socket per active market, not multiplexed through HLSocketProvider).
 * `onBook` is called on every update; pass a stable (useCallback'd) fn.
 */
export function useHLBookStream(symbol: string, onBook: (book: OrderBook) => void) {
  const onBookRef = useRef(onBook);
  onBookRef.current = onBook;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let ws: WebSocket;

    function connect() {
      ws = new WebSocket(hlWsUrl());
      ws.onopen = () => ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'l2Book', coin: symbol } }));
      ws.onmessage = ({ data }) => {
        try {
          const msg = JSON.parse(data);
          if (msg.channel === 'l2Book' && msg.data?.coin === symbol && msg.data.levels) {
            onBookRef.current({
              bids: (msg.data.levels[0] ?? []).slice(0, 10).map((l: { px: string; sz: string }) => ({ px: +l.px, sz: +l.sz })),
              asks: (msg.data.levels[1] ?? []).slice(0, 10).map((l: { px: string; sz: string }) => ({ px: +l.px, sz: +l.sz })),
            });
          }
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => { if (alive) timer = setTimeout(connect, 2000); };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      alive = false;
      clearTimeout(timer);
      ws?.close();
    };
  }, [symbol]);
}
