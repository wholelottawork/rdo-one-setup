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

export function renderFills(fills: any[]) {
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

// Aster has no bulk fills endpoint — pull per-symbol userTrades for the
// symbols with an open position (same approach as the root's getAsterFills).
export async function getAsterFillsLocal(addr: string) {
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

export function createBottomTabs(deps: {
  getMode: () => string;
  getAddr: () => string | null;
  getUserFills: (addr: string) => Promise<any[]>;
  getOpenOrders: (addr: string) => Promise<any[]>;
  getFundingHistory: (addr: string) => Promise<any[]>;
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
        if (tab === "balances") await deps.refreshPositions(addr);
      });
    });
  }
  return { bindBtmTabs };
}
