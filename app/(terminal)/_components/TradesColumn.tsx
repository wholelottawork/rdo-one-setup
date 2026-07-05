'use client';

import { useTranslation } from '@/lib/i18n';
import { fmtPrice, fmtSize, type TradeMode } from '@/lib/markets';
import type { Trade } from '@/lib/hl-socket';

interface Props {
  mode: TradeMode;
  market: string;
  trades: Trade[];
}

// Live trades column — verbatim structure from index.html + renderTrades().
export function TradesColumn({ mode, market, trades }: Props) {
  const { t } = useTranslation();
  const suffix = mode === 'aster' ? '-USDT' : '-USDC';

  return (
    <section className="tr-col">
      <div className="tr-col-hdr">
        <span className="tr-col-title">{t('liveTrades')}</span>
        <span className="tr-col-pair" id="tradesPair">{market}{suffix}</span>
      </div>
      <div className="tr-col-labels">
        <span>{t('price')}</span>
        <span>{t('size')}</span>
        <span>{t('time')}</span>
      </div>
      <div id="tradesList" className="tr-col-list">
        {mode === 'aster' ? (
          <div style={{ color: 'var(--hl-text-muted)', fontSize: 11, padding: 8, textAlign: 'center' }}>
            Aster live trades streaming<br />coming soon
          </div>
        ) : (
          trades.slice(0, 50).map((trade, i) => {
            const d = new Date(trade.time);
            const ts = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => n.toString().padStart(2, '0')).join(':');
            return (
              <div key={i} className={`trade-row ${trade.side === 'buy' ? 't-buy' : 't-sell'}`}>
                <span className="tr-price">{fmtPrice(trade.px)}</span>
                <span className="tr-sz">{fmtSize(trade.sz)}</span>
                <span className="tr-time">{ts}</span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
