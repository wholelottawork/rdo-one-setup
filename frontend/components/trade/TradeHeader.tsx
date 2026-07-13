import { WalletControls } from "../shared/WalletControls";
// Trade page (/) — extracted from TradingTerminal. Pure markup: all
// behaviour is wired imperatively by TradingTerminal's init() via ids.
export function TradeHeader() {
  return (
    <>
      {/* ══ HEADER ═══════════════════════════════════════════════ */}
      <header className="flex items-center justify-between px-3 gap-0 bg-black border-b border-[#1f1f1f] relative z-[200] h-[var(--hdr)]">
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-baseline gap-0.5 pr-1">
            <span className="text-[13px] font-bold text-[#50d2c1] tracking-[0.5px]">RDO</span>
            <span className="text-[13px] font-light text-white">ONE</span>
          </div>
          <div className="w-px h-[18px] bg-[#1f1f1f] shrink-0"></div>
          <div className="relative flex items-center gap-2.5 shrink-0">
            <div className="flex items-center bg-[#0d0d0d] border border-[#1f1f1f] rounded-md p-0.5 gap-0.5 shrink-0" id="modeSwitch">
              <button
                className="mode-btn mode-hl active font-[var(--hl-font)] text-[11px] font-bold tracking-[0.5px] py-[3px] px-2.5 rounded border-none cursor-pointer text-[#878c8f] bg-transparent transition-all duration-150 flex items-center gap-1"
                id="modeBtnHL"
                onClick={() => (window as any).rdo?.switchMode("hl")}
              >
                BASIC
              </button>
              <button
                className="mode-btn mode-aster font-[var(--hl-font)] text-[11px] font-bold tracking-[0.5px] py-[3px] px-2.5 rounded border-none cursor-pointer text-[#878c8f] bg-transparent transition-all duration-150 flex items-center gap-1"
                id="modeBtnAster"
                onClick={() => (window as any).rdo?.switchMode("aster")}
              >
                EXTRA
              </button>
            </div>
            <button
              className="w-4 h-4 rounded-full border border-[#1f1f1f] bg-[#0d0d0d] text-[#6b7173] text-[10px] font-bold font-[var(--hl-font)] cursor-pointer leading-none flex items-center justify-center transition-all duration-150 shrink-0 hover:border-[#50d2c1] hover:text-[#50d2c1]"
              id="modeHelpBtn"
              onClick={() => (window as any).rdo?.toggleModeHelp()}
            >
              ?
            </button>
            <div
              className="hidden fixed inset-0 z-[998] backdrop-blur-[4px] bg-black/25"
              id="modeBackdrop"
              onClick={() => (window as any).rdo?.toggleModeHelp()}
            ></div>
            <div className="hidden fixed inset-0 z-[499] backdrop-blur-[4px] bg-black/25" id="mktBackdrop"></div>
            <div className="hidden absolute top-[calc(100%+8px)] left-0 bg-[#0d0d0d] border border-[#1f1f1f] rounded-lg py-3 px-3.5 min-w-[430px] z-[999] shadow-[0_8px_24px_rgba(0,0,0,0.4)]" id="modePopup">
              <div className="flex gap-2.5 items-start">
                <span className="text-[10px] font-bold tracking-[0.5px] py-0.5 px-[7px] rounded shrink-0 mt-0.5 bg-[rgba(10,153,129,0.20)] text-[#50d2c1]">BASIC</span>
                <div className="text-[11px] leading-[1.6] text-[#878c8f]">
                  <strong className="text-white text-[11px]" data-i18n="basicTitle">RDO ONE x HYPE x LI.FI</strong>
                  <br />
                  <b className="text-white text-[11px]" data-i18n="basicLev">Up to 40x leverage</b>
                  <br />
                  <span data-i18n="basicDesc">
                    Crypto perps only / Non-custodial / Any collateral
                  </span>
                  <br />
                  <span data-i18n="basicFee">
                    Taker fee 0.045% / Maker 0.015%
                  </span>
                  <br />
                  <span data-i18n="basicExtra">
                    The best liquidity / Average 0.0015% spreads
                  </span>
                </div>
              </div>
              <div className="h-px bg-[#1f1f1f] my-2.5"></div>
              <div className="flex gap-2.5 items-start">
                <span className="text-[10px] font-bold tracking-[0.5px] py-0.5 px-[7px] rounded shrink-0 mt-0.5 bg-[rgba(139,92,246,0.15)] text-[#a78bfa]">EXTRA</span>
                <div className="text-[11px] leading-[1.6] text-[#878c8f]">
                  <strong className="text-white text-[11px]" data-i18n="extraTitle">
                    RDO ONE x ASTER x LI.FI
                  </strong>
                  <br />
                  <b className="text-white text-[11px]" data-i18n="extraLev">Up to 200x leverage</b>
                  <br />
                  <span data-i18n="extraDesc">
                    Crypto perps only / Hybrid-custodial / Any collateral
                  </span>
                  <br />
                  <span data-i18n="extraFee">Taker fee 0.04% / Maker 0%</span>
                  <br />
                  <span data-i18n="extraExtra">
                    Higher leverage level / Best fee rates
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="w-px h-[18px] bg-[#1f1f1f] shrink-0"></div>
          <nav className="flex items-center gap-1 mx-4">
            <a className="text-xs font-medium text-white no-underline py-[5px] px-3 rounded-[7px] transition-colors duration-150 bg-[#1f1f1f] font-semibold pb-[5px]" href="/" data-i18n="trade">
              Trade
            </a>
            <a className="text-xs font-medium text-[#878c8f] no-underline py-[5px] px-3 rounded-[7px] transition-colors duration-150 hover:text-white hover:bg-[#1a1a1a]" href="/markets" data-i18n="markets">
              Markets
            </a>
            <a className="text-xs font-medium text-[#878c8f] no-underline py-[5px] px-3 rounded-[7px] transition-colors duration-150 hover:text-white hover:bg-[#1a1a1a]" href="/news" data-i18n="news">
              News
            </a>
            <a className="text-xs font-medium text-[#878c8f] no-underline py-[5px] px-3 rounded-[7px] transition-colors duration-150 hover:text-white hover:bg-[#1a1a1a]" href="/portfolio" data-i18n="portfolio">
              Portfolio
            </a>
            <a className="text-xs font-medium text-[#878c8f] no-underline py-[5px] px-3 rounded-[7px] transition-colors duration-150 hover:text-white hover:bg-[#1a1a1a]" href="/transfer" data-i18n="transfer">
              Transfer
            </a>
          </nav>
          <div className="w-px h-[18px] bg-[#1f1f1f] shrink-0"></div>
          <button className="flex items-center gap-1 font-[var(--hl-font)] text-[13px] font-semibold text-white bg-transparent border-none cursor-pointer py-1 px-2 rounded-md transition-colors duration-150 hover:bg-[#0d0d0d]" id="mktBtn">
            <span id="mktSymbol">BTC-USDC</span>
            <span className="text-[10px] text-[#878c8f] mt-px">▾</span>
          </button>
          <div id="mktDropdown" className="mkt-dropdown hidden absolute top-[calc(var(--hdr)+2px)] left-[120px] bg-[#0d0d0d] border border-[#1f1f1f] rounded-[10px] z-[500] w-[260px] shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
            <input
              id="mktSearch"
              className="w-full py-2 px-3 bg-transparent border-0 border-b border-[#1f1f1f] font-[var(--hl-font)] text-xs text-white outline-none placeholder:text-[#878c8f]"
              placeholder="Search market..."
              autoComplete="off"
              data-i18n="searchMarket"
              data-i18n-attr="placeholder"
            />
            <div className="max-h-[280px] overflow-y-auto" id="mktList"></div>
            <div className="flex items-center gap-4 py-2 px-3 border-t border-[#1f1f1f]">
              <span className="flex items-center gap-[5px] text-[11px] text-[#878c8f]">
                <kbd className="font-[var(--hl-font)] text-[10px] font-semibold text-white bg-white/[0.08] border border-[#1f1f1f] rounded-[3px] py-px px-[5px] leading-[1.6]">↑↓</kbd> Navigate
              </span>
              <span className="flex items-center gap-[5px] text-[11px] text-[#878c8f]">
                <kbd className="font-[var(--hl-font)] text-[10px] font-semibold text-white bg-white/[0.08] border border-[#1f1f1f] rounded-[3px] py-px px-[5px] leading-[1.6]">Enter</kbd> Select
              </span>
              <span className="flex items-center gap-[5px] text-[11px] text-[#878c8f]">
                <kbd className="font-[var(--hl-font)] text-[10px] font-semibold text-white bg-white/[0.08] border border-[#1f1f1f] rounded-[3px] py-px px-[5px] leading-[1.6]">Esc</kbd> Close
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0 flex-1 overflow-hidden px-3 py-0">
          <div className="flex flex-col items-start py-0 px-3.5 border-r border-[#1f1f1f] gap-px shrink-0 first:pl-0">
            <span className="text-[9px] text-[#878c8f] tracking-[0.4px] uppercase" data-i18n="mark">
              Mark
            </span>
            <span className="text-[11px] text-white font-medium" id="statMark">
              —
            </span>
          </div>
          <div className="flex flex-col items-start py-0 px-3.5 border-r border-[#1f1f1f] gap-px shrink-0 first:pl-0">
            <span className="text-[9px] text-[#878c8f] tracking-[0.4px] uppercase" data-i18n="change24h">
              24h Change
            </span>
            <span className="text-[11px] text-white font-medium" id="statChange">
              —
            </span>
          </div>
          <div className="flex flex-col items-start py-0 px-3.5 border-r border-[#1f1f1f] gap-px shrink-0 first:pl-0">
            <span className="text-[9px] text-[#878c8f] tracking-[0.4px] uppercase" data-i18n="volume24h">
              24h Volume
            </span>
            <span className="text-[11px] text-white font-medium" id="statVolume">
              —
            </span>
          </div>
          <div className="flex flex-col items-start py-0 px-3.5 border-r border-[#1f1f1f] gap-px shrink-0 first:pl-0">
            <span className="text-[9px] text-[#878c8f] tracking-[0.4px] uppercase" data-i18n="fundingCountdown">
              Funding / Countdown
            </span>
            <span className="text-[11px] text-white font-medium" id="statFunding">
              — / —
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span id="balanceDisplay" className="text-[11px] font-semibold text-[#50d2c1] px-2 tracking-[0.3px] hidden">
            $0.00
          </span>
          <button
            id="depositBtn"
            className="font-[var(--hl-font)] text-[11px] font-semibold py-[5px] px-3 bg-transparent border border-[#50d2c1] text-[#50d2c1] rounded-md cursor-pointer tracking-[0.5px] hover:bg-[#50d2c1] hover:text-[#04060c] hidden"
            onClick={() => (window as any).rdo?.openDeposit()}
            data-i18n="deposit"
          >
            DEPOSIT
          </button>
          <button
            id="rubBtn"
            className="font-[var(--hl-font)] text-[11px] font-bold py-[5px] px-[11px] bg-transparent border border-[#5a3800] rounded-md text-[#d4870a] cursor-pointer tracking-[0.3px] hover:border-[#d4870a] hover:text-[#f0a020] hover:bg-[rgba(212,135,10,0.08)] hidden"
            onClick={() => (window as any).rdo?.openOnramp()}
          >
            ₽ RUB
          </button>
          <WalletControls />
        </div>
      </header>
    </>
  );
}
