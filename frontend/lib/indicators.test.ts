// Run: npm test   (node strips the types natively, no test framework)
import assert from "node:assert/strict";
import { sma, ema, bollinger, rsi } from "./indicators.ts";

const RAMP = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// --- warm-up: nothing is claimed before a full window exists ---------------
assert.deepEqual(sma(RAMP, 3).slice(0, 2), [null, null], "SMA warm-up is null");
assert.deepEqual(ema(RAMP, 3).slice(0, 2), [null, null], "EMA warm-up is null");
assert.deepEqual(sma([1, 2], 5), [null, null], "series shorter than the period is all null");
assert.deepEqual(rsi([1, 2, 3], 14), [null, null, null], "RSI needs period+1 points");
assert.deepEqual(sma(RAMP, 0), new Array(10).fill(null), "period 0 never divides by zero");

// --- SMA -------------------------------------------------------------------
assert.equal(sma(RAMP, 3)[2], 2, "(1+2+3)/3");
assert.equal(sma(RAMP, 3)[9], 9, "(8+9+10)/3 — the rolling sum drops the tail");
assert.equal(sma([5, 5, 5, 5], 4)[3], 5, "flat series");

// --- EMA -------------------------------------------------------------------
// Seed is the SMA of the first window, then k = 2/(period+1) = 0.5 for period 3.
const e = ema(RAMP, 3);
assert.equal(e[2], 2, "EMA seeds on the first full SMA window");
assert.equal(e[3], 3, "4·0.5 + 2·0.5");
assert.equal(e[4], 4, "5·0.5 + 3·0.5");
// On a *linear* ramp a correctly-seeded EMA and the SMA coincide exactly (both
// lag by (period−1)/2), so the ramp can't show the difference. A step can:
// EMA weights the jump more heavily than an equal-weight window does.
const STEP = [5, 5, 5, 5, 5, 5, 10];
assert.ok(ema(STEP, 3)[6]! > sma(STEP, 3)[6]!, "EMA reacts to a step faster than SMA");

// --- Bollinger -------------------------------------------------------------
const flat = bollinger([7, 7, 7, 7], 4, 2);
assert.equal(flat.mid[3], 7, "flat mid");
assert.equal(flat.upper[3], 7, "zero deviation collapses the bands onto the mid");
assert.equal(flat.lower[3], 7, "zero deviation collapses the bands onto the mid");
// [1,2,3,4,5]: mean 3, population sd = sqrt(2) — sample sd would be sqrt(2.5),
// which is the wrong band width and the easiest thing to get wrong here.
const b = bollinger([1, 2, 3, 4, 5], 5, 2);
assert.equal(b.mid[4], 3, "mid is the SMA");
assert.ok(Math.abs(b.upper[4]! - (3 + 2 * Math.SQRT2)) < 1e-9, "upper uses population sd");
assert.ok(Math.abs(b.lower[4]! - (3 - 2 * Math.SQRT2)) < 1e-9, "lower uses population sd");

// --- RSI -------------------------------------------------------------------
// A series that only ever rises has no losses: RSI pins at 100 instead of
// dividing by zero.
assert.equal(rsi(RAMP, 3)[3], 100, "no losses reads 100, not NaN");
const down = [10, 9, 8, 7, 6, 5];
assert.equal(rsi(down, 3)[3], 0, "no gains reads 0");
// Wilder smoothing, period 2 on [1,2,1,2,3]: changes +1,-1,+1,+1.
// seed avgGain=0.5 avgLoss=0.5 -> RSI 50 at index 2.
const r = rsi([1, 2, 1, 2, 3], 2);
assert.equal(r[2], 50, "equal average gain and loss is 50");
assert.ok(r[3]! > 50 && r[4]! > r[3]!, "successive gains push RSI up");
assert.ok(r.slice(3).every((v) => v! >= 0 && v! <= 100), "RSI stays in 0..100");

console.log("indicators: all checks passed");
