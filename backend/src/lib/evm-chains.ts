/**
 * The one list of EVM JSON-RPC endpoints this backend will talk to.
 *
 * Shared by routes/rpc.ts (the read-only relay) and routes/evm-balances.ts
 * (the portfolio sweep) so the allowlist cannot drift between them — the two
 * had already diverged from being copy-pasted, and a chain silently missing
 * from one of them reads as "you hold nothing here".
 *
 * Keyless endpoints, all verified to accept batched requests, which the
 * balance sweep depends on. Two entries here are replacements for endpoints
 * that died: eth.llamarpc.com stopped resolving, and polygon-rpc.com now
 * answers 401 "API key disabled". Both failed silently in the old code.
 */
export const RPC_URLS: Record<string, string> = {
  '1': 'https://ethereum-rpc.publicnode.com',
  '10': 'https://mainnet.optimism.io',
  '56': 'https://bsc-dataseed.binance.org',
  '137': 'https://polygon-bor-rpc.publicnode.com',
  '8453': 'https://mainnet.base.org',
  '42161': 'https://arb1.arbitrum.io/rpc',
  '43114': 'https://api.avax.network/ext/bc/C/rpc',
};
