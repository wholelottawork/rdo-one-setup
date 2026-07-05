'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWallet, getEVMProvider } from '@/lib/wallet';
import { useToast } from '@/lib/toast';
import { HLSocketProvider, useHLSocket, useHLBookStream, type Trade } from '@/lib/hl-socket';
import {
  useHLMeta, useHLTickers, useHLCandles, useHLBalance, useHLPositions,
  useHLFills, useHLOpenOrders, useHLFunding,
} from '@/lib/hl-hooks';
import { useAsterTickers, useAsterFunding, useAsterCandles, useAsterBook, useAsterOpenInterest } from '@/lib/aster-hooks';
import { openPosition, closePosition, cancelOrder, getL2Book, type OrderBook } from '@/lib/hyperliquid';
import { HL_MARKETS, ASTER_MARKETS, fmtPrice, fmtAster, fmtLarge, type TradeMode } from '@/lib/markets';
import { Header, type DropdownRow, type HeaderStats } from './_components/Header';
import { XTracker } from './_components/XTracker';
import { ChartColumn } from './_components/ChartColumn';
import { TradesColumn } from './_components/TradesColumn';
import { TradePanel } from './_components/TradePanel';
import { BottomPanel } from './_components/BottomPanel';
import { StatusBar } from './_components/StatusBar';
import { DepositModal } from './_components/DepositModal';

// Same symbol set the original startPriceStream subscribed to
const STREAM_SYMBOLS = HL_MARKETS.slice(0, 20);

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
    <HLSocketProvider symbols={STREAM_SYMBOLS}>
      <Terminal />
    </HLSocketProvider>
  );
}

