import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5176,
    host: '0.0.0.0',
    proxy: {
      '/coingecko': {
        target: 'https://api.coingecko.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/coingecko/, ''),
      },
      '/binance': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/binance/, ''),
      },
      '/feargreed': {
        target: 'https://api.alternative.me',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/feargreed/, ''),
      },
      '/ctnews': {
        target: 'https://cointelegraph.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/ctnews/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)' },
      },
      '/hl': {
        target: 'https://api.hyperliquid.xyz',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/hl/, ''),
      },
    },
  },
  build: { outDir: 'dist' },
});
