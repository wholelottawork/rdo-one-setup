// Trade page (/) — TP/SL dialog controller: promise-returning modal
// (replaces window.prompt). open() resolves with parsed price(s) or
// null on cancel; direction validation and outcome preview run inline.
// Extracted verbatim from TradingTerminal's init().
import { fmt } from "@/lib/format";

export function createTpslDialog() {
  const $ = (id: string) => document.getElementById(id);
  type Ctx = {
    mode: "add" | "edit";
    symbol: string;
    isLong: boolean;
    size: number;
    markPx: number;
    entryPx?: number;
    leverage?: number;
    kind?: "tp" | "sl";
  };
  let resolver: ((v: any) => void) | null = null;
  let ctx: Ctx | null = null;

  function preview(inputId: string, prevId: string) {
    const prev = $(prevId);
    if (!prev) return;
    prev.className = "tpsl-preview";
    prev.textContent = "";
    if (!ctx) return;
    const v = parseFloat(
      ($(inputId) as HTMLInputElement | null)?.value ?? "",
    );
    if (!v || v <= 0 || !ctx.markPx) return;
    const pct = (((v - ctx.markPx) / ctx.markPx) * 100).toFixed(2);
    let txt = `${v >= ctx.markPx ? "+" : ""}${pct}% from mark`;
    let pos = v >= ctx.markPx;
    if (ctx.entryPx) {
      const pnl = (v - ctx.entryPx) * ctx.size * (ctx.isLong ? 1 : -1);
      txt += ` · ≈ ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)}`;
      // Leverage never changes $ PnL — it changes the return on the
      // margin posted. Show ROE so the leverage effect is visible.
      if (ctx.leverage) {
        const margin = (ctx.entryPx * ctx.size) / ctx.leverage;
        if (margin > 0) {
          const roe = (pnl / margin) * 100;
          txt += ` (${roe >= 0 ? "+" : "−"}${Math.abs(roe).toFixed(1)}% ROE)`;
        }
      }
      pos = pnl >= 0;
    }
    prev.textContent = txt;
    prev.classList.add(pos ? "pos" : "neg");
  }

  function showErr(msg: string) {
    const e = $("tpslModalErr");
    if (!e) return;
    e.textContent = msg;
    e.classList.remove("hidden");
  }

  // TP must sit above mark for longs (below for shorts); SL opposite.
  const legOk = (px: number, kind: "tp" | "sl") => {
    if (!ctx?.markPx || !px) return true;
    const above = ctx.isLong ? kind === "tp" : kind === "sl";
    return above ? px > ctx.markPx : px < ctx.markPx;
  };
  const legErr = (kind: "tp" | "sl") => {
    const above = ctx!.isLong ? kind === "tp" : kind === "sl";
    return `${kind === "tp" ? "TP" : "SL"} must be ${
      above ? "above" : "below"
    } mark ${fmt(ctx!.markPx, ctx!.symbol)}`;
  };

  function validate(): { tpPx: number; slPx: number } | number | null {
    $("tpslModalErr")?.classList.add("hidden");
    if (!ctx) return null;
    const tpPx =
      parseFloat(($("tpslInputTp") as HTMLInputElement | null)?.value ?? "") ||
      0;
    const slPx =
      parseFloat(($("tpslInputSl") as HTMLInputElement | null)?.value ?? "") ||
      0;
    if (ctx.mode === "edit") {
      const px = ctx.kind === "tp" ? tpPx : slPx;
      if (!px) {
        showErr("Enter a trigger price");
        return null;
      }
      if (!legOk(px, ctx.kind!)) {
        showErr(legErr(ctx.kind!));
        return null;
      }
      return px;
    }
    if (!tpPx && !slPx) {
      showErr("Enter at least one trigger price");
      return null;
    }
    if (!legOk(tpPx, "tp")) {
      showErr(legErr("tp"));
      return null;
    }
    if (!legOk(slPx, "sl")) {
      showErr(legErr("sl"));
      return null;
    }
    return { tpPx, slPx };
  }

  function close(val: any) {
    $("tpslModal")?.classList.add("hidden");
    if (resolver) resolver(val);
    resolver = null;
    ctx = null;
  }

  function submit() {
    const v = validate();
    if (v === null) return;
    close(v);
  }

  function open(config: Ctx & { curPx?: number }) {
    ctx = {
      mode: config.mode,
      symbol: config.symbol,
      isLong: config.isLong,
      size: config.size,
      markPx: config.markPx,
      entryPx: config.entryPx,
      leverage: config.leverage,
      kind: config.kind,
    };
    const edit = config.mode === "edit";
    $("tpslModalTitle")!.textContent = edit
      ? `Edit ${config.kind === "tp" ? "Take Profit" : "Stop Loss"}`
      : "Set TP/SL";
    $("tpslModalSub")!.textContent = `${config.symbol} · ${
      config.isLong ? "Long" : "Short"
    } ${config.size}${config.leverage ? ` · ${config.leverage}x` : ""}`;
    $("tpslModalMark")!.textContent = config.markPx
      ? fmt(config.markPx, config.symbol)
      : "—";
    $("tpslSubmit")!.textContent = edit ? "Update" : "Set TP/SL";
    $("tpslFieldTp")!.style.display =
      !edit || config.kind === "tp" ? "" : "none";
    $("tpslFieldSl")!.style.display =
      !edit || config.kind === "sl" ? "" : "none";
    ($("tpslInputTp") as HTMLInputElement).value = "";
    ($("tpslInputSl") as HTMLInputElement).value = "";
    if (edit && config.curPx) {
      ($(
        config.kind === "tp" ? "tpslInputTp" : "tpslInputSl",
      ) as HTMLInputElement).value = String(config.curPx);
    }
    preview("tpslInputTp", "tpslPrevTp");
    preview("tpslInputSl", "tpslPrevSl");
    $("tpslModalErr")?.classList.add("hidden");
    $("tpslModal")?.classList.remove("hidden");
    setTimeout(() => {
      const first = (
        !edit || config.kind === "tp"
          ? $("tpslInputTp")
          : $("tpslInputSl")
      ) as HTMLInputElement | null;
      first?.focus();
      if (edit) first?.select();
    }, 30);
    return new Promise((res) => (resolver = res));
  }

  // One-time bindings (DOM exists — init() runs post-mount).
  const modal = $("tpslModal");
  $("tpslInputTp")?.addEventListener("input", () =>
    preview("tpslInputTp", "tpslPrevTp"),
  );
  $("tpslInputSl")?.addEventListener("input", () =>
    preview("tpslInputSl", "tpslPrevSl"),
  );
  $("tpslSubmit")?.addEventListener("click", submit);
  $("tpslCancel")?.addEventListener("click", () => close(null));
  $("tpslModalX")?.addEventListener("click", () => close(null));
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) close(null);
  });
  modal?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close(null);
    if (e.key === "Enter") submit();
  });

  return { open };
}
