// Trade page (/) — bottom-panel tab machinery: tab switching plus the
// open-orders / trade-history / funding-history loaders and renderers for
// both venues. Extracted from TradingTerminal's init(); the terminal
// supplies mode/address getters, the HL loaders, and its refresh fn — the
// Aster loaders and DOM renderers below are self-contained.
import { fmt, fmtSz } from "@/lib/format";

const btmPaneMap: Record<string, string> = {
  positions: "btPositions",
  balances: "btBalances",
  "open-orders": "btOpenOrders",
  "trade-history": "btTradeHistory",
  funding: "btFunding",
  "order-history": "btOrderHistory",
  "liq-map": "btLiqMap",
};

// Merge individual fills into round-trip trades: reconstruct the net
// position per coin chronologically — everything between zero-crossings
// is ONE trade (handles scale-ins and partial closes). Works for both
// venues off the fill side (Buy adds, Sell reduces). A flip (one fill
// larger than the open group) over-closes it without opening the
// remainder as a new trade — acceptable for manual order flow.
function groupTrades(fills: any[]) {
  const chrono = [...fills].sort((a, b) => a.time - b.time);
  const openByCoin: Record<string, any> = {};
  const trades: any[] = [];
  for (const f of chrono) {
    let g = openByCoin[f.coin];
    if (!g) {
      g = {
        coin: f.coin,
        isLong: f.side === "Buy",
        entryPx: 0,
        entrySz: 0,
        closePx: 0,
        closeSz: 0,
        fee: 0,
        pnl: 0,
        openTime: f.time,
        closeTime: 0,
      };
      openByCoin[f.coin] = g;
      trades.push(g);
    }
    if ((f.side === "Buy") === g.isLong) {
      g.entryPx += f.price * f.size;
      g.entrySz += f.size;
    } else {
      g.closePx += f.price * f.size;
      g.closeSz += f.size;
      g.pnl += f.pnl;
      g.closeTime = f.time;
    }
    g.fee += f.fee;
    if (g.entrySz > 0 && g.closeSz >= g.entrySz - 1e-9)
      delete openByCoin[f.coin];
  }
  return trades.sort(
    (a, b) => (b.closeTime || b.openTime) - (a.closeTime || a.openTime),
  );
}

export function renderFills(fills: any[]) {
  const el = document.getElementById("btTradeHistory");
  if (!el) return;
  if (!fills.length) {
    el.innerHTML = '<div class="btm-empty">No trade history</div>';
    return;
  }
  const cols = "70px 60px 100px 100px 80px 80px 80px 1fr";
  el.innerHTML =
    `<div class="btm-col-hdr" style="grid-template-columns:${cols}"><span>Market</span><span>Side</span><span>Entry</span><span>Close</span><span>Size</span><span>Fee</span><span>PnL</span><span>Time</span></div>` +
    groupTrades(fills)
      .slice(0, 100)
      .map((g) => {
        const entry = g.entrySz ? g.entryPx / g.entrySz : 0;
        const close = g.closeSz ? g.closePx / g.closeSz : 0;
        const pnlCls = g.pnl > 0 ? "pnl-pos" : g.pnl < 0 ? "pnl-neg" : "";
        return `<div class="pos-row" style="grid-template-columns:${cols}"><span class="pos-sym">${g.coin}</span><span class="${g.isLong ? "dir-long" : "dir-short"}">${g.isLong ? "Long" : "Short"}</span><span>${fmt(entry, g.coin)}</span><span>${g.closeSz ? fmt(close, g.coin) : "—"}</span><span>${fmtSz(g.entrySz)}</span><span>$${g.fee.toFixed(4)}</span><span class="${pnlCls}">${(g.pnl > 0 ? "+" : "") + "$" + g.pnl.toFixed(2)}</span><span style="color:var(--hl-text-muted)">${new Date(g.closeTime || g.openTime).toLocaleString()}</span></div>`;
      })
      .join("");
}

