"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@/lib/wallet";
import { cachedFetch } from "@/lib/query";
import { fmt, fmtSz, fmtLarge, fmtAster, ivLabel, countdown, asterRound } from "@/lib/format";
import { createAsterUserStreamSync } from "./trade/asterUserStreamSync";
import { createBottomTabs } from "./trade/bottomTabs";
import { createOrderFlow } from "./trade/orderFlow";
import { createMarketList } from "./trade/marketList";
import { createMarketFeed } from "./trade/marketFeed";
import { TradeHeader } from "./trade/TradeHeader";
import { XTrackerPanel } from "./trade/XTrackerPanel";
import { ChartPanel } from "./trade/ChartPanel";
import { TradesPanel } from "./trade/TradesPanel";
import { OrderPanel } from "./trade/OrderPanel";
import { BottomPanel } from "./trade/BottomPanel";
import { TradeModals } from "./trade/TradeModals";
import { FloatingOrderBook } from "./trade/FloatingOrderBook";

export default function TradingTerminal() {
  // Wallet connect/disconnect now lives in the shared nav (SiteNav /
  // lib/wallet's WalletProvider) — no more terminal-local wallet
  // modal or module-singleton. Bridged into the vanilla-DOM effect below
  // via refs, same pattern as the portfolio/transfer page retrofits.
  const { evmAddress, connect } = useWallet();
  const evmAddressRef = useRef(evmAddress);
  evmAddressRef.current = evmAddress;
  const connectRef = useRef(connect);
  connectRef.current = connect;
  const onEvmConnectedRef = useRef<((addr: string) => void) | null>(null);
  const onEvmDisconnectedRef = useRef<(() => void) | null>(null);
  const didInitRef = useRef(false);

  useEffect(() => {
    if (evmAddress) onEvmConnectedRef.current?.(evmAddress);
    else onEvmDisconnectedRef.current?.();
  }, [evmAddress]);

  useEffect(() => {
    // React StrictMode double-invokes effects in dev, and this effect binds
    // DOM listeners / opens the price-stream websocket imperatively with no
    // cleanup — so without a guard every handler binds twice. That silently
    // breaks *toggle* handlers (e.g. the market-symbol dropdown button, which
    // does "if hidden open else close": two listeners fire per click, opening
    // then immediately re-closing it) and opens duplicate websockets. Run once.
    if (didInitRef.current) return;
    didInitRef.current = true;
    // Dynamically import all modules after mount (browser-only)
    async function init() {
      const { showToast } = await import("@/lib/toast");
      const {
        loadAccountState,
        getPositions,
        getMarketPrice,
        getCandles,
        openPosition,
        closePosition,
        cancelOrder,
        modifyTriggerOrder,
        placeTpslOrders,
        startPriceStream,
        getMetaAndAssetCtxs,
        getUserFills,
        getOpenOrders,
        getFundingHistory,
        getL2Book,
        startBookStream,
      } = await import("@/lib/trading");
      const { initChart, setCandles, pushTick } = await import("@/lib/chart");
      const { t, applyTranslations } = await import("@/lib/i18n");

      // Shim matching the old lib/wallet.ts module-singleton's synchronous
      // getter shape — keeps every getEVMAddress() call site below
      // unchanged, now backed by the shared Context via evmAddressRef.
      function getEVMAddress() {
        return evmAddressRef.current;
      }

      let currentMode = "hl";
      let currentMarket = "BTC";
      let currentIv = 1;
      let livePrices: Record<string, number> = {};
      let metaCtxs: Record<string, any> = {};
      let marketLev: Record<string, number> = {};
      let asterLev: Record<string, number> = {};
      // Per-symbol order grid from exchangeInfo (LOT_SIZE step / PRICE_FILTER
      // tick / minQty) — Aster rejects off-grid orders with -1111.
      let asterPrec: Record<
        string,
        { step: number; tick: number; minQty: number }
      > = {};
      const asterStats: Record<string, any> = {};
      const hlStats: Record<string, any> = {};

      // Market lists + dropdown + per-venue poll loops live in
      // trade/marketList.ts — the stat maps are shared by reference
      // (never reassigned here), scalars via getters.
      const marketList = createMarketList({
        getMode: () => currentMode,
        getMarket: () => currentMarket,
        livePrices,
        asterStats,
        hlStats,
        marketLev,
        asterLev,
        asterPrec,
        t,
        onSelectMarket: selectMarket,
        onAsterTicker: updateAsterHeaderStats,
        syncLevMax,
      });

      // Book/trade feeds + symbol switching (candles, depth stream,
      // live-trades socket) live in trade/marketFeed.ts.
      const marketFeed = createMarketFeed({
        getMode: () => currentMode,
        getMarket: () => currentMarket,
        getIv: () => currentIv,
        getCandles,
        setCandles,
        getL2Book,
        startBookStream,
        syncLevMax,
        updateHeaderStats,
      });

      // Trade panel + order placement + positions refresh live in
      // trade/orderFlow.ts (real-money paths, moved verbatim).
      const orderFlow = createOrderFlow({
        getMode: () => currentMode,
        getMarket: () => currentMarket,
        getAddr: getEVMAddress,
        livePrices,
        asterPrec,
        connectWallet: connectWalletFn,
        getMarketPrice,
        openPosition,
        closePosition,
        cancelOrder,
        modifyTriggerOrder,
        placeTpslOrders,
        loadAccountState,
        getPositions,
        getOpenOrders,
      });

      // ── mode switch ────────────────────────────────────────────
      async function switchMode(mode: string) {
        if (mode === currentMode) return;
        currentMode = mode;
        const hlBtn = document.getElementById("modeBtnHL");
        const asterBtn = document.getElementById("modeBtnAster");
        if (mode === "aster") {
          hlBtn?.classList.remove("active");
          asterBtn?.classList.add("active");
          document.body.classList.add("mode-aster");
          const levInput = document.getElementById(
            "levInput",
          ) as HTMLInputElement;
          if (levInput) {
            levInput.max = "200";
            levInput.value = String(Math.min(parseInt(levInput.value), 200));
          }
          const feeEl = document.getElementById("stFee");
          if (feeEl) feeEl.textContent = "0.0400% Taker / 0.0000% Maker";
          currentMarket = "BTC";
          const mktSym = document.getElementById("mktSymbol");
          if (mktSym) mktSym.textContent = "BTC-USDT";
          const sUnit = document.getElementById("sizeUnit");
          if (sUnit) sUnit.textContent = "BTC";
          marketFeed.resetTrades();
          marketList.rebuildDropdown();
          await marketFeed.loadMarket(currentMarket);
          marketList.fetchAsterLeverage();
          marketList.fetchAsterMarkets();
          marketList.fetchAsterMids();
          marketList.fetchAsterFunding();
          marketList.fetchAsterOI();
        } else {
          asterBtn?.classList.remove("active");
          hlBtn?.classList.add("active");
          document.body.classList.remove("mode-aster");
          const levInput = document.getElementById(
            "levInput",
          ) as HTMLInputElement;
          if (levInput) {
            levInput.max = "50";
            levInput.value = String(Math.min(parseInt(levInput.value), 50));
          }
          const feeEl = document.getElementById("stFee");
          if (feeEl) feeEl.textContent = "0.0450% / 0.0150%";
          currentMarket = "BTC";
          const mktSym = document.getElementById("mktSymbol");
          if (mktSym) mktSym.textContent = "BTC-USDC";
          const sUnit = document.getElementById("sizeUnit");
          if (sUnit) sUnit.textContent = "BTC";
          marketList.rebuildDropdown();
          await marketFeed.loadMarket(currentMarket);
          loadMeta();
        }
        const cl = document.getElementById("chartLabel");
        if (cl)
          cl.textContent = `${currentMarket}${mode === "aster" ? "USDT" : "USD"} · ${ivLabel(currentIv)} · RDO ONE`;
        orderFlow.updateTradeBtn();
        // Reload the positions table + balances for the newly-selected venue
        // (HL vs Aster) — refreshPositions branches on currentMode.
        if (evmAddressRef.current) orderFlow.refreshPositions(evmAddressRef.current);
        syncAsterUserStream();
      }

      function updateAsterHeaderStats(ticker: any) {
        const px = parseFloat(ticker.lastPrice ?? 0);
        const open = parseFloat(ticker.openPrice ?? px);
        const chg = px - open;
        const pct = open ? (chg / open) * 100 : 0;
        const vol = parseFloat(ticker.quoteVolume ?? 0);
        const sm = document.getElementById("statMark");
        if (sm) sm.textContent = fmtAster(px, currentMarket);
        const chgEl = document.getElementById("statChange");
        if (chgEl) {
          chgEl.textContent = `${chg >= 0 ? "+" : ""}${fmtAster(chg, currentMarket)} / ${chg >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
          chgEl.className = "hdr-stat-val " + (chg >= 0 ? "up" : "down");
        }
        const sv = document.getElementById("statVolume");
        if (sv) sv.textContent = "$" + fmtLarge(vol);
        const sf = document.getElementById("statFunding");
        if (sf) sf.textContent = "— / —";
      }

      // ── market data ────────────────────────────────────────────
      async function loadMeta() {
        const data = await getMetaAndAssetCtxs();
        if (!data) return;
        data.forEach((ctx: any, sym: string) => {
          metaCtxs[sym] = ctx;
          marketLev[sym] = ctx.maxLeverage;
        });
        marketList.setMarkets(
          "hl",
          [...data.keys()].sort(
            (a, b) =>
              (metaCtxs[b].dayNtlVlm ?? 0) - (metaCtxs[a].dayNtlVlm ?? 0),
          ),
        );
        updateHeaderStats();
        syncLevMax(currentMarket);
      }

      // Max leverage is per-asset (BTC caps at 40x on HL; Aster brackets
      // vary by symbol) — keep the input's ceiling in sync with the
      // selected market instead of the flat mode defaults.
      function syncLevMax(sym: string) {
        const maxL = currentMode === "aster" ? asterLev[sym] : marketLev[sym];
        const levEl = document.getElementById("levInput") as HTMLInputElement;
        if (!maxL || !levEl) return;
        levEl.max = String(maxL);
        if (parseInt(levEl.value) > maxL) {
          levEl.value = String(maxL);
          orderFlow.updateStats();
        }
      }

      function updateHeaderStats() {
        const ctx = metaCtxs[currentMarket];
        if (!ctx) return;
        const px = livePrices[currentMarket] ?? 0;
        const open = ctx.prevDayPx ?? px;
        const chg = px - open;
        const pct = open ? (chg / open) * 100 : 0;
        const sm = document.getElementById("statMark");
        if (sm) sm.textContent = fmt(px, currentMarket);
        const chgEl = document.getElementById("statChange");
        if (chgEl) {
          chgEl.textContent = `${chg >= 0 ? "+" : ""}${fmt(chg, currentMarket)} / ${chg >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
          chgEl.className = "hdr-stat-val " + (chg >= 0 ? "up" : "down");
        }
        const sv = document.getElementById("statVolume");
        if (sv) sv.textContent = "$" + fmtLarge(ctx.dayNtlVlm ?? 0);
        const sf = document.getElementById("statFunding");
        if (sf)
          sf.textContent =
            (ctx.funding * 100).toFixed(4) + "% / " + countdown();
      }

      async function selectMarket(sym: string) {
        currentMarket = sym;
        const suffix = currentMode === "aster" ? "-USDT" : "-USDC";
        const chartSuffix = currentMode === "aster" ? "USDT" : "USD";
        const mktSym = document.getElementById("mktSymbol");
        if (mktSym) mktSym.textContent = sym + suffix;
        const cl = document.getElementById("chartLabel");
        if (cl)
          cl.textContent = `${sym}${chartSuffix} · ${ivLabel(currentIv)} · RDO ONE`;
        const su = document.getElementById("sizeUnit");
        if (su) su.textContent = sym;
        orderFlow.updateTradeBtn();
        await marketFeed.loadMarket(sym);
      }

      // ── intervals ──────────────────────────────────────────────
      function bindIntervals() {
        document.querySelectorAll(".iv-btn").forEach((btn) => {
          btn.addEventListener("click", async () => {
            document
              .querySelectorAll(".iv-btn")
              .forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            currentIv = parseInt((btn as HTMLElement).dataset.iv!);
            const suffix = currentMode === "aster" ? "USDT" : "USD";
            const cl = document.getElementById("chartLabel");
            if (cl)
              cl.textContent = `${currentMarket}${suffix} · ${ivLabel(currentIv)} · RDO ONE`;
            if (currentMode === "aster") {
              setCandles(
                await marketFeed.getAsterCandles(currentMarket, currentIv, 200),
                currentMarket,
              );
            } else {
              setCandles(
                await getCandles(currentMarket, currentIv, 200),
                currentMarket,
              );
            }
          });
        });
      }

      // ── price stream ───────────────────────────────────────────
      function onPrice(sym: string, price: number) {
        livePrices[sym] = price;
        const el = document.getElementById(`mprice-${sym}`);
        if (el) el.textContent = fmt(price, sym);
        if (sym === currentMarket) {
          pushTick(sym, price);
          updateHeaderStats();
          orderFlow.updateStats();
        }
      }

      function onTrade(sym: string, trade: any) {
        // The HL trade websocket keeps running in EXTRA mode; ignore its trades
        // there so they don't mix into the Aster live-trades list.
        if (currentMode !== "hl") return;
        if (sym !== currentMarket) return;
        marketFeed.pushTrade(trade);
      }

      // ── trade panel ────────────────────────────────────────────
      async function connectWalletFn() {
        await connectRef.current();
      }

      // ── Aster user-data stream ────────────────────────────────
      // Syncs the EXTRA account's push stream with mode/wallet state;
      // see trade/asterUserStreamSync.ts for the extracted controller.
      const { sync: syncAsterUserStream } = createAsterUserStreamSync({
        getMode: () => currentMode,
        getAddr: () => evmAddressRef.current,
        refreshPositions: orderFlow.refreshPositions,
      });

      // Fires whenever evmAddress goes from unset to set — covers both
      // "clicked Connect on this page" and "already connected via the nav
      // on a different page, then navigated here." positionsPollStarted
      // guards against starting a duplicate polling interval if this fires
      // more than once (e.g. React StrictMode's double-invoke in dev).
      let positionsPollStarted = false;
      async function onEvmConnected(addr: string) {
        // WalletDropdown (React-driven, off useWallet() directly) now owns
        // the header wallet button's display — no imperative DOM update
        // needed here for it anymore.
        const btn = document.getElementById("tradeBtn");
        if (btn) {
          btn.textContent =
            (orderFlow.getIsBuy() ? "Buy / Long " : "Sell / Short ") + currentMarket;
          btn.className =
            "tp-action-btn " + (orderFlow.getIsBuy() ? "tp-buy-bg" : "tp-sell-bg");
        }
        await orderFlow.refreshPositions(addr);
        syncAsterUserStream();
        if (!positionsPollStarted) {
          positionsPollStarted = true;
          setInterval(() => {
            if (evmAddressRef.current) orderFlow.refreshPositions(evmAddressRef.current);
          }, 15000);
        }
      }
      onEvmConnectedRef.current = onEvmConnected;
      onEvmDisconnectedRef.current = syncAsterUserStream;
      // If the wallet was already connected before this async init finished,
      // the [evmAddress] effect fired while onEvmConnectedRef was still null,
      // so the initial positions/balance load was skipped. Trigger it now.
      if (evmAddressRef.current) onEvmConnected(evmAddressRef.current);

      // ── clock ──────────────────────────────────────────────────
      function startClock() {
        const clockEl = document.getElementById("clockEl");
        const tick = () => {
          if (clockEl)
            clockEl.textContent =
              new Date().toUTCString().slice(5, 25) + " UTC";
          if (currentMode === "hl") {
            const ctx = metaCtxs[currentMarket];
            const sf = document.getElementById("statFunding");
            if (ctx && sf)
              sf.textContent =
                (ctx.funding * 100).toFixed(4) + "% / " + countdown();
          }
        };
        tick();
        setInterval(tick, 1000);
      }

      // ── language ───────────────────────────────────────────────
      // The picker itself is now the shared WalletControls component
      // (React-driven, off lib/i18n directly) — this just keeps this
      // page's own non-data-i18n content in sync: the market list's
      // column headers are baked into innerHTML strings at render time
      // (see renderMarketList), so applyTranslations()'s generic
      // [data-i18n] re-scan can't reach them — they need an explicit
      // re-render, same as the vanilla lang picker used to trigger.
      function initLang() {
        applyTranslations();
        window.addEventListener("rdo:langchange", () => {
          marketList.rebuildDropdown();
        });
      }

      // ── resize handles ─────────────────────────────────────────
      function initXtResize() {
        const handle = document.getElementById("xtResizeHandle");
        if (!handle) return;
        const root = document.documentElement;
        const MIN = 120,
          MAX = 520;
        let dragging = false,
          startX = 0,
          startW = 0;
        handle.addEventListener("mousedown", (e) => {
          dragging = true;
          startX = e.clientX;
          startW =
            parseInt(getComputedStyle(root).getPropertyValue("--xt")) || 240;
          handle.classList.add("dragging");
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
          e.preventDefault();
        });
        document.addEventListener("mousemove", (e) => {
          if (!dragging) return;
          const w = Math.min(MAX, Math.max(MIN, startW + (e.clientX - startX)));
          root.style.setProperty("--xt", w + "px");
        });
        document.addEventListener("mouseup", () => {
          if (!dragging) return;
          dragging = false;
          handle.classList.remove("dragging");
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        });
      }

      function initBtmResize() {
        const handle = document.getElementById("btmResizeHandle");
        if (!handle) return;
        const root = document.documentElement;
        const MIN = 60,
          MAX = 480;
        let dragging = false,
          startY = 0,
          startH = 0;
        handle.addEventListener("mousedown", (e) => {
          dragging = true;
          startY = e.clientY;
          startH =
            parseInt(getComputedStyle(root).getPropertyValue("--btm")) || 175;
          handle.classList.add("dragging");
          document.body.style.cursor = "ns-resize";
          document.body.style.userSelect = "none";
          e.preventDefault();
        });
        document.addEventListener("mousemove", (e) => {
          if (!dragging) return;
          const h = Math.min(MAX, Math.max(MIN, startH + (startY - e.clientY)));
          root.style.setProperty("--btm", h + "px");
        });
        document.addEventListener("mouseup", () => {
          if (!dragging) return;
          dragging = false;
          handle.classList.remove("dragging");
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        });
      }

      // ── floating order book drag ───────────────────────────────
      function initObFloat() {
        const fl = document.getElementById("obFloat");
        const hdr = document.getElementById("obFloatHdr");
        if (!fl || !hdr) return;
        let mx = 0,
          my = 0;
        (window as any).toggleObFloat = function () {
          if (fl.style.display === "none") {
            fl.style.display = "flex";
            if (!fl.dataset.placed) {
              fl.style.right = "340px";
              fl.style.top = "52px";
              fl.dataset.placed = "1";
            }
          } else {
            fl.style.display = "none";
          }
        };
        hdr.addEventListener("mousedown", function (e) {
          if ((e.target as HTMLElement).classList.contains("ob-float-close"))
            return;
          mx = e.clientX;
          my = e.clientY;
          const r = fl.getBoundingClientRect();
          fl.style.left = r.left + "px";
          fl.style.top = r.top + "px";
          fl.style.right = "auto";
          function onMove(e: MouseEvent) {
            const dx = e.clientX - mx,
              dy = e.clientY - my;
            mx = e.clientX;
            my = e.clientY;
            fl.style.left = fl.getBoundingClientRect().left + dx + "px";
            fl.style.top = fl.getBoundingClientRect().top + dy + "px";
          }
          function onUp() {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          }
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
          e.preventDefault();
        });
      }

      // ── liq map ────────────────────────────────────────────────
      function initLiqMap() {
        const FUT_SYMS = ["BTC", "ETH", "SOL"];
        let lmpSym = "BTC";
        let lmpTab = "liqmap";
        let lmpData: any = null;
        let lmpTimer: any = null;

        function fmtPx(n: number) {
          if (!isFinite(n) || n == null) return "—";
          if (n >= 10000)
            return (
              "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 })
            );
          if (n >= 1000)
            return (
              "$" +
              n.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            );
          if (n >= 1) return "$" + n.toFixed(4);
          return "$" + n.toFixed(6);
        }
        function fmtM(n: number) {
          if (!isFinite(n) || n == null) return "—";
          if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
          if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
          return "$" + (n / 1e3).toFixed(1) + "K";
        }

        function updateClosestBars(
          mark: number,
          levels: any[],
          totalOI: number,
          totalW: number,
        ) {
          const el = document.getElementById("lmpClosestBars");
          if (!el) return;
          const abovePrice = levels
            .filter((l) => !l.isLong)
            .sort((a, b) => a.price - b.price);
          const belowPrice = levels
            .filter((l) => l.isLong)
            .sort((a, b) => b.price - a.price);
          const nearShort = abovePrice[0],
            nearLong = belowPrice[0];
          function card(l: any, type: string) {
            const oiUsd = ((totalOI * l.weight) / totalW) * mark;
            const color = type === "short" ? "#ff7caa" : "#7cffc0";
            const dist = ((Math.abs(l.price - mark) / mark) * 100).toFixed(1);
            const reaction =
              type === "short"
                ? `If price reaches <b style="color:#e0e0e0">${fmtPx(l.price)}</b>, ~${fmtM(oiUsd)} in short positions get forcibly closed → cascading buy orders, expect a sharp spike upward.`
                : `If price drops to <b style="color:#e0e0e0">${fmtPx(l.price)}</b>, ~${fmtM(oiUsd)} in long positions get forcibly closed → cascading sell orders, expect a sharp drop.`;
            return `<div style="background:rgba(255,255,255,0.025);border:1px solid var(--hl-border);border-left:2px solid ${color};border-radius:6px;padding:9px 11px;display:flex;flex-direction:column;gap:5px"><div style="display:flex;align-items:center;gap:7px"><span style="display:inline-block;width:9px;height:9px;background:${color};border-radius:2px;flex-shrink:0"></span><span style="font-size:11px;font-weight:700;color:${color}">${fmtPx(l.price)}</span><span style="font-size:10px;color:var(--hl-text-muted);margin-left:auto">${dist}% · ${fmtM(oiUsd)}</span></div><div style="font-size:10px;color:var(--hl-text-secondary);line-height:1.55">${reaction}</div></div>`;
          }
          let html = "";
          if (nearShort) html += card(nearShort, "short");
          if (nearLong) html += card(nearLong, "long");
          if (!html)
            html =
              '<div style="font-size:10px;color:var(--hl-text-muted)">No data available</div>';
          el.innerHTML = html;
        }

        function getSym() {
          const txt = (
            document.getElementById("mktSymbol")?.textContent || "BTC-USDC"
          ).split("-")[0];
          return FUT_SYMS.includes(txt) ? txt : lmpSym;
        }

        async function fetchLmpData(sym: string) {
          const B = "/fapi",
            s = sym + "USDT";
          try {
            const [ticker, oiData, lsRatio, takerRatio, oiHist] =
              await Promise.all([
                fetch(`${B}/fapi/v1/ticker/24hr?symbol=${s}`).then((r) =>
                  r.json(),
                ),
                fetch(`${B}/fapi/v1/openInterest?symbol=${s}`).then((r) =>
                  r.json(),
                ),
                fetch(
                  `${B}/futures/data/globalLongShortAccountRatio?symbol=${s}&period=5m&limit=1`,
                ).then((r) => r.json()),
                fetch(
                  `${B}/futures/data/takerlongshortRatio?symbol=${s}&period=5m&limit=1`,
                ).then((r) => r.json()),
                fetch(
                  `${B}/futures/data/openInterestHist?symbol=${s}&period=5m&limit=12`,
                ).then((r) => r.json()),
              ]);
            return { sym, ticker, oiData, lsRatio, takerRatio, oiHist };
          } catch {
            return null;
          }
        }

        function renderLiqMap(data: any) {
          const body = document.getElementById("lmpBody");
          if (!body) return;
          if (!data) {
            body.innerHTML = '<div class="lmp-loading">No data</div>';
            return;
          }
          const mark = parseFloat(data.ticker.lastPrice) || 0;
          const totalOI = parseFloat(data.oiData.openInterest) || 0;
          const LEVELS = 20,
            RANGE = 0.15;
          const step = (mark * RANGE * 2) / LEVELS;
          const levels: any[] = [];
          for (let i = 0; i < LEVELS; i++) {
            const price = mark * (1 - RANGE) + i * step;
            const d = Math.abs(price - mark) / mark;
            const w =
              Math.exp(-d * 12) + Math.exp(-Math.pow(d - 0.07, 2) * 200) * 0.6;
            levels.push({ price, weight: w, isLong: price < mark });
          }
          const maxW = Math.max(...levels.map((l) => l.weight));
          const totalW = levels.reduce((s, l) => s + l.weight, 0);
          const reversed = [...levels].reverse();
          const markIdx = reversed.findIndex((l) => l.price <= mark);
          let html = "";
          reversed.forEach((l, i) => {
            const pct = ((l.weight / maxW) * 100).toFixed(0);
            const oiUsd = ((totalOI * l.weight) / totalW) * mark;
            const color = l.isLong ? "var(--hl-buy)" : "var(--hl-sell)";
            if (i === markIdx) html += '<div class="lmp-mark-line"></div>';
            html += `<div class="lmp-bar-row"><span class="lmp-price">${fmtPx(l.price)}</span><div class="lmp-bar-wrap"><div class="lmp-bar-fill" style="width:${pct}%;background:${color}"></div></div><span class="lmp-oi-tag">${fmtM(oiUsd)}</span></div>`;
          });
          body.innerHTML = html;
          updateClosestBars(mark, levels, totalOI, totalW);
        }

        function renderOiFlow(data: any) {
          const body = document.getElementById("lmpOiBody");
          if (!body) return;
          if (!data?.oiHist?.length) {
            body.innerHTML = '<div class="lmp-loading">No data</div>';
            return;
          }
          const hist = data.oiHist;
          const px = parseFloat(data.ticker.lastPrice) || 0;
          const rows = [...hist]
            .reverse()
            .map((h: any, i: number, arr: any[]) => {
              const oi = parseFloat(h.sumOpenInterest);
              const prev = arr[i + 1];
              const delta = prev ? oi - parseFloat(prev.sumOpenInterest) : 0;
              const cls = delta >= 0 ? "up" : "dn";
              const time = new Date(h.timestamp).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              });
              return `<div class="lmp-oi-row"><span style="color:var(--hl-text-secondary)">${time}</span><span>${fmtM(oi * px)} <span class="${cls}" style="font-size:10px">${delta >= 0 ? "+" : ""}${fmtM(Math.abs(delta) * px)}</span></span></div>`;
            })
            .join("");
          body.innerHTML = `<div style="font-size:9px;color:var(--hl-text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">OI Flow · 5m</div>${rows}`;
        }

        function renderAI(data: any) {
          const body = document.getElementById("lmpAiBody");
          const verdictEl = document.getElementById("lmpVerdict");
          const verdictVal = document.getElementById("lmpVerdictVal");
          const symLbl = document.getElementById("lmpAiSym");
          if (!body) return;
          if (!data) {
            body.innerHTML = '<div class="lmp-loading">No data</div>';
            return;
          }
          if (symLbl) symLbl.textContent = data.sym;
          const ch24 = parseFloat(data.ticker.priceChangePercent) || 0;
          const ls = data.lsRatio?.[0];
          const lr = ls ? parseFloat(ls.longAccount) : 0.5;
          const sr = ls ? parseFloat(ls.shortAccount) : 0.5;
          const taker = data.takerRatio?.[0];
          const takerBuy = taker
            ? parseFloat(taker.buyVol) / (parseFloat(taker.sellVol) || 1)
            : 1;
          const fr = parseFloat(data.ticker.lastFundingRate || 0) * 100;
          const hist = data.oiHist || [];
          const oiFirst = hist.length ? parseFloat(hist[0].sumOpenInterest) : 0;
          const oiLast = hist.length
            ? parseFloat(hist[hist.length - 1].sumOpenInterest)
            : 0;
          const oiTrend = oiFirst ? ((oiLast - oiFirst) / oiFirst) * 100 : 0;
          const sigs = [
            {
              name: "L/S Ratio",
              bull: lr <= 0.52,
              val: `${(lr * 100).toFixed(1)}%L / ${(sr * 100).toFixed(1)}%S`,
              body:
                lr > 0.52
                  ? "Longs crowded — squeeze risk"
                  : "Shorts heavy — squeeze fuel",
            },
            {
              name: "Taker Flow",
              bull: takerBuy >= 1,
              val: `Buy ${((takerBuy / (1 + takerBuy)) * 100).toFixed(0)}%`,
              body:
                takerBuy >= 1
                  ? "Aggressive buying — bullish"
                  : "Selling into bids — bearish",
            },
            {
              name: "Funding",
              bull: Math.abs(fr) < 0.03,
              val: `${fr >= 0 ? "+" : ""}${fr.toFixed(4)}%`,
              body:
                Math.abs(fr) < 0.03
                  ? "Neutral — no extreme"
                  : fr > 0
                    ? "Longs paying — crowded"
                    : "Shorts paying — bearish",
            },
            {
              name: "OI Trend",
              bull: oiTrend > 0,
              val: `${oiTrend >= 0 ? "+" : ""}${oiTrend.toFixed(2)}%`,
              body:
                oiTrend > 0 ? "Growing — new money in" : "Falling — unwinding",
            },
            {
              name: "24h Price",
              bull: ch24 >= 0,
              val: `${ch24 >= 0 ? "+" : ""}${ch24.toFixed(2)}%`,
              body: ch24 >= 0 ? "Bullish trend bias" : "Bearish trend bias",
            },
          ];
          const bullCount = sigs.filter((s) => s.bull).length;
          const verdict =
            bullCount >= 4
              ? "STRONG BULL"
              : bullCount >= 3
                ? "BULL LEAN"
                : bullCount === 2
                  ? "NEUTRAL"
                  : bullCount === 1
                    ? "BEAR LEAN"
                    : "STRONG BEAR";
          const vc =
            bullCount >= 3
              ? "var(--hl-buy)"
              : bullCount === 2
                ? "var(--hl-text-secondary)"
                : "var(--hl-sell)";
          body.innerHTML = sigs
            .map(
              (s) =>
                `<div class="lmp-ai-sig"><div class="lmp-ai-sig-hdr"><div class="lmp-ai-dot" style="background:${s.bull ? "var(--hl-buy)" : "var(--hl-sell)"}"></div><span class="lmp-ai-name">${s.name}</span><span class="lmp-ai-val" style="color:${s.bull ? "var(--hl-buy)" : "var(--hl-sell)"}">${s.val}</span></div><div class="lmp-ai-body-text">${s.body}</div></div>`,
            )
            .join("");
          if (verdictEl) verdictEl.style.display = "flex";
          if (verdictVal) {
            verdictVal.textContent = verdict;
            verdictVal.style.color = vc;
          }
        }

        async function refresh() {
          const data = await fetchLmpData(lmpSym);
          lmpData = data;
          renderLiqMap(data);
          renderOiFlow(data);
          renderAI(data);
        }

        function syncPills() {
          document
            .querySelectorAll(".lmp-sym-pill")
            .forEach((b) =>
              b.classList.toggle(
                "active",
                (b as HTMLElement).dataset.sym === lmpSym,
              ),
            );
        }

        (window as any).lmpOpen = function () {
          lmpSym = getSym();
          syncPills();
          clearInterval(lmpTimer);
          refresh();
          lmpTimer = setInterval(refresh, 30000);
        };

        const pillsEl = document.getElementById("lmpSymPills");
        if (pillsEl) {
          pillsEl.innerHTML = FUT_SYMS.map(
            (s) =>
              `<button class="lmp-sym-pill${s === lmpSym ? " active" : ""}" data-sym="${s}">${s}</button>`,
          ).join("");
          pillsEl.addEventListener("click", (e) => {
            const btn = (e.target as HTMLElement).closest(
              ".lmp-sym-pill",
            ) as HTMLElement;
            if (!btn) return;
            lmpSym = btn.dataset.sym!;
            syncPills();
            refresh();
          });
        }
        document.getElementById("lmpTabs")?.addEventListener("click", (e) => {
          const btn = (e.target as HTMLElement).closest(
            ".lmp-tab",
          ) as HTMLElement;
          if (!btn) return;
          lmpTab = btn.dataset.tab!;
          document
            .querySelectorAll(".lmp-tab")
            .forEach((b) => b.classList.toggle("active", b === btn));
          const lbody = document.getElementById("lmpBody");
          const oibody = document.getElementById("lmpOiBody");
          if (lbody) lbody.style.display = lmpTab === "liqmap" ? "" : "none";
          if (oibody) oibody.style.display = lmpTab === "oi" ? "" : "none";
          if (lmpData) {
            if (lmpTab === "liqmap") renderLiqMap(lmpData);
            else renderOiFlow(lmpData);
          }
        });
      }

      // ── mode help popup ────────────────────────────────────────
      function toggleModeHelp() {
        const popup = document.getElementById("modePopup");
        const backdrop = document.getElementById("modeBackdrop");
        if (!popup) return;
        marketList.closeDropdown();
        const opening = popup.classList.contains("hidden");
        popup.classList.toggle("hidden", !opening);
        if (backdrop) backdrop.classList.toggle("hidden", !opening);
        if (opening) {
          const close = (e: Event) => {
            const target = e.target as HTMLElement;
            if (
              !popup.contains(target) &&
              target.id !== "modeHelpBtn" &&
              target.id !== "modeBackdrop"
            )
              return;
            popup.classList.add("hidden");
            if (backdrop) backdrop.classList.add("hidden");
            document.removeEventListener("click", close);
          };
          setTimeout(() => document.addEventListener("click", close), 0);
        }
      }

      // ── public API ─────────────────────────────────────────────
      (window as any).rdo = {
        connectWallet: connectWalletFn,
        switchMode,
        setSide: orderFlow.setSide,
        updateStats: orderFlow.updateStats,
        onSlider: orderFlow.onSlider,
        submitTrade: orderFlow.submitTrade,
        closePos: orderFlow.closePos,
        cancelOrd: orderFlow.cancelOrd,
        editTrigger: orderFlow.editTrigger,
        addTpsl: orderFlow.addTpsl,
        openDeposit() {
          document.getElementById("depositModal")?.classList.remove("hidden");
        },
        closeDeposit(e?: Event) {
          if (e && e.target !== document.getElementById("depositModal")) return;
          document.getElementById("depositModal")?.classList.add("hidden");
        },
        openOnramp() {
          document.getElementById("onrampModal")?.classList.remove("hidden");
        },
        closeOnramp(e?: Event) {
          if (e && e.target !== document.getElementById("onrampModal")) return;
          document.getElementById("onrampModal")?.classList.add("hidden");
        },
        closeOnrampForce() {
          document.getElementById("onrampModal")?.classList.add("hidden");
        },
        connectX() {
          const btn = document.getElementById(
            "xtConnectBtn",
          ) as HTMLButtonElement;
          if (btn) {
            btn.textContent = "Connected";
            btn.disabled = true;
          }
          const feed = document.getElementById("xtFeed");
          if (feed)
            feed.innerHTML =
              '<div class="xt-empty">X integration coming soon.</div>';
        },
        toggleOrderBook() {
          document.getElementById("obMini")?.classList.toggle("collapsed");
        },
        toggleModeHelp,
      };

      // ── run ────────────────────────────────────────────────────
      await initChart();
      startClock();
      marketList.rebuildDropdown();
      marketList.fetchAllMids();
      bindIntervals();
      createBottomTabs({
        getMode: () => currentMode,
        getAddr: getEVMAddress,
        getUserFills,
        getOpenOrders,
        getFundingHistory,
        refreshPositions: orderFlow.refreshPositions,
      }).bindBtmTabs();
      marketList.bindMarketBtn();
      initLang();
      initXtResize();
      initBtmResize();
      initObFloat();
      initLiqMap();
      await marketFeed.loadMarket("BTC");
      await loadMeta();
      startPriceStream(marketList.getMarkets("hl").slice(0, 20), onPrice, null, onTrade);
    }

    init().catch(console.error);
  }, []);

  return (
    <div id="app">
      <TradeHeader />

      {/* ══ WORKSPACE ════════════════════════════════════════════ */}
      <div className="grid overflow-hidden border-b border-[#1f1f1f]" style={{ gridTemplateColumns: "var(--xt) 1fr var(--tr) var(--tp)" }}>
        <XTrackerPanel />
        <ChartPanel />
        <TradesPanel />
        <OrderPanel />
      </div>

      {/* ══ BOTTOM RESIZE ════════════════════════════════════════ */}
      <div
        className="h-1 bg-[#1f1f1f] cursor-ns-resize flex-shrink-0 relative transition-colors duration-150 hover:bg-[#50d2c1]"
        id="btmResizeHandle"
      ></div>

      <BottomPanel />

      {/* Status bar */}
      <div className="status-bar">
        <span className="ws-dot" id="wsDot"></span>
        <span id="wsStatus" className="ws-status" data-i18n="connecting">
          CONNECTING...
        </span>
        <span className="sb-sep">·</span>
        <span id="clockEl" className="sb-clock">
          —
        </span>
      </div>

      <TradeModals />

      {/* Toast */}
      <div id="toastWrap" className="toast-wrap"></div>

      <FloatingOrderBook />
    </div>
  );
}
