'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import type { HLConnStatus } from '@/lib/hl-socket';

// Status bar — verbatim structure from index.html; clock format matches
// startClock() in main.js (UTC string slice + ' UTC').
export function StatusBar({ status }: { status: HLConnStatus }) {
  const { t } = useTranslation();
  const [clock, setClock] = useState('—');

  useEffect(() => {
    const tick = () => setClock(new Date().toUTCString().slice(5, 25) + ' UTC');
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const dotCls = status === 'live' ? 'ws-dot live' : status === 'reconnecting' ? 'ws-dot err' : 'ws-dot';
  const label = status === 'live' ? t('live') : status === 'reconnecting' ? t('reconnecting') : t('connecting');

  return (
    <div className="status-bar">
      <span className={dotCls} id="wsDot"></span>
      <span id="wsStatus" className="ws-status">{label}</span>
      <span className="sb-sep">·</span>
      <span id="clockEl" className="sb-clock">{clock}</span>
    </div>
  );
}
