'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  defaultHeight?: number;
  minHeight?: number;
  maxHeight?: number;
  /** Height when collapsed — just enough for the tab bar, no table area. */
  collapsedHeight?: number;
}

/** Shared bottom panel shell with draggable resize handle and collapse/expand
 *  button. Used by all pages (terminal + non-terminal) for a consistent
 *  bottom-panel experience. The `children` prop is the actual panel content
 *  (tabs, tables, etc.) — this shell only provides the chrome. */
export function BottomPanelShell({
  children,
  defaultHeight = 175,
  minHeight = 60,
  maxHeight = 480,
  collapsedHeight = 38,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [height, setHeight] = useState(defaultHeight);
  const handleRef = useRef<HTMLDivElement>(null);
  const prevHeightRef = useRef(defaultHeight);
  // Use refs for drag state so the effect doesn't re-run mid-drag
  const heightRef = useRef(height);
  const collapsedRef = useRef(collapsed);

  // Keep refs in sync with state
  useEffect(() => { heightRef.current = height; }, [height]);
  useEffect(() => { collapsedRef.current = collapsed; }, [collapsed]);

  // Draggable resize — stable effect, no re-attachment on height change
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const root = document.documentElement;
    let dragging = false;
    let startY = 0;
    let startH = 0;

    const onDown = (e: MouseEvent) => {
      dragging = true;
      startY = e.clientY;
      startH = parseInt(getComputedStyle(root).getPropertyValue('--btm')) || heightRef.current;
      handle.classList.add('dragging');
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const h = Math.min(maxHeight, Math.max(minHeight, startH + (startY - e.clientY)));
      root.style.setProperty('--btm', h + 'px');
      if (collapsedRef.current && h > minHeight) {
        setCollapsed(false);
      }
      // Defer state update to avoid effect re-running during drag
      requestAnimationFrame(() => setHeight(h));
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minHeight, maxHeight]);

  // Sync CSS variable when collapsed/height changes from non-drag sources.
  // Collapsed uses collapsedHeight (tab-bar only), not minHeight, so the panel
  // shrinks to just the headings rather than an empty minHeight slab.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--btm', (collapsed ? collapsedHeight : height) + 'px');
  }, [collapsed, height, collapsedHeight]);

  function toggleCollapse() {
    if (collapsed) {
      // Expand to previous height (or default)
      const next = prevHeightRef.current > minHeight ? prevHeightRef.current : defaultHeight;
      setHeight(next);
      setCollapsed(false);
    } else {
      prevHeightRef.current = height;
      setCollapsed(true);
    }
  }

  return (
    <>
      {/* Resize handle with collapse button */}
      <div className="btm-resize-handle" ref={handleRef}>
        <button
          className="btm-collapse-btn"
          onClick={toggleCollapse}
          title={collapsed ? 'Expand' : 'Collapse'}
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
        >
          <span className={`btm-collapse-icon${collapsed ? ' collapsed' : ''}`} />
        </button>
      </div>

      {/* Bottom panel */}
      <section className={`btm-panel${collapsed ? ' collapsed' : ''}`}>
        {children}
      </section>
    </>
  );
}
