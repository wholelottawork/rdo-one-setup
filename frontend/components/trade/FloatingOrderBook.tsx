// Trade page (/) — extracted from TradingTerminal. Pure markup: all
// behaviour is wired imperatively by TradingTerminal's init() via ids.
export function FloatingOrderBook() {
  return (
    <>
      {/* Floating order book */}
      <div id="obFloat" className="fixed z-[9999] flex flex-col w-[320px] max-h-[80vh] bg-[var(--hl-bg-elevated)] border border-[var(--hl-border)] rounded-[var(--hl-radius)] shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden" style={{ display: "none" }}>
        <div className="flex items-center py-2 px-3 bg-[var(--hl-bg-overlay)] border-b border-[var(--hl-border)] cursor-grab select-none shrink-0 active:cursor-grabbing" id="obFloatHdr">
          <span className="text-[11px] font-bold tracking-[0.05em] uppercase text-[var(--hl-text-secondary)] flex-1">Order Book</span>
          <button
            className="bg-none border-none text-[var(--hl-text-muted)] text-[13px] cursor-pointer px-0.5 leading-none hover:text-white"
            onClick={() => {
              const el = document.getElementById("obFloat");
              if (el) el.style.display = "none";
            }}
          >
            ✕
          </button>
        </div>
        <div className="ob-mini border-t border-[var(--hl-border)] shrink-0 mt-2" id="obMini">
          <div
            className="ob-mini-hdr flex items-center justify-between py-1.5 px-2 pb-2.5"
            onClick={() => (window as any).rdo?.toggleOrderBook()}
            style={{ cursor: "pointer" }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[var(--hl-text-secondary)] whitespace-nowrap mr-1.5" data-i18n="orderBook">
              Order Book
            </span>
            <button
              className="ob-toggle-btn"
              id="obToggleBtn"
              aria-label="Toggle order book"
            ></button>
            <div className="ob-colhdr grid grid-cols-3 px-2 ml-auto" id="obColHdr" style={{ flex: 1 }}>
              <span className="text-[9px] text-[var(--hl-text-light)] uppercase tracking-[0.3px]" data-i18n="price">Price</span>
              <span className="text-[9px] text-[var(--hl-text-light)] uppercase tracking-[0.3px] text-right" data-i18n="size">Size</span>
              <span className="text-[9px] text-[var(--hl-text-light)] uppercase tracking-[0.3px] text-right" data-i18n="total">Total</span>
            </div>
          </div>
          <div id="obBody">
            <div id="obAsks" className="overflow-hidden flex flex-col flex-col-reverse"></div>
            <div className="flex items-center gap-1.5 py-1 px-2 border-y border-[#1f1f1f] shrink-0 my-2">
              <span className="text-[9px] text-[var(--hl-text-secondary)] flex-1 uppercase tracking-[0.4px]" data-i18n="spread">
                Spread
              </span>
              <span id="obSpreadVal" className="text-[11px] text-white">
                —
              </span>
              <span id="obSpreadPct" className="text-[9px] text-[var(--hl-text-muted)]"></span>
            </div>
            <div id="obBids" className="overflow-hidden pb-2"></div>
            <div className="flex h-[22px] shrink-0 border-t border-[#1f1f1f] text-[10px] font-bold overflow-hidden" id="obRatio">
              <div
                className="flex items-center pl-[7px] transition-[width] duration-300 whitespace-nowrap overflow-hidden"
                id="obRatioBid"
                style={{ width: "50%" }}
              >
                B 50.0%
              </div>
              <div className="flex items-center justify-end pr-[7px] flex-1 transition-[width] duration-300 whitespace-nowrap overflow-hidden" id="obRatioAsk">
                50.0% S
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