function Terminal() {
  const [mode, setMode] = useState<TradeMode>('hl');
  const [market, setMarket] = useState('BTC');
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
  const { data: hlMeta } = useHLMeta();
  const { data: hlTickers } = useHLTickers();
  const { data: hlCandles } = useHLCandles(market, intervalMinutes);
  const { data: asterTickers } = useAsterTickers();
  const { data: asterFunding } = useAsterFunding();
  const { data: asterCandles } = useAsterCandles(market, intervalMinutes);
  const { data: asterBook } = useAsterBook(market, isAster);

  const asterPrices = useMemo(() => {
    const out: Record<string, number> = {};
    asterTickers?.forEach(t => { if (t.lastPrice > 0) out[t.symbol] = t.lastPrice; });
    return out;
  }, [asterTickers]);

  const { data: asterOI } = useAsterOpenInterest(ASTER_MARKETS, asterPrices, isAster);

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
    getL2Book(market).then(book => { if (!stale) setHlBook(book); });
    return () => { stale = true; };
  }, [market, isAster]);
  const onHLBook = useCallback((book: OrderBook) => setHlBook(book), []);
  useHLBookStream(isAster ? '' : market, onHLBook);
  const book = isAster ? (asterBook ?? { asks: [], bids: [] }) : hlBook;

  // Trades feed (HL only, current market)
  useEffect(() => setTrades([]), [market, mode]);
  const onTrade = useCallback((trade: Trade) => setTrades(prev => [trade, ...prev].slice(0, 80)), []);
  useEffect(() => {
    if (isAster) return;
    return subscribeTrades(market, onTrade);
  }, [isAster, market, onTrade, subscribeTrades]);

  // ── Wallet-gated account data ──────────────────────────────────
  const { data: balance = 0 } = useHLBalance(address);
  const { data: positions = [] } = useHLPositions(address);
  const { data: fills = [] } = useHLFills(address, true);
  const { data: openOrders = [] } = useHLOpenOrders(address, true);
  const { data: fundingHistory = [] } = useHLFunding(address, true);

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
  const dropdownRows: DropdownRow[] = useMemo(() => {
    if (isAster) {
      return ASTER_MARKETS.map(sym => {
        const ticker = asterTickers?.find(t => t.symbol === sym);
        return {
          sym,
          lev: '200x',
          price: ticker?.lastPrice ? fmtAster(ticker.lastPrice) : '—',
          chgPct: ticker ? ticker.priceChangePercent : null,
          fund8h: asterFunding?.[sym] ?? null,
          vol: ticker?.quoteVolume ?? null,
          oi: asterOI?.[sym] ?? null,
        };
      });
    }
    return HL_MARKETS.map(sym => {
      const s = hlTickers?.[sym];
      const px = livePrices[sym];
      return {
        sym,
        lev: s?.lev ? s.lev + 'x' : '',
        price: px ? fmtPrice(px) : '—',
        chgPct: s?.chgPct ?? null,
        fund8h: s?.fund8h ?? null,
        vol: s?.vol ?? null,
        oi: s?.oi ?? null,
      };
    });
  }, [isAster, asterTickers, asterFunding, asterOI, hlTickers, livePrices]);

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
      // original: clicking Connect on the trade button starts wallet connect
      await connect();
      return;
    }

    const sizeNum = parseFloat(size);
    if (!sizeNum || sizeNum <= 0) { flashError('Enter a size'); return; }
    const provider = getEVMProvider();
    if (!provider) { flashError('No wallet found'); return; }

    setSubmitting(true);
    try {
      const { ethers } = await import('ethers');
      const signer = await new ethers.BrowserProvider(provider as never).getSigner();
      const px = livePrice ?? 0;
      const result = await openPosition({ symbol: market, sizeDollars: sizeNum * px, leverage, isLong: isBuy, signer });
      if (result.status === 'ok') {
        showToast(`${isBuy ? 'Long' : 'Short'} ${market} opened`, 'ok');
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ['hl', 'positions', address] }), 2000);
      } else {
        flashError(result.response ?? 'Order failed');
      }
    } catch (e) {
      flashError(e instanceof Error ? e.message : 'Transaction failed');
    } finally {
      setSubmitting(false);
    }
  }

  // showErr() — message hides after 5s like the original
  function flashError(msg: string) {
    setSubmitError(msg);
    setTimeout(() => setSubmitError(null), 5000);
  }

  async function handleClosePosition(index: number) {
    if (!address) return;
    const p = positions[index];
    if (!p) return;
    const provider = getEVMProvider();
    if (!provider) return;
    try {
      const { ethers } = await import('ethers');
      const signer = await new ethers.BrowserProvider(provider as never).getSigner();
      const result = await closePosition({ symbol: p.symbol, size: p.size, isLong: p.isLong, signer });
      if (result.status === 'ok') {
        showToast('Position closed', 'ok');
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ['hl', 'positions', address] }), 2000);
      } else {
        showToast(result.response ?? 'Close failed', 'err');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Close failed', 'err');
    }
  }

  async function handleCancelOrder(oid: number, symbol: string) {
    if (!address) return;
    const provider = getEVMProvider();
    if (!provider) return;
    try {
      const { ethers } = await import('ethers');
      const signer = await new ethers.BrowserProvider(provider as never).getSigner();
      const result = await cancelOrder({ oid, symbol, signer });
      if (result.status === 'ok') {
        showToast('Order cancelled', 'ok');
        queryClient.invalidateQueries({ queryKey: ['hl', 'openOrders', address] });
      } else {
        showToast(result.response ?? 'Cancel failed', 'err');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Cancel failed', 'err');
    }
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
          <TradesColumn mode={mode} market={market} trades={trades} />
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

        <BottomPanel
          mode={mode}
          address={address}
          positions={positions}
          fills={fills}
          openOrders={openOrders}
          funding={fundingHistory}
          livePrices={livePrices}
          onClosePosition={handleClosePosition}
          onCancelOrder={handleCancelOrder}
          onTabData={() => {}}
        />

        <StatusBar status={status} />
      </div>

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
    </>
  );
}
