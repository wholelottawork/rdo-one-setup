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
 */
export function HLSocketProvider({ symbols, children }: { symbols: string[]; children: React.ReactNode }) {
  const [status, setStatus] = useState<HLConnStatus>('connecting');
  const [prices, setPrices] = useState<Record<string, number>>({});
  const tradeListeners = useRef(new Map<string, Set<(t: Trade) => void>>());
  const symbolsKey = symbols.join(',');

  useEffect(() => {
    let alive = true;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let ws: WebSocket;

    function connect() {
      ws = new WebSocket(hlWsUrl());

      ws.onopen = () => {
        setStatus('live');
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }));
        symbolsKey.split(',').filter(Boolean).forEach(sym => {
          ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin: sym } }));
        });
      };

      ws.onmessage = ({ data }) => {
        try {
          const msg = JSON.parse(data);
          if (msg.channel === 'allMids') {
            const syms = symbolsKey.split(',').filter(Boolean);
            setPrices(prev => {
              const next = { ...prev };
              let changed = false;
              syms.forEach(sym => {
                const px = parseFloat(msg.data.mids[sym]);
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
      ws?.close();
    };
  }, [symbolsKey]);

  const subscribeTrades = useCallback((symbol: string, cb: (t: Trade) => void) => {
    if (!tradeListeners.current.has(symbol)) tradeListeners.current.set(symbol, new Set());
    tradeListeners.current.get(symbol)!.add(cb);
    return () => tradeListeners.current.get(symbol)?.delete(cb);
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
