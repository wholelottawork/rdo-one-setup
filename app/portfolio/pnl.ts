// Pure helpers ported verbatim from public/portfolio.html's inline script.
// The SVG/HTML string builders are kept as string builders (rendered via
// dangerouslySetInnerHTML) so the output markup is byte-identical.

export const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtUSD = (n: number) => '$' + fmt(n, n >= 1 ? 2 : 6);
export const fmtK = (n: number) => (n >= 1e6 ? '$' + fmt(n / 1e6, 2) + 'M' : n >= 1e3 ? '$' + fmt(n / 1e3, 1) + 'K' : '$' + fmt(n));
export const shorten = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);
export const pCls = (v: number) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
export const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

export function rangeStartMs(range: string): number {
  const now = Date.now();
  if (range === '7D') return now - 7 * 86400000;
  if (range === '30D') return now - 30 * 86400000;
  if (range === '90D') return now - 90 * 86400000;
  return 0;
}

export function formatDuration(ms: number): string {
  if (ms < 60000) return Math.round(ms / 1000) + 's';
  if (ms < 3600000) return Math.round(ms / 60000) + 'm';
  if (ms < 86400000) return (ms / 3600000).toFixed(1) + 'h';
  return (ms / 86400000).toFixed(1) + 'd';
}

// ── Raw HL fill (userFillsByTime response) ────────────────────────────────────
export interface RawFill {
  coin: string;
  px: string;
  sz: string;
  side: string;
  dir?: string;
  closedPnl?: string;
  time: number;
}

export function calcEntryPx(fill: RawFill): number {
  const exitPx = parseFloat(fill.px);
  const pnl = parseFloat(fill.closedPnl ?? '0');
  const sz = parseFloat(fill.sz);
  if (sz === 0) return 0;
  const isLong = (fill.dir ?? '').toLowerCase().includes('long') || fill.side === 'B';
  return isLong ? exitPx - pnl / sz : exitPx + pnl / sz;
}

export interface CumPoint { t: number; v: number }

// ── Cumulative PnL chart (renderPnLChart) — returns SVG innerHTML ────────────
export function buildPnLChartSvg(pts: CumPoint[], totalPnl?: number): { svg: string; total: string; totalCls: string } {
  if (!pts.length) {
    return { svg: '<text x="400" y="105" text-anchor="middle" font-size="11" fill="#4a5568">No PnL data</text>', total: '', totalCls: 'chart-total' };
  }
  const W = 800, H = 200, PAD = { t: 10, r: 8, b: 28, l: 56 };
  const cw = W - PAD.l - PAD.r, ch = H - PAD.t - PAD.b;
  const vals = pts.map(p => p.v);
  const minV = Math.min(0, ...vals), maxV = Math.max(0, ...vals);
  const rng = maxV - minV || 1;
  const px = (i: number) => PAD.l + (i / (pts.length - 1 || 1)) * cw;
  const py = (v: number) => PAD.t + (1 - (v - minV) / rng) * ch;
  const zeroY = py(0);
  const points = pts.map((p, i) => `${px(i).toFixed(1)},${py(p.v).toFixed(1)}`).join(' ');
  const color = (totalPnl ?? vals[vals.length - 1]) >= 0 ? '#1fa67d' : '#ed7088';
  const fid = 'cf' + Math.random().toString(36).slice(2, 6);
  const yLabels: string[] = [], xLabels: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const v = minV + (rng / 4) * i;
    const y = py(v);
    yLabels.push(`<text x="${PAD.l - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#878c8f">${fmtK(v).replace('$', '')}</text><line x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}" stroke="#1d2c32" stroke-width="1"/>`);
  }
  const lc = Math.min(6, pts.length);
  for (let i = 0; i < lc; i++) {
    const idx = Math.floor((i / (lc - 1 || 1)) * (pts.length - 1));
    const d = new Date(pts[idx].t);
    xLabels.push(`<text x="${px(idx)}" y="${H - PAD.b + 10}" text-anchor="middle" font-size="9" fill="#878c8f">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</text>`);
  }
  const areaPath = `M${px(0)},${zeroY} ` + pts.map((p, i) => `L${px(i).toFixed(1)},${py(p.v).toFixed(1)}`).join(' ') + ` L${px(pts.length - 1)},${zeroY} Z`;
  const svg = `<defs><linearGradient id="${fid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.25"/><stop offset="100%" stop-color="${color}" stop-opacity="0.02"/></linearGradient></defs>${yLabels.join('')}${xLabels.join('')}<line x1="${PAD.l}" y1="${zeroY}" x2="${W - PAD.r}" y2="${zeroY}" stroke="#273035" stroke-width="1" stroke-dasharray="3,3"/><path d="${areaPath}" fill="url(#${fid})"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${px(pts.length - 1)}" cy="${py(vals[vals.length - 1])}" r="3" fill="${color}"/>`;
  const finalPnl = vals[vals.length - 1];
  return {
    svg,
    total: (finalPnl >= 0 ? '+' : '') + '$' + fmt(finalPnl),
    totalCls: 'chart-total ' + pCls(finalPnl),
  };
}

