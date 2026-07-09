'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { useWallet } from '@/lib/wallet';

// Deposit modal — verbatim structure from index.html (backdrop click closes,
// mirrors deposit.js closeDepositModal's e.target check).
export function DepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { address } = useWallet();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  return (
    <div
      id="depositModal"
      className={`modal-overlay${open ? '' : ' hidden'}`}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-box">
        <div className="modal-header">
          <div>
            <div className="modal-title">{t('depositFunds')}</div>
            <div className="modal-sub">{t('depositSub')}</div>
          </div>
          <span className="modal-close" onClick={onClose}>✕</span>
        </div>

        <div className="deposit-steps">
          <div className="step"><span className="step-num">1</span><span>{t('step1')}</span></div>
          <div className="step"><span className="step-num">2</span><span>{t('step2')}</span></div>
          <div className="step"><span className="step-num">3</span><span>{t('step3')}</span></div>
        </div>

        <div className="deposit-addr-box">
          <div className="deposit-addr-label">{t('yourHlAddr')}</div>
          <div className="deposit-addr" id="depositAddr">{mounted && address ? address : t('connectFirst')}</div>
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
            <span className="deposit-route-from">{t('directDeposit')}</span>
            <span className="deposit-route-arrow">→</span>
            <span className="deposit-route-to">{t('sendToAddr')}</span>
            <span className="deposit-route-time">~1 min</span>
          </div>
        </div>

        <div className="modal-note">
          Wire up <code>@lifi/widget</code> in <code>src/deposit.js</code> to enable one-click swaps from any chain.
        </div>
      </div>
    </div>
  );
}
