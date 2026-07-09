'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n';

// X Tracker column — verbatim structure from index.html, including the
// column-resize drag that adjusts the --xt CSS variable (main.js initXtResize).
export function XTracker({ market }: { market: string }) {
  const { t } = useTranslation();
  const [connected, setConnected] = useState(false);
  const handleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const root = document.documentElement;
    const MIN = 120, MAX = 520;
    let dragging = false, startX = 0, startW = 0;

    const onDown = (e: MouseEvent) => {
      dragging = true;
      startX = e.clientX;
      startW = parseInt(getComputedStyle(root).getPropertyValue('--xt')) || 240;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const w = Math.min(MAX, Math.max(MIN, startW + (e.clientX - startX)));
      root.style.setProperty('--xt', w + 'px');
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    handle.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      handle.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <aside className="xt-col">
      <div className="xt-hdr">
        <span className="xt-title">{t('tracker')}</span>
        <button
          className={`xt-connect-btn${connected ? ' connected' : ''}`}
          id="xtConnectBtn"
          disabled={connected}
          onClick={() => setConnected(true)}
        >
          {connected ? 'Connected' : t('connectX')}
        </button>
      </div>
      <div className="xt-feed" id="xtFeed">
        {connected ? (
          <div className="xt-empty">X integration coming soon — connect your API key in settings.</div>
        ) : (
          <div className="xt-empty">{t('xtEmpty')} <span className="xt-ticker" id="xtTicker">{market}</span></div>
        )}
      </div>
      <div className="xt-resize-handle" id="xtResizeHandle" ref={handleRef}></div>
    </aside>
  );
}
