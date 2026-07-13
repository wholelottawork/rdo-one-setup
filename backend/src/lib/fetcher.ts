/** RequestInit plus an optional per-call abort timeout (ms, default 8000). */
export interface FetchOptions extends RequestInit {
  timeout?: number;
}

export async function fetchJSON<T = unknown>(
  url: string,
  options: FetchOptions = {},
  retries = 2,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 8000);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)',
        ...options.headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return (await res.json()) as T;
  } catch (err) {
    if (retries > 0 && (err as Error).name !== 'AbortError') {
      await new Promise((r) => setTimeout(r, 500));
      return fetchJSON<T>(url, options, retries - 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(
  url: string,
  options: FetchOptions = {},
  retries = 2,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 8000);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)',
        ...options.headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.text();
  } catch (err) {
    if (retries > 0 && (err as Error).name !== 'AbortError') {
      await new Promise((r) => setTimeout(r, 500));
      return fetchText(url, options, retries - 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
