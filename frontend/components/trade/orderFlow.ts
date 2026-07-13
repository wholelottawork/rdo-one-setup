// Trade page (/) — order flow: the trade panel (side/size/leverage stats),
// order placement (HL wallet-signed, Aster agent-signed), position
// close/cancel, TP/SL add/edit, and the positions/balances refresh for
// both venues. Extracted verbatim from TradingTerminal's init() — these
// are the real-money paths; library fns, the wallet address getter, and
// the shared price/precision maps arrive as deps.
import { getEVMProvider } from "@/lib/wallet";
import { showToast } from "@/lib/toast";
import { fmt, fmtLarge, asterRound } from "@/lib/format";
import { createTpslDialog } from "./tpslDialog";
import { renderOpenOrders, getAsterOpenOrdersLocal } from "./bottomTabs";

export function createOrderFlow(deps: {
  getMode: () => string;
  getMarket: () => string;
  getAddr: () => string | null;
  livePrices: Record<string, number>;
  asterPrec: Record<string, { step: number; tick: number; minQty: number }>;
  connectWallet: () => Promise<void>;
  getMarketPrice: (sym: string) => Promise<number>;
  openPosition: (args: any) => Promise<any>;
  closePosition: (args: any) => Promise<any>;
  cancelOrder: (args: any) => Promise<any>;
  modifyTriggerOrder: (args: any) => Promise<any>;
  placeTpslOrders: (args: any) => Promise<any>;
  loadAccountState: (addr: string) => Promise<any>;
  getPositions: (addr: string) => Promise<any[]>;
  getOpenOrders: (addr: string) => Promise<any[]>;
}) {
  let isBuy = true;
  function setSide(buy: boolean) {
    isBuy = buy;
    document.getElementById("btnBuy")?.classList.toggle("active", buy);
    document.getElementById("btnSell")?.classList.toggle("active", !buy);
    if (deps.getAddr()) {
      const btn = document.getElementById("tradeBtn");
      if (btn) {
        btn.className =
          "tp-action-btn " + (buy ? "tp-buy-bg" : "tp-sell-bg");
        btn.textContent =
          (buy ? "Buy / Long " : "Sell / Short ") + deps.getMarket();
      }
    }
    updateStats();
  }

  function updateTradeBtn() {
    const addr = deps.getAddr();
    const btn = document.getElementById("tradeBtn");
    if (!btn) return;
    if (!addr) {
      btn.textContent = "Connect";
      return;
    }
    btn.textContent =
      (isBuy ? "Buy / Long " : "Sell / Short ") + deps.getMarket();
  }

  function updateStats() {
    const sizeEl = document.getElementById("sizeInput") as HTMLInputElement;
    const levEl = document.getElementById("levInput") as HTMLInputElement;
    const size = parseFloat(sizeEl?.value) || 0;
    const lev = parseFloat(levEl?.value) || 20;
    const px = deps.livePrices[deps.getMarket()] || 0;
    const notional = size * px;
    const margin = notional / lev;
    const liqMove = 0.975 / lev;
    const liqPx = px
      ? isBuy
        ? px * (1 - liqMove)
        : px * (1 + liqMove)
      : 0;
    const feeRate = deps.getMode() === "aster" ? 0.0004 : 0.00045;
    const feeLabel =
      deps.getMode() === "aster"
        ? "0.0400% Taker / 0.0000% Maker"
        : "0.0450% / 0.0150%";
    const feePct = deps.getMode() === "aster" ? "0.0400%" : "0.0450%";
    const el = (id: string, val: string) => {
      const e = document.getElementById(id);
      if (e) e.textContent = val;
    };
    el("stLiq", liqPx ? fmt(liqPx, deps.getMarket()) : "N/A");
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
    const addr = deps.getAddr();
    if (!addr) return;
    const avEl = document.getElementById("tpAvail");
    const avail =
      parseFloat(avEl?.textContent?.replace(/[^0-9.]/g, "") || "0") || 0;
    const levEl = document.getElementById("levInput") as HTMLInputElement;
    const lev = parseFloat(levEl?.value) || 20;
    const px = deps.livePrices[deps.getMarket()] || 0;
    if (!px) return;
    const sizeEl = document.getElementById("sizeInput") as HTMLInputElement;
    if (sizeEl)
      sizeEl.value = ((avail * lev * (parseInt(val) / 100)) / px).toFixed(
        6,
      );
    updateStats();
  }

  async function submitTrade() {
    const addr = deps.getAddr();
    if (!addr) {
      await deps.connectWallet();
      return;
    }
    const sizeEl = document.getElementById("sizeInput") as HTMLInputElement;
    const levEl = document.getElementById("levInput") as HTMLInputElement;
    const size = parseFloat(sizeEl?.value);
    const lev = parseFloat(levEl?.value) || 20;
    const px =
      deps.livePrices[deps.getMarket()] || (await deps.getMarketPrice(deps.getMarket()));
    if (!size || size <= 0) {
      showErr("Enter a size");
      return;
    }
    const tpslOn =
      (document.getElementById("chkTpSl") as HTMLInputElement)?.checked ??
      false;
    const reduceOnly =
      (document.getElementById("chkReduce") as HTMLInputElement)?.checked ??
      false;
    const tpPx = tpslOn
      ? parseFloat(
          (document.getElementById("tpPrice") as HTMLInputElement)?.value,
        ) || 0
      : 0;
    const slPx = tpslOn
      ? parseFloat(
          (document.getElementById("slPrice") as HTMLInputElement)?.value,
        ) || 0
      : 0;
    // Trigger on the wrong side of mark would fire instantly — catch it
    // here rather than after the entry has already filled.
    if (tpPx && (isBuy ? tpPx <= px : tpPx >= px)) {
      showErr("TP must be " + (isBuy ? "above" : "below") + " mark price");
      return;
    }
    if (slPx && (isBuy ? slPx >= px : slPx <= px)) {
      showErr("SL must be " + (isBuy ? "below" : "above") + " mark price");
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
    if (deps.getMode() === "aster") {
      // Snap size/prices to the symbol's grid — off-grid orders are
      // rejected (-1111), and Aster's real {code,msg} now reaches us.
      const prec = deps.asterPrec[deps.getMarket()];
      const qty = prec ? asterRound(size, prec.step) : size;
      if (!qty || (prec && qty < prec.minQty)) {
        showToast(
          `Size below minimum for ${deps.getMarket()} (min ${prec?.minQty})`,
          "err",
        );
        btn.textContent = orig;
        (btn as HTMLButtonElement).disabled = false;
        return;
      }
      const roundPx = (v: number) => (prec ? asterRound(v, prec.tick) : v);
      try {
        const res = await fetch(`/aster-signed/fapi/v3/order`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: `${deps.getMarket()}USDT`,
            side: isBuy ? "BUY" : "SELL",
            type: "MARKET",
            quantity: String(qty),
            user: addr,
          }),
        });
        const d = await res.json();
        if (d.orderId || d.status) {
          showToast(
            `${isBuy ? "Long" : "Short"} ${deps.getMarket()} opened`,
            "ok",
          );
          // TP/SL = separate reduce-only stop-market orders signed by the
          // agent (no wallet prompt). Binance-style TAKE_PROFIT_MARKET /
          // STOP_MARKET with stopPrice.
          if (tpslOn && (tpPx || slPx)) {
            const tpslSide = isBuy ? "SELL" : "BUY";
            const placeTpsl = (type: string, stopPrice: number) =>
              fetch(`/aster-signed/fapi/v3/order`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  symbol: `${deps.getMarket()}USDT`,
                  side: tpslSide,
                  type,
                  stopPrice: String(roundPx(stopPrice)),
                  workingType: "MARK_PRICE",
                  quantity: String(qty),
                  reduceOnly: "true",
                  user: addr,
                }),
              })
                .then((r) => r.json())
                .catch((e) => ({ msg: e.message }));
            const results = await Promise.all([
              tpPx ? placeTpsl("TAKE_PROFIT_MARKET", tpPx) : null,
              slPx ? placeTpsl("STOP_MARKET", slPx) : null,
            ]);
            const failed = results.filter(
              (r) => r && !(r.orderId || r.status),
            );
            showToast(
              failed.length
                ? "TP/SL failed: " + ((failed[0] as any).msg ?? "error")
                : "TP/SL placed",
              failed.length ? "err" : "ok",
            );
          }
          setTimeout(() => refreshPositions(addr), 2000);
        } else {
          // Toast, not the inline banner — a rejection must be
          // unmissable, same as the HL branch.
          showToast(d.msg ?? "Order failed", "err");
        }
      } catch (e: any) {
        showToast(e.message ?? "Transaction failed", "err");
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
      const result = await deps.openPosition({
        symbol: deps.getMarket(),
        sizeDollars: size * px,
        leverage: lev,
        isLong: isBuy,
        signer,
        reduceOnly,
        tpPx,
        slPx,
      });
      const orderErr = hlOrderError(result);
      if (result.status === "ok" && !orderErr) {
        const applied = result.appliedLeverage as number;
        showToast(
          `${isBuy ? "Long" : "Short"} ${deps.getMarket()} opened` +
            (applied
              ? ` · ${applied}x${applied < lev ? ` (capped from ${lev}x)` : ""}`
              : ""),
          "ok",
        );
        setTimeout(() => refreshPositions(addr), 2000);
      } else {
        // Toast (not the inline #tradeErr banner) — a rejection like
        // "Order has invalid price." must be unmissable, and every
        // other error path here already toasts.
        showToast(orderErr ?? result.response ?? "Order failed", "err");
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

  // HL exchange responses only mean "request well-formed" at the top
  // level — per-order rejections (insufficient margin, bad price, …)
  // live in response.data.statuses[i].error while status stays "ok".
  // Without this, rejected orders show a false success toast.
  function hlOrderError(result: any): string | null {
    const statuses = result?.response?.data?.statuses;
    if (!Array.isArray(statuses)) return null;
    return statuses.map((s: any) => s?.error).find(Boolean) ?? null;
  }

  const tpslDialog = createTpslDialog();

  async function refreshPositions(addr: string) {
    if (deps.getMode() === "aster") {
      await refreshAsterAccount(addr);
      return;
    }
    // Open orders ride along so the Positions table can show/edit each
    // position's live TP/SL triggers.
    const [acct, orders] = await Promise.all([
      deps.loadAccountState(addr),
      deps.getOpenOrders(addr),
    ]);
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
    const mine = positions.find((p: any) => p.symbol === deps.getMarket());
    el(
      "tpCurPos",
      mine
        ? (mine.size >= 0 ? "+" : "") +
            mine.size.toFixed(5) +
            " " +
            deps.getMarket()
        : "0.00000 " + deps.getMarket(),
    );
    renderPositions(positions, addr, orders);
  }

  // EXTRA/Aster equivalent — its own signed futures account (USDT margin).
  // availableBalance is what's free to trade; totalMarginBalance is equity.
  async function refreshAsterAccount(addr: string) {
    const el = (id: string, val: string) => {
      const e = document.getElementById(id);
      if (e) e.textContent = val;
    };
    let data: any = null;
    let orders: any[] = [];
    let liqMap: Record<string, number> = {};
    let fundIncome: any[] = [];
    try {
      const [r, ords, risk, income] = await Promise.all([
        fetch(
          `/aster-signed/fapi/v3/accountWithJoinMargin?user=${encodeURIComponent(addr)}`,
        ),
        getAsterOpenOrdersLocal(addr),
        // accountWithJoinMargin positions carry NO liquidationPrice —
        // that lives only on positionRisk. Funding is a separate income
        // ledger (FUNDING_FEE), never on the position object either.
        fetch(
          `/aster-signed/fapi/v3/positionRisk?user=${encodeURIComponent(addr)}`,
        )
          .then((x) => (x.ok ? x.json() : []))
          .catch(() => []),
        fetch(
          `/aster-signed/fapi/v3/income?incomeType=FUNDING_FEE&limit=1000&user=${encodeURIComponent(addr)}`,
        )
          .then((x) => (x.ok ? x.json() : []))
          .catch(() => []),
      ]);
      orders = ords;
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d.positions)) data = d;
      }
      if (Array.isArray(risk))
        risk.forEach((rp: any) => {
          if (rp.symbol)
            liqMap[String(rp.symbol).replace(/USDT$/, "")] = parseFloat(
              rp.liquidationPrice ?? 0,
            );
        });
      if (Array.isArray(income)) fundIncome = income;
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
      el("tpCurPos", "0.00000 " + deps.getMarket());
      renderPositions([], addr);
      return;
    }
    const avail = parseFloat(data.availableBalance ?? 0);
    const equity = parseFloat(data.totalMarginBalance ?? 0);
    const upnl = parseFloat(data.totalUnrealizedProfit ?? 0);
    const marginUsed = parseFloat(data.totalPositionInitialMargin ?? 0);
    const positions = (data.positions ?? [])
      .filter((p: any) => parseFloat(p.positionAmt ?? 0) !== 0)
      .map((p: any) => {
        const sym = String(p.symbol).replace(/USDT$/, "");
        const updatedMs = Number(p.updateTime ?? 0);
        // Funding paid/received since the position's last update — the
        // closest available analogue to HL's cumFunding.sinceOpen.
        const funding = fundIncome
          .filter(
            (i: any) => i.symbol === p.symbol && Number(i.time) >= updatedMs,
          )
          .reduce((s: number, i: any) => s + parseFloat(i.income ?? 0), 0);
        return {
          symbol: sym,
          size: parseFloat(p.positionAmt ?? 0),
          entryPrice: parseFloat(p.entryPrice ?? 0),
          leverage: parseFloat(p.leverage ?? 0),
          pnl: parseFloat(p.unrealizedProfit ?? 0),
          liqPrice: liqMap[sym] ?? 0,
          margin: parseFloat(p.positionInitialMargin ?? p.initialMargin ?? 0),
          funding,
          isLong: parseFloat(p.positionAmt ?? 0) > 0,
        };
      });
    const ntl = positions.reduce(
      (s: number, p: any) =>
        s + Math.abs(p.size) * (deps.livePrices[p.symbol] || p.entryPrice),
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
    const mine = positions.find((p: any) => p.symbol === deps.getMarket());
    el(
      "tpCurPos",
      mine
        ? (mine.size >= 0 ? "+" : "") +
            mine.size.toFixed(5) +
            " " +
            deps.getMarket()
        : "0.00000 " + deps.getMarket(),
    );
    renderPositions(positions, addr, orders);
  }

  function renderPositions(positions: any[], addr: string, orders: any[] = []) {
    const el = document.getElementById("posRows");
    if (!el) return;
    if (!positions.length) {
      el.innerHTML = '<div class="btm-empty">No open positions yet</div>';
      return;
    }
    el.innerHTML = positions
      .map((p: any, i: number) => {
        const pnlCls = p.pnl >= 0 ? "pnl-pos" : "pnl-neg";
        const px = deps.livePrices[p.symbol] || p.entryPrice;
        const roe = p.entryPrice
          ? ((px - p.entryPrice) / p.entryPrice) *
            p.leverage *
            (p.isLong ? 1 : -1) *
            100
          : 0;
        const modeLbl = deps.getMode() === "aster" ? "EXTRA" : "BASIC";
        const modeCls =
          deps.getMode() === "aster" ? "pos-mode-extra" : "pos-mode-basic";
        // Live TP/SL triggers for this symbol (from open orders) — click a
        // price to edit; "+ Add" places standalone reduce-only triggers.
        const tpsl = orders.filter((o) => o.coin === p.symbol && o.kind);
        const tpslCell = tpsl.length
          ? tpsl
              .map(
                (o) =>
                  `<a class="tpsl-link" onclick="window.rdo.editTrigger(${o.oid},'${o.coin}','${o.side}',${o.size},'${o.kind}',${o.reduceOnly},${o.triggerPx})">${o.kind === "tp" ? "TP" : "SL"} ${fmt(o.triggerPx, p.symbol)}</a>`,
              )
              .join(" ")
          : `<a class="tpsl-link" onclick="window.rdo.addTpsl('${p.symbol}',${p.isLong},${Math.abs(p.size)},${p.entryPrice},${p.leverage || 0})">+ Add</a>`;
        return `<div class="pos-row"><span class="pos-sym">${p.symbol}${p.leverage ? `<span class="pos-lev">${p.leverage}x</span>` : ""}</span><span><span class="pos-mode-tag ${modeCls}">${modeLbl}</span></span><span>${p.size.toFixed(4)}</span><span>$${(Math.abs(p.size) * px).toFixed(2)}</span><span>${fmt(p.entryPrice, p.symbol)}</span><span>${fmt(px, p.symbol)}</span><span class="${pnlCls}">${p.pnl >= 0 ? "+" : ""}$${p.pnl.toFixed(2)} (${roe.toFixed(2)}%)</span><span>${fmt(p.liqPrice, p.symbol)}</span><span class="pos-tpsl">${tpslCell}</span><span>${p.margin > 0 ? "$" + p.margin.toFixed(2) : "—"}</span><span>${p.funding != null ? (p.funding >= 0 ? "+" : "") + "$" + p.funding.toFixed(4) : "—"}</span><span class="${p.isLong ? "dir-long" : "dir-short"}">${p.isLong ? "Long" : "Short"}</span><span><button class="pos-close-btn" onclick="window.rdo.closePos(${i})">Close</button></span></div>`;
      })
      .join("");
  }

  async function closePos(index: number) {
    const addr = deps.getAddr();
    if (!addr) return;
    if (deps.getMode() === "aster") {
      await closeAsterPos(index, addr);
      return;
    }
    const positions = await deps.getPositions(addr);
    const p = positions[index];
    if (!p) return;
    try {
      const { ethers } = await import("ethers");
      const signer = await new ethers.BrowserProvider(
        getEVMProvider(),
      ).getSigner();
      const result = await deps.closePosition({
        symbol: p.symbol,
        size: p.size,
        isLong: p.isLong,
        signer,
      });
      const orderErr = hlOrderError(result);
      if (result.status === "ok" && !orderErr) {
        showToast("Position closed", "ok");
        setTimeout(() => refreshPositions(addr), 2000);
      } else {
        showToast(orderErr ?? result.response ?? "Close failed", "err");
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
    const addr = deps.getAddr();
    if (!addr) return;
    if (deps.getMode() === "aster") {
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
      const result = await deps.cancelOrder({ oid, symbol, signer });
      const orderErr = hlOrderError(result);
      if (result.status === "ok" && !orderErr) {
        showToast("Order cancelled", "ok");
        renderOpenOrders(await deps.getOpenOrders(addr));
      } else {
        showToast(orderErr ?? result.response ?? "Cancel failed", "err");
      }
    } catch (e: any) {
      showToast(e.message, "err");
    }
  }

  // Edit a resting TP/SL trigger's price. HL supports native modify
  // (keeps grouping/position binding); Aster's amend can't change
  // stopPrice, so cancel + re-place — both agent-signed, no prompts.
  async function editTrigger(
    oid: number,
    coin: string,
    side: string,
    size: number,
    kind: "tp" | "sl",
    reduceOnly: boolean,
    curPx: number,
  ) {
    const addr = deps.getAddr();
    if (!addr) return;
    const label = kind === "tp" ? "Take Profit" : "Stop Loss";
    // A Sell-side trigger protects a long, a Buy-side one a short —
    // the closing order's side gives the position direction.
    const newPx = (await tpslDialog.open({
      mode: "edit",
      kind,
      symbol: coin,
      isLong: side === "Sell",
      size,
      markPx: deps.livePrices[coin] || 0,
      curPx,
    })) as number | null;
    if (!newPx) return;
    try {
      if (deps.getMode() === "aster") {
        await fetch(`/aster-signed/fapi/v3/order`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: `${coin}USDT`,
            orderId: String(oid),
            user: addr,
          }),
        });
        const r = await fetch(`/aster-signed/fapi/v3/order`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: `${coin}USDT`,
            side: side === "Buy" ? "BUY" : "SELL",
            type: kind === "tp" ? "TAKE_PROFIT_MARKET" : "STOP_MARKET",
            stopPrice: String(asterRound(newPx, deps.asterPrec[coin]?.tick ?? 0)),
            workingType: "MARK_PRICE",
            quantity: String(asterRound(size, deps.asterPrec[coin]?.step ?? 0)),
            reduceOnly: "true",
            user: addr,
          }),
        });
        const d = await r.json();
        if (d.orderId || d.status) showToast(`${label} updated`, "ok");
        else showToast(d.msg ?? "Update failed", "err");
      } else {
        const { ethers } = await import("ethers");
        const signer = await new ethers.BrowserProvider(
          getEVMProvider(),
        ).getSigner();
        const result = await deps.modifyTriggerOrder({
          oid,
          symbol: coin,
          isBuy: side === "Buy",
          size,
          triggerPx: newPx,
          kind,
          reduceOnly,
          signer,
        });
        const orderErr = hlOrderError(result);
        if (result.status === "ok" && !orderErr)
          showToast(`${label} updated`, "ok");
        else
          showToast(
            orderErr ?? result.response ?? "Update failed",
            "err",
          );
      }
      renderOpenOrders(
        await (deps.getMode() === "aster"
          ? getAsterOpenOrdersLocal(addr)
          : deps.getOpenOrders(addr)),
      );
    } catch (e: any) {
      showToast(e.message ?? "Update failed", "err");
    }
  }

  // Place standalone reduce-only TP/SL triggers on an EXISTING position
  // (from the Positions table's "+ Add"). HL: one signed action, both
  // legs. Aster: two agent-signed stop-market orders, no wallet prompt.
  async function addTpsl(
    symbol: string,
    isLong: boolean,
    size: number,
    entryPx: number,
    leverage: number,
  ) {
    const addr = deps.getAddr();
    if (!addr) return;
    const res = (await tpslDialog.open({
      mode: "add",
      symbol,
      isLong,
      size,
      entryPx,
      leverage,
      markPx: deps.livePrices[symbol] || 0,
    })) as { tpPx: number; slPx: number } | null;
    if (!res) return;
    const { tpPx, slPx } = res;
    try {
      if (deps.getMode() === "aster") {
        const side = isLong ? "SELL" : "BUY";
        const place = (type: string, stopPrice: number) =>
          fetch(`/aster-signed/fapi/v3/order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbol: `${symbol}USDT`,
              side,
              type,
              stopPrice: String(
                asterRound(stopPrice, deps.asterPrec[symbol]?.tick ?? 0),
              ),
              workingType: "MARK_PRICE",
              quantity: String(
                asterRound(size, deps.asterPrec[symbol]?.step ?? 0),
              ),
              reduceOnly: "true",
              user: addr,
            }),
          })
            .then((r) => r.json())
            .catch((e) => ({ msg: e.message }));
        const results = await Promise.all([
          tpPx ? place("TAKE_PROFIT_MARKET", tpPx) : null,
          slPx ? place("STOP_MARKET", slPx) : null,
        ]);
        const failed = results.filter((r) => r && !(r.orderId || r.status));
        showToast(
          failed.length
            ? "TP/SL failed: " + ((failed[0] as any).msg ?? "error")
            : "TP/SL placed",
          failed.length ? "err" : "ok",
        );
      } else {
        const { ethers } = await import("ethers");
        const signer = await new ethers.BrowserProvider(
          getEVMProvider(),
        ).getSigner();
        const result = await deps.placeTpslOrders({
          symbol,
          size,
          isLong,
          signer,
          tpPx,
          slPx,
        });
        const orderErr = hlOrderError(result);
        if (result.status === "ok" && !orderErr)
          showToast("TP/SL placed", "ok");
        else
          showToast(orderErr ?? result.response ?? "TP/SL failed", "err");
      }
      if (deps.getAddr()) refreshPositions(deps.getAddr());
    } catch (e: any) {
      showToast(e.message ?? "TP/SL failed", "err");
    }
  }

  function getIsBuy() {
    return isBuy;
  }

  return {
    setSide,
    updateTradeBtn,
    updateStats,
    onSlider,
    submitTrade,
    refreshPositions,
    closePos,
    cancelOrd,
    editTrigger,
    addTpsl,
    getIsBuy,
  };
}
