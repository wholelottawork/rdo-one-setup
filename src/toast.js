export function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  document.getElementById('toastWrap').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'tOut 0.25s ease forwards';
    setTimeout(() => el.remove(), 250);
  }, 3200);
}
