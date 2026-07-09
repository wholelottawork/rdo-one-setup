import { showToast } from './toast';

let evmAddress: string | null = null;
let connType: string | null   = null;
let _resolveConnect: ((addr: string | null) => void) | null = null;

export const getEVMAddress = () => evmAddress;

export function getEVMProvider() {
  const w = window as any;
  if (connType === 'extension') return w.phantom?.ethereum ?? w.ethereum ?? null;
  return w.phantom?.ethereum ?? w.ethereum ?? null;
}

export function connectWallet(): Promise<string | null> {
  return new Promise(resolve => {
    _resolveConnect = resolve;
    document.getElementById('walletModal')?.classList.remove('hidden');
  });
}

export function closeWalletModal(event?: Event) {
  if (event && event.target !== document.getElementById('walletModal')) return;
  _hideModal(); _settle(null);
}

export function closeWalletModalForce() { _hideModal(); _settle(null); }

export async function connectExtension() {
  _hideModal();
  const btn = document.getElementById('walletBtn');
  const w   = window as any;
  const evmProvider = w.phantom?.ethereum ?? w.ethereum;
  if (!evmProvider) {
    showToast('No wallet found — install Phantom or MetaMask', 'err');
    _settle(null); return null;
  }
  try {
    if (btn) btn.textContent = 'Connecting...';
    const [addr] = await evmProvider.request({ method: 'eth_requestAccounts' });
    evmAddress = addr; connType = 'extension';
    _onConnected(addr); _settle(addr); return addr;
  } catch {
    if (btn) btn.textContent = 'Connect';
    showToast('Connection rejected', 'err'); _settle(null); return null;
  }
}

export async function connectAntarctic() {
  _hideModal();
  const btn = document.getElementById('walletBtn');
  showToast('WalletConnect QR — coming soon', 'err');
  if (btn) btn.textContent = 'Connect';
  _settle(null); return null;
}

export function disconnectWallet() {
  evmAddress = null; connType = null;
  const btn = document.getElementById('walletBtn');
  if (btn) { btn.textContent = 'Connect'; btn.classList.remove('connected'); }
  document.getElementById('depositBtn')?.classList.add('hidden');
  document.getElementById('rubBtn')?.classList.add('hidden');
  document.getElementById('balanceDisplay')?.classList.add('hidden');
}

function _onConnected(address: string) {
  const btn = document.getElementById('walletBtn');
  if (btn) { btn.textContent = address.slice(0, 6) + '...' + address.slice(-4); btn.classList.add('connected'); }
  document.getElementById('depositBtn')?.classList.remove('hidden');
  document.getElementById('rubBtn')?.classList.remove('hidden');
  document.getElementById('balanceDisplay')?.classList.remove('hidden');
}

function _hideModal() { document.getElementById('walletModal')?.classList.add('hidden'); }

function _settle(addr: string | null) {
  if (_resolveConnect) { _resolveConnect(addr); _resolveConnect = null; }
}