export function renderOpenOrders(orders: any[]) {
  const el = document.getElementById("btOpenOrders");
  if (!el) return;
  if (!orders.length) {
    el.innerHTML = '<div class="btm-empty">No open orders</div>';
    return;
  }
  const cols = "70px 60px 130px 80px 80px 1fr 110px";
  el.innerHTML =
    `<div class="btm-col-hdr" style="grid-template-columns:${cols}"><span>Market</span><span>Side</span><span>Price</span><span>Size</span><span>Filled</span><span>Time</span><span></span></div>` +
    orders
      .map((o) => {
        const filled = o.origSize - o.size;
        // TP/SL triggers show their trigger price and get an Edit
        // button (HL: native modify; Aster: cancel + re-place).
        const pxCell = o.kind
          ? `${o.kind === "tp" ? "TP" : "SL"} @ ${fmt(o.triggerPx, o.coin)}`
          : fmt(o.price, o.coin);
        const editBtn = o.kind
          ? `<button class="pos-close-btn" onclick="window.rdo.editTrigger(${o.oid},'${o.coin}','${o.side}',${o.size},'${o.kind}',${o.reduceOnly},${o.triggerPx})">Edit</button> `
          : "";
        return `<div class="pos-row" style="grid-template-columns:${cols}"><span class="pos-sym">${o.coin}</span><span class="${o.side === "Buy" ? "dir-long" : "dir-short"}">${o.side}</span><span>${pxCell}</span><span>${fmtSz(o.size)}</span><span>${fmtSz(filled)}</span><span style="color:var(--hl-text-muted)">${new Date(o.time).toLocaleString()}</span><span>${editBtn}<button class="pos-close-btn" onclick="window.rdo.cancelOrd(${o.oid},'${o.coin}')">Cancel</button></span></div>`;
      })
      .join("");
}

export function renderFundingHistory(rows: any[]) {
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

// ── EXTRA/Aster bottom-tab data (open orders / fills / funding) ──
export async function getAsterOpenOrdersLocal(addr: string) {
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
        kind:
          o.type === "TAKE_PROFIT_MARKET"
            ? "tp"
            : o.type === "STOP_MARKET"
              ? "sl"
              : null,
        triggerPx:
          o.stopPrice && parseFloat(o.stopPrice) > 0
            ? parseFloat(o.stopPrice)
            : null,
        reduceOnly: !!o.reduceOnly,
      }));
  } catch {
    return [];
  }
}

