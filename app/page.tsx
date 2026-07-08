'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useWallet, getEVMProvider } from '@/lib/wallet';
import { useToast } from '@/lib/toast';
import { HLSocketProvider, useHLSocket, useHLBookStream, type Trade } from '@/lib/hl-socket';
import {
  useHLMeta, useHLTickers, useHLCandles, useHLBalance, useHLPositions,
  useHLFills, useHLOpenOrders, useHLFunding,
} from '@/lib/hl-hooks';
import {
  useAsterTickers, useAsterFunding, useAsterCandles, useAsterBook, useAsterOpenInterest,
  useAsterSymbols, useAsterLeverageBrackets, useAsterBalance, useAsterPositions,
  useAsterFills, useAsterOpenOrders, useAsterFundingHistory,
  useAsterUserStream, useAsterTradeStream,
} from '@/lib/aster-hooks';
import { openPosition, closePosition, cancelOrder, getL2Book, type OrderBook, type HLNetwork } from '@/lib/hyperliquid';
import { asterPlaceOrder, asterClosePosition, asterCancelOrder } from '@/lib/aster';
import { fmtPrice, fmtAster, fmtLarge, type TradeMode } from '@/lib/markets';
import { Header, type DropdownRow, type HeaderStats } from '@/app/_components/Header';
import { XTracker } from '@/app/_components/XTracker';
import { ChartColumn } from '@/app/_components/ChartColumn';
import { TradesColumn } from '@/app/_components/TradesColumn';
import { TradePanel } from '@/app/_components/TradePanel';
import { BottomPanel } from '@/app/_components/BottomPanel';
import { BottomPanelShell } from '@/app/_components/BottomPanelShell';
import { StatusBar } from '@/app/_components/StatusBar';
import { DepositModal } from '@/app/_components/DepositModal';

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

export default function TerminalPage() {
  return (
    <Suspense fallback={null}>
      <TerminalPageInner />
    </Suspense>
  );
}

// Reads ?sym=&mode= from the URL (e.g. links from the Markets page perps
// table) so the terminal opens on the clicked market instead of always BTC.
// Needs its own component + Suspense boundary — useSearchParams() requires
// one for static prerendering, same as the /swap page.
//
// No hardcoded market list to validate against here — the live symbol list
// is fetched async inside <Terminal>, and every per-symbol fetch already
// degrades gracefully (empty/zero) for a symbol that turns out not to exist,
// so an unrecognized ?sym= just shows "—" until the user picks a real one.
function TerminalPageInner() {
  const params = useSearchParams();
  const requestedMode: TradeMode = params.get('mode') === 'aster' ? 'aster' : 'hl';
  const initialMarket = params.get('sym')?.toUpperCase() || 'BTC';
  const initialNetwork: HLNetwork = params.get('net') === 'testnet' ? 'testnet' : 'mainnet';
  const [network, setNetwork] = useState<HLNetwork>(initialNetwork);

  return (
    <HLSocketProvider network={network}>
      <Terminal initialMode={requestedMode} initialMarket={initialMarket} network={network} onNetworkChange={setNetwork} />
    </HLSocketProvider>
  );
}

