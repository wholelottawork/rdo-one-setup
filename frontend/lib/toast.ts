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
  if (type) mirrorToSystem(msg, type);
}

// Toasts are this app's only notification channel — fill results, transfer
// progress, failures — and a toast fired into a background tab is a toast the
// user never sees. Mirror the outcomes (ok/err) to a system notification;
// untyped toasts are in-flight chatter and stay in-page.
let askedPermission = false;

function mirrorToSystem(msg: string, type: 'ok' | 'err'): void {
  if (typeof Notification === 'undefined') return;

  if (Notification.permission === 'granted') {
    if (!document.hidden) return; // they're looking at the toast already
    try {
      // One tag per kind, so a burst of results replaces rather than stacks.
      new Notification(type === 'err' ? 'RDO ONE — failed' : 'RDO ONE', {
        body: msg,
        tag: 'rdo-' + type,
      });
    } catch {}
    return;
  }

  // Ask once, and only off a real outcome while the tab is in front — a
  // request raised from a background tab is answered blind or dropped.
  // ponytail: no in-app opt-in UI, just the browser prompt. Add a settings
  // toggle if users need to re-enable after denying at the browser level.
  if (Notification.permission === 'default' && !document.hidden && !askedPermission) {
    askedPermission = true;
    Notification.requestPermission().catch(() => {});
  }
}
