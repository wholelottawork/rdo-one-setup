export function showToast(msg: string, type: 'ok' | 'err' | '' = ''): void {
  if (typeof document === 'undefined') return;
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'tOut 0.2s ease forwards';
    setTimeout(() => el.remove(), 220);
  }, 3000);
}
