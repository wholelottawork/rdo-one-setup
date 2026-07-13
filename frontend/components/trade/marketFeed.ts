// Trade page (/) — market feed: candles + order-book stream + live-trades
// socket for the selected symbol, and loadMarket (the symbol-switch hub).
// Extracted from TradingTerminal's init(); the chart/trading library fns,
// leverage sync, and header stats arrive as deps, mutable scalars via
// getters. recentTrades / stopBook / asterTradeWs are owned here.
import { fmt, fmtAster, fmtSz } from "@/lib/format";

// Backend rewrite to Aster's public futures API (see next.config.js).
const ASTER_API = "/aster-fapi";

export function createMarketFeed(deps: {
  getMode: () => string;
  getMarket: () => string;
  getIv: () => number;
  getCandles: (sym: string, iv: number, count: number) => Promise<any>;
  setCandles: (data: any, sym: string) => void;
  getL2Book: (sym: string) => Promise<any>;
  startBookStream: (sym: string, cb: (sym: string, book: any) => void) => any;
  syncLevMax: (sym: string) => void;
  updateHeaderStats: () => void;
}) {
  let recentTrades: any[] = [];
  let stopBook: any = null;
  let asterTradeWs: WebSocket | null = null;

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

  // stopBook is a stream cleanup fn in HL mode but a poll interval id
  // in Aster mode — handle both, and always tear down the previous
  // mode's feed before starting the new one.
  function stopBookFeed() {
    if (!stopBook) return;
    if (typeof stopBook === "function") stopBook();
    else clearInterval(stopBook);
    stopBook = null;
  }

  async function loadMarket(sym: string) {
    deps.syncLevMax(sym);
    const suffix = deps.getMode() === "aster" ? "-USDT" : "-USDC";
    const pairEl = document.getElementById("tradesPair");
    if (pairEl) pairEl.textContent = sym + suffix;
    const xtEl = document.getElementById("xtTicker");
    if (xtEl) xtEl.textContent = sym;

    if (deps.getMode() === "aster") {
      const data = await getAsterCandles(sym, deps.getIv(), 200);
      deps.setCandles(data, sym);
      recentTrades = [];
      renderTrades();
      startAsterTrades(sym);
      stopBookFeed();
      getAsterBook(sym).then((book) => renderOrderBook(sym, book));
      stopBook = setInterval(async () => {
        if (deps.getMode() !== "aster" || deps.getMarket() !== sym) {
          clearInterval(stopBook);
          return;
        }
        const book = await getAsterBook(sym);
        renderOrderBook(sym, book);
      }, 2000);
    } else {
      const data = await deps.getCandles(sym, deps.getIv(), 200);
      deps.setCandles(data, sym);
      deps.updateHeaderStats();
      stopAsterTrades();
      stopBookFeed();
      deps.getL2Book(sym).then((book) => renderOrderBook(sym, book));
      stopBook = deps.startBookStream(sym, renderOrderBook);
    }
  }

  function renderOrderBook(sym: string, { asks, bids }: any) {
    if (sym !== deps.getMarket()) return;
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
        deps.getMode() === "aster"
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
          deps.getMode() === "aster"
            ? fmtAster(tr.px, deps.getMarket())
            : fmt(tr.px, deps.getMarket());
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
      if (deps.getMode() !== "aster" || deps.getMarket() !== sym) return;
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
      if (deps.getMode() === "aster" && deps.getMarket() === sym)
        setTimeout(() => {
          if (deps.getMode() === "aster" && deps.getMarket() === sym)
            startAsterTrades(sym);
        }, 5000);
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {}
    };
  }

  // Drop the trades list and show the connecting placeholder — used on
  // mode switch before the new venue's stream opens.
  function resetTrades() {
    recentTrades = [];
    renderTrades();
  }

  return { loadMarket, pushTrade, resetTrades, getAsterCandles };
}
