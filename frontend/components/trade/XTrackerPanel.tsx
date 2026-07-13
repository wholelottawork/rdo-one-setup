// Trade page (/) — extracted from TradingTerminal. Pure markup: all
// behaviour is wired imperatively by TradingTerminal's init() via ids.
export function XTrackerPanel() {
  return (
    <>
        {/* X Tracker */}
        <aside className="flex flex-col border-r border-[#1f1f1f] bg-[var(--hl-bg-base)] overflow-hidden relative">
          <div className="flex items-center justify-between pl-6 pr-4 h-12 shrink-0 border-b border-[#1f1f1f]">
            <span className="xt-title" data-i18n="tracker">
              Tracker
            </span>
            <button
              className="xt-connect-btn"
              id="xtConnectBtn"
              onClick={() => (window as any).rdo?.connectX()}
              data-i18n="connectX"
            >
              Connect X
            </button>
          </div>
          <div className="flex-1 overflow-y-auto" id="xtFeed">
            <div className="xt-empty">
              Connect your X account to see real-time news and mentions for{" "}
              <span className="text-[var(--hl-accent)] font-semibold" id="xtTicker">
                BTC
              </span>
            </div>
          </div>
          <div className="xt-resize-handle absolute top-0 -right-[3px] w-[6px] h-full z-10 cursor-col-resize" id="xtResizeHandle"></div>
        </aside>

    </>
  );
}
