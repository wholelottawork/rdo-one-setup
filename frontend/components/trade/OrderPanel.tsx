// Trade page (/) — extracted from TradingTerminal. Pure markup: all
// behaviour is wired imperatively by TradingTerminal's init() via ids.
export function OrderPanel() {
  return (
    <>
        {/* Trade Panel */}
        <aside className="flex flex-col bg-[var(--hl-bg-base)] overflow-y-auto">
          <div className="flex items-center gap-1 py-2 px-2 pb-1.5 border-b border-[#1f1f1f] shrink-0 h-12 box-border">
            <select className="tp-select" id="marginType">
              <option data-i18n="cross">Cross</option>
              <option data-i18n="isolated">Isolated</option>
            </select>
            <div className="flex items-center gap-px bg-[var(--hl-bg-elevated)] border border-[var(--hl-border)] rounded-[var(--hl-radius)] py-1 px-1.5">
              <input
                id="levInput"
                className="w-[30px] bg-transparent border-none outline-none font-[var(--hl-font)] text-[11px] text-white text-center"
                type="number"
                min={1}
                max={50}
                defaultValue={20}
              />
              <span className="text-[10px] text-[var(--hl-text-secondary)]">x</span>
            </div>
            <select className="tp-select">
              <option data-i18n="unified">Unified</option>
            </select>
          </div>
          <div className="flex border-b border-[#1f1f1f] shrink-0 h-8">
            <button
              className="tp-otab active"
              data-ot="market"
              data-i18n="market"
            >
              Market
            </button>
            <button className="tp-otab" data-ot="limit" data-i18n="limit">
              Limit
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1 py-2 px-2 pb-1.5 shrink-0">
            <button
              id="btnBuy"
              className="tp-side tp-buy active"
              onClick={() => (window as any).rdo?.setSide(true)}
              data-i18n="buyLong"
            >
              Buy / Long
            </button>
            <button
              id="btnSell"
              className="tp-side tp-sell"
              onClick={() => (window as any).rdo?.setSide(false)}
              data-i18n="sellShort"
            >
              Sell / Short
            </button>
          </div>
          <div className="px-2 pb-2 flex flex-col gap-1.5 shrink-0">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-[var(--hl-text-secondary)]" data-i18n="availableTrade">
                Available to Trade
              </span>
              <span id="tpAvail" className="text-[var(--hl-text-soft)]">
                0.00 USDC
              </span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-[var(--hl-text-secondary)]" data-i18n="currentPosition">
                Current Position
              </span>
              <span id="tpCurPos" className="text-[var(--hl-text-soft)]">
                0.00000 BTC
              </span>
            </div>
            <div className="text-[9px] text-[var(--hl-text-secondary)] tracking-[0.4px] uppercase mt-0.5" data-i18n="size">
              Size
            </div>
            <div className="tp-size-wrap">
              <input
                id="sizeInput"
                className="flex-1 bg-transparent border-none outline-none font-[var(--hl-font)] text-[13px] font-medium text-white py-[7px] px-2 placeholder:text-[var(--hl-text-secondary)] placeholder:text-[11px]"
                type="number"
                placeholder="0"
                min={0}
                onChange={() => (window as any).rdo?.updateStats()}
              />
              <div className="py-0 px-2 text-[10px] text-[var(--hl-text-secondary)] border-l border-[var(--hl-border)] cursor-default" id="sizeUnit">
                BTC
              </div>
            </div>
            <input
              id="sizeSlider"
              className="tp-slider"
              type="range"
              min={0}
              max={100}
              defaultValue={0}
              onChange={(e) => (window as any).rdo?.onSlider(e.target.value)}
            />
            <div className="flex justify-between text-[8px] text-[var(--hl-text-secondary)]">
              <span>0%</span>
              <span>25%</span>
              <span>50%</span>
              <span>75%</span>
              <span>100%</span>
            </div>
            <div className="flex flex-col gap-1 mt-0.5">
              <label className="tp-check">
                <input type="checkbox" id="chkReduce" />
                <span data-i18n="reduceOnly">Reduce Only</span>
              </label>
              <label className="tp-check">
                <input
                  type="checkbox"
                  id="chkTpSl"
                  onChange={(e) =>
                    document
                      .getElementById("tpslInputs")
                      ?.classList.toggle("hidden", !e.target.checked)
                  }
                />
                <span data-i18n="tpsl">Take Profit / Stop Loss</span>
              </label>
              <div id="tpslInputs" className="hidden tp-tpsl-inputs">
                <div className="tp-tpsl-field">
                  <label className="tp-tpsl-label" htmlFor="tpPrice">
                    <span className="tpsl-dot tp"></span>Take Profit
                  </label>
                  <input
                    id="tpPrice"
                    type="number"
                    placeholder="Price"
                    min={0}
                    className="tp-tpsl-input"
                  />
                </div>
                <div className="tp-tpsl-field">
                  <label className="tp-tpsl-label" htmlFor="slPrice">
                    <span className="tpsl-dot sl"></span>Stop Loss
                  </label>
                  <input
                    id="slPrice"
                    type="number"
                    placeholder="Price"
                    min={0}
                    className="tp-tpsl-input"
                  />
                </div>
              </div>
            </div>
            <button
              id="tradeBtn"
              className="tp-action-btn tp-buy-bg"
              onClick={() => (window as any).rdo?.submitTrade()}
            >
              Connect
            </button>
            <div id="tradeErr" className="tp-err hidden"></div>
            <div className="flex flex-col gap-1 border-t border-[#1f1f1f] pt-2 mt-0.5">
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="liqPrice">Liquidation Price</span>
                <span id="stLiq">N/A</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="orderValue">Order Value</span>
                <span id="stVal">N/A</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="marginRequired">Margin Required</span>
                <span id="stMargin">--</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="slippage">Slippage</span>
                <span id="stSlip">--</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="fee">Fee</span>
                <span id="stFee">0.0450% / 0.0150%</span>
              </div>
            </div>
            <div className="text-[9px] tracking-[0.8px] text-[var(--hl-text-secondary)] uppercase py-1.5 pt-1.5 pb-0.5 border-t border-[#1f1f1f] mt-1" data-i18n="accountEquity">
              Account Equity
            </div>
            <div className="flex flex-col gap-1 border-t border-[#1f1f1f] pt-2 mt-0.5">
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="spot">Spot</span>
                <span id="eqSpot">$0.00</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span>
                  <a href="#" className="tp-link text-[var(--hl-text-secondary)] no-underline font-semibold hover:text-[var(--hl-accent)]" data-i18n="perps">
                    Perps
                  </a>
                </span>
                <span id="eqPerps">$0.00</span>
              </div>
            </div>
            <div className="text-[9px] tracking-[0.8px] text-[var(--hl-text-secondary)] uppercase py-1.5 pt-1.5 pb-0.5 border-t border-[#1f1f1f] mt-1" data-i18n="perpsOverview">
              Perps Overview
            </div>
            <div className="flex flex-col gap-1 border-t border-[#1f1f1f] pt-2 mt-0.5">
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span>
                  <a href="#" className="tp-link text-[var(--hl-text-secondary)] no-underline font-semibold hover:text-[var(--hl-accent)]" data-i18n="balance">
                    Balance
                  </a>
                </span>
                <span id="ovBalance">$0.00</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="unrealizedPnl">Unrealized PnL</span>
                <span id="ovPnl">$0.00</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span data-i18n="crossMarginRatio">Cross Margin Ratio</span>
                <span id="ovCmr">0.00%</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span>
                  <a href="#" className="tp-link text-[var(--hl-text-secondary)] no-underline font-semibold hover:text-[var(--hl-accent)]" data-i18n="maintenanceMargin">
                    Maintenance Margin
                  </a>
                </span>
                <span id="ovMm">$0.00</span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--hl-text-secondary)]">
                <span>
                  <a href="#" className="tp-link text-[var(--hl-text-secondary)] no-underline font-semibold hover:text-[var(--hl-accent)]" data-i18n="crossAccountLev">
                    Cross Account Leverage
                  </a>
                </span>
                <span id="ovLev">0.00x</span>
              </div>
            </div>
          </div>
        </aside>
    </>
  );
}
