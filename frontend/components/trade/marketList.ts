// Trade page (/) — market list & symbol dropdown: the exchange-fetched
// market lists, their poll loops (HL metaAndAssetCtxs; Aster 24hr ticker /
// funding / OI / leverage brackets), and the dropdown UI (render, search,
// keyboard nav). Extracted from TradingTerminal's init(); shared stat maps
// are passed by reference (never reassigned in the terminal), mutable
// scalars via getters, and market selection / header stats via callbacks.
import { cachedFetch } from "@/lib/query";
import { fmt, fmtAster, fmtLarge } from "@/lib/format";

// Backend rewrite to Aster's public futures API (see next.config.js).
const ASTER_API = "/aster-fapi";

export function createMarketList(deps: {
  getMode: () => string;
  getMarket: () => string;
  livePrices: Record<string, number>;
  asterStats: Record<string, any>;
  hlStats: Record<string, any>;
  marketLev: Record<string, number>;
  asterLev: Record<string, number>;
  asterPrec: Record<string, { step: number; tick: number; minQty: number }>;
  t: (key: string) => string;
  onSelectMarket: (sym: string) => void;
  onAsterTicker: (ticker: any) => void;
  syncLevMax: (sym: string) => void;
}) {
  // Exchange-fetched market lists (see note above ASTER_API), each
  // sorted by 24h volume desc once stats arrive.
  let hlMarkets: string[] = [];
  let asterMarkets: string[] = [];
  const currentMarkets = () =>
    deps.getMode() === "aster" ? asterMarkets : hlMarkets;
  // Membership-only update + dropdown refresh, so the open dropdown
  // isn't re-rendered on every poll cycle.
  function setMarkets(mode: string, syms: string[]) {
    const prev = mode === "aster" ? asterMarkets : hlMarkets;
    if (syms.join() === prev.join()) return;
    if (mode === "aster") asterMarkets = syms;
    else hlMarkets = syms;
    if (deps.getMode() === mode) rebuildDropdown();
  }

  function rebuildDropdown() {
    const list = document.getElementById("mktList");
    if (list) renderMarketList(currentMarkets(), list);
  }

  // Real per-symbol max leverage from Aster's (signed) leverageBracket
  // endpoint — NOT a flat 200x. brackets[0] is the highest-leverage tier,
  // so its initialLeverage is the "up to Nx" headline (200x for BTC/ETH,
  // but as low as 5x for smaller caps). Static data, so fetch once.
  async function fetchAsterLeverage() {
    if (Object.keys(deps.asterLev).length) return;
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
        if (sym && lev) deps.asterLev[sym] = lev;
      });
      if (deps.getMode() === "aster") {
        rebuildDropdown();
        deps.syncLevMax(deps.getMarket());
      }
    } catch {}
  }

  // Canonical Aster market list — exchangeInfo's TRADING USDT
  // perpetuals, not a hardcoded subset. Static metadata, cached 10 min.
  // Also captures each symbol's order grid (step/tick/minQty) so orders
  // can be rounded to it — off-grid orders are rejected with -1111.
  async function fetchAsterMarkets() {
    if (asterMarkets.length && Object.keys(deps.asterPrec).length) return;
    try {
      const data = await cachedFetch(
        ["aster", "exchangeInfo"],
        async () =>
          (await fetch(`${ASTER_API}/fapi/v1/exchangeInfo`)).json(),
        600_000,
      );
      const syms = (data?.symbols ?? [])
        .filter(
          (s: any) =>
            s.status === "TRADING" &&
            s.contractType === "PERPETUAL" &&
            s.quoteAsset === "USDT",
        )
        .map((s: any) => {
          const lot = s.filters?.find(
            (f: any) => f.filterType === "LOT_SIZE",
          );
          const prc = s.filters?.find(
            (f: any) => f.filterType === "PRICE_FILTER",
          );
          deps.asterPrec[s.baseAsset as string] = {
            step: parseFloat(lot?.stepSize ?? "0.001"),
            tick: parseFloat(prc?.tickSize ?? "0.01"),
            minQty: parseFloat(lot?.minQty ?? "0"),
          };
          return s.baseAsset as string;
        });
      if (syms.length) setMarkets("aster", syms);
    } catch {}
  }

  async function fetchAsterMids() {
    if (deps.getMode() !== "aster") return;
    try {
      const res = await fetch(`${ASTER_API}/fapi/v1/ticker/24hr`);
      const data = await res.json();
      if (!Array.isArray(data)) return;
      data.forEach((tk: any) => {
        const sym = tk.symbol?.replace("USDT", "");
        if (!sym) return;
        const price = parseFloat(tk.lastPrice ?? 0);
        if (price > 0) deps.livePrices[sym] = price;
        deps.asterStats[sym] = deps.asterStats[sym] || {};
        deps.asterStats[sym].chgPct = parseFloat(tk.priceChangePercent ?? 0);
        deps.asterStats[sym].vol = parseFloat(tk.quoteVolume ?? 0);
        const priceEl = document.getElementById(`mprice-${sym}`);
        if (priceEl) priceEl.textContent = fmtAster(price, sym);
      });
      setMarkets(
        "aster",
        [...asterMarkets].sort(
          (a, b) => (deps.asterStats[b]?.vol ?? 0) - (deps.asterStats[a]?.vol ?? 0),
        ),
      );
      const ticker = data.find(
        (tk: any) => tk.symbol === deps.getMarket() + "USDT",
      );
      if (ticker) deps.onAsterTicker(ticker);
    } catch {}
    setTimeout(fetchAsterMids, 5000);
  }

  async function fetchAsterFunding() {
    if (deps.getMode() !== "aster") return;
    try {
      const res = await fetch(`${ASTER_API}/fapi/v1/premiumIndex`);
      const data = await res.json();
      if (!Array.isArray(data)) return;
      data.forEach((tk: any) => {
        const sym = tk.symbol?.replace("USDT", "");
        if (!sym) return;
        deps.asterStats[sym] = deps.asterStats[sym] || {};
        deps.asterStats[sym].fund8h = parseFloat(tk.lastFundingRate ?? 0) * 100;
      });
      rebuildDropdown();
    } catch {}
    setTimeout(fetchAsterFunding, 30000);
  }

  async function fetchAsterOI() {
    if (deps.getMode() !== "aster") return;
    try {
      await Promise.all(
        // One request per symbol, so cap the fan-out to the most
        // liquid markets instead of hammering the full universe.
        asterMarkets.slice(0, 30).map(async (sym) => {
          const res = await fetch(
            `${ASTER_API}/fapi/v1/openInterest?symbol=${sym}USDT`,
          );
          const d = await res.json();
          const oi = parseFloat(d.openInterest ?? 0);
          deps.asterStats[sym] = deps.asterStats[sym] || {};
          deps.asterStats[sym].oi = oi * (deps.livePrices[sym] || 0);
        }),
      );
      rebuildDropdown();
    } catch {}
    setTimeout(fetchAsterOI, 30000);
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
        if (asset.maxLeverage) deps.marketLev[sym] = asset.maxLeverage;
        if (!price) return;
        deps.livePrices[sym] = price;
        const prev = parseFloat(ctx.prevDayPx ?? price);
        deps.hlStats[sym] = {
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
      setMarkets(
        "hl",
        meta.universe
          .map((asset: any, i: number) => ({
            name: asset.name as string,
            vol: parseFloat(ctxs[i]?.dayNtlVlm ?? "0"),
          }))
          .sort((x: any, y: any) => y.vol - x.vol)
          .map((x: any) => x.name),
      );
    } catch {}
    setTimeout(fetchAllMids, 5000);
  }

  function renderMarketList(markets: string[], list: HTMLElement) {
    const dd = document.getElementById("mktDropdown");
    if (dd) dd.classList.add("mkt-wide");
    const isAster = deps.getMode() === "aster";
    const mktSuffix = isAster ? "-USDT" : "-USDC";
    const getLev = (sym: string) =>
      isAster
        ? deps.asterLev[sym]
          ? deps.asterLev[sym] + "x"
          : ""
        : deps.marketLev[sym]
          ? deps.marketLev[sym] + "x"
          : "";
    const getPrice = (sym: string) =>
      deps.livePrices[sym]
        ? isAster
          ? fmtAster(deps.livePrices[sym], sym)
          : fmt(deps.livePrices[sym], sym)
        : "—";
    const fmtFund = (v: any) =>
      v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(4)}%`;
    const fmtChg = (v: any) =>
      v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
    const colHdr = `<div class="mkt-col-hdr">
      <span>${deps.t("market")}</span><span>${deps.t("lastPrice")}</span><span>${deps.t("change24hShort")}</span><span>${deps.t("funding8h")}</span><span>${deps.t("volume")}</span><span>${deps.t("openInterest")}</span>
    </div>`;
    list.innerHTML =
      colHdr +
      markets
        .map((sym) => {
          const s = (isAster ? deps.asterStats : deps.hlStats)[sym] || {};
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
        deps.onSelectMarket((el as HTMLElement).dataset.sym!);
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
      const list = document.getElementById("mktList");
      if (list)
        renderMarketList(
          currentMarkets().filter((s) => s.toLowerCase().includes(q)),
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
        deps.onSelectMarket((items[focusedIdx] as HTMLElement).dataset.sym!);
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

  function getMarkets(mode: string) {
    return mode === "aster" ? asterMarkets : hlMarkets;
  }

  return {
    bindMarketBtn,
    rebuildDropdown,
    closeDropdown,
    setMarkets,
    fetchAllMids,
    fetchAsterMarkets,
    fetchAsterMids,
    fetchAsterFunding,
    fetchAsterOI,
    fetchAsterLeverage,
    getMarkets,
  };
}
