export function openDepositModal() {
  document.getElementById('depositModal').classList.remove('hidden');
}

export function closeDepositModal(event) {
  if (event && event.target !== document.getElementById('depositModal')) return;
  document.getElementById('depositModal').classList.add('hidden');
}
