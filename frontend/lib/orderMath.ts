// Entry-price and trigger-placement rules for the trade panel. Kept DOM-free
// and dependency-free so the money-path branches can be exercised directly —
// see orderMath.test.ts (`npm test`). Everything here answers one question:
// what price does this order actually enter at, and is a TP/SL survivable
// against THAT price rather than against mark?

/** The price an order fills at: a resting limit's own price, else mark. */
export function entryPrice(isLimit: boolean, limitPx: number, markPx: number): number {
  return isLimit && limitPx > 0 ? limitPx : markPx;
}

/**
 * Whether an order has a position behind it yet, from one status response.
 *
 * TP/SL for a resting limit can only be placed once something has executed —
 * triggers sent earlier fire against an empty position and are consumed,
 * leaving the eventual fill naked. "filled" here means ANY execution, partial
 * included: that is the moment protection becomes both possible and needed.
 */
export function fillState(order: {
  executedQty?: string | number;
  status?: string;
}): "filled" | "ended" | "waiting" {
  if (parseFloat(String(order?.executedQty ?? "0")) > 0) return "filled";
  if (["CANCELED", "EXPIRED", "REJECTED"].includes(String(order?.status)))
    return "ended";
  return "waiting";
}

/**
 * Error message when a TP/SL sits on the wrong side of the entry, else null.
 *
 * `entryPx` must be the ENTRY price, not mark. A stop placed between mark and
 * a resting limit passes a mark-based check but is fatal: price has to cross
 * the stop on its way to filling the limit, so the trigger fires into the fill
 * and closes the position at a loss the instant it opens.
 */
export function tpslError(
  isBuy: boolean,
  entryPx: number,
  tpPx: number,
  slPx: number,
  isLimit: boolean,
): string | null {
  const lbl = isLimit ? "limit price" : "mark price";
  if (tpPx && (isBuy ? tpPx <= entryPx : tpPx >= entryPx))
    return "TP must be " + (isBuy ? "above" : "below") + " " + lbl;
  if (slPx && (isBuy ? slPx >= entryPx : slPx <= entryPx))
    return "SL must be " + (isBuy ? "below" : "above") + " " + lbl;
  return null;
}
