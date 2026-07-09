import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5176,
    host: '0.0.0.0',
    proxy: {
      // ── /api/* routes — match production backend paths ───────────────────────
      '/api/hl': {
        target: 'https://api.hyperliquid.xyz',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/hl/, ''),
      },
      '/api/hl-testnet': {
        target: 'https://api.hyperliquid-testnet.xyz',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/hl-testnet/, ''),
      },
      '/api/binance': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/binance/, ''),
      },
      '/api/coingecko': {
        target: 'https://api.coingecko.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/coingecko/, ''),
      },
      '/api/feargreed': {
        target: 'https://api.alternative.me',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/feargreed/, ''),
      },
      // ── Legacy paths (keep for backwards compat during migration) ────────────
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
      '/cdnews': {
        target: 'https://www.coindesk.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/cdnews/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)' },
      },
      '/decnews': {
        target: 'https://decrypt.co',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/decnews/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)' },
      },
      '/blknews': {
        target: 'https://www.theblock.co',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/blknews/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)' },
      },
      '/bwknews': {
        target: 'https://blockworks.co',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/bwknews/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)' },
      },
      '/btcmnews': {
        target: 'https://bitcoinmagazine.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/btcmnews/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)' },
      },
      '/beinnews': {
        target: 'https://beincrypto.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/beinnews/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)' },
      },
      '/btcinews': {
        target: 'https://bitcoinist.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/btcinews/, ''),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)' },
      },
      '/hl': {
        target: 'https://api.hyperliquid.xyz',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/hl/, ''),
      },
      '/aster-fapi': {
        target: 'https://fapi.asterdex.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/aster-fapi/, ''),
        headers: {
          'Referer': 'https://www.asterdex.com/',
          'Origin': 'https://www.asterdex.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        },
      },
      '/lifi-api': {
        target: 'https://li.quest',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/lifi-api/, ''),
      },
      '/aster-stream': {
        target: 'https://fstream.asterdex.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/aster-stream/, ''),
        ws: true,
        headers: {
          'Referer': 'https://www.asterdex.com/',
          'Origin': 'https://www.asterdex.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        lifi: resolve(__dirname, 'lifi.html'),
      },
    },
  },
});
