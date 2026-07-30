// Trade page (/) — order flow: the trade panel (side/size/leverage stats),
// order placement (HL wallet-signed, Aster agent-signed), position
// close/cancel, TP/SL add/edit, and the positions/balances refresh for
// both venues. Extracted verbatim from TradingTerminal's init() — these
// are the real-money paths; library fns, the wallet address getter, and
// the shared price/precision maps arrive as deps.
import { getEVMProvider } from "@/lib/wallet";
import { asterFetch } from "@/lib/aster-session";
import { showToast } from "@/lib/toast";
import { MARKET_SLIPPAGE } from "@/lib/trading";
import { entryPrice, fillState, tpslError } from "@/lib/orderMath";
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

  const isLimitOrder = () =>
    (document.getElementById("orderTypeInput") as HTMLInputElement)?.value ===
    "limit";
  const limitInputPx = () =>
    parseFloat(
      (document.getElementById("limitInput") as HTMLInputElement)?.value,
    ) || 0;

  // A resting limit order fills at ITS price, not at mark. Every number
  // derived from the entry — notional, margin, liq price, and the TP/SL
  // side checks — has to use this, or a limit far from mark shows stats
  // for a fill that can't happen and accepts a stop on the wrong side of
  // the real entry. Market orders (and a blank limit field) fall back to
  // mark, so their behaviour is unchanged.
  const entryPx = () =>
    entryPrice(
      isLimitOrder(),
      limitInputPx(),
      deps.livePrices[deps.getMarket()] || 0,
    );

  const getSizeUnit = () =>
    (document.getElementById("sizeUnitInput") as HTMLInputElement)?.value ||
    "asset";

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
    (window as any).rdo?.setAssetLabel?.(deps.getMarket());
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
    const px = entryPx();
    const isUsd = getSizeUnit() === "usd";
    const notional = isUsd ? size : size * px;
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
    // Only HL market orders have a knowable slippage bound (openPosition
    // sends an IOC capped at mark ± MARKET_SLIPPAGE). A resting limit can't
    // slip at all, and Aster MARKET is a true market order with no cap —
    // both show "—" rather than a made-up number.
    el(
      "stSlip",
      !isLimitOrder() && deps.getMode() !== "aster"
        ? (MARKET_SLIPPAGE * 100).toFixed(2) + "% max"
        : "—",
    );
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
    const px = entryPx();
    if (!px) return;
    const isUsd = getSizeUnit() === "usd";
    const sizeEl = document.getElementById("sizeInput") as HTMLInputElement;
    if (sizeEl)
      sizeEl.value = isUsd
        ? (avail * lev * (parseInt(val) / 100)).toFixed(2)
        : ((avail * lev * (parseInt(val) / 100)) / px).toFixed(6);
    updateStats();
  }

  // Polls one Aster order until it has ANY execution. FALLBACK ONLY: the
  // backend watcher (backend/src/lib/aster-tpsl-watcher.ts) normally holds
  // this wait, since it survives the tab closing. This path runs when that
  // watcher is unreachable — better a wait that dies with the tab than no
  // protection at all, and the toast says so.
  async function waitForFill(
    orderId: number,
    symbol: string,
    addr: string,
    timeoutMs = 1_800_000,
  ): Promise<"filled" | "ended" | "timeout"> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const r = await asterFetch(
          `/aster-signed/fapi/v3/order?symbol=${symbol}&orderId=${orderId}&user=${encodeURIComponent(addr)}`,
        );
        const s = fillState(await r.json());
        if (s !== "waiting") return s;
      } catch {
        // Transient network/proxy blip — keep watching rather than abandoning
        // a position the user expects to be protected.
      }
    }
    return "timeout";
  }

  async function submitTrade() {
    const addr = deps.getAddr();
    if (!addr) {
      await deps.connectWallet();
      return;
    }
    const sizeEl = document.getElementById("sizeInput") as HTMLInputElement;
    const levEl = document.getElementById("levInput") as HTMLInputElement;
    const isLimit = isLimitOrder();
    const sizeRaw = parseFloat(sizeEl?.value);
    const lev = parseFloat(levEl?.value) || 20;
    const px =
      deps.livePrices[deps.getMarket()] || (await deps.getMarketPrice(deps.getMarket()));
    const isUsdUnit = getSizeUnit() === "usd";
    const size = isUsdUnit ? sizeRaw / px : sizeRaw;
    if (!sizeRaw || sizeRaw <= 0) {
      showErr("Enter a size");
      return;
    }
    const limitPx = isLimit ? limitInputPx() : 0;
    if (isLimit && !limitPx) {
      showErr("Enter a limit price");
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
    // Triggers are checked against the price this order actually ENTERS at,
    // not mark — see lib/orderMath.ts for why the difference is dangerous.
    const trigErr = tpslError(
      isBuy,
      entryPrice(isLimit, limitPx, px),
      tpPx,
      slPx,
      isLimit,
    );
    if (trigErr) {
      showErr(trigErr);
      return;
    }
    const btn = document.getElementById("tradeBtn");
    if (!btn) return;
    const orig = btn.textContent!;
    btn.textContent = "Confirming...";
    (btn as HTMLButtonElement).disabled = true;
    // EXTRA/Aster: signed order placed server-side (no wallet prompt). size
    // is base-coin units. Ported from asterPlaceOrder.
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
        // The leverage picker was cosmetic on Aster — orders went out at
        // whatever the ACCOUNT default happened to be (often 20x+) while the
        // panel read 5x, so the liq price shown was fiction. Apply it first,
        // and abort if Aster refuses: trading at a leverage the user did not
        // choose is worse than not trading. Skipped when reducing, where
        // leverage is irrelevant and Aster can reject the change outright.
        if (!reduceOnly) {
          const levRes = await asterFetch(`/aster-signed/fapi/v3/leverage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbol: `${deps.getMarket()}USDT`,
              leverage: String(Math.round(lev)),
              user: addr,
            }),
          });
          const levD = await levRes.json().catch(() => ({}));
          if (!levD.leverage) {
            showToast(
              `Could not set ${Math.round(lev)}x on Aster: ${levD.msg ?? "unknown error"}`,
              "err",
            );
            btn.textContent = orig;
            (btn as HTMLButtonElement).disabled = false;
            return;
          }
        }
        const res = await asterFetch(`/aster-signed/fapi/v3/order`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: `${deps.getMarket()}USDT`,
            side: isBuy ? "BUY" : "SELL",
            type: isLimit ? "LIMIT" : "MARKET",
            ...(isLimit ? { price: String(asterRound(limitPx, deps.asterPrec[deps.getMarket()]?.tick ?? 0)), timeInForce: "GTC" } : {}),
            // Without this the checkbox was cosmetic on Aster: an oversized
            // "reduce only" close would flatten the position AND open the
            // remainder as a new position on the opposite side. Sent only
            // when ticked — Aster rejects reduceOnly with no position open
            // (-2022), which is the correct outcome, not a silent flip.
            ...(reduceOnly ? { reduceOnly: "true" } : {}),
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
          // TP/SL = separate stop-market orders signed by the agent (no wallet
          // prompt). Binance-style TAKE_PROFIT_MARKET / STOP_MARKET.
          if (tpslOn && (tpPx || slPx)) {
            const tpslSide = isBuy ? "SELL" : "BUY";
            // closePosition closes whatever is ACTUALLY open when the trigger
            // fires. The old code sent the requested qty with reduceOnly, so a
            // partial fill left triggers sized for a position that never
            // existed. Aster forbids quantity/reduceOnly alongside it.
            const placeTpsl = (type: string, stopPrice: number) =>
              asterFetch(`/aster-signed/fapi/v3/order`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  symbol: `${deps.getMarket()}USDT`,
                  side: tpslSide,
                  type,
                  stopPrice: String(roundPx(stopPrice)),
                  workingType: "MARK_PRICE",
                  closePosition: "true",
                  user: addr,
                }),
              })
                .then((r) => r.json())
                .catch((e) => ({ msg: e.message }));
            const submitTpsl = async () => {
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
            };
            if (isLimit) {
              // A resting limit has no position behind it yet: triggers placed
              // now fire against nothing and are consumed, so the fill that
              // arrives later is naked. Hand the wait to the backend watcher,
              // which survives this tab closing; only if that's unreachable do
              // we fall back to holding it here.
              const watched = await asterFetch(`/aster-tpsl-watch`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  user: addr,
                  symbol: `${deps.getMarket()}USDT`,
                  orderId: String(d.orderId),
                  side: tpslSide,
                  tpPrice: tpPx ? String(roundPx(tpPx)) : "",
                  slPrice: slPx ? String(roundPx(slPx)) : "",
                }),
              })
                .then((r) => r.ok)
                .catch(() => false);
              if (watched) {
                showToast("TP/SL will be placed when the limit fills", "ok");
                setTimeout(() => refreshPositions(addr), 2000);
                btn.textContent = orig;
                (btn as HTMLButtonElement).disabled = false;
                return;
              }
              showToast(
                "TP/SL will be placed when the limit fills — keep this tab open",
                "ok",
              );
              waitForFill(d.orderId, `${deps.getMarket()}USDT`, addr).then(
                (r) =>
                  r === "filled"
                    ? submitTpsl()
                    : showToast(
                        r === "ended"
                          ? "Limit order closed without filling — no TP/SL placed"
                          : "Limit order still unfilled after 30 min — TP/SL not placed",
                        "err",
                      ),
              );
            } else {
              await submitTpsl();
            }
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
      const marginEl = document.getElementById('marginType') as HTMLSelectElement;
      const isCross = !marginEl || marginEl.value !== 'isolated';
      const result = await deps.openPosition({
        symbol: deps.getMarket(),
        // Base-coin size, not dollars — the round trip through a re-fetched
        // mark used to resize the order behind the user's back.
        size,
        leverage: lev,
        isLong: isBuy,
        signer,
        reduceOnly,
        tpPx,
        slPx,
        isCross,
        limitPx: limitPx || 0,
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
    // Both of these read 0 until now. The ratio is maintenance margin over
    // cross equity — at 100% the account is being liquidated, so it's the one
    // number worth watching with a position open.
    el(
      "ovCmr",
      acct.crossEquity > 0
        ? ((acct.maintenanceMargin / acct.crossEquity) * 100).toFixed(2) + "%"
        : "0.00%",
    );
    el("ovMm", "$" + acct.maintenanceMargin.toFixed(2));
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
    renderBalances([
      { label: "Perps Equity", value: "$" + acct.perpEquity.toFixed(2) },
      { label: "Spot Balance", value: "$" + acct.spotTotal.toFixed(2) },
      {
        label: "Available to Trade",
        value: "$" + acct.availableToTrade.toFixed(2) + " USDC",
      },
      { label: "Margin Used", value: "$" + acct.marginUsed.toFixed(2) },
      {
        label: "Unrealized PnL",
        value: (acct.upnl >= 0 ? "+" : "") + "$" + acct.upnl.toFixed(2),
      },
    ]);
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
        asterFetch(
          `/aster-signed/fapi/v3/accountWithJoinMargin?user=${encodeURIComponent(addr)}`,
        ),
        getAsterOpenOrdersLocal(addr),
        // accountWithJoinMargin positions carry NO liquidationPrice —
        // that lives only on positionRisk. Funding is a separate income
        // ledger (FUNDING_FEE), never on the position object either.
        asterFetch(
          `/aster-signed/fapi/v3/positionRisk?user=${encodeURIComponent(addr)}`,
        )
          .then((x) => (x.ok ? x.json() : []))
          .catch(() => []),
        asterFetch(
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
      el("ovCmr", "0.00%");
      el("ovMm", "$0.00");
      el("tpCurPos", "0.00000 " + deps.getMarket());
      renderBalances([
        { label: "Account Equity", value: "$0.00" },
        { label: "Available Balance", value: "$0.00 USDT" },
        { label: "Margin Used", value: "$0.00" },
        { label: "Unrealized PnL", value: "$0.00" },
      ]);
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
    // Aster's own equivalents of HL's cross ratio / maintenance margin.
    const maintMargin = parseFloat(data.totalMaintMargin ?? 0);
    el(
      "ovCmr",
      equity > 0 ? ((maintMargin / equity) * 100).toFixed(2) + "%" : "0.00%",
    );
    el("ovMm", "$" + maintMargin.toFixed(2));
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
    renderBalances([
      { label: "Account Equity", value: "$" + equity.toFixed(2) },
      {
        label: "Available Balance",
        value: "$" + avail.toFixed(2) + " USDT",
      },
      { label: "Margin Used", value: "$" + marginUsed.toFixed(2) },
      {
        label: "Unrealized PnL",
        value: (upnl >= 0 ? "+" : "") + "$" + upnl.toFixed(2),
      },
    ]);
    renderPositions(positions, addr, orders);
  }

  // Balances tab — filled from the same account numbers the side panel
  // gets, so both stay in sync on every refresh.
  function renderBalances(rows: { label: string; value: string }[]) {
    const el = document.getElementById("btBalances");
    if (!el) return;
    el.innerHTML = rows
      .map(
        (r) =>
          `<div class="pos-row" style="grid-template-columns:1fr 1fr"><span style="color:var(--hl-text-muted)">${r.label}</span><span>${r.value}</span></div>`,
      )
      .join("");
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
      const r = await asterFetch(
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
      const res = await asterFetch(`/aster-signed/fapi/v3/order`, {
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
        const r = await asterFetch(`/aster-signed/fapi/v3/order`, {
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
        // Aster has no atomic modify, so the order of these two calls is the
        // whole safety property. Cancel-then-place (what this did) leaves the
        // position naked in the gap, and a rejected placement — bad tick, rate
        // limit — destroys the trigger with nothing to fall back to. Placing
        // first is the survivable order: both triggers existing for a moment
        // is harmless, since whichever fires closes the position and the other
        // is reduce-only against nothing.
        const r = await asterFetch(`/aster-signed/fapi/v3/order`, {
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
        if (!(d.orderId || d.status)) {
          showToast(
            `${d.msg ?? "Update failed"} — your ${label} at ${fmt(curPx, coin)} is untouched`,
            "err",
          );
          return;
        }
        const del = await asterFetch(`/aster-signed/fapi/v3/order`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: `${coin}USDT`,
            orderId: String(oid),
            user: addr,
          }),
        });
        const delD = await del.json().catch(() => ({ code: -1 }));
        const delOk = !delD.code && (delD.orderId || delD.status);
        // A failed cancel is not a failed edit — say which one it is, because
        // the fix (cancel the leftover) is the user's to make.
        showToast(
          delOk
            ? `${label} updated`
            : `${label} placed at ${fmt(newPx, coin)}, but the old one at ${fmt(curPx, coin)} is still open — cancel it manually`,
          delOk ? "ok" : "err",
        );
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
          asterFetch(`/aster-signed/fapi/v3/order`, {
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
