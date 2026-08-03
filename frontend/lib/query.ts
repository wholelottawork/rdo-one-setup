import { QueryClient } from '@tanstack/react-query';

/**
 * One shared React Query cache for the whole app. Because most of this app's
 * data layer is imperative (fetch inside effects / websockets, not hooks), we
 * expose the SAME client instance both to <Providers> (for any useQuery hooks)
 * and to plain async code via getQueryClient()/cachedFetch() — so repeated and
 * cross-page reads (HL meta, CoinGecko, account state, …) dedupe and serve from
 * cache within their staleTime instead of re-hitting the network every call.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000, // serve cached for 30s before a fetch revalidates
        gcTime: 5 * 60_000, // drop unused cache after 5 min
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

let browserClient: QueryClient | undefined;

// Server: a fresh client per call (no shared state across requests).
// Browser: a single long-lived instance shared by hooks and imperative code.
export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient();
  if (!browserClient) browserClient = makeQueryClient();
  return browserClient;
}

/**
 * Cache any async read through the shared client — dedupes in-flight requests
 * and serves cached data within `staleTime`. Use for GET/POST JSON reads that
 * are safe to reuse briefly (market meta, prices, account snapshots, …).
 */
export function cachedFetch<T>(
  key: unknown[],
  fetcher: () => Promise<T>,
  staleTime = 30_000,
): Promise<T> {
  return getQueryClient().fetchQuery({ queryKey: key, queryFn: fetcher, staleTime });
}

/**
 * JSON fetch with a deadline and one retry.
 *
 * A bare fetch() has no timeout, so a hung upstream proxy left the market
 * panels sitting on "Loading…" forever with nothing to click. This throws on
 * timeout, transport error or non-2xx — always, so callers can render a retry
 * state instead of a spinner that never resolves.
 */
export async function fetchJson<T = any>(
  url: string,
  { timeout = 8_000, retries = 1, ...init }: RequestInit & { timeout?: number; retries?: number } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return (await res.json()) as T;
    } catch (e) {
      if (attempt >= retries) throw e;
    }
  }
}
