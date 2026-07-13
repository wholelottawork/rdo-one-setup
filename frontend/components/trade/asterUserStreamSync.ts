// Trade page (/) — Aster user-data stream sync.
// Pushes account/order events for the EXTRA account instead of waiting for
// the 15s REST poll. Events just trigger a debounced REST refresh — the
// poll stays the source of truth; the stream makes updates instant (and is
// the only source of margin calls). Extracted from TradingTerminal's
// init(); the terminal supplies mode/address getters and its refresh fn.
import { startAsterUserStream } from "@/lib/aster-user-stream";
import { showToast } from "@/lib/toast";

export function createAsterUserStreamSync(deps: {
  getMode: () => string;
  getAddr: () => string | null;
  refreshPositions: (addr: string) => void;
}) {
  let stopUserStream: (() => void) | null = null;
  let userStreamAddr: string | null = null;
  let userStreamRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleRefresh() {
    if (userStreamRefreshTimer) return;
    userStreamRefreshTimer = setTimeout(() => {
      userStreamRefreshTimer = null;
      const addr = deps.getAddr();
      if (deps.getMode() === "aster" && addr) deps.refreshPositions(addr);
    }, 500);
  }

  function sync() {
    const addr = deps.getAddr();
    if (deps.getMode() === "aster" && addr) {
      if (stopUserStream && userStreamAddr === addr) return;
      stopUserStream?.();
      userStreamAddr = addr;
      stopUserStream = startAsterUserStream(addr, {
        onAccountUpdate: scheduleRefresh,
        onOrderUpdate: scheduleRefresh,
        onMarginCall: () =>
          showToast("Aster margin call — position at risk", "err"),
      });
    } else {
      stopUserStream?.();
      stopUserStream = null;
      userStreamAddr = null;
    }
  }

  return { sync };
}
