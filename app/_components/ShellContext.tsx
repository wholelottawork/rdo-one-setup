'use client';

import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWallet } from '@/lib/wallet';
import { useToast } from '@/lib/toast';
import { useHLSocket } from '@/lib/hl-socket';
import { useHLMeta, useHLTickers, useHLBalance, useHLPositions, useHLFills, useHLOpenOrders, useHLFunding } from '@/lib/hl-hooks';
import {
  useAsterTickers, useAsterFunding, useAsterSymbols, useAsterLeverageBrackets,
  useAsterBalance, useAsterPositions, useAsterFills, useAsterOpenOrders, useAsterFundingHistory,
} from '@/lib/aster-hooks';
import { fmtPrice, fmtAster, fmtLarge, type TradeMode } from '@/lib/markets';
import type { HLNetwork, Position, Fill, OpenOrder, FundingEntry } from '@/lib/hyperliquid';
import type { HLConnStatus } from '@/lib/hl-socket';

function countdown(): string {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(Math.ceil((now.getUTCHours() + 1) / 8) * 8, 0, 0, 0);
  if (next <= now) next.setUTCHours(next.getUTCHours() + 8);
  const diff = next.getTime() - now.getTime();
  const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
  const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
  const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export interface HeaderStats {
  mark: string;
  change: string;
  changeUp: boolean;
  volume: string;
  funding: string;
}

export interface DropdownRow {
  sym: string;
  lev: string;
  price: string;
  chgPct: number | null;
  fund8h: number | null;
  vol: number | null;
  oi: number | null;
}

interface ShellContextValue {
  mode: TradeMode;
  setMode: (m: TradeMode) => void;
  market: string;
  setMarket: (m: string) => void;
  network: HLNetwork;
  setNetwork: (n: HLNetwork) => void;
  isAster: boolean;
  clockTick: number;
  headerStats: HeaderStats;
  dropdownRows: DropdownRow[];
  livePrices: Record<string, number>;
  livePrice: number | undefined;
  balance: number;
  positions: Position[];
  fills: Fill[];
  openOrders: OpenOrder[];
  funding: FundingEntry[];
  address: string | null;
  status: HLConnStatus;
  handleClosePosition: (index: number) => void;
  handleCancelOrder: (oid: number, symbol: string) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<TradeMode>('hl');
  const [market, setMarket] = useState('BTC');
  const [network, setNetwork] = useState<HLNetwork>('mainnet');
  const [clockTick, setClockTick] = useState(0);

  const { address } = useWallet();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const { status, prices: wsPrices } = useHLSocket();

  const isAster = mode === 'aster';

  // ── Wallet-gated account data ──────────────────────────────────
  const { data: hlBalance = 0 } = useHLBalance(address, network);
  const { data: hlPositions = [] } = useHLPositions(address, network);
  const { data: hlFills = [] } = useHLFills(address, true, network);
  const { data: hlOpenOrders = [] } = useHLOpenOrders(address, true, network);
  const { data: hlFundingHistory = [] } = useHLFunding(address, true, network);

  const { data: asterBalance = 0 } = useAsterBalance(address);
  const { data: asterPositions = [] } = useAsterPositions(address);
  const { data: asterFills = [] } = useAsterFills(address, true);
  const { data: asterOpenOrders = [] } = useAsterOpenOrders(address, true);
  const { data: asterFundingHistory = [] } = useAsterFundingHistory(address, true);

  const balance = isAster ? asterBalance : hlBalance;
  const positions = isAster ? asterPositions : hlPositions;
  const fills = isAster ? asterFills : hlFills;
  const openOrders = isAster ? asterOpenOrders : hlOpenOrders;
  const funding = isAster ? asterFundingHistory : hlFundingHistory;

  const handleClosePosition = useCallback((index: number) => {
    showToast('Manage positions on the Trade page', '');
  }, [showToast]);

  const handleCancelOrder = useCallback((oid: number, symbol: string) => {
    showToast('Manage orders on the Trade page', '');
  }, [showToast]);

  // body.mode-aster re-themes
  useEffect(() => {
    document.body.classList.toggle('mode-aster', isAster);
    return () => document.body.classList.remove('mode-aster');
  }, [isAster]);

  // per-second tick
  useEffect(() => {
    const id = setInterval(() => setClockTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Market data ────────────────────────────────────────────────
  const { data: hlMeta } = useHLMeta(network);
  const { data: hlTickers } = useHLTickers(network);
  const { data: asterSymbols } = useAsterSymbols();
  const { data: asterTickers } = useAsterTickers();
  const { data: asterFunding } = useAsterFunding();
  const { data: asterLeverage } = useAsterLeverageBrackets();

  const asterPrices = useMemo(() => {
    const out: Record<string, number> = {};
    asterTickers?.forEach(t => { if (t.lastPrice > 0) out[t.symbol] = t.lastPrice; });
    return out;
  }, [asterTickers]);

  const livePrices = useMemo(() => {
    if (isAster) return asterPrices;
    const out: Record<string, number> = {};
    Object.entries(hlTickers ?? {}).forEach(([sym, s]) => { if (s.price > 0) out[sym] = s.price; });
    return { ...out, ...wsPrices };
  }, [isAster, asterPrices, hlTickers, wsPrices]);

  const livePrice = livePrices[market];

  // ── Header stats ───────────────────────────────────────────────
  const headerStats: HeaderStats = useMemo(() => {
    void clockTick;
    if (isAster) {
      const ticker = asterTickers?.find(t => t.symbol === market);
      if (!ticker) return { mark: '—', change: '—', changeUp: true, volume: '—', funding: '— / —' };
      const px = ticker.lastPrice;
      const open = ticker.openPrice || px;
      const chg = px - open;
      const pct = open ? (chg / open) * 100 : 0;
      return {
        mark: fmtAster(px),
        change: `${chg >= 0 ? '+' : ''}${fmtAster(chg)} / ${chg >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
        changeUp: chg >= 0,
        volume: '$' + fmtLarge(ticker.quoteVolume),
        funding: '— / —',
      };
    }
    const ctx = hlMeta?.get(market);
    const px = livePrices[market] ?? 0;
    if (!ctx) return { mark: fmtPrice(px), change: '—', changeUp: true, volume: '—', funding: '— / —' };
    const open = ctx.prevDayPx || px;
    const chg = px - open;
    const pct = open ? (chg / open) * 100 : 0;
    return {
      mark: fmtPrice(px),
      change: `${chg >= 0 ? '+' : ''}${fmtPrice(chg)} / ${chg >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
      changeUp: chg >= 0,
      volume: '$' + fmtLarge(ctx.dayNtlVlm),
      funding: (ctx.funding * 100).toFixed(4) + '% / ' + countdown(),
    };
  }, [isAster, asterTickers, hlMeta, market, livePrices, clockTick]);

  // ── Market dropdown rows ───────────────────────────────────────
  const dropdownRows: DropdownRow[] = useMemo(() => {
    if (isAster) {
      return (asterSymbols ?? []).map(sym => {
        const ticker = asterTickers?.find(t => t.symbol === sym);
        const lev = asterLeverage?.[sym];
        return {
          sym,
          lev: lev ? lev + 'x' : '—',
          price: ticker?.lastPrice ? fmtAster(ticker.lastPrice) : '—',
          chgPct: ticker ? ticker.priceChangePercent : null,
          fund8h: asterFunding?.[sym] ?? null,
          vol: ticker?.quoteVolume ?? null,
          oi: null,
        };
      });
    }
    return Object.entries(hlTickers ?? {}).map(([sym, s]) => {
      const px = livePrices[sym];
      return {
        sym,
        lev: s.lev ? s.lev + 'x' : '',
        price: px ? fmtPrice(px) : '—',
        chgPct: s.chgPct ?? null,
        fund8h: s.fund8h ?? null,
        vol: s.vol ?? null,
        oi: s.oi ?? null,
      };
    });
  }, [isAster, asterSymbols, asterTickers, asterFunding, asterLeverage, hlTickers, livePrices]);

  const value = useMemo(() => ({
    mode, setMode, market, setMarket, network, setNetwork, isAster, clockTick,
    headerStats, dropdownRows, livePrices, livePrice, balance,
    positions, fills, openOrders, funding, address, status,
    handleClosePosition, handleCancelOrder,
  }), [
    mode, market, network, isAster, clockTick, headerStats, dropdownRows,
    livePrices, livePrice, balance, positions, fills, openOrders, funding,
    address, status, handleClosePosition, handleCancelOrder,
  ]);

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used within ShellProvider');
  return ctx;
}
