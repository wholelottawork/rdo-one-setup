// Run: npm test   (node strips the types natively, no test framework)
import assert from "node:assert/strict";
import { entryPrice, tpslError } from "./orderMath.ts";

const MARK = 100_000;

// --- entryPrice ------------------------------------------------------------
assert.equal(entryPrice(false, 0, MARK), MARK, "market uses mark");
assert.equal(entryPrice(true, 90_000, MARK), 90_000, "limit uses its own price");
assert.equal(entryPrice(true, 0, MARK), MARK, "blank limit field falls back to mark");
assert.equal(entryPrice(false, 90_000, MARK), MARK, "stale limit ignored on market");

// --- tpslError: market orders (entry == mark) ------------------------------
assert.equal(tpslError(true, MARK, 110_000, 95_000, false), null, "valid long TP/SL");
assert.equal(tpslError(false, MARK, 90_000, 105_000, false), null, "valid short TP/SL");
assert.match(tpslError(true, MARK, 95_000, 0, false)!, /TP must be above/, "long TP below entry");
assert.match(tpslError(true, MARK, 0, 105_000, false)!, /SL must be below/, "long SL above entry");
assert.match(tpslError(false, MARK, 105_000, 0, false)!, /TP must be below/, "short TP above entry");
assert.match(tpslError(false, MARK, 0, 95_000, false)!, /SL must be above/, "short SL below entry");

// --- tpslError: the bug this file exists for -------------------------------
// Buy limit at 90k while mark is 100k. An SL at 95k clears a MARK-based check
// but sits above the real entry — price must cross 95k on the way down to
// fill at 90k, so the stop fires into the fill. Must be rejected.
assert.match(
  tpslError(true, 90_000, 0, 95_000, true)!,
  /SL must be below limit price/,
  "stop between mark and a lower buy limit must be rejected",
);
// Mirror: a TP at 95k IS profitable against a 90k entry and must be allowed,
// even though a mark-based check would have rejected it for being under 100k.
assert.equal(
  tpslError(true, 90_000, 95_000, 0, true),
  null,
  "TP between a lower buy limit and mark must be allowed",
);
// Same shape on the short side: sell limit at 110k, mark 100k.
assert.match(
  tpslError(false, 110_000, 0, 105_000, true)!,
  /SL must be above limit price/,
  "stop between mark and a higher sell limit must be rejected",
);
assert.equal(
  tpslError(false, 110_000, 105_000, 0, true),
  null,
  "TP between a higher sell limit and mark must be allowed",
);

// --- zero means "not set", never a trigger at price 0 ----------------------
assert.equal(tpslError(true, MARK, 0, 0, false), null, "no triggers set");

console.log("orderMath: all checks passed");
