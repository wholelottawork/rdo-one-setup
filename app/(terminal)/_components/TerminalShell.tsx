'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWallet } from '@/lib/wallet';
import { useToast } from '@/lib/toast';
import { HLSocketProvider, useHLSocket } from '@/lib/hl-socket';
import { useHLMeta, useHLTickers, useHLBalance, useHLPositions, useHLFills, useHLOpenOrders, useHLFunding } from '@/lib/hl-hooks';
import {
  useAsterTickers, useAsterFunding, useAsterSymbols, useAsterLeverageBrackets,
  useAsterBalance, useAsterPositions, useAsterFills, useAsterOpenOrders, useAsterFundingHistory,
} from '@/lib/aster-hooks';
import { fmtPrice, fmtAster, fmtLarge, type TradeMode } from '@/lib/markets';
import { Header, type DropdownRow, type HeaderStats } from './Header';
import { XTracker } from './XTracker';
import { StatusBar } from './StatusBar';
import { BottomPanel } from './BottomPanel';
import { BottomPanelShell } from './BottomPanelShell';
import type { HLNetwork } from '@/lib/hyperliquid';

// countdown() — verbatim from main.js (time to next 8h funding boundary)
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

interface Props {
  children: React.ReactNode;
  initialMode?: TradeMode;
  initialMarket?: string;
  network?: HLNetwork;
  onNetworkChange?: (n: HLNetwork) => void;
  activePage?: string;
  /** Optional custom bottom panel content. If provided, replaces the default
   *  account-data bottom panel (used by the terminal page for trading actions). */
  bottomPanel?: React.ReactNode;
}

/** Shared terminal shell used by ALL pages (trade, markets, news, portfolio,
 *  transfer, swap). Provides the consistent layout: Header (with mode/network
 *  toggles), XTracker sidebar, center content area, optional bottom panel,
 *  and status bar. Only the center content changes per page. */
export function TerminalShell({
  children,
  initialMode = 'hl',
  initialMarket = 'BTC',
  network = 'mainnet',
  onNetworkChange,
  activePage = 'trade',
  bottomPanel,
}: Props) {
  const [mode, setMode] = useState<TradeMode>(initialMode);
  const [market, setMarket] = useState(initialMarket);
  const [clockTick, setClockTick] = useState(0);
  const [depositOpen, setDepositOpen] = useState(false);

  const { address } = useWallet();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const { status, prices: wsPrices } = useHLSocket();

  const isAster = mode === 'aster';

  // ── Wallet-gated account data (for bottom panel) ───────────────
  // Hyperliquid
  const { data: hlBalance = 0 } = useHLBalance(address, network);
  const { data: hlPositions = [] } = useHLPositions(address, network);
  const { data: hlFills = [] } = useHLFills(address, true, network);
  const { data: hlOpenOrders = [] } = useHLOpenOrders(address, true, network);
  const { data: hlFundingHistory = [] } = useHLFunding(address, true, network);

  // Aster
  const { data: asterBalance = 0 } = useAsterBalance(address);
  const { data: asterPositions = [] } = useAsterPositions(address);
  const { data: asterFills = [] } = useAsterFills(address, true);
  const { data: asterOpenOrders = [] } = useAsterOpenOrders(address, true);
  const { data: asterFundingHistory = [] } = useAsterFundingHistory(address, true);

  // Use mode-appropriate data for bottom panel
  const balance = isAster ? asterBalance : hlBalance;
  const positions = isAster ? asterPositions : hlPositions;
  const fills = isAster ? asterFills : hlFills;
  const openOrders = isAster ? asterOpenOrders : hlOpenOrders;
  const funding = isAster ? asterFundingHistory : hlFundingHistory;

  // ── Trading actions (redirect to trade page for non-terminal pages) ─
  const handleClosePosition = useCallback((index: number) => {
    showToast('Manage positions on the Trade page', '');
  }, [showToast]);

  const handleCancelOrder = useCallback((oid: number, symbol: string) => {
    showToast('Manage orders on the Trade page', '');
  }, [showToast]);

  // body.mode-aster re-themes the whole page (accent → purple)
  useEffect(() => {
    document.body.classList.toggle('mode-aster', isAster);
    return () => document.body.classList.remove('mode-aster');
  }, [isAster]);

  // per-second tick for the funding countdown
  useEffect(() => {
    const id = setInterval(() => setClockTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Market data (needed for Header dropdown and stats) ─────────
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
          oi: null, // OI is expensive to fetch for all symbols; skip in header dropdown
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

  function changeMode(next: TradeMode) {
    if (next === mode) return;
    setMode(next);
    setMarket('BTC');
    setDepositOpen(false);
  }

  function selectMarket(sym: string) {
    setMarket(sym);
  }

  return (
    <>
      <div id="app">
        <Header
          mode={mode}
          market={market}
          stats={headerStats}
          balance={0}
          dropdownRows={dropdownRows}
          onModeChange={changeMode}
          onSelectMarket={selectMarket}
          onOpenDeposit={() => setDepositOpen(true)}
          network={network}
          onNetworkChange={onNetworkChange ?? (() => {})}
          activePage={activePage}
        />

        {/* ══ WORKSPACE ══ */}
        <div className="workspace">
          <XTracker market={market} />
          <div className="page-content-area">
            {children}
          </div>
        </div>

        <BottomPanelShell>
          {bottomPanel ?? (
            <BottomPanel
              mode={mode}
              address={address}
              positions={positions}
              fills={fills}
              openOrders={openOrders}
              funding={funding}
              livePrices={livePrices}
              onClosePosition={handleClosePosition}
              onCancelOrder={handleCancelOrder}
              onTabData={() => {}}
            />
          )}
        </BottomPanelShell>

        <StatusBar status={status} />
      </div>
    </>
  );
}

/** Wrapper that provides the HLSocketProvider context needed by TerminalShell.
 *  Use this at the page level: <TerminalShellProvider><YourPage /></TerminalShellProvider>
 *  Or better: wrap your page content with TerminalShell directly inside the provider. */
export function TerminalShellProvider({
  children,
  network = 'mainnet',
}: {
  children: React.ReactNode;
  network?: HLNetwork;
}) {
  return (
    <HLSocketProvider network={network}>
      {children}
    </HLSocketProvider>
  );
}