// ── PnL distribution (renderDistribution) — returns container innerHTML ──────
export function buildDistributionHtml(closing: Array<{ closedPnl?: string }>): string {
  const buckets = [
    { label: '> +$500', min: 500, max: Infinity, color: '#1fa67d' },
    { label: '+$100–500', min: 100, max: 500, color: '#2bc08a' },
    { label: '+$25–100', min: 25, max: 100, color: '#4dd4a0' },
    { label: '+$0–25', min: 0, max: 25, color: '#7de3c0' },
    { label: '-$0–25', min: -25, max: 0, color: '#f4a0b0' },
    { label: '-$25–100', min: -100, max: -25, color: '#ed7088' },
    { label: '-$100–500', min: -500, max: -100, color: '#d94f6a' },
    { label: '< -$500', min: -Infinity, max: -500, color: '#c03050' },
  ];
  const counts = buckets.map(b => closing.filter(f => { const p = parseFloat(f.closedPnl ?? '0'); return p >= b.min && p < b.max; }).length);
  const maxCount = Math.max(...counts, 1);
  if (!closing.length) return '<div style="color:var(--text3);font-size:11px;text-align:center;padding:40px 0">No data</div>';
  return buckets.map((b, i) => {
    const pct = closing.length ? ((counts[i] / closing.length) * 100).toFixed(1) : '0';
    const w = ((counts[i] / maxCount) * 100).toFixed(1);
    return `<div class="dist-row"><div class="dist-meta"><span class="dist-label">${b.label}</span><span class="dist-count">${counts[i]} · ${pct}%</span></div><div class="dist-track"><div class="dist-bar" style="width:${w}%;background:${b.color}"></div></div></div>`;
  }).join('');
}

// ── Calendar grid (renderCalendar) — returns grid innerHTML + summary ────────
export interface CalendarResult {
  gridHtml: string;
  monthLabel: string;
  monthTotal: string;
  monthTotalCls: string;
  barPct: string;
  barColor: string;
  winLabel: string;
  lossLabel: string;
  streakLabel: string;
  bestStreakHtml: string;
}