export async function getAsterFundingLocal(addr: string) {
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

export async function getAsterOrderHistoryLocal(addr: string) {
  try {
    const r = await fetch(
      `/aster-signed/fapi/v3/allOrders?limit=100&user=${encodeURIComponent(addr)}`,
    );
    const data = await r.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((o: any) => ({
        coin: String(o.symbol ?? "").replace(/USDT$/, ""),
        side: o.side === "BUY" ? "Buy" : "Sell",
        price: parseFloat(o.price ?? 0),
        origSize: parseFloat(o.origQty ?? 0),
        orderType: String(o.type ?? ""),
        kind:
          o.type === "TAKE_PROFIT_MARKET"
            ? "tp"
            : o.type === "STOP_MARKET"
              ? "sl"
              : null,
        triggerPx:
          o.stopPrice && parseFloat(o.stopPrice) > 0
            ? parseFloat(o.stopPrice)
            : null,
        status: String(o.status ?? ""),
        oid: Number(o.orderId ?? 0),
        time: Number(o.updateTime ?? o.time ?? 0),
      }))
      .sort((a: any, b: any) => b.time - a.time);
  } catch {
    return [];
  }
}

// Aster userTrades works WITHOUT a symbol (unlike Binance) — one call
// returns recent fills across all symbols, whether or not anything is
// currently open. Scoping to open positions hid all history for flat
// accounts.
export async function getAsterFillsLocal(addr: string) {
  try {
    const r = await fetch(
      `/aster-signed/fapi/v3/userTrades?limit=100&user=${encodeURIComponent(addr)}`,
    );
    const data = await r.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((t: any) => ({
        coin: String(t.symbol ?? "").replace(/USDT$/, ""),
        side: t.side === "BUY" ? "Buy" : "Sell",
        price: parseFloat(t.price ?? 0),
        size: parseFloat(t.qty ?? 0),
        fee: parseFloat(t.commission ?? 0),
        pnl: parseFloat(t.realizedPnl ?? 0),
        dir: String(t.side ?? ""),
        time: Number(t.time ?? 0),
      }))
      .sort((a: any, b: any) => b.time - a.time);
  } catch {
    return [];
  }
}

export function renderOrderHistory(orders: any[]) {
  const el = document.getElementById("btOrderHistory");
  if (!el) return;
  if (!orders.length) {
    el.innerHTML = '<div class="btm-empty">No order history</div>';
    return;
  }
  const STATUS: Record<string, string> = {
    filled: "Filled",
    canceled: "Canceled",
    reduceOnlyCanceled: "Canceled",
    triggered: "Triggered",
    open: "Open",
    rejected: "Rejected",
    FILLED: "Filled",
    CANCELED: "Canceled",
    NEW: "Open",
    PARTIALLY_FILLED: "Partial",
    REJECTED: "Rejected",
    EXPIRED: "Expired",
  };
  const cols = "70px 60px 140px 110px 80px 90px 1fr";
  el.innerHTML =
    `<div class="btm-col-hdr" style="grid-template-columns:${cols}"><span>Market</span><span>Side</span><span>Type</span><span>Price</span><span>Size</span><span>Status</span><span>Time</span></div>` +
    orders
      .slice(0, 200)
      .map((o) => {
        const pxCell = o.kind
          ? `${o.kind === "tp" ? "TP" : "SL"} @ ${fmt(o.triggerPx, o.coin)}`
          : o.orderType === "MARKET"
            ? "Market"
            : fmt(o.price, o.coin);
        return `<div class="pos-row" style="grid-template-columns:${cols}"><span class="pos-sym">${o.coin}</span><span class="${o.side === "Buy" ? "dir-long" : "dir-short"}">${o.side}</span><span style="color:var(--hl-text-muted);font-size:10px">${o.orderType}</span><span>${pxCell}</span><span>${fmtSz(o.origSize)}</span><span>${STATUS[o.status] ?? o.status}</span><span style="color:var(--hl-text-muted)">${new Date(o.time).toLocaleString()}</span></div>`;
      })
      .join("");
}

export function createBottomTabs(deps: {
  getMode: () => string;
  getAddr: () => string | null;
  getUserFills: (addr: string) => Promise<any[]>;
  getOpenOrders: (addr: string) => Promise<any[]>;
  getFundingHistory: (addr: string) => Promise<any[]>;
  getOrderHistory: (addr: string) => Promise<any[]>;
  refreshPositions: (addr: string) => void;
}) {
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
        const addr = deps.getAddr();
        if (!addr) return;
        const tab = (btn as HTMLElement).dataset.bt;
        const aster = deps.getMode() === "aster";
        if (tab === "trade-history")
          renderFills(
            await (aster ? getAsterFillsLocal(addr) : deps.getUserFills(addr)),
          );
        if (tab === "open-orders")
          renderOpenOrders(
            await (aster
              ? getAsterOpenOrdersLocal(addr)
              : deps.getOpenOrders(addr)),
          );
        if (tab === "funding")
          renderFundingHistory(
            await (aster
              ? getAsterFundingLocal(addr)
              : deps.getFundingHistory(addr)),
          );
        if (tab === "order-history")
          renderOrderHistory(
            await (aster
              ? getAsterOrderHistoryLocal(addr)
              : deps.getOrderHistory(addr)),
          );
        if (tab === "balances") await deps.refreshPositions(addr);
      });
    });
  }
  return { bindBtmTabs };
}
