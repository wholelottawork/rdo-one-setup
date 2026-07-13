// Pure formatting/grid helpers shared by the trade terminal modules.
// Extracted from TradingTerminal's init() — no closure state, safe to import
// anywhere. (fmt/fmtAster keep their unused `sym` param for call-site
// compatibility.)

export function fmt(p: number, sym?: string) {
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

export function fmtSz(n: number) {
  if (!n) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

export function fmtLarge(n: number) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

export function fmtAster(n: number, sym?: string) {
  if (isNaN(n) || n === 0) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(4);
}

export function ivLabel(iv: number) {
  if (iv < 60) return iv + "m";
  if (iv < 1440) return iv / 60 + "h";
  return "1D";
}

// Countdown to the next 8h funding boundary (00/08/16 UTC).
export function countdown() {
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

// Round DOWN to a symbol's order grid (rounding up could spend more than the
// user intended). Decimals counted by scaling the grid up to an integer —
// String(1e-7) is "1e-7" and would give 0 decimals.
export function asterRound(value: number, grid: number) {
  if (!grid) return value;
  let dec = 0;
  let g = grid;
  while (dec < 12 && Math.abs(g - Math.round(g)) > 1e-9) {
    g *= 10;
    dec++;
  }
  return parseFloat((Math.floor(value / grid) * grid).toFixed(dec));
}