export function buildCalendar(dailyPnl: Record<string, number>, calYear: number, calMonth: number): CalendarResult {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const today = new Date();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  let firstDay = new Date(calYear, calMonth, 1).getDay();
  firstDay = (firstDay + 6) % 7;

  let html = DAYS.map(d => `<div class="cal-day-hdr">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-day empty-bg"></div>`;

  let winDays = 0, lossDays = 0, totalMonthPnl = 0;
  let bestStreak = 0, runStreak = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const pnl = dailyPnl[key];
    const isToday = today.getDate() === d && today.getMonth() === calMonth && today.getFullYear() === calYear;
    let cls = 'cal-day';
    let pnlHtml = '';
    if (pnl !== undefined) {
      totalMonthPnl += pnl;
      if (pnl > 0) { cls += ' pos'; winDays++; runStreak++; bestStreak = Math.max(bestStreak, runStreak); }
      else if (pnl < 0) { cls += ' neg'; lossDays++; runStreak = 0; }
      else { cls += ' zero'; runStreak = 0; }
      const sign = pnl > 0 ? '+' : '';
      pnlHtml = `<span class="cal-day-pnl">${sign}${Math.abs(pnl) >= 1000 ? fmtK(pnl).replace('$', '') + '' : ('$' + fmt(Math.abs(pnl), 0))}</span>`;
    } else { cls += ' empty-bg'; }
    if (isToday) cls += ' today';
    html += `<div class="${cls}"><span class="cal-day-num">${d}</span>${pnlHtml}</div>`;
  }

  const tradingDays = winDays + lossDays;
  const barPct = tradingDays ? ((winDays / tradingDays) * 100).toFixed(1) : '0';

  let cStreak = 0;
  for (let d = today.getDate(); d >= 1; d--) {
    const key = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (dailyPnl[key] > 0) cStreak++;
    else break;
  }

  return {
    gridHtml: html,
    monthLabel: months[calMonth] + ' ' + calYear,
    monthTotal: (totalMonthPnl >= 0 ? '+' : '') + '$' + fmt(totalMonthPnl),
    monthTotalCls: 'cal-total ' + pCls(totalMonthPnl),
    barPct,
    barColor: winDays > lossDays ? 'var(--green)' : 'var(--red)',
    winLabel: winDays + ' day' + (winDays !== 1 ? 's' : '') + ' profitable',
    lossLabel: lossDays + ' day' + (lossDays !== 1 ? 's' : '') + ' losing',
    streakLabel: cStreak > 0 ? cStreak + ' day' + (cStreak !== 1 ? 's' : '') : '—',
    bestStreakHtml: 'Best Streak: <strong>' + (bestStreak > 0 ? bestStreak + ' day' + (bestStreak !== 1 ? 's' : '') : '—') + '</strong>',
  };
}

// ── Share-card sparkline path (buildSparkPath) ────────────────────────────────
export function buildSparkPath(vals: number[], W: number, H: number): string {
  if (vals.length < 2) return '';
  const min = Math.min(...vals), max = Math.max(...vals);
  const rng = max - min || 1;
  const px = (i: number) => (i / (vals.length - 1)) * W;
  const py = (v: number) => H - (((v - min) / rng) * (H * 0.8) + H * 0.1);
  return vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
}

// ── downloadCard() — canvas PNG export, ported verbatim ──────────────────────
export interface ShareData {
  totalPnl: number;
  winRate: string;
  wins: number;
  losses: number;
  bestVal: number;
  cumPts: CumPoint[];
  address: string;
}

