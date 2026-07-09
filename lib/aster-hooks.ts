'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAsterSocket } from './aster-socket';
import {
  getAsterCandles, getAsterOpenInterest,
  getAsterSymbols, getAsterLeverageBrackets,
  getAsterBalance, getAsterPositions, getAsterFills, getAsterOpenOrders as getAsterOpenOrdersRaw, getAsterFundingHistory,
  startAsterUserStream, keepaliveAsterUserStream, closeAsterUserStream, asterUserStreamWsUrl,
} from './aster';

// Re-export so the terminal keeps importing all Aster data hooks from one place.
export { useAsterBookStream } from './aster-socket';

// The exchange's own symbol list — rarely changes, so a long staleTime avoids
// re-fetching exchangeInfo (a ~700KB payload) more often than needed.
export function useAsterSymbols() {
  return useQuery({
    queryKey: ['aster', 'symbols'],
    queryFn: getAsterSymbols,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

// Live from the shared Aster market WebSocket (see aster-socket.tsx) — no more
// /ticker/24hr or /premiumIndex polling. Same `{ data }` shape the old React
// Query hooks exposed, so existing call sites don't change.
export function useAsterTickers() {
  const { tickers } = useAsterSocket();
  return { data: tickers };
}

export function useAsterFunding() {
  const { funding } = useAsterSocket();
  return { data: funding };
}

export function useAsterCandles(symbol: string, intervalMinutes: number) {
  return useQuery({
    queryKey: ['aster', 'candles', symbol, intervalMinutes],
    queryFn: () => getAsterCandles(symbol, intervalMinutes, 200),
  });
}

export function useAsterOpenInterest(symbols: string[], prices: Record<string, number>, enabled = true) {
  return useQuery({
    queryKey: ['aster', 'oi', symbols.length],
    queryFn: () => getAsterOpenInterest(symbols, prices),
    // Batched (see getAsterOpenInterest) but still N requests for N symbols —
    // slower interval than the bulk ticker/funding calls on purpose.
    refetchInterval: 90_000,
    enabled: enabled && symbols.length > 0 && Object.keys(prices).length > 0,
  });
}

// One signed call for every symbol's real max leverage — backed by a 5-min
// server-side cache (see server/routes/proxy.js), so this is cheap to refetch.
export function useAsterLeverageBrackets() {
  return useQuery({
    queryKey: ['aster', 'leverageBrackets'],
    queryFn: getAsterLeverageBrackets,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

// ── Terminal account data hooks (wallet-gated) ───────────────────────────────

// These hit the signed /fapi/v3/accountWithJoinMargin endpoint (the weightiest,
// most ban-prone calls). The push-based user-data stream (useAsterUserStream)
// invalidates them the instant a fill/funding actually changes the account, so
// the interval here is just a slow safety net, not the real-time source.
export function useAsterBalance(address: string | null) {
  return useQuery({
    queryKey: ['aster', 'balance', address],
    queryFn: () => getAsterBalance(address!),
    enabled: !!address,
    refetchInterval: 60_000,
  });
}

export function useAsterPositions(address: string | null) {
  return useQuery({
    queryKey: ['aster', 'positions', address],
    queryFn: () => getAsterPositions(address!),
    enabled: !!address,
    refetchInterval: 60_000,
  });
}

export function useAsterFills(address: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['aster', 'fills', address],
    queryFn: () => getAsterFills(address!),
    enabled: !!address && enabled,
  });
}

export function useAsterOpenOrders(address: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['aster', 'openOrders', address],
    queryFn: () => getAsterOpenOrdersRaw(address!),
    enabled: !!address && enabled,
  });
}

export function useAsterFundingHistory(address: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['aster', 'funding', address],
    queryFn: () => getAsterFundingHistory(address!),
    enabled: !!address && enabled,
  });
}

// ── Aster public trade stream (individual symbol @aggTrade) ───────────────

export interface AsterAggTrade {
  px: number;
  sz: number;
  side: 'buy' | 'sell';
  time: number;
}

/** Subscribe to Aster's public aggregate trade stream for a single symbol.
 *  Uses the direct wss://fstream.asterdex.com/ws/<symbol>@aggTrade endpoint.
 *  Returns live trades and a connection status. */
