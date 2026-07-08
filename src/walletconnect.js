import { EthereumProvider } from '@walletconnect/ethereum-provider'

const PROJECT_ID = 'e9383f655173189d57a3ea4d76bb0b63'
let _provider = null

export async function connectViaWC() {
  _provider = await EthereumProvider.init({
    projectId: PROJECT_ID,
    chains: [42161],                          // Arbitrum — HL deposit chain
    optionalChains: [1, 56, 137, 10, 43114],  // ETH, BSC, Polygon, Optimism, Avalanche
    showQrModal: true,
    qrModalOptions: {
      themeMode: 'dark',
      themeVariables: {
        '--wcm-background-color':  '#0f1a1e',
        '--wcm-accent-color':      '#50d2c1',
        '--wcm-font-family':       'Inter, system-ui, sans-serif',
      },
    },
    metadata: {
      name:        'RDO ONE',
      description: 'Perpetuals Terminal — BASIC (Hyperliquid) & EXTRA (Aster)',
      url:         location.origin,
      icons:       [],
    },
  })

  _provider.on('disconnect', () => {
    _provider = null
    // notify wallet.js via custom event
    window.dispatchEvent(new CustomEvent('wc:disconnect'))
  })

  await _provider.connect()
  const [address] = await _provider.request({ method: 'eth_accounts' })
  return { provider: _provider, address }
}

export const getWCProvider = () => _provider

export async function disconnectWC() {
  if (_provider) {
    try { await _provider.disconnect() } catch {}
    _provider = null
  }
}
