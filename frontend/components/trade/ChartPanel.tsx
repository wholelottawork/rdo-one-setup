// Trade page (/) — extracted from TradingTerminal. Pure markup: all
// behaviour is wired imperatively by TradingTerminal's init() via ids.
export function ChartPanel() {
  return (
    <>
        {/* Chart */}
        <section className="flex flex-col border-r border-[#1f1f1f] overflow-hidden bg-[var(--hl-bg-page)]">
          <div className="relative flex items-center justify-between px-2 border-b border-[#1f1f1f] bg-[var(--hl-bg-page)] shrink-0 h-12">
            <div className="flex items-center gap-3 min-w-0">
              <span id="chartLabel" className="text-[11px] text-[var(--hl-text-secondary)] whitespace-nowrap">
                BTCUSD · 1m · RDO ONE
              </span>
              <span id="chartOhlc" className="chart-ohlc">
                O <b id="oO">—</b>&nbsp; H <b id="oH">—</b>&nbsp; L{" "}
                <b id="oL">—</b>&nbsp; C <b id="oC">—</b>
              </span>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 flex gap-px shrink-0">
              <button className="iv-btn active" data-iv="1">
                1m
              </button>
              <button className="iv-btn" data-iv="3">
                3m
              </button>
              <button className="iv-btn" data-iv="5">
                5m
              </button>
              <button className="iv-btn" data-iv="15">
                15m
              </button>
              <button className="iv-btn" data-iv="60">
                1h
              </button>
              <button className="iv-btn" data-iv="240">
                4h
              </button>
              <button className="iv-btn" data-iv="1440">
                1D
              </button>
            </div>
            <div className="shrink-0 relative">
              <button id="indBtn" className="font-[var(--hl-font)] text-[11px] font-bold text-[var(--hl-text-secondary)] bg-transparent border-none rounded-[7px] py-1 px-2.5 cursor-pointer transition-colors duration-100 hover:text-white hover:bg-[#1a1a1a]" title="Indicators">
                <span data-i18n="indicators">Indicators</span>
              </button>
              {/* Toggled by lib/chart.ts's initIndicatorMenu — each row's
                  data-ind is the indicator name toggleIndicator() expects. */}
              <div
                id="indMenu"
                className="hidden absolute right-0 top-full mt-1 z-30 w-[168px] py-1 bg-[#0d0d0d] border border-[#1f1f1f] rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
              >
                {[
                  ["volume", "Volume"],
                  ["sma", "SMA 20"],
                  ["ema", "EMA 50"],
                  ["boll", "Bollinger 20·2"],
                  ["rsi", "RSI 14"],
                ].map(([id, label]) => (
                  <div
                    key={id}
                    data-ind={id}
                    className="ind-row flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--hl-text-secondary)] cursor-pointer hover:bg-[#161616] hover:text-white"
                  >
                    <span className="ind-tick w-3 shrink-0 text-[#50d2c1]">✓</span>
                    {label}
                  </div>
                ))}
              </div>
              <button
                className="font-[var(--hl-font)] text-[11px] font-bold text-[var(--hl-text-secondary)] bg-transparent border-none rounded-[7px] py-1 px-2.5 cursor-pointer transition-colors duration-100 hover:text-white hover:bg-[#1a1a1a]"
                onClick={() => (window as any).toggleObFloat?.()}
                title="Order Book"
              >
                Order Book
              </button>
            </div>
          </div>
          <div className="flex flex-1 overflow-hidden relative">
            <div className="flex flex-col items-center w-[30px] border-r border-[#1f1f1f] bg-[var(--hl-bg-page)] py-1.5 gap-0.5 shrink-0">
              <button className="dt" title="Cursor">
                ✛
              </button>
              <button className="dt" title="Crosshair">
                ⊕
              </button>
              <div className="dt-sep"></div>
              <button className="dt" title="Trend line">
                ╱
              </button>
              <button className="dt" title="Horizontal line">
                —
              </button>
              <button className="dt" title="Rectangle">
                ▭
              </button>
              <button className="dt" title="Fibonacci">
                ∿
              </button>
              <div className="dt-sep"></div>
              <button className="dt" title="Text">
                T
              </button>
              <div className="dt-sep"></div>
              <button className="dt" title="Magnet">
                ⊙
              </button>
            </div>
            <div className="flex-1 relative overflow-hidden min-h-0" id="priceChart"></div>
          </div>
        </section>

    </>
  );
}
