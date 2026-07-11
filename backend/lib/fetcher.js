export async function fetchJSON(url, options = {}, retries = 2) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 8000);

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
    return await res.json();
  } catch (err) {
    if (retries > 0 && err.name !== 'AbortError') {
      await new Promise(r => setTimeout(r, 500));
      return fetchJSON(url, options, retries - 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url, options = {}, retries = 2) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 8000);

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
    if (retries > 0 && err.name !== 'AbortError') {
      await new Promise(r => setTimeout(r, 500));
      return fetchText(url, options, retries - 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