function Terminal({
  initialMode, initialMarket, network, onNetworkChange,
}: { initialMode: TradeMode; initialMarket: string; network: HLNetwork; onNetworkChange: (n: HLNetwork) => void }) {
  const [mode, setMode] = useState<TradeMode>(initialMode);
  const [market, setMarket] = useState(initialMarket);
  const [intervalMinutes, setIntervalMinutes] = useState(1);
  const [isBuy, setIsBuy] = useState(true);
  const [size, setSize] = useState('');
  const [leverage, setLeverage] = useState(20);
  const [depositOpen, setDepositOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [hlBook, setHlBook] = useState<OrderBook>({ asks: [], bids: [] });
  const [clockTick, setClockTick] = useState(0); // drives the funding countdown

  const { address, connect } = useWallet();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const { status, prices: wsPrices, subscribeTrades } = useHLSocket();

  const isAster = mode === 'aster';

  // body.mode-aster re-themes the whole page (accent → purple) — original CSS
  useEffect(() => {
    document.body.classList.toggle('mode-aster', isAster);
    return () => document.body.classList.remove('mode-aster');
  }, [isAster]);

  // per-second tick for the funding countdown (startClock in main.js)
  useEffect(() => {
    const id = setInterval(() => setClockTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Market data ────────────────────────────────────────────────
  const { data: hlMeta } = useHLMeta(network);
  const { data: hlTickers } = useHLTickers(network);
  const { data: hlCandles } = useHLCandles(market, intervalMinutes, network);
  const { data: asterSymbols } = useAsterSymbols();
  const { data: asterTickers } = useAsterTickers();
  const { data: asterFunding } = useAsterFunding();
  const { data: asterCandles } = useAsterCandles(market, intervalMinutes);
  const { data: asterBook } = useAsterBook(market, isAster);

  const asterPrices = useMemo(() => {
    const out: Record<string, number> = {};
    asterTickers?.forEach(t => { if (t.lastPrice > 0) out[t.symbol] = t.lastPrice; });
    return out;
  }, [asterTickers]);

  const { data: asterOI } = useAsterOpenInterest(asterSymbols ?? [], asterPrices, isAster);
  const { data: asterLeverage } = useAsterLeverageBrackets();

  // livePrices — ticker snapshot for all markets, overlaid by ws stream (HL)
  const livePrices = useMemo(() => {
    if (isAster) return asterPrices;
    const out: Record<string, number> = {};
    Object.entries(hlTickers ?? {}).forEach(([sym, s]) => { if (s.price > 0) out[sym] = s.price; });
    return { ...out, ...wsPrices };
  }, [isAster, asterPrices, hlTickers, wsPrices]);

  const livePrice = livePrices[market];
  const candles = isAster ? asterCandles : hlCandles;

  // HL order book: seed with REST snapshot, then stream (loadMarket in main.js)
  useEffect(() => {
    if (isAster) return;
    let stale = false;
    getL2Book(market, network).then(book => { if (!stale) setHlBook(book); });
    return () => { stale = true; };
  }, [market, isAster, network]);
  const onHLBook = useCallback((book: OrderBook) => setHlBook(book), []);
  useHLBookStream(isAster ? '' : market, onHLBook, network);
  const book = isAster ? (asterBook ?? { asks: [], bids: [] }) : hlBook;

  // Trades feed
  useEffect(() => setTrades([]), [market, mode]);
  const onTrade = useCallback((trade: Trade) => setTrades(prev => [trade, ...prev].slice(0, 80)), []);
  useEffect(() => {
    if (isAster) return;
    return subscribeTrades(market, onTrade);
  }, [isAster, market, onTrade, subscribeTrades]);

  // Aster live trades stream
  const { trades: asterTrades } = useAsterTradeStream(market, isAster);

  // ── Wallet-gated account data ──────────────────────────────────
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

  // Aster user stream for live account updates
  const asterOnUpdate = useCallback(() => {
    if (!address) return;
    queryClient.invalidateQueries({ queryKey: ['aster', 'balance', address] });
    queryClient.invalidateQueries({ queryKey: ['aster', 'positions', address] });
    queryClient.invalidateQueries({ queryKey: ['aster', 'openOrders', address] });
  }, [address, queryClient]);
  const asterStreamStatus = useAsterUserStream(isAster ? address : null, asterOnUpdate);

  // Use mode-appropriate data
  const balance = isAster ? asterBalance : hlBalance;
  const positions = isAster ? asterPositions : hlPositions;
  const fills = isAster ? asterFills : hlFills;
  const openOrders = isAster ? asterOpenOrders : hlOpenOrders;
  const funding = isAster ? asterFundingHistory : hlFundingHistory;

  const currentPosition = positions.find(p => p.symbol === market);
  const totalUnrealizedPnl = positions.reduce((s, p) => s + p.pnl, 0);

  // ── Header stats (updateHeaderStats / updateAsterHeaderStats) ──
  const headerStats: HeaderStats = useMemo(() => {
    void clockTick; // recompute countdown every second
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

  // ── Market dropdown rows (renderMarketList) ───────────────────
  // Both branches iterate whatever the live API returns — no hardcoded
  // symbol arrays — so a market Aster or Hyperliquid adds/removes shows up
  // (or disappears) here automatically instead of needing a code change.
  const dropdownRows: DropdownRow[] = useMemo(() => {
    if (isAster) {
      return (asterSymbols ?? []).map(sym => {
        const ticker = asterTickers?.find(t => t.symbol === sym);
        const lev = asterLeverage?.[sym];
        return {
          sym,
          // Real per-symbol max leverage via the signed V3 leverageBracket
          // endpoint (server/lib/aster-auth.js) — varies a lot by symbol
          // (200x for majors, as low as 2-5x for small caps), so don't guess.
          lev: lev ? lev + 'x' : '—',
          price: ticker?.lastPrice ? fmtAster(ticker.lastPrice) : '—',
          chgPct: ticker ? ticker.priceChangePercent : null,
          fund8h: asterFunding?.[sym] ?? null,
          vol: ticker?.quoteVolume ?? null,
          oi: asterOI?.[sym] ?? null,
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
  }, [isAster, asterSymbols, asterTickers, asterFunding, asterOI, asterLeverage, hlTickers, livePrices]);

  // ── Actions ────────────────────────────────────────────────────
  function changeMode(next: TradeMode) {
    if (next === mode) return;
    setMode(next);
    setMarket('BTC');
    setLeverage(l => Math.min(l, next === 'aster' ? 200 : 50));
    setSubmitError(null);
  }

  function selectMarket(sym: string) {
    setMarket(sym);
    setSubmitError(null);
  }

  async function submitTrade() {
    if (!address) {
      await connect();
      return;
    }

    const sizeNum = parseFloat(size);
    if (!sizeNum || sizeNum <= 0) { flashError('Enter a size'); return; }

    setSubmitting(true);
    try {
      if (isAster) {
        // Aster trading via shared agent (backend-signed, user identity in `user` param)
        const px = livePrice ?? 0;
        if (!px) { flashError('Cannot fetch price'); setSubmitting(false); return; }
        const coinSize = sizeNum; // size input is already in coins for Aster
        const result = await asterPlaceOrder({
          symbol: market,
          size: coinSize,
          price: 0,
          isLong: isBuy,
          isMarket: true,
          userAddress: address,
        });
        if (result.status === 'ok') {
          showToast(`${isBuy ? 'Long' : 'Short'} ${market} opened`, 'ok');
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['aster', 'positions', address] });
            queryClient.invalidateQueries({ queryKey: ['aster', 'balance', address] });
          }, 2000);
        } else {
          flashError(result.response ?? 'Order failed');
        }
      } else {
        // Hyperliquid trading (client-signed)
        const provider = getEVMProvider();
        if (!provider) { flashError('No wallet found'); setSubmitting(false); return; }
        const { ethers } = await import('ethers');
        const signer = await new ethers.BrowserProvider(provider as never).getSigner();
        const px = livePrice ?? 0;
        const result = await openPosition({ symbol: market, sizeDollars: sizeNum * px, leverage, isLong: isBuy, signer, network });
        if (result.status === 'ok') {
          showToast(`${isBuy ? 'Long' : 'Short'} ${market} opened`, 'ok');
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ['hl', 'positions', address, network] }), 2000);
        } else {
          flashError(result.response ?? 'Order failed');
        }
      }
    } catch (e) {
      flashError(e instanceof Error ? e.message : 'Transaction failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClosePosition(index: number) {
    if (!address) return;
    const p = positions[index];
    if (!p) return;

    try {
      if (isAster) {
        const result = await asterClosePosition({
          symbol: p.symbol,
          size: p.size,
          isLong: p.isLong,
          userAddress: address,
        });
        if (result.status === 'ok') {
          showToast('Position closed', 'ok');
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['aster', 'positions', address] });
            queryClient.invalidateQueries({ queryKey: ['aster', 'balance', address] });
          }, 2000);
        } else {
          showToast(result.response ?? 'Close failed', 'err');
        }
      } else {
        const provider = getEVMProvider();
        if (!provider) return;
        const { ethers } = await import('ethers');
        const signer = await new ethers.BrowserProvider(provider as never).getSigner();
        const result = await closePosition({ symbol: p.symbol, size: p.size, isLong: p.isLong, signer, network });
        if (result.status === 'ok') {
          showToast('Position closed', 'ok');
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ['hl', 'positions', address, network] }), 2000);
        } else {
          showToast(result.response ?? 'Close failed', 'err');
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Close failed', 'err');
    }
  }

  async function handleCancelOrder(oid: number, symbol: string) {
    if (!address) return;

    try {
      if (isAster) {
        const result = await asterCancelOrder({ oid, symbol, userAddress: address });
        if (result.status === 'ok') {
          showToast('Order cancelled', 'ok');
          queryClient.invalidateQueries({ queryKey: ['aster', 'openOrders', address] });
        } else {
          showToast(result.response ?? 'Cancel failed', 'err');
        }
      } else {
        const provider = getEVMProvider();
        if (!provider) return;
        const { ethers } = await import('ethers');
        const signer = await new ethers.BrowserProvider(provider as never).getSigner();
        const result = await cancelOrder({ oid, symbol, signer, network });
        if (result.status === 'ok') {
          showToast('Order cancelled', 'ok');
          queryClient.invalidateQueries({ queryKey: ['hl', 'openOrders', address, network] });
        } else {
          showToast(result.response ?? 'Cancel failed', 'err');
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Cancel failed', 'err');
    }
  }

  function flashError(msg: string) {
    setSubmitError(msg);
    setTimeout(() => setSubmitError(null), 5000);
  }

  return (
    <>
      <div id="app">
        <Header
          mode={mode}
          market={market}
          stats={headerStats}
          balance={balance}
          dropdownRows={dropdownRows}
          onModeChange={changeMode}
          onSelectMarket={selectMarket}
          onOpenDeposit={() => setDepositOpen(true)}
          network={network}
          onNetworkChange={onNetworkChange}
        />

        {/* ══ WORKSPACE ══ */}
        <div className="workspace">
          <XTracker market={market} />
          <ChartColumn
            mode={mode}
            market={market}
            intervalMinutes={intervalMinutes}
            candles={candles}
            livePrice={livePrice}
            onIntervalChange={setIntervalMinutes}
          />
          <TradesColumn mode={mode} market={market} trades={trades} asterTrades={asterTrades} />
          <TradePanel
            mode={mode}
            market={market}
            isBuy={isBuy}
            size={size}
            leverage={leverage}
            livePrice={livePrice}
            balance={balance}
            currentPositionSize={currentPosition ? currentPosition.size : null}
            totalUnrealizedPnl={totalUnrealizedPnl}
            submitting={submitting}
            error={submitError}
            book={book}
            onSideChange={setIsBuy}
            onSizeChange={setSize}
            onLeverageChange={setLeverage}
            onSubmit={submitTrade}
          />
        </div>

        <BottomPanelShell>
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
        </BottomPanelShell>

        <StatusBar status={status} />
      </div>

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
    </>
  );
}
