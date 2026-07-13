// Trade page (/) — extracted from TradingTerminal. Pure markup: all
// behaviour is wired imperatively by TradingTerminal's init() via ids.
export function TradeModals() {
  return (
    <>
      {/* Deposit modal */}
      <div
        id="depositModal"
        className="modal-overlay hidden"
        onClick={(e) => (window as any).rdo?.closeDeposit(e)}
      >
        <div className="modal-box">
          <div className="modal-header">
            <div>
              <div className="modal-title" data-i18n="depositFunds">
                DEPOSIT FUNDS
              </div>
              <div className="modal-sub" data-i18n="depositSub">
                Swap any token → USDC on Hyperliquid
              </div>
            </div>
            <span
              className="modal-close"
              onClick={() => (window as any).rdo?.closeDeposit()}
            >
              ✕
            </span>
          </div>
          <div className="deposit-steps">
            <div className="step">
              <span className="step-num">1</span>
              <span data-i18n="step1">Pick source token</span>
            </div>
            <div className="step">
              <span className="step-num">2</span>
              <span data-i18n="step2">Approve in Phantom</span>
            </div>
            <div className="step">
              <span className="step-num">3</span>
              <span data-i18n="step3">USDC arrives in ~2 min</span>
            </div>
          </div>
          <div className="deposit-addr-box">
            <div className="deposit-addr-label" data-i18n="yourHlAddr">
              Your Hyperliquid address
            </div>
            <div
              className="deposit-addr"
              id="depositAddr"
              data-i18n="connectFirst"
            >
              Connect wallet first
            </div>
          </div>
          <div className="deposit-routes">
            <div className="deposit-route">
              <span className="deposit-route-from">Solana (SOL / USDC)</span>
              <span className="deposit-route-arrow">→</span>
              <span className="deposit-route-to">HyperEVM via LI.FI</span>
              <span className="deposit-route-time">~2 min</span>
            </div>
            <div className="deposit-route">
              <span className="deposit-route-from">Ethereum (ETH / USDC)</span>
              <span className="deposit-route-arrow">→</span>
              <span className="deposit-route-to">HyperEVM via LI.FI</span>
              <span className="deposit-route-time">~3 min</span>
            </div>
            <div className="deposit-route">
              <span className="deposit-route-from" data-i18n="directDeposit">
                Direct USDC deposit
              </span>
              <span className="deposit-route-arrow">→</span>
              <span className="deposit-route-to" data-i18n="sendToAddr">
                Send to address above on HyperEVM
              </span>
              <span className="deposit-route-time">~1 min</span>
            </div>
          </div>
        </div>
      </div>

      {/* Onramp modal */}
      <div
        id="onrampModal"
        className="modal-overlay hidden"
        onClick={(e) => (window as any).rdo?.closeOnramp(e)}
      >
        <div className="modal-box" style={{ maxWidth: 400 }}>
          <div className="modal-header" style={{ padding: "16px 18px 0" }}>
            <div>
              <div className="modal-title">DEPOSIT RUB → PERPS</div>
              <div className="modal-sub">
                Купи USDT за рубли и отправь на перпы
              </div>
            </div>
            <span
              className="modal-close"
              onClick={() => (window as any).rdo?.closeOnrampForce()}
            >
              ✕
            </span>
          </div>
          <div className="onramp-body">
            <div className="onramp-addr-box">
              <div className="onramp-addr-label">
                Адрес Antarctic Wallet (USDT)
              </div>
              <div className="onramp-addr-row">
                <span className="onramp-address" id="onrampAddress">
                  —
                </span>
                <button className="onramp-copy-btn" id="onrampCopyBtn">
                  Copy
                </button>
              </div>
            </div>
            <div className="onramp-steps">
              <div className="onramp-step">
                <span className="onramp-num">1</span>Купи USDT за рубли на UTORG
                или Mercuryo
              </div>
              <div className="onramp-step">
                <span className="onramp-num">2</span>USDT придёт в Antarctic
                Wallet (~5 мин)
              </div>
              <div className="onramp-step">
                <span className="onramp-num">3</span>Нажми DEPOSIT → LI.FI для
                отправки на перпы
              </div>
            </div>
            <div className="onramp-providers">
              <button className="onramp-provider-btn onramp-utorg">
                <span className="onramp-prov-name">UTORG</span>
                <span className="onramp-prov-tag">Рекомендуем для РФ</span>
              </button>
              <button className="onramp-provider-btn onramp-mercuryo">
                <span className="onramp-prov-name">Mercuryo</span>
                <span className="onramp-prov-tag">Альтернатива</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* TP/SL dialog — instrument-panel modal for placing/editing triggers.
          Replaces window.prompt: mark-price context, per-leg outcome preview,
          direction validation inline. Driven imperatively by tpslDialog. */}
      <div
        id="tpslModal"
        className="modal-overlay hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tpslModalTitle"
      >
        <div className="modal-box tpsl-box">
          <div className="modal-header">
            <div>
              <div id="tpslModalTitle" className="modal-title">
                Set TP/SL
              </div>
              <div id="tpslModalSub" className="modal-sub"></div>
            </div>
            <span id="tpslModalX" className="modal-close" role="button" aria-label="Close">
              ✕
            </span>
          </div>
          <div className="tpsl-mark-row">
            <span>Mark price</span>
            <b id="tpslModalMark">—</b>
          </div>
          <div id="tpslFieldTp" className="tpsl-field">
            <label className="tpsl-label" htmlFor="tpslInputTp">
              <span className="tpsl-dot tp"></span>Take Profit
            </label>
            <input
              id="tpslInputTp"
              className="tpsl-input"
              type="number"
              inputMode="decimal"
              placeholder="Trigger price"
            />
            <div id="tpslPrevTp" className="tpsl-preview"></div>
          </div>
          <div id="tpslFieldSl" className="tpsl-field">
            <label className="tpsl-label" htmlFor="tpslInputSl">
              <span className="tpsl-dot sl"></span>Stop Loss
            </label>
            <input
              id="tpslInputSl"
              className="tpsl-input"
              type="number"
              inputMode="decimal"
              placeholder="Trigger price"
            />
            <div id="tpslPrevSl" className="tpsl-preview"></div>
          </div>
          <div id="tpslModalErr" className="tpsl-err hidden"></div>
          <div className="tpsl-actions">
            <button id="tpslCancel" className="tpsl-btn ghost">
              Cancel
            </button>
            <button id="tpslSubmit" className="tpsl-btn solid">
              Set TP/SL
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
