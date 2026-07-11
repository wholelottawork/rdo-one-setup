"use client";

import { useEffect, useRef } from "react";
import { useWallet, getEVMProvider } from "@/lib/wallet";
import { WalletControls } from "./WalletControls";
import { cachedFetch } from "@/lib/query";

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
  const didInitRef = useRef(false);

  useEffect(() => {
    if (evmAddress) onEvmConnectedRef.current?.(evmAddress);
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

      const HL_MARKETS = [
        "BTC",
        "ETH",
        "SOL",
        "BNB",
        "XRP",
        "ADA",
        "AVAX",
        "DOGE",
        "LINK",
        "DOT",
        "UNI",
        "ATOM",
        "LTC",
        "PEPE",
        "WIF",
        "BONK",
        "JUP",
        "ARB",
        "OP",
        "SUI",
        "APT",
        "INJ",
        "SEI",
        "TIA",
        "GMX",
        "PENDLE",
        "BLUR",
        "SHIB",
        "FLOKI",
        "NEAR",
        "FTM",
        "MATIC",
        "SAND",
        "MANA",
        "AXS",
        "ENJ",
        "CHZ",
        "RUNE",
        "LDO",
        "CRV",
        "AAVE",
        "MKR",
        "SNX",
        "COMP",
        "1INCH",
        "IMX",
        "FIL",
        "AR",
      ];
      const ASTER_CRYPTO_MARKETS = [
        "BTC",
        "ETH",
        "SOL",
        "BNB",
        "XRP",
        "DOGE",
        "AVAX",
        "ADA",
        "LINK",
        "DOT",
        "SUI",
        "APT",
        "INJ",
        "ARB",
        "OP",
        "PEPE",
        "WIF",
        "NEAR",
        "ATOM",
        "UNI",
      ];
      const ASTER_MARKETS = [...ASTER_CRYPTO_MARKETS];
      const ASTER_API = "/aster-fapi";
      let currentMode = "hl";
      let currentMarket = "BTC";
      let currentIv = 1;
      let isBuy = true;
      let livePrices: Record<string, number> = {};
      let metaCtxs: Record<string, any> = {};
      let marketLev: Record<string, number> = {};
      let asterLev: Record<string, number> = {};
      let recentTrades: any[] = [];
      let stopBook: any = null;
      let asterTradeWs: WebSocket | null = null;
      const asterStats: Record<string, any> = {};
      const hlStats: Record<string, any> = {};

      // ── helpers ────────────────────────────────────────────────
      function fmt(p: number, sym?: string) {
        if (!p) return "—";
        if (p >= 10000)
          return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
        if (p >= 100)
          return p.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
        if (p >= 1)
          return p.toLocaleString("en-US", {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
          });
        return p.toLocaleString("en-US", {
          minimumFractionDigits: 5,
          maximumFractionDigits: 6,
        });
      }
      function fmtSz(n: number) {
        if (!n) return "0";
        if (n >= 1000)
          return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
        if (n >= 1) return n.toFixed(4);
        return n.toFixed(6);
      }
      function fmtLarge(n: number) {
        if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
        if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
        if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
        return n.toFixed(2);
      }
      function fmtAster(n: number, sym?: string) {
        if (isNaN(n) || n === 0) return "—";
        if (n >= 1000)
          return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
        if (n >= 1) return n.toFixed(2);
        return n.toPrecision(4);
      }
      function ivLabel(iv: number) {
        if (iv < 60) return iv + "m";
        if (iv < 1440) return iv / 60 + "h";
        return "1D";
      }
      function countdown() {
        const now = new Date();
        const next = new Date(now);
        next.setUTCHours(Math.ceil((now.getUTCHours() + 1) / 8) * 8, 0, 0, 0);
        if (next <= now) next.setUTCHours(next.getUTCHours() + 8);
        const diff = +next - +now;
        const h = Math.floor(diff / 3600000)
          .toString()
          .padStart(2, "0");
        const m = Math.floor((diff % 3600000) / 60000)
          .toString()
          .padStart(2, "0");
        const s = Math.floor((diff % 60000) / 1000)
          .toString()
          .padStart(2, "0");
        return `${h}:${m}:${s}`;
      }

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
          recentTrades = [];
          const tl = document.getElementById("tradesList");
          if (tl)
            tl.innerHTML =
              '<div style="color:var(--hl-text-muted);font-size:11px;padding:8px;text-align:center">Connecting to live trades…</div>';
          rebuildDropdown();
          await loadMarket(currentMarket);
          fetchAsterLeverage();
          fetchAsterMids();
          fetchAsterFunding();
          fetchAsterOI();
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
          rebuildDropdown();
          await loadMarket(currentMarket);
          loadMeta();
        }
        const cl = document.getElementById("chartLabel");
        if (cl)
          cl.textContent = `${currentMarket}${mode === "aster" ? "USDT" : "USD"} · ${ivLabel(currentIv)} · RDO ONE`;
        updateTradeBtn();
        // Reload the positions table + balances for the newly-selected venue
        // (HL vs Aster) — refreshPositions branches on currentMode.
        if (evmAddressRef.current) refreshPositions(evmAddressRef.current);
      }

      function rebuildDropdown() {
        const markets = currentMode === "aster" ? ASTER_MARKETS : HL_MARKETS;
        const list = document.getElementById("mktList");
        if (list) renderMarketList(markets, list);
      }

      // Real per-symbol max leverage from Aster's (signed) leverageBracket
      // endpoint — NOT a flat 200x. brackets[0] is the highest-leverage tier,
      // so its initialLeverage is the "up to Nx" headline (200x for BTC/ETH,
      // but as low as 5x for smaller caps). Static data, so fetch once.
      async function fetchAsterLeverage() {
        if (Object.keys(asterLev).length) return;
        try {
          // Static per-symbol brackets — cache 10 min so revisiting the
          // terminal (remount) serves from cache instead of re-fetching.
          const data = await cachedFetch(
            ["aster", "leverageBrackets"],
            async () => (await fetch("/aster-leverage-brackets")).json(),
            600_000,
          );
          if (!Array.isArray(data)) return;
          data.forEach((e: any) => {
            const sym = String(e.symbol ?? "").replace(/USDT$/, "");
            const lev = e.brackets?.[0]?.initialLeverage;
            if (sym && lev) asterLev[sym] = lev;
          });
          if (currentMode === "aster") rebuildDropdown();
        } catch {}
      }

      async function fetchAsterMids() {
        if (currentMode !== "aster") return;
        try {
          const res = await fetch(`${ASTER_API}/fapi/v1/ticker/24hr`);
          const data = await res.json();
          if (!Array.isArray(data)) return;
          data.forEach((tk: any) => {
            const sym = tk.symbol?.replace("USDT", "");
            if (!sym) return;
            const price = parseFloat(tk.lastPrice ?? 0);
            if (price > 0) livePrices[sym] = price;
            asterStats[sym] = asterStats[sym] || {};
            asterStats[sym].chgPct = parseFloat(tk.priceChangePercent ?? 0);
            asterStats[sym].vol = parseFloat(tk.quoteVolume ?? 0);
            const priceEl = document.getElementById(`mprice-${sym}`);
            if (priceEl) priceEl.textContent = fmtAster(price, sym);
          });
          const ticker = data.find(
            (tk: any) => tk.symbol === currentMarket + "USDT",
          );
          if (ticker) updateAsterHeaderStats(ticker);
        } catch {}
        setTimeout(fetchAsterMids, 5000);
      }

      async function fetchAsterFunding() {
        if (currentMode !== "aster") return;
        try {
          const res = await fetch(`${ASTER_API}/fapi/v1/premiumIndex`);
          const data = await res.json();
          if (!Array.isArray(data)) return;
          data.forEach((tk: any) => {
            const sym = tk.symbol?.replace("USDT", "");
            if (!sym) return;
            asterStats[sym] = asterStats[sym] || {};
            asterStats[sym].fund8h = parseFloat(tk.lastFundingRate ?? 0) * 100;
          });
          rebuildDropdown();
        } catch {}
        setTimeout(fetchAsterFunding, 30000);
      }

      async function fetchAsterOI() {
        if (currentMode !== "aster") return;
        try {
          await Promise.all(
            ASTER_MARKETS.map(async (sym) => {
              const res = await fetch(
                `${ASTER_API}/fapi/v1/openInterest?symbol=${sym}USDT`,
              );
              const d = await res.json();
              const oi = parseFloat(d.openInterest ?? 0);
              asterStats[sym] = asterStats[sym] || {};
              asterStats[sym].oi = oi * (livePrices[sym] || 0);
            }),
          );
          rebuildDropdown();
        } catch {}
        setTimeout(fetchAsterOI, 30000);
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

      async function getAsterCandles(
        symbol: string,
        intervalMin: number,
        count = 200,
      ) {
        const ivMap: Record<number, string> = {
          1: "1m",
          3: "3m",
          5: "5m",
          15: "15m",
          60: "1h",
          240: "4h",
          1440: "1d",
        };
        const iv = ivMap[intervalMin] || "1m";
        try {
          const res = await fetch(
            `${ASTER_API}/fapi/v1/klines?symbol=${symbol}USDT&interval=${iv}&limit=${count}`,
          );
          const data = await res.json();
          if (!Array.isArray(data)) return [];
          return data.map((c: any) => ({
            t: c[0],
            o: +c[1],
            h: +c[2],
            l: +c[3],
            c: +c[4],
            v: +c[5],
          }));
        } catch {
          return [];
        }
      }

      async function getAsterBook(symbol: string) {
        try {
          const res = await fetch(
            `${ASTER_API}/fapi/v1/depth?symbol=${symbol}USDT&limit=20`,
          );
          const data = await res.json();
          return {
            asks: (data.asks || []).map(([px, sz]: any) => ({
              px: +px,
              sz: +sz,
            })),
            bids: (data.bids || []).map(([px, sz]: any) => ({
              px: +px,
              sz: +sz,
            })),
          };
        } catch {
          return { asks: [], bids: [] };
        }
      }

      // ── market data ────────────────────────────────────────────
      async function loadMeta() {
        const data = await getMetaAndAssetCtxs();
        if (!data) return;
        data.forEach((ctx: any, sym: string) => {
          metaCtxs[sym] = ctx;
        });
        updateHeaderStats();
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

      async function fetchAllMids() {
        try {
          const r = await fetch("/api/hl/info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "metaAndAssetCtxs" }),
          });
          const [meta, ctxs] = await r.json();
          meta.universe.forEach((asset: any, i: number) => {
            const sym = asset.name;
            const ctx = ctxs[i] ?? {};
            const price = parseFloat(ctx.markPx ?? 0);
            if (asset.maxLeverage) marketLev[sym] = asset.maxLeverage;
            if (!price) return;
            livePrices[sym] = price;
            const prev = parseFloat(ctx.prevDayPx ?? price);
            hlStats[sym] = {
              chgPct: prev ? ((price - prev) / prev) * 100 : 0,
              vol: parseFloat(ctx.dayNtlVlm ?? 0),
              fund8h: parseFloat(ctx.funding ?? 0) * 100,
              oi: parseFloat(ctx.openInterest ?? 0) * price,
            };
            const priceEl = document.getElementById(`mprice-${sym}`);
            if (priceEl) priceEl.textContent = fmt(price, sym);
            const levEl = document.getElementById(`mlev-${sym}`);
            if (levEl) levEl.textContent = asset.maxLeverage + "x";
          });
        } catch {}
        setTimeout(fetchAllMids, 5000);
      }

      function renderMarketList(markets: string[], list: HTMLElement) {
        const dd = document.getElementById("mktDropdown");
        if (dd) dd.classList.add("mkt-wide");
        const isAster = currentMode === "aster";
        const mktSuffix = isAster ? "-USDT" : "-USDC";
        const getLev = (sym: string) =>
          isAster
            ? asterLev[sym]
              ? asterLev[sym] + "x"
              : ""
            : marketLev[sym]
              ? marketLev[sym] + "x"
              : "";
        const getPrice = (sym: string) =>
          livePrices[sym]
            ? isAster
              ? fmtAster(livePrices[sym], sym)
              : fmt(livePrices[sym], sym)
            : "—";
        const fmtFund = (v: any) =>
          v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(4)}%`;
        const fmtChg = (v: any) =>
          v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
        const colHdr = `<div class="mkt-col-hdr">
          <span>${t("market")}</span><span>${t("lastPrice")}</span><span>${t("change24hShort")}</span><span>${t("funding8h")}</span><span>${t("volume")}</span><span>${t("openInterest")}</span>
        </div>`;
        list.innerHTML =
          colHdr +
          markets
            .map((sym) => {
              const s = (isAster ? asterStats : hlStats)[sym] || {};
              const chgCls = (s.chgPct ?? 0) >= 0 ? "up" : "dn";
              const fundCls = (s.fund8h ?? 0) >= 0 ? "up" : "dn";
              return `<div class="mkt-item mkt-item-wide" data-sym="${sym}">
            <span class="mkt-item-name">${sym}${mktSuffix}<span class="mkt-item-lev" id="mlev-${sym}">${getLev(sym)}</span></span>
            <span class="mkt-item-price" id="mprice-${sym}">${getPrice(sym)}</span>
            <span class="${chgCls}">${fmtChg(s.chgPct)}</span>
            <span class="${fundCls}">${fmtFund(s.fund8h)}</span>
            <span>${s.vol != null ? "$" + fmtLarge(s.vol) : "—"}</span>
            <span>${s.oi != null ? "$" + fmtLarge(s.oi) : "—"}</span>
          </div>`;
            })
            .join("");
        list.querySelectorAll(".mkt-item").forEach((el) =>
          el.addEventListener("click", () => {
            selectMarket((el as HTMLElement).dataset.sym!);
            closeDropdown();
          }),
        );
      }

      function bindMarketBtn() {
        const btn = document.getElementById("mktBtn");
        const dd = document.getElementById("mktDropdown");
        const srch = document.getElementById("mktSearch") as HTMLInputElement;
        const backdrop = document.getElementById("mktBackdrop");
        if (!btn || !dd || !srch) return;

        function openDropdown() {
          dd.classList.remove("hidden");
          backdrop?.classList.remove("hidden");
          srch.focus();
          document.getElementById("modePopup")?.classList.add("hidden");
          document.getElementById("modeBackdrop")?.classList.add("hidden");
        }

        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (dd.classList.contains("hidden")) openDropdown();
          else closeDropdown();
        });
        backdrop?.addEventListener("click", () => closeDropdown());
        srch.addEventListener("input", () => {
          const q = srch.value.toLowerCase();
          const markets = currentMode === "aster" ? ASTER_MARKETS : HL_MARKETS;
          const list = document.getElementById("mktList");
          if (list)
            renderMarketList(
              markets.filter((s) => s.toLowerCase().includes(q)),
              list,
            );
        });

        let focusedIdx = -1;
        const getItems = () =>
          [
            ...document
              .getElementById("mktList")!
              .querySelectorAll(".mkt-item"),
          ] as HTMLElement[];
        function setFocus(idx: number) {
          const items = getItems();
          items.forEach((el) => el.classList.remove("mkt-focused"));
          if (idx < 0 || idx >= items.length) {
            focusedIdx = -1;
            return;
          }
          focusedIdx = idx;
          items[idx].classList.add("mkt-focused");
          items[idx].scrollIntoView({ block: "nearest" });
        }
        srch.addEventListener("keydown", (e) => {
          const items = getItems();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocus(Math.min(focusedIdx + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocus(Math.max(focusedIdx - 1, 0));
          } else if (e.key === "Enter" && focusedIdx >= 0) {
            selectMarket((items[focusedIdx] as HTMLElement).dataset.sym!);
            closeDropdown();
          } else if (e.key === "Escape") closeDropdown();
        });
        document.addEventListener("click", (e) => {
          if (!dd.contains(e.target as Node) && e.target !== btn)
            closeDropdown();
        });
      }

      function closeDropdown() {
        document.getElementById("mktDropdown")?.classList.add("hidden");
        document.getElementById("mktBackdrop")?.classList.add("hidden");
        (document.getElementById("mktSearch") as HTMLInputElement).value = "";
        rebuildDropdown();
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
        updateTradeBtn();
        await loadMarket(sym);
      }

      async function loadMarket(sym: string) {
        const suffix = currentMode === "aster" ? "-USDT" : "-USDC";
        const pairEl = document.getElementById("tradesPair");
        if (pairEl) pairEl.textContent = sym + suffix;
        const xtEl = document.getElementById("xtTicker");
        if (xtEl) xtEl.textContent = sym;

        if (currentMode === "aster") {
          const data = await getAsterCandles(sym, currentIv, 200);
          setCandles(data, sym);
          recentTrades = [];
          renderTrades();
          startAsterTrades(sym);
          if (stopBook) {
            clearInterval(stopBook);
            stopBook = null;
          }
          getAsterBook(sym).then((book) => renderOrderBook(sym, book));
          stopBook = setInterval(async () => {
            if (currentMode !== "aster" || currentMarket !== sym) {
              clearInterval(stopBook);
              return;
            }
            const book = await getAsterBook(sym);
            renderOrderBook(sym, book);
          }, 2000);
        } else {
          const data = await getCandles(sym, currentIv, 200);
          setCandles(data, sym);
          updateHeaderStats();
          stopAsterTrades();
          if (stopBook) stopBook();
          getL2Book(sym).then((book) => renderOrderBook(sym, book));
          stopBook = startBookStream(sym, renderOrderBook);
        }
      }

      function renderOrderBook(sym: string, { asks, bids }: any) {
        if (sym !== currentMarket) return;
        const fmtPx = (n: number) =>
          n.toLocaleString("en-US", {
            minimumFractionDigits: 1,
            maximumFractionDigits: 2,
          });
        const fmtSzOb = (n: number) =>
          n >= 1 ? n.toFixed(2) : n >= 0.001 ? n.toFixed(3) : n.toFixed(4);
        const sortedAsks = [...asks].sort((a, b) => a.px - b.px);
        const sortedBids = [...bids].sort((a, b) => b.px - a.px);
        let ca = 0,
          cb = 0;
        const cumAsks = sortedAsks.map((r) => {
          ca += r.sz;
          return { ...r, cum: ca };
        });
        const cumBids = sortedBids.map((r) => {
          cb += r.sz;
          return { ...r, cum: cb };
        });
        const maxCum = Math.max(ca, cb) || 1;
        const row = (cls: string, { px, sz, cum }: any) => {
          const pct = ((cum / maxCum) * 100).toFixed(1);
          return `<div class="ob-row ${cls}"><span class="ob-price">${fmtPx(px)}</span><span class="ob-sz">${fmtSzOb(sz)}</span><span class="ob-total">${fmtSzOb(cum)}</span><div class="ob-depth" style="width:${pct}%"></div></div>`;
        };
        const asksEl = document.getElementById("obAsks");
        if (asksEl)
          asksEl.innerHTML = cumAsks.map((r) => row("ask", r)).join("");
        const bidsEl = document.getElementById("obBids");
        if (bidsEl)
          bidsEl.innerHTML = cumBids.map((r) => row("bid", r)).join("");
        const totalVol = ca + cb || 1;
        const bidPct = ((cb / totalVol) * 100).toFixed(1);
        const askPct = ((ca / totalVol) * 100).toFixed(1);
        const ratioBid = document.getElementById("obRatioBid");
        const ratioAsk = document.getElementById("obRatioAsk");
        if (ratioBid) {
          (ratioBid as HTMLElement).style.width = bidPct + "%";
          ratioBid.textContent = `B ${bidPct}%`;
        }
        if (ratioAsk) ratioAsk.textContent = `${askPct}% S`;
        const bestAsk = sortedAsks[0]?.px ?? 0;
        const bestBid = sortedBids[0]?.px ?? 0;
        if (bestAsk && bestBid) {
          const spread = bestAsk - bestBid;
          const sv = document.getElementById("obSpreadVal");
          const sp = document.getElementById("obSpreadPct");
          if (sv) sv.textContent = fmtPx(spread);
          if (sp) sp.textContent = ((spread / bestBid) * 100).toFixed(3) + "%";
        }
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
                await getAsterCandles(currentMarket, currentIv, 200),
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

      // ── bottom tabs ────────────────────────────────────────────
      const btmPaneMap: Record<string, string> = {
        positions: "btPositions",
        balances: "btBalances",
        "open-orders": "btOpenOrders",
        "trade-history": "btTradeHistory",
        funding: "btFunding",
        "order-history": "btOrderHistory",
        "liq-map": "btLiqMap",
      };

      function bindBtmTabs() {
        document.querySelectorAll(".btm-tab").forEach((btn) => {
          btn.addEventListener("click", async () => {
            document
              .querySelectorAll(".btm-tab")
              .forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            Object.values(btmPaneMap).forEach((id) => {
              const el = document.getElementById(id);
              if (el) {
                el.classList.add("hidden");
                el.style.display = "";
              }
            });
            const activePane = document.getElementById(
              btmPaneMap[(btn as HTMLElement).dataset.bt!],
            );
            if (activePane) {
              activePane.classList.remove("hidden");
              if ((btn as HTMLElement).dataset.bt === "liq-map")
                activePane.style.display = "flex";
            }
            if ((btn as HTMLElement).dataset.bt === "liq-map")
              (window as any).lmpOpen?.();
            const addr = getEVMAddress();
            if (!addr) return;
            const tab = (btn as HTMLElement).dataset.bt;
            const aster = currentMode === "aster";
            if (tab === "trade-history")
              renderFills(
                await (aster ? getAsterFillsLocal(addr) : getUserFills(addr)),
              );
            if (tab === "open-orders")
              renderOpenOrders(
                await (aster
                  ? getAsterOpenOrdersLocal(addr)
                  : getOpenOrders(addr)),
              );
            if (tab === "funding")
              renderFundingHistory(
                await (aster
                  ? getAsterFundingLocal(addr)
                  : getFundingHistory(addr)),
              );
            if (tab === "balances") await refreshPositions(addr);
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
          updateStats();
        }
      }

      function onTrade(sym: string, trade: any) {
        // The HL trade websocket keeps running in EXTRA mode; ignore its trades
        // there so they don't mix into the Aster live-trades list.
        if (currentMode !== "hl") return;
        if (sym !== currentMarket) return;
        pushTrade(trade);
      }

      function pushTrade(trade: any) {
        recentTrades.unshift(trade);
        if (recentTrades.length > 80) recentTrades.pop();
        renderTrades();
      }

      function renderTrades() {
        const tl = document.getElementById("tradesList");
        if (!tl) return;
        if (!recentTrades.length) {
          tl.innerHTML =
            currentMode === "aster"
              ? '<div style="color:var(--hl-text-muted);font-size:11px;padding:8px;text-align:center">Connecting to live trades…</div>'
              : "";
          return;
        }
        tl.innerHTML = recentTrades
          .slice(0, 50)
          .map((tr) => {
            const d = new Date(tr.time);
            const ts = [d.getHours(), d.getMinutes(), d.getSeconds()]
              .map((n) => n.toString().padStart(2, "0"))
              .join(":");
            const pxFmt =
              currentMode === "aster"
                ? fmtAster(tr.px, currentMarket)
                : fmt(tr.px, currentMarket);
            return `<div class="trade-row ${tr.side === "buy" ? "t-buy" : "t-sell"}">
            <span class="tr-price">${pxFmt}</span>
            <span class="tr-sz">${fmtSz(tr.sz)}</span>
            <span class="tr-time">${ts}</span>
          </div>`;
          })
          .join("");
      }

      // Aster public live trades — wss @aggTrade for one symbol. Ported from the
      // root's useAsterTradeStream. Message: { p: px, q: sz, m: isBuyerMaker, T }.
      function stopAsterTrades() {
        if (asterTradeWs) {
          try {
            asterTradeWs.close();
          } catch {}
          asterTradeWs = null;
        }
      }

      function startAsterTrades(sym: string) {
        stopAsterTrades();
        const ws = new WebSocket(
          `wss://fstream.asterdex.com/ws/${sym.toLowerCase()}usdt@aggTrade`,
        );
        asterTradeWs = ws;
        ws.onmessage = ({ data }) => {
          if (currentMode !== "aster" || currentMarket !== sym) return;
          try {
            const msg = JSON.parse(data);
            const px = parseFloat(msg.p ?? 0);
            const sz = parseFloat(msg.q ?? 0);
            if (!px || !sz) return;
            pushTrade({
              side: msg.m ? "sell" : "buy",
              px,
              sz,
              time: msg.T || Date.now(),
            });
          } catch {}
        };
        ws.onclose = () => {
          if (asterTradeWs !== ws) return; // superseded by a newer stream
          asterTradeWs = null;
          if (currentMode === "aster" && currentMarket === sym)
            setTimeout(() => {
              if (currentMode === "aster" && currentMarket === sym)
                startAsterTrades(sym);
            }, 5000);
        };
        ws.onerror = () => {
          try {
            ws.close();
          } catch {}
        };
      }

      function renderFills(fills: any[]) {
        const el = document.getElementById("btTradeHistory");
        if (!el) return;
        if (!fills.length) {
          el.innerHTML = '<div class="btm-empty">No trade history</div>';
          return;
        }
        el.innerHTML =
          `<div class="btm-col-hdr" style="grid-template-columns:70px 60px 100px 80px 80px 80px 80px 1fr"><span>Market</span><span>Side</span><span>Price</span><span>Size</span><span>Fee</span><span>PnL</span><span>Dir</span><span>Time</span></div>` +
          fills
            .slice(0, 200)
            .map((f) => {
              const pnlCls = f.pnl > 0 ? "pnl-pos" : f.pnl < 0 ? "pnl-neg" : "";
              return `<div class="pos-row" style="grid-template-columns:70px 60px 100px 80px 80px 80px 80px 1fr"><span class="pos-sym">${f.coin}</span><span class="${f.side === "Buy" ? "dir-long" : "dir-short"}">${f.side}</span><span>${fmt(f.price, f.coin)}</span><span>${fmtSz(f.size)}</span><span>$${f.fee.toFixed(4)}</span><span class="${pnlCls}">${f.pnl !== 0 ? (f.pnl > 0 ? "+" : "") + "$" + f.pnl.toFixed(2) : "—"}</span><span style="color:var(--hl-text-muted);font-size:10px">${f.dir}</span><span style="color:var(--hl-text-muted)">${new Date(f.time).toLocaleString()}</span></div>`;
            })
            .join("");
      }

      function renderOpenOrders(orders: any[]) {
        const el = document.getElementById("btOpenOrders");
        if (!el) return;
        if (!orders.length) {
          el.innerHTML = '<div class="btm-empty">No open orders</div>';
          return;
        }
        el.innerHTML =
          `<div class="btm-col-hdr" style="grid-template-columns:70px 60px 100px 80px 80px 1fr 60px"><span>Market</span><span>Side</span><span>Price</span><span>Size</span><span>Filled</span><span>Time</span><span></span></div>` +
          orders
            .map((o) => {
              const filled = o.origSize - o.size;
              return `<div class="pos-row" style="grid-template-columns:70px 60px 100px 80px 80px 1fr 60px"><span class="pos-sym">${o.coin}</span><span class="${o.side === "Buy" ? "dir-long" : "dir-short"}">${o.side}</span><span>${fmt(o.price, o.coin)}</span><span>${fmtSz(o.size)}</span><span>${fmtSz(filled)}</span><span style="color:var(--hl-text-muted)">${new Date(o.time).toLocaleString()}</span><span><button class="pos-close-btn" onclick="window.rdo.cancelOrd(${o.oid},'${o.coin}')">Cancel</button></span></div>`;
            })
            .join("");
      }

      function renderFundingHistory(rows: any[]) {
        const el = document.getElementById("btFunding");
        if (!el) return;
        if (!rows.length) {
          el.innerHTML = '<div class="btm-empty">No funding history</div>';
          return;
        }
        el.innerHTML =
          `<div class="btm-col-hdr" style="grid-template-columns:70px 80px 80px 80px 1fr"><span>Market</span><span>Payment</span><span>Rate</span><span>Size</span><span>Time</span></div>` +
          rows
            .slice(0, 200)
            .map((f) => {
              const cls = f.usdc >= 0 ? "pnl-pos" : "pnl-neg";
              return `<div class="pos-row" style="grid-template-columns:70px 80px 80px 80px 1fr"><span class="pos-sym">${f.coin}</span><span class="${cls}">${f.usdc >= 0 ? "+" : ""}$${f.usdc.toFixed(4)}</span><span>${(f.rate * 100).toFixed(4)}%</span><span>${fmtSz(Math.abs(f.size))}</span><span style="color:var(--hl-text-muted)">${new Date(f.time).toLocaleString()}</span></div>`;
            })
            .join("");
      }

      // ── trade panel ────────────────────────────────────────────
      function setSide(buy: boolean) {
        isBuy = buy;
        document.getElementById("btnBuy")?.classList.toggle("active", buy);
        document.getElementById("btnSell")?.classList.toggle("active", !buy);
        if (getEVMAddress()) {
          const btn = document.getElementById("tradeBtn");
          if (btn) {
            btn.className =
              "tp-action-btn " + (buy ? "tp-buy-bg" : "tp-sell-bg");
            btn.textContent =
              (buy ? "Buy / Long " : "Sell / Short ") + currentMarket;
          }
        }
        updateStats();
      }

      function updateTradeBtn() {
        const addr = getEVMAddress();
        const btn = document.getElementById("tradeBtn");
        if (!btn) return;
        if (!addr) {
          btn.textContent = "Connect";
          return;
        }
        btn.textContent =
          (isBuy ? "Buy / Long " : "Sell / Short ") + currentMarket;
      }

      function updateStats() {
        const sizeEl = document.getElementById("sizeInput") as HTMLInputElement;
        const levEl = document.getElementById("levInput") as HTMLInputElement;
        const size = parseFloat(sizeEl?.value) || 0;
        const lev = parseFloat(levEl?.value) || 20;
        const px = livePrices[currentMarket] || 0;
        const notional = size * px;
        const margin = notional / lev;
        const liqMove = 0.975 / lev;
        const liqPx = px
          ? isBuy
            ? px * (1 - liqMove)
            : px * (1 + liqMove)
          : 0;
        const feeRate = currentMode === "aster" ? 0.0004 : 0.00045;
        const feeLabel =
          currentMode === "aster"
            ? "0.0400% Taker / 0.0000% Maker"
            : "0.0450% / 0.0150%";
        const feePct = currentMode === "aster" ? "0.0400%" : "0.0450%";
        const el = (id: string, val: string) => {
          const e = document.getElementById(id);
          if (e) e.textContent = val;
        };
        el("stLiq", liqPx ? fmt(liqPx, currentMarket) : "N/A");
        el("stVal", notional ? "$" + fmtLarge(notional) : "N/A");
        el("stMargin", margin ? "$" + margin.toFixed(2) : "--");
        el(
          "stFee",
          notional
            ? "$" + (notional * feeRate).toFixed(4) + " (" + feePct + ")"
            : feeLabel,
        );
      }

      function onSlider(val: string) {
        const addr = getEVMAddress();
        if (!addr) return;
        const avEl = document.getElementById("tpAvail");
        const avail =
          parseFloat(avEl?.textContent?.replace(/[^0-9.]/g, "") || "0") || 0;
        const levEl = document.getElementById("levInput") as HTMLInputElement;
        const lev = parseFloat(levEl?.value) || 20;
        const px = livePrices[currentMarket] || 0;
        if (!px) return;
        const sizeEl = document.getElementById("sizeInput") as HTMLInputElement;
        if (sizeEl)
          sizeEl.value = ((avail * lev * (parseInt(val) / 100)) / px).toFixed(
            6,
          );
        updateStats();
      }

      async function submitTrade() {
        const addr = getEVMAddress();
        if (!addr) {
          await connectWalletFn();
          return;
        }
        const sizeEl = document.getElementById("sizeInput") as HTMLInputElement;
        const levEl = document.getElementById("levInput") as HTMLInputElement;
        const size = parseFloat(sizeEl?.value);
        const lev = parseFloat(levEl?.value) || 20;
        const px =
          livePrices[currentMarket] || (await getMarketPrice(currentMarket));
        if (!size || size <= 0) {
          showErr("Enter a size");
          return;
        }
        const btn = document.getElementById("tradeBtn");
        if (!btn) return;
        const orig = btn.textContent!;
        btn.textContent = "Confirming...";
        (btn as HTMLButtonElement).disabled = true;
        // EXTRA/Aster: signed market order server-side (no wallet prompt). size
        // is base-coin units; Aster uses the account's own leverage (the root
        // app doesn't set leverage per order either). Ported from asterPlaceOrder.
        if (currentMode === "aster") {
          try {
            const res = await fetch(`/aster-signed/fapi/v3/order`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                symbol: `${currentMarket}USDT`,
                side: isBuy ? "BUY" : "SELL",
                type: "MARKET",
                quantity: String(size),
                user: addr,
              }),
            });
            const d = await res.json();
            if (d.orderId || d.status) {
              showToast(
                `${isBuy ? "Long" : "Short"} ${currentMarket} opened`,
                "ok",
              );
              setTimeout(() => refreshPositions(addr), 2000);
            } else {
              showErr(d.msg ?? "Order failed");
            }
          } catch (e: any) {
            showErr(e.message ?? "Transaction failed");
          } finally {
            btn.textContent = orig;
            (btn as HTMLButtonElement).disabled = false;
          }
          return;
        }
        try {
          const { ethers } = await import("ethers");
          const signer = await new ethers.BrowserProvider(
            getEVMProvider(),
          ).getSigner();
          const result = await openPosition({
            symbol: currentMarket,
            sizeDollars: size * px,
            leverage: lev,
            isLong: isBuy,
            signer,
          });
          if (result.status === "ok") {
            showToast(
              `${isBuy ? "Long" : "Short"} ${currentMarket} opened`,
              "ok",
            );
            setTimeout(() => refreshPositions(addr), 2000);
          } else {
            showErr(result.response ?? "Order failed");
          }
        } catch (e: any) {
          showErr(e.message ?? "Transaction failed");
        } finally {
          btn.textContent = orig;
          (btn as HTMLButtonElement).disabled = false;
        }
      }

      function showErr(msg: string) {
        const el = document.getElementById("tradeErr");
        if (!el) return;
        el.textContent = msg;
        el.classList.remove("hidden");
        setTimeout(() => el.classList.add("hidden"), 5000);
      }

      async function refreshPositions(addr: string) {
        if (currentMode === "aster") {
          await refreshAsterAccount(addr);
          return;
        }
        const acct = await loadAccountState(addr);
        const positions = acct.positions;
        const el = (id: string, val: string) => {
          const e = document.getElementById(id);
          if (e) e.textContent = val;
        };
        // "Available to Trade" is spendable balance (spot minus held margin +
        // free cross), NOT perp equity — matches the exchange.
        el("tpAvail", "$" + acct.availableToTrade.toFixed(2) + " USDC");
        el("eqSpot", "$" + acct.spotTotal.toFixed(2));
        el("eqPerps", "$" + acct.perpEquity.toFixed(2));
        el("ovBalance", "$" + acct.perpEquity.toFixed(2));
        el("balanceDisplay", "$" + acct.perpEquity.toFixed(2));
        el("ovPnl", (acct.upnl >= 0 ? "+" : "") + "$" + acct.upnl.toFixed(2));
        el(
          "ovLev",
          acct.marginUsed > 0 && acct.perpEquity > 0
            ? (acct.ntl / acct.perpEquity).toFixed(2) + "x"
            : "0.00x",
        );
        const mine = positions.find((p: any) => p.symbol === currentMarket);
        el(
          "tpCurPos",
          mine
            ? (mine.size >= 0 ? "+" : "") +
                mine.size.toFixed(5) +
                " " +
                currentMarket
            : "0.00000 " + currentMarket,
        );
        renderPositions(positions, addr);
      }

      // EXTRA/Aster equivalent — its own signed futures account (USDT margin).
      // availableBalance is what's free to trade; totalMarginBalance is equity.
      async function refreshAsterAccount(addr: string) {
        const el = (id: string, val: string) => {
          const e = document.getElementById(id);
          if (e) e.textContent = val;
        };
        let data: any = null;
        try {
          const r = await fetch(
            `/aster-signed/fapi/v3/accountWithJoinMargin?user=${encodeURIComponent(addr)}`,
          );
          if (r.ok) {
            const d = await r.json();
            if (Array.isArray(d.positions)) data = d;
          }
        } catch {}
        if (!data) {
          // Aster agent not approved for this address (or no account yet).
          el("tpAvail", "$0.00 USDT");
          el("eqSpot", "$0.00");
          el("eqPerps", "$0.00");
          el("ovBalance", "$0.00");
          el("balanceDisplay", "$0.00");
          el("ovPnl", "$0.00");
          el("ovLev", "0.00x");
          el("tpCurPos", "0.00000 " + currentMarket);
          renderPositions([], addr);
          return;
        }
        const avail = parseFloat(data.availableBalance ?? 0);
        const equity = parseFloat(data.totalMarginBalance ?? 0);
        const upnl = parseFloat(data.totalUnrealizedProfit ?? 0);
        const marginUsed = parseFloat(data.totalPositionInitialMargin ?? 0);
        const positions = (data.positions ?? [])
          .filter((p: any) => parseFloat(p.positionAmt ?? 0) !== 0)
          .map((p: any) => ({
            symbol: String(p.symbol).replace(/USDT$/, ""),
            size: parseFloat(p.positionAmt ?? 0),
            entryPrice: parseFloat(p.entryPrice ?? 0),
            leverage: parseFloat(p.leverage ?? 0),
            pnl: parseFloat(p.unrealizedProfit ?? 0),
            liqPrice: parseFloat(p.liquidationPrice ?? 0),
            isLong: parseFloat(p.positionAmt ?? 0) > 0,
          }));
        const ntl = positions.reduce(
          (s: number, p: any) =>
            s + Math.abs(p.size) * (livePrices[p.symbol] || p.entryPrice),
          0,
        );
        el("tpAvail", "$" + avail.toFixed(2) + " USDT");
        el("eqSpot", "$0.00");
        el("eqPerps", "$" + equity.toFixed(2));
        el("ovBalance", "$" + equity.toFixed(2));
        el("balanceDisplay", "$" + equity.toFixed(2));
        el("ovPnl", (upnl >= 0 ? "+" : "") + "$" + upnl.toFixed(2));
        el(
          "ovLev",
          marginUsed > 0 && equity > 0
            ? (ntl / equity).toFixed(2) + "x"
            : "0.00x",
        );
        const mine = positions.find((p: any) => p.symbol === currentMarket);
        el(
          "tpCurPos",
          mine
            ? (mine.size >= 0 ? "+" : "") +
                mine.size.toFixed(5) +
                " " +
                currentMarket
            : "0.00000 " + currentMarket,
        );
        renderPositions(positions, addr);
      }

      // ── EXTRA/Aster bottom-tab data (open orders / fills / funding) ──
      async function getAsterOpenOrdersLocal(addr: string) {
        try {
          const r = await fetch(
            `/aster-signed/fapi/v3/allOrders?limit=100&user=${encodeURIComponent(addr)}`,
          );
          const data = await r.json();
          if (!Array.isArray(data)) return [];
          return data
            .filter(
              (o: any) => o.status === "NEW" || o.status === "PARTIALLY_FILLED",
            )
            .map((o: any) => ({
              coin: String(o.symbol ?? "").replace(/USDT$/, ""),
              side: o.side === "BUY" ? "Buy" : "Sell",
              price: parseFloat(o.price ?? 0),
              size: parseFloat(o.origQty ?? 0) - parseFloat(o.executedQty ?? 0),
              origSize: parseFloat(o.origQty ?? 0),
              oid: Number(o.orderId ?? 0),
              time: Number(o.time ?? 0),
            }));
        } catch {
          return [];
        }
      }

      async function getAsterFundingLocal(addr: string) {
        try {
          const r = await fetch(
            `/aster-signed/fapi/v3/income?incomeType=FUNDING_FEE&limit=100&user=${encodeURIComponent(addr)}`,
          );
          const data = await r.json();
          if (!Array.isArray(data)) return [];
          return data.map((f: any) => ({
            coin: String(f.symbol ?? "").replace(/USDT$/, ""),
            usdc: parseFloat(f.income ?? 0),
            rate: 0, // Aster income endpoint has no rate/size
            size: 0,
            time: Number(f.time ?? 0),
          }));
        } catch {
          return [];
        }
      }

      // Aster has no bulk fills endpoint — pull per-symbol userTrades for the
      // symbols with an open position (same approach as the root's getAsterFills).
      async function getAsterFillsLocal(addr: string) {
        let acct: any = null;
        try {
          const r = await fetch(
            `/aster-signed/fapi/v3/accountWithJoinMargin?user=${encodeURIComponent(addr)}`,
          );
          if (r.ok) {
            const d = await r.json();
            if (Array.isArray(d.positions)) acct = d;
          }
        } catch {}
        const symbols = (acct?.positions ?? [])
          .filter((p: any) => parseFloat(p.positionAmt ?? 0) !== 0)
          .map((p: any) => String(p.symbol))
          .slice(0, 20);
        if (!symbols.length) return [];
        const results = await Promise.allSettled(
          symbols.map(async (sym: string) => {
            try {
              const r = await fetch(
                `/aster-signed/fapi/v3/userTrades?symbol=${sym}&limit=100&user=${encodeURIComponent(addr)}`,
              );
              const data = await r.json();
              if (!Array.isArray(data)) return [];
              return data.map((t: any) => ({
                coin: String(t.symbol ?? "").replace(/USDT$/, ""),
                side: parseFloat(t.realizedPnl ?? 0) >= 0 ? "Buy" : "Sell",
                price: parseFloat(t.price ?? 0),
                size: parseFloat(t.qty ?? 0),
                fee: parseFloat(t.commission ?? 0),
                pnl: parseFloat(t.realizedPnl ?? 0),
                dir: String(t.side ?? ""),
                time: Number(t.time ?? 0),
              }));
            } catch {
              return [];
            }
          }),
        );
        const out: any[] = [];
        results.forEach((r) => {
          if (r.status === "fulfilled") out.push(...r.value);
        });
        return out.sort((a: any, b: any) => b.time - a.time);
      }

      function renderPositions(positions: any[], addr: string) {
        const el = document.getElementById("posRows");
        if (!el) return;
        if (!positions.length) {
          el.innerHTML = '<div class="btm-empty">No open positions yet</div>';
          return;
        }
        el.innerHTML = positions
          .map((p: any, i: number) => {
            const pnlCls = p.pnl >= 0 ? "pnl-pos" : "pnl-neg";
            const px = livePrices[p.symbol] || p.entryPrice;
            const roe = p.entryPrice
              ? ((px - p.entryPrice) / p.entryPrice) *
                p.leverage *
                (p.isLong ? 1 : -1) *
                100
              : 0;
            const modeLbl = currentMode === "aster" ? "EXTRA" : "BASIC";
            const modeCls =
              currentMode === "aster" ? "pos-mode-extra" : "pos-mode-basic";
            return `<div class="pos-row"><span class="pos-sym">${p.symbol}</span><span><span class="pos-mode-tag ${modeCls}">${modeLbl}</span></span><span>${p.size.toFixed(4)}</span><span>$${(Math.abs(p.size) * px).toFixed(2)}</span><span>${fmt(p.entryPrice, p.symbol)}</span><span>${fmt(px, p.symbol)}</span><span class="${pnlCls}">${p.pnl >= 0 ? "+" : ""}$${p.pnl.toFixed(2)} (${roe.toFixed(2)}%)</span><span>${fmt(p.liqPrice, p.symbol)}</span><span>—</span><span>—</span><span class="${p.isLong ? "dir-long" : "dir-short"}">${p.isLong ? "Long" : "Short"}</span><span><button class="pos-close-btn" onclick="window.rdo.closePos(${i})">Close</button></span></div>`;
          })
          .join("");
      }

      async function closePos(index: number) {
        const addr = getEVMAddress();
        if (!addr) return;
        if (currentMode === "aster") {
          await closeAsterPos(index, addr);
          return;
        }
        const positions = await getPositions(addr);
        const p = positions[index];
        if (!p) return;
        try {
          const { ethers } = await import("ethers");
          const signer = await new ethers.BrowserProvider(
            getEVMProvider(),
          ).getSigner();
          const result = await closePosition({
            symbol: p.symbol,
            size: p.size,
            isLong: p.isLong,
            signer,
          });
          if (result.status === "ok") {
            showToast("Position closed", "ok");
            setTimeout(() => refreshPositions(addr), 2000);
          } else {
            showToast(result.response ?? "Close failed", "err");
          }
        } catch (e: any) {
          showToast(e.message, "err");
        }
      }

      // Close an Aster position: an opposite-side MARKET order of the exact
      // position size, signed server-side by the user's agent (no client wallet
      // prompt). Ported from the root app's asterClosePosition/asterPlaceOrder.
      async function closeAsterPos(index: number, addr: string) {
        let data: any = null;
        try {
          const r = await fetch(
            `/aster-signed/fapi/v3/accountWithJoinMargin?user=${encodeURIComponent(addr)}`,
          );
          if (r.ok) {
            const d = await r.json();
            if (Array.isArray(d.positions)) data = d;
          }
        } catch {}
        // Resolve the same filtered (non-zero) list refreshAsterAccount rendered.
        const positions = (data?.positions ?? []).filter(
          (p: any) => parseFloat(p.positionAmt ?? 0) !== 0,
        );
        const p = positions[index];
        if (!p) return;
        const symbol = String(p.symbol).replace(/USDT$/, "");
        const amt = parseFloat(p.positionAmt ?? 0);
        try {
          const res = await fetch(`/aster-signed/fapi/v3/order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbol: `${symbol}USDT`,
              side: amt > 0 ? "SELL" : "BUY", // opposite side closes
              type: "MARKET",
              quantity: String(Math.abs(amt)),
              user: addr,
            }),
          });
          const d = await res.json();
          if (d.orderId || d.status) {
            showToast(`${symbol} position closed`, "ok");
            setTimeout(() => refreshPositions(addr), 2000);
          } else {
            showToast(d.msg ?? "Close failed", "err");
          }
        } catch (e: any) {
          showToast(e.message ?? "Close failed", "err");
        }
      }

      async function cancelOrd(oid: number, symbol: string) {
        const addr = getEVMAddress();
        if (!addr) return;
        if (currentMode === "aster") {
          try {
            const r = await fetch(`/aster-signed/fapi/v3/order`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                symbol: `${symbol}USDT`,
                orderId: String(oid),
                user: addr,
              }),
            });
            const d = await r.json();
            if (d.orderId || d.status === "CANCELED") {
              showToast("Order cancelled", "ok");
              renderOpenOrders(await getAsterOpenOrdersLocal(addr));
            } else {
              showToast(d.msg ?? "Cancel failed", "err");
            }
          } catch (e: any) {
            showToast(e.message, "err");
          }
          return;
        }
        try {
          const { ethers } = await import("ethers");
          const signer = await new ethers.BrowserProvider(
            getEVMProvider(),
          ).getSigner();
          const result = await cancelOrder({ oid, symbol, signer });
          if (result.status === "ok") {
            showToast("Order cancelled", "ok");
            renderOpenOrders(await getOpenOrders(addr));
          } else {
            showToast(result.response ?? "Cancel failed", "err");
          }
        } catch (e: any) {
          showToast(e.message, "err");
        }
      }

      async function connectWalletFn() {
        await connectRef.current();
      }

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
            (isBuy ? "Buy / Long " : "Sell / Short ") + currentMarket;
          btn.className =
            "tp-action-btn " + (isBuy ? "tp-buy-bg" : "tp-sell-bg");
        }
        await refreshPositions(addr);
        if (!positionsPollStarted) {
          positionsPollStarted = true;
          setInterval(() => {
            if (evmAddressRef.current) refreshPositions(evmAddressRef.current);
          }, 15000);
        }
      }
      onEvmConnectedRef.current = onEvmConnected;
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
          const list = document.getElementById("mktList");
          const markets = currentMode === "aster" ? ASTER_MARKETS : HL_MARKETS;
          if (list) renderMarketList(markets, list);
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
        closeDropdown();
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
        setSide,
        updateStats,
        onSlider,
        submitTrade,
        closePos,
        cancelOrd,
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
      const list = document.getElementById("mktList");
      if (list) renderMarketList(HL_MARKETS, list);
      fetchAllMids();
      bindIntervals();
      bindBtmTabs();
      bindMarketBtn();
      initLang();
      initXtResize();
      initBtmResize();
      initObFloat();
      initLiqMap();
      await loadMarket("BTC");
      await loadMeta();
      startPriceStream(HL_MARKETS.slice(0, 20), onPrice, null, onTrade);
    }

    init().catch(console.error);
  }, []);

  return (
    <div id="app">
      {/* ══ HEADER ═══════════════════════════════════════════════ */}
      <header className="flex items-center justify-between px-3 gap-0 bg-black border-b border-[#1f1f1f] relative z-[200] h-[var(--hdr)]">
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-baseline gap-0.5 pr-1">
            <span className="text-[13px] font-bold text-[#50d2c1] tracking-[0.5px]">RDO</span>
            <span className="text-[13px] font-light text-white">ONE</span>
          </div>
          <div className="w-px h-[18px] bg-[#1f1f1f] shrink-0"></div>
          <div className="relative flex items-center gap-2.5 shrink-0">
            <div className="flex items-center bg-[#0d0d0d] border border-[#1f1f1f] rounded-md p-0.5 gap-0.5 shrink-0" id="modeSwitch">
              <button
                className="mode-btn mode-hl active font-[var(--hl-font)] text-[11px] font-bold tracking-[0.5px] py-[3px] px-2.5 rounded border-none cursor-pointer text-[#878c8f] bg-transparent transition-all duration-150 flex items-center gap-1"
                id="modeBtnHL"
                onClick={() => (window as any).rdo?.switchMode("hl")}
              >
                BASIC
              </button>
              <button
                className="mode-btn mode-aster font-[var(--hl-font)] text-[11px] font-bold tracking-[0.5px] py-[3px] px-2.5 rounded border-none cursor-pointer text-[#878c8f] bg-transparent transition-all duration-150 flex items-center gap-1"
                id="modeBtnAster"
                onClick={() => (window as any).rdo?.switchMode("aster")}
              >
                EXTRA
              </button>
            </div>
            <button
              className="w-4 h-4 rounded-full border border-[#1f1f1f] bg-[#0d0d0d] text-[#6b7173] text-[10px] font-bold font-[var(--hl-font)] cursor-pointer leading-none flex items-center justify-center transition-all duration-150 shrink-0 hover:border-[#50d2c1] hover:text-[#50d2c1]"
              id="modeHelpBtn"
              onClick={() => (window as any).rdo?.toggleModeHelp()}
            >
              ?
            </button>
            <div
              className="hidden fixed inset-0 z-[998] backdrop-blur-[4px] bg-black/25"
              id="modeBackdrop"
              onClick={() => (window as any).rdo?.toggleModeHelp()}
            ></div>
            <div className="hidden fixed inset-0 z-[499] backdrop-blur-[4px] bg-black/25" id="mktBackdrop"></div>
            <div className="hidden absolute top-[calc(100%+8px)] left-0 bg-[#0d0d0d] border border-[#1f1f1f] rounded-lg py-3 px-3.5 min-w-[430px] z-[999] shadow-[0_8px_24px_rgba(0,0,0,0.4)]" id="modePopup">
              <div className="flex gap-2.5 items-start">
                <span className="text-[10px] font-bold tracking-[0.5px] py-0.5 px-[7px] rounded shrink-0 mt-0.5 bg-[rgba(10,153,129,0.20)] text-[#50d2c1]">BASIC</span>
                <div className="text-[11px] leading-[1.6] text-[#878c8f]">
                  <strong className="text-white text-[11px]" data-i18n="basicTitle">RDO ONE x HYPE x LI.FI</strong>
                  <br />
                  <b className="text-white text-[11px]" data-i18n="basicLev">Up to 40x leverage</b>
                  <br />
                  <span data-i18n="basicDesc">
                    Crypto perps only / Non-custodial / Any collateral
                  </span>
                  <br />
                  <span data-i18n="basicFee">
                    Taker fee 0.045% / Maker 0.015%
                  </span>
                  <br />
                  <span data-i18n="basicExtra">
                    The best liquidity / Average 0.0015% spreads
                  </span>
                </div>
              </div>
              <div className="h-px bg-[#1f1f1f] my-2.5"></div>
              <div className="flex gap-2.5 items-start">
                <span className="text-[10px] font-bold tracking-[0.5px] py-0.5 px-[7px] rounded shrink-0 mt-0.5 bg-[rgba(139,92,246,0.15)] text-[#a78bfa]">EXTRA</span>
                <div className="text-[11px] leading-[1.6] text-[#878c8f]">
                  <strong className="text-white text-[11px]" data-i18n="extraTitle">
                    RDO ONE x ASTER x LI.FI
                  </strong>
                  <br />
                  <b className="text-white text-[11px]" data-i18n="extraLev">Up to 200x leverage</b>
                  <br />
                  <span data-i18n="extraDesc">
                    Crypto perps only / Hybrid-custodial / Any collateral
                  </span>
                  <br />
                  <span data-i18n="extraFee">Taker fee 0.04% / Maker 0%</span>
                  <br />
                  <span data-i18n="extraExtra">
                    Higher leverage level / Best fee rates
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="w-px h-[18px] bg-[#1f1f1f] shrink-0"></div>
          <nav className="flex items-center gap-1 mx-4">
            <a className="text-xs font-medium text-white no-underline py-[5px] px-3 rounded-[7px] transition-colors duration-150 bg-[#1f1f1f] font-semibold pb-[5px]" href="/" data-i18n="trade">
              Trade
            </a>
            <a className="text-xs font-medium text-[#878c8f] no-underline py-[5px] px-3 rounded-[7px] transition-colors duration-150 hover:text-white hover:bg-[#1a1a1a]" href="/markets" data-i18n="markets">
              Markets
            </a>
            <a className="text-xs font-medium text-[#878c8f] no-underline py-[5px] px-3 rounded-[7px] transition-colors duration-150 hover:text-white hover:bg-[#1a1a1a]" href="/news" data-i18n="news">
              News
            </a>
            <a className="text-xs font-medium text-[#878c8f] no-underline py-[5px] px-3 rounded-[7px] transition-colors duration-150 hover:text-white hover:bg-[#1a1a1a]" href="/portfolio" data-i18n="portfolio">
              Portfolio
            </a>
            <a className="text-xs font-medium text-[#878c8f] no-underline py-[5px] px-3 rounded-[7px] transition-colors duration-150 hover:text-white hover:bg-[#1a1a1a]" href="/transfer" data-i18n="transfer">
              Transfer
            </a>
          </nav>
          <div className="w-px h-[18px] bg-[#1f1f1f] shrink-0"></div>
          <button className="flex items-center gap-1 font-[var(--hl-font)] text-[13px] font-semibold text-white bg-transparent border-none cursor-pointer py-1 px-2 rounded-md transition-colors duration-150 hover:bg-[#0d0d0d]" id="mktBtn">
            <span id="mktSymbol">BTC-USDC</span>
            <span className="text-[10px] text-[#878c8f] mt-px">▾</span>
          </button>
          <div id="mktDropdown" className="mkt-dropdown hidden absolute top-[calc(var(--hdr)+2px)] left-[120px] bg-[#0d0d0d] border border-[#1f1f1f] rounded-[10px] z-[500] w-[260px] shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
            <input
              id="mktSearch"
              className="w-full py-2 px-3 bg-transparent border-0 border-b border-[#1f1f1f] font-[var(--hl-font)] text-xs text-white outline-none placeholder:text-[#878c8f]"
              placeholder="Search market..."
              autoComplete="off"
              data-i18n="searchMarket"
              data-i18n-attr="placeholder"
            />
            <div className="max-h-[280px] overflow-y-auto" id="mktList"></div>
            <div className="flex items-center gap-4 py-2 px-3 border-t border-[#1f1f1f]">
              <span className="flex items-center gap-[5px] text-[11px] text-[#878c8f]">
                <kbd className="font-[var(--hl-font)] text-[10px] font-semibold text-white bg-white/[0.08] border border-[#1f1f1f] rounded-[3px] py-px px-[5px] leading-[1.6]">↑↓</kbd> Navigate
              </span>
              <span className="flex items-center gap-[5px] text-[11px] text-[#878c8f]">
                <kbd className="font-[var(--hl-font)] text-[10px] font-semibold text-white bg-white/[0.08] border border-[#1f1f1f] rounded-[3px] py-px px-[5px] leading-[1.6]">Enter</kbd> Select
              </span>
              <span className="flex items-center gap-[5px] text-[11px] text-[#878c8f]">
                <kbd className="font-[var(--hl-font)] text-[10px] font-semibold text-white bg-white/[0.08] border border-[#1f1f1f] rounded-[3px] py-px px-[5px] leading-[1.6]">Esc</kbd> Close
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0 flex-1 overflow-hidden px-3 py-0">
          <div className="flex flex-col items-start py-0 px-3.5 border-r border-[#1f1f1f] gap-px shrink-0 first:pl-0">
            <span className="text-[9px] text-[#878c8f] tracking-[0.4px] uppercase" data-i18n="mark">
              Mark
            </span>
            <span className="text-[11px] text-white font-medium" id="statMark">
              —
            </span>
          </div>
          <div className="flex flex-col items-start py-0 px-3.5 border-r border-[#1f1f1f] gap-px shrink-0 first:pl-0">
            <span className="text-[9px] text-[#878c8f] tracking-[0.4px] uppercase" data-i18n="change24h">
              24h Change
            </span>
            <span className="text-[11px] text-white font-medium" id="statChange">
              —
            </span>
          </div>
          <div className="flex flex-col items-start py-0 px-3.5 border-r border-[#1f1f1f] gap-px shrink-0 first:pl-0">
            <span className="text-[9px] text-[#878c8f] tracking-[0.4px] uppercase" data-i18n="volume24h">
              24h Volume
            </span>
            <span className="text-[11px] text-white font-medium" id="statVolume">
              —
            </span>
          </div>
          <div className="flex flex-col items-start py-0 px-3.5 border-r border-[#1f1f1f] gap-px shrink-0 first:pl-0">
            <span className="text-[9px] text-[#878c8f] tracking-[0.4px] uppercase" data-i18n="fundingCountdown">
              Funding / Countdown
            </span>
            <span className="text-[11px] text-white font-medium" id="statFunding">
              — / —
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span id="balanceDisplay" className="text-[11px] font-semibold text-[#50d2c1] px-2 tracking-[0.3px] hidden">
            $0.00
          </span>
          <button
            id="depositBtn"
            className="font-[var(--hl-font)] text-[11px] font-semibold py-[5px] px-3 bg-transparent border border-[#50d2c1] text-[#50d2c1] rounded-md cursor-pointer tracking-[0.5px] hover:bg-[#50d2c1] hover:text-[#04060c] hidden"
            onClick={() => (window as any).rdo?.openDeposit()}
            data-i18n="deposit"
          >
            DEPOSIT
          </button>
          <button
            id="rubBtn"
            className="font-[var(--hl-font)] text-[11px] font-bold py-[5px] px-[11px] bg-transparent border border-[#5a3800] rounded-md text-[#d4870a] cursor-pointer tracking-[0.3px] hover:border-[#d4870a] hover:text-[#f0a020] hover:bg-[rgba(212,135,10,0.08)] hidden"
            onClick={() => (window as any).rdo?.openOnramp()}
          >
            ₽ RUB
          </button>
          <WalletControls />
        </div>
      </header>

      {/* ══ WORKSPACE ════════════════════════════════════════════ */}
      <div className="grid overflow-hidden border-b border-[#1f1f1f]" style={{ gridTemplateColumns: "var(--xt) 1fr var(--tr) var(--tp)" }}>
        {/* X Tracker */}
        <aside className="flex flex-col border-r border-[#1f1f1f] bg-[var(--hl-bg-base)] overflow-hidden relative">
          <div className="flex items-center justify-between pl-6 pr-4 h-12 shrink-0 border-b border-[#1f1f1f]">
            <span className="xt-title" data-i18n="tracker">
              Tracker
            </span>
            <button
              className="xt-connect-btn"
              id="xtConnectBtn"
              onClick={() => (window as any).rdo?.connectX()}
              data-i18n="connectX"
            >
              Connect X
            </button>
          </div>
          <div className="flex-1 overflow-y-auto" id="xtFeed">
            <div className="xt-empty">
              Connect your X account to see real-time news and mentions for{" "}
              <span className="text-[var(--hl-accent)] font-semibold" id="xtTicker">
                BTC
              </span>
            </div>
          </div>
          <div className="xt-resize-handle absolute top-0 -right-[3px] w-[6px] h-full z-10 cursor-col-resize" id="xtResizeHandle"></div>
        </aside>

        {/* Chart */}
        <section className="flex flex-col border-r border-[#1f1f1f] overflow-hidden bg-[var(--hl-bg-page)]">
          <div className="relative flex items-center justify-between px-2 border-b border-[#1f1f1f] bg-[var(--hl-bg-page)] shrink-0 h-12">
            <div className="flex items-center gap-3 min-w-0">
              <span id="chartLabel" className="text-[11px] text-[var(--hl-text-secondary)] whitespace-nowrap">
                BTCUSD · 1m · RDO ONE
              </span>
              <span id="chartOhlc" className="chart-ohlc">
                O <b id="oO">—</b>&nbsp; H <b id="oH">—</b>&nbsp; L{" "}
                <b id="oL">—</b>&nbsp; C <b id="oC">—</b>
              </span>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 flex gap-px shrink-0">
              <button className="iv-btn active" data-iv="1">
                1m
              </button>
              <button className="iv-btn" data-iv="3">
                3m
              </button>
              <button className="iv-btn" data-iv="5">
                5m
              </button>
              <button className="iv-btn" data-iv="15">
                15m
              </button>
              <button className="iv-btn" data-iv="60">
                1h
              </button>
              <button className="iv-btn" data-iv="240">
                4h
              </button>
              <button className="iv-btn" data-iv="1440">
                1D
              </button>
            </div>
            <div className="shrink-0">
              <button className="font-[var(--hl-font)] text-[11px] font-bold text-[var(--hl-text-secondary)] bg-transparent border-none rounded-[7px] py-1 px-2.5 cursor-pointer transition-colors duration-100 hover:text-white hover:bg-[#1a1a1a]" title="Indicators">
                <span data-i18n="indicators">Indicators</span>
              </button>
              <button
                className="font-[var(--hl-font)] text-[11px] font-bold text-[var(--hl-text-secondary)] bg-transparent border-none rounded-[7px] py-1 px-2.5 cursor-pointer transition-colors duration-100 hover:text-white hover:bg-[#1a1a1a]"
                onClick={() => (window as any).toggleObFloat?.()}
                title="Order Book"
              >
                Order Book
              </button>
            </div>
          </div>
          <div className="flex flex-1 overflow-hidden relative">
            <div className="flex flex-col items-center w-[30px] border-r border-[#1f1f1f] bg-[var(--hl-bg-page)] py-1.5 gap-0.5 shrink-0">
              <button className="dt" title="Cursor">
                ✛
              </button>
              <button className="dt" title="Crosshair">
                ⊕
              </button>
              <div className="dt-sep"></div>
              <button className="dt" title="Trend line">
                ╱
              </button>
              <button className="dt" title="Horizontal line">
                —
              </button>
              <button className="dt" title="Rectangle">
                ▭
              </button>
              <button className="dt" title="Fibonacci">
                ∿
              </button>
              <div className="dt-sep"></div>
              <button className="dt" title="Text">
                T
              </button>
              <div className="dt-sep"></div>
              <button className="dt" title="Magnet">
                ⊙
              </button>
            </div>
            <div className="flex-1 relative overflow-hidden min-h-0" id="priceChart"></div>
          </div>
        </section>

        {/* Live Trades */}
        <section className="flex flex-col border-r border-[#1f1f1f] bg-[var(--hl-bg-base)] overflow-hidden">
          <div className="flex items-center justify-between px-4 h-12 shrink-0 border-b border-[#1f1f1f]">
            <span className="text-[11px] font-semibold text-white" data-i18n="liveTrades">
              Live Trades
            </span>
            <span className="text-[10px] text-[var(--hl-text-secondary)]" id="tradesPair">
              BTC-USDC
            </span>
          </div>
          <div className="grid grid-cols-3 px-4 py-[3px] border-b border-[#1f1f1f] shrink-0">
            <span className="text-[9px] text-[var(--hl-text-light)] uppercase tracking-[0.3px]" data-i18n="price">Price</span>
            <span className="text-[9px] text-[var(--hl-text-light)] uppercase tracking-[0.3px] text-right" data-i18n="size">Size</span>
            <span className="text-[9px] text-[var(--hl-text-light)] uppercase tracking-[0.3px] text-right" data-i18n="time">Time</span>
          </div>
          <div id="tradesList" className="flex-1 overflow-y-auto"></div>
        </section>

        {/* Trade Panel */}
        <aside className="flex flex-col bg-[var(--hl-bg-base)] overflow-y-auto">
          <div className="flex items-center gap-1 py-2 px-2 pb-1.5 border-b border-[#1f1f1f] shrink-0 h-12 box-border">
            <select className="tp-select" id="marginType">
              <option data-i18n="cross">Cross</option>
              <option data-i18n="isolated">Isolated</option>
            </select>
            <div className="flex items-center gap-px bg-[var(--hl-bg-elevated)] border border-[var(--hl-border)] rounded-[var(--hl-radius)] py-1 px-1.5">
              <input
                id="levInput"
                className="w-[30px] bg-transparent border-none outline-none font-[var(--hl-font)] text-[11px] text-white text-center"
                type="number"
                min={1}
                max={50}
                defaultValue={20}
              />
              <span className="text-[10px] text-[var(--hl-text-secondary)]">x</span>
            </div>
            <select className="tp-select">
              <option data-i18n="unified">Unified</option>
            </select>
          </div>
          <div className="flex border-b border-[#1f1f1f] shrink-0 h-8">
            <button
              className="tp-otab active"
              data-ot="market"
              data-i18n="market"
            >
              Market
            </button>
            <button className="tp-otab" data-ot="limit" data-i18n="limit">
              Limit
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1 py-2 px-2 pb-1.5 shrink-0">
            <button
              id="btnBuy"
              className="tp-side tp-buy active"
              onClick={() => (window as any).rdo?.setSide(true)}
              data-i18n="buyLong"
            >
              Buy / Long
            </button>
            <button
              id="btnSell"
              className="tp-side tp-sell"
              onClick={() => (window as any).rdo?.setSide(false)}
              data-i18n="sellShort"
            >
              Sell / Short
            </button>
          </div>
          <div className="px-2 pb-2 flex flex-col gap-1.5 shrink-0">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-[var(--hl-text-secondary)]" data-i18n="availableTrade">
                Available to Trade
              </span>
              <span id="tpAvail" className="text-[var(--hl-text-soft)]">
                0.00 USDC
              </span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-[var(--hl-text-secondary)]" data-i18n="currentPosition">
                Current Position
              </span>
              <span id="tpCurPos" className="text-[var(--hl-text-soft)]">
                0.00000 BTC
              </span>
            </div>
            <div className="text-[9px] text-[var(--hl-text-secondary)] tracking-[0.4px] uppercase mt-0.5" data-i18n="size">
              Size
            </div>
            <div className="tp-size-wrap">
              <input
                id="sizeInput"
                className="flex-1 bg-transparent border-none outline-none font-[var(--hl-font)] text-[13px] font-medium text-white py-[7px] px-2 placeholder:text-[var(--hl-text-secondary)] placeholder:text-[11px]"
                type="number"
                placeholder="0"
                min={0}
                onChange={() => (window as any).rdo?.updateStats()}
              />
              <div className="py-0 px-2 text-[10px] text-[var(--hl-text-secondary)] border-l border-[var(--hl-border)] cursor-default" id="sizeUnit">
                BTC
              </div>
            </div>
            <input
              id="sizeSlider"
              className="tp-slider"
              type="range"
              min={0}
              max={100}
              defaultValue={0}
              onChange={(e) => (window as any).rdo?.onSlider(e.target.value)}
            />
            <div className="flex justify-between text-[8px] text-[var(--hl-text-secondary)]">
              <span>0%</span>
              <span>25%</span>
              <span>50%</span>
              <span>75%</span>
              <span>100%</span>
            </div>
            <div className="flex flex-col gap-1 mt-0.5">
              <label className="tp-check">
                <input type="checkbox" id="chkReduce" />
                <span data-i18n="reduceOnly">Reduce Only</span>
              </label>
              <label className="tp-check">
                <input type="checkbox" id="chkTpSl" />
                <span data-i18n="tpsl">Take Profit / Stop Loss</span>
              </label>
            </div>
            <button
              id="tradeBtn"
              className="tp-action-btn tp-buy-bg"
              onClick={() => (window as any).rdo?.submitTrade()}
            >
              Connect
            </button>
            <div id="tradeErr" className="tp-err hidden"></div>
            <div className="flex flex-col gap-1 border-t border-[#1f1f1f] pt-2 mt-0.5">
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="liqPrice">Liquidation Price</span>
                <span id="stLiq">N/A</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="orderValue">Order Value</span>
                <span id="stVal">N/A</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="marginRequired">Margin Required</span>
                <span id="stMargin">--</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="slippage">Slippage</span>
                <span id="stSlip">--</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="fee">Fee</span>
                <span id="stFee">0.0450% / 0.0150%</span>
              </div>
            </div>
            <div className="text-[9px] tracking-[0.8px] text-[var(--hl-text-secondary)] uppercase py-1.5 pt-1.5 pb-0.5 border-t border-[#1f1f1f] mt-1" data-i18n="accountEquity">
              Account Equity
            </div>
            <div className="flex flex-col gap-1 border-t border-[#1f1f1f] pt-2 mt-0.5">
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="spot">Spot</span>
                <span id="eqSpot">$0.00</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span>
                  <a href="#" className="tp-link text-[var(--hl-text-secondary)] no-underline font-semibold hover:text-[var(--hl-accent)]" data-i18n="perps">
                    Perps
                  </a>
                </span>
                <span id="eqPerps">$0.00</span>
              </div>
            </div>
            <div className="text-[9px] tracking-[0.8px] text-[var(--hl-text-secondary)] uppercase py-1.5 pt-1.5 pb-0.5 border-t border-[#1f1f1f] mt-1" data-i18n="perpsOverview">
              Perps Overview
            </div>
            <div className="flex flex-col gap-1 border-t border-[#1f1f1f] pt-2 mt-0.5">
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span>
                  <a href="#" className="tp-link text-[var(--hl-text-secondary)] no-underline font-semibold hover:text-[var(--hl-accent)]" data-i18n="balance">
                    Balance
                  </a>
                </span>
                <span id="ovBalance">$0.00</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="unrealizedPnl">Unrealized PnL</span>
                <span id="ovPnl">$0.00</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="crossMarginRatio">Cross Margin Ratio</span>
                <span id="ovCmr">0.00%</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span>
                  <a href="#" className="tp-link text-[var(--hl-text-secondary)] no-underline font-semibold hover:text-[var(--hl-accent)]" data-i18n="maintenanceMargin">
                    Maintenance Margin
                  </a>
                </span>
                <span id="ovMm">$0.00</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span>
                  <a href="#" className="tp-link text-[var(--hl-text-secondary)] no-underline font-semibold hover:text-[var(--hl-accent)]" data-i18n="crossAccountLev">
                    Cross Account Leverage
                  </a>
                </span>
                <span id="ovLev">0.00x</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* ══ BOTTOM RESIZE ════════════════════════════════════════ */}
      <div
        className="h-1 bg-[#1f1f1f] cursor-ns-resize flex-shrink-0 relative transition-colors duration-150 hover:bg-[#50d2c1]"
        id="btmResizeHandle"
      ></div>

      {/* ══ BOTTOM PANEL ════════════════════════════════════════ */}
      <section className="flex flex-col bg-black overflow-hidden">
        <div className="flex items-center pt-1 px-4 pb-2 border-b border-[#1f1f1f] overflow-x-auto flex-shrink-0 gap-1">
          <button
            className="btm-tab active"
            data-bt="positions"
            data-i18n="positions"
          >
            Positions
          </button>
          <button className="btm-tab" data-bt="balances" data-i18n="balances">
            Balances
          </button>
          <button
            className="btm-tab"
            data-bt="open-orders"
            data-i18n="openOrders"
          >
            Open Orders
          </button>
          <button
            className="btm-tab"
            data-bt="trade-history"
            data-i18n="tradeHistory"
          >
            Trade History
          </button>
          <button
            className="btm-tab"
            data-bt="funding"
            data-i18n="fundingHistory"
          >
            Funding History
          </button>
          <button
            className="btm-tab"
            data-bt="order-history"
            data-i18n="orderHistory"
          >
            Order History
          </button>
          <button className="btm-tab" data-bt="liq-map">
            Liq Map
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <div id="btPositions" className="h-full overflow-y-auto">
            <div className="flex px-4 py-2 border-b border-[#1f1f1f] sticky top-0 bg-black">
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="market">Market</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="mode">Mode</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="size">Size</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="positionValue">Position Value</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="entryPrice">Entry Price</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="markPrice">Mark Price</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="pnlRoe">PNL (ROE %)</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="liqPriceShort">Liq. Price</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="margin">Margin</span>
              <span className="flex-1 min-w-0 text-[11px] text-[#878c8f] whitespace-nowrap overflow-hidden text-ellipsis" data-i18n="funding">Funding</span>
            </div>
            <div id="posRows" className="p-0">
              <div className="py-5 px-3 text-[11px] text-[#878c8f] tracking-[0.4px]" data-i18n="noPositions">
                No open positions yet
              </div>
            </div>
          </div>
          <div id="btBalances" className="h-full overflow-y-auto hidden">
            <div className="py-5 px-3 text-[11px] text-[#878c8f] tracking-[0.4px]" data-i18n="connectBalances">
              Connect wallet to view balances
            </div>
          </div>
          <div id="btOpenOrders" className="h-full overflow-y-auto hidden">
            <div className="py-5 px-3 text-[11px] text-[#878c8f] tracking-[0.4px]" data-i18n="noOpenOrders">
              No open orders
            </div>
          </div>
          <div id="btTradeHistory" className="h-full overflow-y-auto hidden">
            <div className="py-5 px-3 text-[11px] text-[#878c8f] tracking-[0.4px]" data-i18n="noTradeHistory">
              No trade history
            </div>
          </div>
          <div id="btFunding" className="h-full overflow-y-auto hidden">
            <div className="py-5 px-3 text-[11px] text-[#878c8f] tracking-[0.4px]" data-i18n="noFundingHistory">
              No funding history
            </div>
          </div>
          <div id="btOrderHistory" className="h-full overflow-y-auto hidden">
            <div className="py-5 px-3 text-[11px] text-[#878c8f] tracking-[0.4px]" data-i18n="noOrderHistory">
              No order history
            </div>
          </div>
          <div
            id="btLiqMap"
            className="h-full overflow-y-auto hidden"
            style={{ display: "none", padding: 0, flexDirection: "row" }}
          >
            <div
              id="lmpOuter"
              style={{
                display: "flex",
                flexDirection: "row",
                height: "100%",
                width: "70%",
                borderRight: "1px solid var(--hl-border)",
              }}
            >
              <div
                id="lmpLeft"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  minWidth: 120,
                  borderRight: "1px solid var(--hl-border)",
                }}
              >
                <div className="lmp-hdr">
                  <span className="lmp-title">Liquidation Map</span>
                  <div className="lmp-sym-pills" id="lmpSymPills"></div>
                  <div className="lmp-tabs" id="lmpTabs">
                    <button className="lmp-tab active" data-tab="liqmap">
                      Liq Map
                    </button>
                    <button className="lmp-tab" data-tab="oi">
                      OI Flow
                    </button>
                  </div>
                </div>
                <div
                  id="lmpBody"
                  className="lmp-body"
                  style={{ flex: 1, height: "auto" }}
                >
                  <div className="lmp-loading">Loading…</div>
                </div>
                <div
                  id="lmpOiBody"
                  className="lmp-oi-body"
                  style={{ display: "none", flex: 1, height: "auto" }}
                >
                  <div className="lmp-loading">Loading…</div>
                </div>
              </div>
              <div
                id="lmpRight"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  width: 600,
                  flexShrink: 0,
                }}
              >
                <div className="lmp-hdr">
                  <span className="lmp-title">AI Signals</span>
                  <span
                    style={{
                      fontSize: 9,
                      color: "var(--hl-text-muted)",
                      marginLeft: "auto",
                    }}
                    id="lmpAiSym"
                  ></span>
                </div>
                <div className="lmp-ai-body" id="lmpAiBody">
                  <div className="lmp-loading">Loading…</div>
                </div>
                <div
                  className="lmp-verdict"
                  id="lmpVerdict"
                  style={{ display: "none" }}
                >
                  <span className="lmp-verdict-lbl">Signal</span>
                  <span className="lmp-verdict-val" id="lmpVerdictVal">
                    —
                  </span>
                </div>
              </div>
            </div>
            <div
              id="lmpGuide"
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minWidth: 0,
              }}
            >
              <div className="lmp-hdr">
                <span className="lmp-title">How to read</span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  overflowY: "scroll",
                  flex: 1,
                  padding: "12px 14px 16px",
                  gap: 12,
                  scrollbarWidth: "thin",
                  scrollbarColor: "var(--hl-border) transparent",
                }}
              >
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--hl-text-primary)",
                    }}
                  >
                    Nearest Liquidation Zones
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "var(--hl-text-secondary)",
                      lineHeight: 1.55,
                    }}
                  >
                    The 2 closest liquidation clusters to the current price —
                    what happens if price reaches them.
                  </div>
                  <div
                    id="lmpClosestBars"
                    style={{ display: "flex", flexDirection: "column", gap: 7 }}
                  >
                    <div
                      style={{ fontSize: 10, color: "var(--hl-text-muted)" }}
                    >
                      Waiting for data…
                    </div>
                  </div>
                </div>
                <div
                  style={{ height: 1, background: "var(--hl-border)" }}
                ></div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--hl-text-primary)",
                    }}
                  >
                    Liquidation Map
                  </div>
                  <div
                    style={{
                      fontSize: "10.5px",
                      color: "var(--hl-text-secondary)",
                      lineHeight: 1.6,
                    }}
                  >
                    Each bar is a{" "}
                    <b style={{ color: "var(--hl-text-primary)" }}>
                      price level
                    </b>{" "}
                    with leveraged positions stacked on it. The wider the bar,
                    the more USD is at risk of forced liquidation at that price.
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      marginTop: 2,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: "10.5px",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            width: 11,
                            height: 11,
                            background: "#ff7caa",
                            borderRadius: 2,
                            flexShrink: 0,
                          }}
                        ></span>
                        <b style={{ color: "var(--hl-text-primary)" }}>
                          Pink bars (above price)
                        </b>
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--hl-text-secondary)",
                          lineHeight: 1.55,
                        }}
                      >
                        Short positions. Price rising into these triggers their
                        liquidation, injecting cascading buy orders into the
                        market.
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: "10.5px",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            width: 11,
                            height: 11,
                            background: "#7cffc0",
                            borderRadius: 2,
                            flexShrink: 0,
                          }}
                        ></span>
                        <b style={{ color: "var(--hl-text-primary)" }}>
                          Green bars (below price)
                        </b>
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--hl-text-secondary)",
                          lineHeight: 1.55,
                        }}
                      >
                        Long positions. Price falling into these forces
                        liquidation, injecting cascading sell orders into the
                        market.
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--hl-text-muted)",
                      marginTop: 2,
                      lineHeight: 1.6,
                    }}
                  >
                    Large clusters act like{" "}
                    <b style={{ color: "var(--hl-text-primary)" }}>magnets</b> —
                    price tends to move toward them because market makers hunt
                    that liquidity.
                  </div>
                </div>
                <div
                  style={{ height: 1, background: "var(--hl-border)" }}
                ></div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--hl-text-primary)",
                    }}
                  >
                    OI Flow
                  </div>
                  <div
                    style={{
                      fontSize: "10.5px",
                      color: "var(--hl-text-secondary)",
                      lineHeight: 1.6,
                    }}
                  >
                    Open Interest = total $ value of all open contracts. OI Flow
                    shows how it changed every 5 minutes.
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 5,
                      marginTop: 2,
                      fontSize: "10.5px",
                      color: "var(--hl-text-secondary)",
                      lineHeight: 1.6,
                    }}
                  >
                    <div>
                      <b style={{ color: "#7cffc0" }}>
                        OI rising + price rising
                      </b>{" "}
                      — new longs opening, bullish
                    </div>
                    <div>
                      <b style={{ color: "#ff7caa" }}>
                        OI rising + price falling
                      </b>{" "}
                      — new shorts opening, bearish
                    </div>
                    <div>
                      <b>OI falling + price rising</b> — shorts squeezed/closed,
                      momentum could fade
                    </div>
                    <div>
                      <b>OI falling + price falling</b> — longs closing in
                      panic, potential capitulation
                    </div>
                  </div>
                </div>
                <div
                  style={{ height: 1, background: "var(--hl-border)" }}
                ></div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--hl-text-primary)",
                    }}
                  >
                    AI Signals
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 7,
                      marginTop: 2,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "10.5px",
                        color: "var(--hl-text-secondary)",
                        lineHeight: 1.6,
                      }}
                    >
                      <b style={{ color: "var(--hl-text-primary)" }}>
                        L/S Ratio
                      </b>{" "}
                      — what % of traders are long vs short.
                    </div>
                    <div
                      style={{
                        fontSize: "10.5px",
                        color: "var(--hl-text-secondary)",
                        lineHeight: 1.6,
                      }}
                    >
                      <b style={{ color: "var(--hl-text-primary)" }}>
                        Taker Flow
                      </b>{" "}
                      — who is being aggressive: buyers or sellers.
                    </div>
                    <div
                      style={{
                        fontSize: "10.5px",
                        color: "var(--hl-text-secondary)",
                        lineHeight: 1.6,
                      }}
                    >
                      <b style={{ color: "var(--hl-text-primary)" }}>Funding</b>{" "}
                      — positive = longs paying shorts. Negative = shorts paying
                      longs.
                    </div>
                    <div
                      style={{
                        fontSize: "10.5px",
                        color: "var(--hl-text-secondary)",
                        lineHeight: 1.6,
                      }}
                    >
                      <b style={{ color: "var(--hl-text-primary)" }}>
                        OI Trend
                      </b>{" "}
                      — short-term direction of open interest.
                    </div>
                    <div
                      style={{
                        fontSize: "10.5px",
                        color: "var(--hl-text-secondary)",
                        lineHeight: 1.6,
                      }}
                    >
                      <b style={{ color: "var(--hl-text-primary)" }}>
                        24h Price
                      </b>{" "}
                      — session context for signals.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

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

      {/* Deposit modal */}
      <div
        id="depositModal"
        className="modal-overlay hidden"
        onClick={(e) => (window as any).rdo?.closeDeposit(e)}
      >
        <div className="modal-box">
          <div className="modal-header">
            <div>
              <div className="modal-title" data-i18n="depositFunds">
                DEPOSIT FUNDS
              </div>
              <div className="modal-sub" data-i18n="depositSub">
                Swap any token → USDC on Hyperliquid
              </div>
            </div>
            <span
              className="modal-close"
              onClick={() => (window as any).rdo?.closeDeposit()}
            >
              ✕
            </span>
          </div>
          <div className="deposit-steps">
            <div className="step">
              <span className="step-num">1</span>
              <span data-i18n="step1">Pick source token</span>
            </div>
            <div className="step">
              <span className="step-num">2</span>
              <span data-i18n="step2">Approve in Phantom</span>
            </div>
            <div className="step">
              <span className="step-num">3</span>
              <span data-i18n="step3">USDC arrives in ~2 min</span>
            </div>
          </div>
          <div className="deposit-addr-box">
            <div className="deposit-addr-label" data-i18n="yourHlAddr">
              Your Hyperliquid address
            </div>
            <div
              className="deposit-addr"
              id="depositAddr"
              data-i18n="connectFirst"
            >
              Connect wallet first
            </div>
          </div>
          <div className="deposit-routes">
            <div className="deposit-route">
              <span className="deposit-route-from">Solana (SOL / USDC)</span>
              <span className="deposit-route-arrow">→</span>
              <span className="deposit-route-to">HyperEVM via LI.FI</span>
              <span className="deposit-route-time">~2 min</span>
            </div>
            <div className="deposit-route">
              <span className="deposit-route-from">Ethereum (ETH / USDC)</span>
              <span className="deposit-route-arrow">→</span>
              <span className="deposit-route-to">HyperEVM via LI.FI</span>
              <span className="deposit-route-time">~3 min</span>
            </div>
            <div className="deposit-route">
              <span className="deposit-route-from" data-i18n="directDeposit">
                Direct USDC deposit
              </span>
              <span className="deposit-route-arrow">→</span>
              <span className="deposit-route-to" data-i18n="sendToAddr">
                Send to address above on HyperEVM
              </span>
              <span className="deposit-route-time">~1 min</span>
            </div>
          </div>
        </div>
      </div>

      {/* Onramp modal */}
      <div
        id="onrampModal"
        className="modal-overlay hidden"
        onClick={(e) => (window as any).rdo?.closeOnramp(e)}
      >
        <div className="modal-box" style={{ maxWidth: 400 }}>
          <div className="modal-header" style={{ padding: "16px 18px 0" }}>
            <div>
              <div className="modal-title">DEPOSIT RUB → PERPS</div>
              <div className="modal-sub">
                Купи USDT за рубли и отправь на перпы
              </div>
            </div>
            <span
              className="modal-close"
              onClick={() => (window as any).rdo?.closeOnrampForce()}
            >
              ✕
            </span>
          </div>
          <div className="onramp-body">
            <div className="onramp-addr-box">
              <div className="onramp-addr-label">
                Адрес Antarctic Wallet (USDT)
              </div>
              <div className="onramp-addr-row">
                <span className="onramp-address" id="onrampAddress">
                  —
                </span>
                <button className="onramp-copy-btn" id="onrampCopyBtn">
                  Copy
                </button>
              </div>
            </div>
            <div className="onramp-steps">
              <div className="onramp-step">
                <span className="onramp-num">1</span>Купи USDT за рубли на UTORG
                или Mercuryo
              </div>
              <div className="onramp-step">
                <span className="onramp-num">2</span>USDT придёт в Antarctic
                Wallet (~5 мин)
              </div>
              <div className="onramp-step">
                <span className="onramp-num">3</span>Нажми DEPOSIT → LI.FI для
                отправки на перпы
              </div>
            </div>
            <div className="onramp-providers">
              <button className="onramp-provider-btn onramp-utorg">
                <span className="onramp-prov-name">UTORG</span>
                <span className="onramp-prov-tag">Рекомендуем для РФ</span>
              </button>
              <button className="onramp-provider-btn onramp-mercuryo">
                <span className="onramp-prov-name">Mercuryo</span>
                <span className="onramp-prov-tag">Альтернатива</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      <div id="toastWrap" className="toast-wrap"></div>

      {/* Floating order book */}
      <div id="obFloat" className="fixed z-[9999] flex flex-col w-[320px] max-h-[80vh] bg-[var(--hl-bg-elevated)] border border-[var(--hl-border)] rounded-[var(--hl-radius)] shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden" style={{ display: "none" }}>
        <div className="flex items-center py-2 px-3 bg-[var(--hl-bg-overlay)] border-b border-[var(--hl-border)] cursor-grab select-none shrink-0 active:cursor-grabbing" id="obFloatHdr">
          <span className="text-[11px] font-bold tracking-[0.05em] uppercase text-[var(--hl-text-secondary)] flex-1">Order Book</span>
          <button
            className="bg-none border-none text-[var(--hl-text-muted)] text-[13px] cursor-pointer px-0.5 leading-none hover:text-white"
            onClick={() => {
              const el = document.getElementById("obFloat");
              if (el) el.style.display = "none";
            }}
          >
            ✕
          </button>
        </div>
        <div className="ob-mini border-t border-[var(--hl-border)] shrink-0 mt-2" id="obMini">
          <div
            className="ob-mini-hdr flex items-center justify-between py-1.5 px-2 pb-2.5"
            onClick={() => (window as any).rdo?.toggleOrderBook()}
            style={{ cursor: "pointer" }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[var(--hl-text-secondary)] whitespace-nowrap mr-1.5" data-i18n="orderBook">
              Order Book
            </span>
            <button
              className="ob-toggle-btn"
              id="obToggleBtn"
              aria-label="Toggle order book"
            ></button>
            <div className="ob-colhdr grid grid-cols-3 px-2 ml-auto" id="obColHdr" style={{ flex: 1 }}>
              <span className="text-[9px] text-[var(--hl-text-light)] uppercase tracking-[0.3px]" data-i18n="price">Price</span>
              <span className="text-[9px] text-[var(--hl-text-light)] uppercase tracking-[0.3px] text-right" data-i18n="size">Size</span>
              <span className="text-[9px] text-[var(--hl-text-light)] uppercase tracking-[0.3px] text-right" data-i18n="total">Total</span>
            </div>
          </div>
          <div id="obBody">
            <div id="obAsks" className="overflow-hidden flex flex-col flex-col-reverse"></div>
            <div className="flex items-center gap-1.5 py-1 px-2 border-y border-[#1f1f1f] shrink-0 my-2">
              <span className="text-[9px] text-[var(--hl-text-secondary)] flex-1 uppercase tracking-[0.4px]" data-i18n="spread">
                Spread
              </span>
              <span id="obSpreadVal" className="text-[11px] text-white">
                —
              </span>
              <span id="obSpreadPct" className="text-[9px] text-[var(--hl-text-muted)]"></span>
            </div>
            <div id="obBids" className="overflow-hidden pb-2"></div>
            <div className="flex h-[22px] shrink-0 border-t border-[#1f1f1f] text-[10px] font-bold overflow-hidden" id="obRatio">
              <div
                className="flex items-center pl-[7px] transition-[width] duration-300 whitespace-nowrap overflow-hidden"
                id="obRatioBid"
                style={{ width: "50%" }}
              >
                B 50.0%
              </div>
              <div className="flex items-center justify-end pr-[7px] flex-1 transition-[width] duration-300 whitespace-nowrap overflow-hidden" id="obRatioAsk">
                50.0% S
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