export function downloadCard(shareData: ShareData) {
  const { totalPnl, winRate, wins, losses, bestVal, cumPts, address } = shareData;
  const W = 480, H = 280, DPR = 2;
  const C = document.createElement('canvas');
  C.width = W * DPR; C.height = H * DPR;
  const ctx = C.getContext('2d')!;
  ctx.scale(DPR, DPR);

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#162025'); bg.addColorStop(1, '#0f1a1e');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, 12); ctx.fill();

  const glow = ctx.createRadialGradient(W - 50, -20, 0, W - 50, -20, 150);
  glow.addColorStop(0, 'rgba(80,210,193,0.10)'); glow.addColorStop(1, 'rgba(80,210,193,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, 12); ctx.fill();

  ctx.strokeStyle = 'rgba(80,210,193,0.22)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(0.5, 0.5, W - 1, H - 1, 12); ctx.stroke();

  ctx.beginPath(); ctx.arc(22, 26, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#50d2c1'; ctx.fill();
  ctx.font = 'bold 12px system-ui,-apple-system,sans-serif';
  const rdoW = ctx.measureText('RDO').width;
  ctx.fillStyle = '#f5f1ea'; ctx.fillText('RDO', 32, 31);
  ctx.fillStyle = '#50d2c1'; ctx.fillText('ONE', 32 + rdoW, 31);

  ctx.font = '10px monospace'; ctx.fillStyle = '#555e63';
  ctx.fillText(address.slice(0, 10) + '…' + address.slice(-6), 20, 50);

  const pnlColor = totalPnl >= 0 ? '#1fa67d' : '#ed7088';
  const pnlStr = (totalPnl >= 0 ? '+' : '') + '$' + fmt(totalPnl);
  ctx.font = 'bold 36px system-ui,-apple-system,sans-serif';
  ctx.fillStyle = pnlColor; ctx.fillText(pnlStr, 20, 108);

  ctx.font = '9px system-ui,-apple-system,sans-serif'; ctx.fillStyle = '#5a666b';
  ctx.fillText('ALL-TIME REALIZED PNL', 20, 126);

  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(20, 134); ctx.lineTo(W - 20, 134); ctx.stroke();

  if (cumPts.length > 1) {
    const vals = cumPts.map(p => p.v);
    const minV = Math.min(...vals), maxV = Math.max(...vals), rng = maxV - minV || 1;
    const SX = 20, SY = 142, SW = W - 40, SH = 48;
    const px = (i: number) => SX + (i / (cumPts.length - 1)) * SW;
    const py = (v: number) => SY + SH - ((v - minV) / rng) * SH;
    const aFill = ctx.createLinearGradient(0, SY, 0, SY + SH);
    const ac0 = totalPnl >= 0 ? 'rgba(31,166,125,0.22)' : 'rgba(237,112,136,0.22)';
    const ac1 = totalPnl >= 0 ? 'rgba(31,166,125,0)' : 'rgba(237,112,136,0)';
    aFill.addColorStop(0, ac0); aFill.addColorStop(1, ac1);
    ctx.beginPath(); ctx.moveTo(px(0), SY + SH);
    cumPts.forEach((p, i) => ctx.lineTo(px(i), py(p.v)));
    ctx.lineTo(px(cumPts.length - 1), SY + SH); ctx.closePath();
    ctx.fillStyle = aFill; ctx.fill();
    ctx.beginPath(); ctx.moveTo(px(0), py(cumPts[0].v));
    cumPts.forEach((p, i) => { if (i > 0) ctx.lineTo(px(i), py(p.v)); });
    ctx.strokeStyle = pnlColor; ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.arc(px(cumPts.length - 1), py(vals[vals.length - 1]), 3, 0, Math.PI * 2);
    ctx.fillStyle = pnlColor; ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(20, 206); ctx.lineTo(W - 20, 206); ctx.stroke();
  const stats: Array<[string, string]> = [['WIN RATE', winRate], ['TRADES', String(wins + losses)], ['BEST TRADE', '+$' + fmt(bestVal)]];
  stats.forEach((s, i) => {
    const cx = 20 + (i * (W - 40)) / 3 + (W - 40) / 6;
    ctx.textAlign = 'center';
    ctx.font = '8px system-ui,-apple-system,sans-serif'; ctx.fillStyle = '#5a666b';
    ctx.fillText(s[0], cx, 220);
    ctx.font = 'bold 14px system-ui,-apple-system,sans-serif'; ctx.fillStyle = '#e8eaed';
    ctx.fillText(s[1], cx, 238);
  });
  ctx.textAlign = 'left';

  ctx.font = '9px system-ui,-apple-system,sans-serif'; ctx.fillStyle = '#2a3a40';
  ctx.fillText('rdoone.com', 20, H - 10);
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }), W - 20, H - 10);
  ctx.textAlign = 'left';

  const link = document.createElement('a');
  link.download = `rdo-pnl-${address.slice(0, 6)}.png`;
  link.href = C.toDataURL('image/png');
  link.click();
}
