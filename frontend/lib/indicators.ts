// Chart overlay math — SMA / EMA / Bollinger Bands / RSI. Kept DOM-free and
// dependency-free so the warm-up and smoothing branches can be exercised
// directly — see indicators.test.ts (`npm test`).
//
// Every function returns one entry per input value, using null for the leading
// bars it cannot answer for yet. Callers drop the nulls when handing points to
// the chart; keeping them keeps every result index-aligned with the candles.

/** Simple moving average. Rolling sum, so O(n) rather than O(n·period). */
export function sma(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  if (period < 1) return out;
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= period) sum -= vals[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential moving average, seeded with the first full SMA window (the
 * conventional seed — seeding from vals[0] alone leaves the first ~2·period
 * bars visibly wrong).
 */
export function ema(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  if (period < 1 || vals.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += vals[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < vals.length; i++) {
    prev = vals[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Bollinger Bands: the SMA, plus/minus `mult` population standard deviations
 * of the same window. Population (÷period), not sample (÷period−1) — that's
 * what Bollinger defined and what every venue's chart draws.
 */
export function bollinger(
  vals: number[],
  period = 20,
  mult = 2,
): { upper: (number | null)[]; mid: (number | null)[]; lower: (number | null)[] } {
  const mid = sma(vals, period);
  const upper: (number | null)[] = new Array(vals.length).fill(null);
  const lower: (number | null)[] = new Array(vals.length).fill(null);
  for (let i = 0; i < vals.length; i++) {
    const m = mid[i];
    if (m === null) continue;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (vals[j] - m) ** 2;
    const sd = Math.sqrt(sq / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { upper, mid, lower };
}

/**
 * Relative Strength Index with Wilder's smoothing (the standard). The first
 * value lands on index `period`; a window with no losses reads 100 rather
 * than dividing by zero.
 */
export function rsi(vals: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  if (period < 1 || vals.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = vals[i] - vals[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = rsiOf(gain, loss);
  for (let i = period + 1; i < vals.length; i++) {
    const d = vals[i] - vals[i - 1];
    gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
    loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = rsiOf(gain, loss);
  }
  return out;
}

function rsiOf(gain: number, loss: number): number {
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}
