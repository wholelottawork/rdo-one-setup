'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getAsterTickers, getAsterFunding, type AsterTicker } from './aster';
import type { OrderBook } from './hyperliquid';

// Aster is Binance-API-compatible, including its WebSocket market streams on
// this host (already used for @aggTrade / the user-data listenKey stream).
const ASTER_WS = 'wss://fstream.asterdex.com';

export type AsterSocketStatus = 'connecting' | 'live' | 'reconnecting';

interface AsterSocketValue {
  tickers: AsterTicker[];
  funding: Record<string, number>;
  status: AsterSocketStatus;
}

const AsterSocketContext = createContext<AsterSocketValue | null>(null);

/**
 * One shared market-data WebSocket for Aster — replaces the app-wide REST
 * polling that got users IP-banned by Aster (a Binance-API clone that returns
 * the "Please use the websocket for live updates to avoid bans" 418 when
 * /fapi REST is hit too often; in local dev those proxied calls leave from the
 * user's own IP). A single combined stream carries every symbol's 24h ticker
 * and mark-price/funding, so `useAsterTickers`/`useAsterFunding` read live
 * state here instead of refetching /ticker/24hr and /premiumIndex on a timer.
 *
 * REST is used only ONCE at mount to seed the full symbol list — !ticker@arr
 * only pushes symbols whose stats changed in the last second, so a rarely
 * traded market would otherwise be missing from the table until it ticks.
 */
export function AsterSocketProvider({ children }: { children: React.ReactNode }) {
  const [tickers, setTickers] = useState<Record<string, AsterTicker>>({});
  const [funding, setFunding] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<AsterSocketStatus>('connecting');

  // One-time REST seed so illiquid symbols appear immediately; the WS keeps
  // them live afterwards. Guard against overwriting values the WS already set.
  useEffect(() => {
    let alive = true;
    getAsterTickers().then((list) => {
      if (!alive) return;
      setTickers((prev) => {
        const next = { ...prev };
        list.forEach((t) => { if (!next[t.symbol]) next[t.symbol] = t; });
        return next;
      });
    }).catch(() => { /* silent — WS will fill in */ });
    getAsterFunding().then((f) => {
      if (alive) setFunding((prev) => ({ ...f, ...prev }));
    }).catch(() => { /* silent */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let ws: WebSocket;

    function connect() {
      setStatus('connecting');
      ws = new WebSocket(`${ASTER_WS}/stream?streams=!ticker@arr/!markPrice@arr@1s`);

      ws.onopen = () => { if (alive) setStatus('live'); };
      ws.onmessage = ({ data }) => {
        try {
          const env = JSON.parse(data);
          const payload = env.data;
          if (!Array.isArray(payload) || payload.length === 0) return;
          // Dispatch on the Binance event tag, not the stream key — more robust
          // than matching the exact "!markPrice@arr@1s" string.
          const ev = payload[0]?.e;
          if (ev === '24hrTicker') {
            setTickers((prev) => {
              const next = { ...prev };
              payload.forEach((t: Record<string, string>) => {
                const sym = String(t.s).replace(/USDT$/, '');
                next[sym] = {
                  symbol: sym,
                  lastPrice: parseFloat(t.c ?? '0'),
                  openPrice: parseFloat(t.o ?? t.c ?? '0'),
                  priceChangePercent: parseFloat(t.P ?? '0'),
                  quoteVolume: parseFloat(t.q ?? '0'),
                };
              });
              return next;
            });
          } else if (ev === 'markPriceUpdate') {
            setFunding((prev) => {
              const next = { ...prev };
              payload.forEach((m: Record<string, string>) => {
                const sym = String(m.s).replace(/USDT$/, '');
                next[sym] = parseFloat(m.r ?? '0') * 100;
              });
              return next;
            });
          }
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        if (!alive) return;
        setStatus('reconnecting');
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const tickerList = useMemo(() => Object.values(tickers), [tickers]);
  const value = useMemo(
    () => ({ tickers: tickerList, funding, status }),
    [tickerList, funding, status],
  );

  return <AsterSocketContext.Provider value={value}>{children}</AsterSocketContext.Provider>;
}

export function useAsterSocket() {
  const ctx = useContext(AsterSocketContext);
  if (!ctx) throw new Error('useAsterSocket must be used within AsterSocketProvider');
  return ctx;
}

/**
 * Per-symbol order-book stream — replaces the 2s REST /fapi/v1/depth poll that
 * was the single biggest contributor to the ban. Opened on demand by whichever
 * component shows the book, mirroring useHLBookStream. Returns the same
 * `{ data }` shape the old useAsterBook (React Query) hook did.
 */
export function useAsterBookStream(symbol: string, enabled: boolean): { data: OrderBook | undefined } {
  const [book, setBook] = useState<OrderBook>();

  useEffect(() => {
    if (!enabled || !symbol) { setBook(undefined); return; }

    let alive = true;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let ws: WebSocket;

    function connect() {
      ws = new WebSocket(`${ASTER_WS}/ws/${symbol.toLowerCase()}usdt@depth20@100ms`);
      ws.onmessage = ({ data }) => {
        try {
          const m = JSON.parse(data);
          const asks = m.a ?? m.asks;
          const bids = m.b ?? m.bids;
          if (!asks || !bids) return;
          setBook({
            asks: asks.slice(0, 20).map(([px, sz]: [string, string]) => ({ px: +px, sz: +sz })),
            bids: bids.slice(0, 20).map(([px, sz]: [string, string]) => ({ px: +px, sz: +sz })),
          });
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => { if (alive) reconnectTimer = setTimeout(connect, 3000); };
      ws.onerror = () => ws.close();
    }

    setBook(undefined);
    connect();
    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [symbol, enabled]);

  return { data: book };
}
