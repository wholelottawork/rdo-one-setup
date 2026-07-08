import { getEVMAddress } from './wallet.js'

export function openOnramp() {
  const address = getEVMAddress()
  const modal  = document.getElementById('onrampModal')
  const addrEl = document.getElementById('onrampAddress')

  if (addrEl) addrEl.textContent = address || 'Connect wallet first'

  // Copy button
  const copyBtn = document.getElementById('onrampCopyBtn')
  if (copyBtn) {
    copyBtn.onclick = () => {
      if (!address) return
      navigator.clipboard.writeText(address)
      copyBtn.textContent = 'Copied!'
      setTimeout(() => { copyBtn.textContent = 'Copy' }, 2000)
    }
  }

  // Provider buttons
  document.getElementById('onrampUtorgBtn')?.addEventListener('click', () => openProvider('utorg', address), { once: true })
  document.getElementById('onrampMercuryoBtn')?.addEventListener('click', () => openProvider('mercuryo', address), { once: true })

  modal?.classList.remove('hidden')
}

function openProvider(provider, address) {
  let url
  if (provider === 'utorg') {
    const p = new URLSearchParams({ coin: 'USDT', fiat: 'RUB' })
    if (address) p.set('toAddress', address)
    url = `https://app.utorg.pro/?${p}`
  } else {
    const p = new URLSearchParams({ currency: 'USDT', fiat_currency: 'RUB', type: 'buy' })
    if (address) p.set('address', address)
    url = `https://exchange.mercuryo.io/?${p}`
  }
  window.open(url, 'rdo-onramp', 'width=420,height=700,left=200,top=80')
}

export function closeOnramp(event) {
  if (event && event.target !== document.getElementById('onrampModal')) return
  _closeOnramp()
}

export function closeOnrampForce() {
  _closeOnramp()
}

function _closeOnramp() {
  document.getElementById('onrampModal')?.classList.add('hidden')
}