export function useAsterTradeStream(symbol: string, enabled: boolean): { trades: AsterAggTrade[]; status: 'idle' | 'connecting' | 'live' | 'reconnecting' } {
  const [trades, setTrades] = useState<AsterAggTrade[]>([]);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'reconnecting'>('idle');

  useEffect(() => {
    if (!enabled || !symbol) {
      setStatus('idle');
      setTrades([]);
      return;
    }

    let alive = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    const RECONNECT_MS = 5_000;

    function connect() {
      setStatus('connecting');
      const streamUrl = `wss://fstream.asterdex.com/ws/${symbol.toLowerCase()}usdt@aggTrade`;
      ws = new WebSocket(streamUrl);

      ws.onopen = () => { if (alive) setStatus('live'); };
      ws.onmessage = ({ data }) => {
        try {
          const msg = JSON.parse(data);
          // Aster aggTrade format: { p: price, q: quantity, m: isBuyerMaker }
          // m=true means buyer is maker → seller is taker → trade was a sell
          const px = parseFloat(msg.p ?? '0');
          const sz = parseFloat(msg.q ?? '0');
          if (!px || !sz) return;
          const trade: AsterAggTrade = {
            px,
            sz,
            side: msg.m ? 'sell' : 'buy',
            time: msg.T || Date.now(),
          };
          setTrades(prev => [trade, ...prev].slice(0, 80));
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        if (!alive) return;
        setStatus('reconnecting');
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };
      ws.onerror = () => ws?.close();
    }

    connect();
    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [symbol, enabled]);

  return { trades, status };
}


export type AsterStreamStatus = 'idle' | 'connecting' | 'live' | 'reconnecting';

// Aster expires a listenKey ~60min after creation/last keepalive — ping well
// before that so a slow tick of the interval never risks missing it.
const KEEPALIVE_MS = 30 * 60_000;
const DEBOUNCE_MS = 500;
const RECONNECT_MS = 5_000;
const START_RETRY_MS = 10_000;

/**
 * Real-time notice (not full state) that userAddress's Aster balance or
 * positions changed, via Aster's push-based User Data Stream — the
 * alternative their own docs recommend over polling accountWithJoinMargin
 * repeatedly, which is what scales badly once many users are doing it
 * concurrently against our one shared IP's rate limit (see lib/aster.ts's
 * startAsterUserStream for why we relay a notice rather than reconstruct
 * account state from the push deltas ourselves: ACCOUNT_UPDATE carries
 * incremental per-asset/per-position changes, not the REST endpoint's
 * pre-computed USD totals).
 *
 * `onUpdate` fires debounced (a single fill can touch balance AND position,
 * arriving as related events in quick succession) — treat it as "go refetch
 * the authoritative REST state now," not as the state itself.
 */
export function useAsterUserStream(userAddress: string | null, onUpdate: () => void): AsterStreamStatus {
  const [status, setStatus] = useState<AsterStreamStatus>('idle');
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!userAddress) {
      setStatus('idle');
      return;
    }

    let alive = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let keepaliveTimer: ReturnType<typeof setInterval>;
    let debounceTimer: ReturnType<typeof setTimeout>;

    async function connect() {
      setStatus('connecting');
      const listenKey = await startAsterUserStream(userAddress!);
      if (!alive) return;
      if (!listenKey) {
        setStatus('reconnecting');
        reconnectTimer = setTimeout(connect, START_RETRY_MS);
        return;
      }

      ws = new WebSocket(asterUserStreamWsUrl(listenKey));
      ws.onopen = () => { if (alive) setStatus('live'); };
      ws.onmessage = ({ data }) => {
        try {
          const msg = JSON.parse(data);
          if (msg.e === 'ACCOUNT_UPDATE') {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => onUpdateRef.current(), DEBOUNCE_MS);
          }
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        if (!alive) return;
        setStatus('reconnecting');
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };
      ws.onerror = () => ws?.close();

      clearInterval(keepaliveTimer);
      keepaliveTimer = setInterval(() => keepaliveAsterUserStream(userAddress!), KEEPALIVE_MS);
    }

    connect();
    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      clearTimeout(debounceTimer);
      clearInterval(keepaliveTimer);
      ws?.close();
      closeAsterUserStream(userAddress);
    };
  }, [userAddress]);

  return status;
}
