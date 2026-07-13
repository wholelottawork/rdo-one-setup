// Trade page (/) — extracted from TradingTerminal. Pure markup: all
// behaviour is wired imperatively by TradingTerminal's init() via ids.
export function TradesPanel() {
  return (
    <>
        {/* Live Trades */}
        <section className="flex flex-col border-r border-[#1f1f1f] bg-[var(--hl-bg-base)] overflow-hidden">
          <div className="flex items-center justify-between px-4 h-12 shrink-0 border-b border-[#1f1f1f]">
            <span className="text-[11px] font-semibold text-white" data-i18n="liveTrades">
              Live Trades
            </span>
            <span className="text-[10px] text-[var(--hl-text-secondary)]" id="tradesPair">
              BTC-USDC
            </span>
          </div>
          <div className="grid grid-cols-3 px-4 py-[3px] border-b border-[#1f1f1f] shrink-0">
            <span className="text-[9px] text-[var(--hl-text-light)] uppercase tracking-[0.3px]" data-i18n="price">Price</span>
            <span className="text-[9px] text-[var(--hl-text-light)] uppercase tracking-[0.3px] text-right" data-i18n="size">Size</span>
            <span className="text-[9px] text-[var(--hl-text-light)] uppercase tracking-[0.3px] text-right" data-i18n="time">Time</span>
          </div>
          <div id="tradesList" className="flex-1 overflow-y-auto"></div>
        </section>

    </>
  );
}
