/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Hyperliquid
      { source: '/api/hl/:path*', destination: 'https://api.hyperliquid.xyz/:path*' },
      { source: '/hl/:path*',     destination: 'https://api.hyperliquid.xyz/:path*' },
      // Binance REST
      { source: '/api/binance/:path*', destination: 'https://api.binance.com/:path*' },
      { source: '/binance/:path*',     destination: 'https://api.binance.com/:path*' },
      { source: '/fapi/:path*',        destination: 'https://fapi.binance.com/:path*' },
      // CoinGecko
      { source: '/api/coingecko/:path*', destination: 'https://api.coingecko.com/:path*' },
      { source: '/coingecko/:path*',     destination: 'https://api.coingecko.com/:path*' },
      // Fear & Greed
      { source: '/api/feargreed/:path*', destination: 'https://api.alternative.me/:path*' },
      { source: '/feargreed/:path*',     destination: 'https://api.alternative.me/:path*' },
      // Aster DEX
      { source: '/aster-fapi/:path*', destination: 'https://fapi.asterdex.com/:path*' },
      // LI.FI
      { source: '/lifi-api/:path*', destination: 'https://li.quest/:path*' },
      // News proxies
      { source: '/ctnews/:path*',  destination: 'https://cointelegraph.com/:path*' },
      { source: '/cdnews/:path*',  destination: 'https://www.coindesk.com/:path*' },
      { source: '/decnews/:path*', destination: 'https://decrypt.co/:path*' },
      { source: '/blknews/:path*', destination: 'https://www.theblock.co/:path*' },
      { source: '/bwknews/:path*', destination: 'https://blockworks.co/:path*' },
      { source: '/btcmnews/:path*', destination: 'https://bitcoinmagazine.com/:path*' },
      { source: '/beinnews/:path*', destination: 'https://beincrypto.com/:path*' },
      { source: '/btcinews/:path*', destination: 'https://bitcoinist.com/:path*' },
    ];
  },
  webpack(config) {
    config.resolve.fallback = { ...config.resolve.fallback, global: false };
    return config;
  },
};

module.exports = nextConfig;
