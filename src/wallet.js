import { showToast } from './toast.js';

let evmAddress = null;

export function getEVMAddress()  { return evmAddress; }
export function getEVMProvider() { return window.phantom?.ethereum ?? window.ethereum ?? null; }
export function getSolanaProvider() { return window.phantom?.solana ?? null; }

export async function connectWallet() {
  const btn = document.getElementById('walletBtn');

  const evmProvider = window.phantom?.ethereum ?? window.ethereum;
  if (!evmProvider) {
    showToast('No wallet found — install Phantom at phantom.app', 'err');
    return null;
  }

  try {
    btn.textContent = 'Connecting...';
    const accounts  = await evmProvider.request({ method: 'eth_requestAccounts' });
    evmAddress = accounts[0];
    onConnected(evmAddress);
    return evmAddress;
  } catch {
    btn.textContent = 'Connect';
    showToast('Connection rejected', 'err');
    return null;
  }
}

function onConnected(address) {
  const btn = document.getElementById('walletBtn');
  btn.textContent = address.slice(0, 6) + '...' + address.slice(-4);
  btn.classList.add('connected');
  document.getElementById('depositBtn')?.classList.remove('hidden');
  document.getElementById('balanceDisplay')?.classList.remove('hidden');
}

export function disconnectWallet() {
  evmAddress = null;
  const btn = document.getElementById('walletBtn');
  btn.textContent = 'Connect';
  btn.classList.remove('connected');
  document.getElementById('depositBtn')?.classList.add('hidden');
  document.getElementById('balanceDisplay')?.classList.add('hidden');
}
