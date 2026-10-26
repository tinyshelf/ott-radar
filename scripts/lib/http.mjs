const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export async function fetchText(url, { timeoutMs = 20000, headers = {}, method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    body,
    headers: { 'user-agent': UA, 'accept-language': 'en-IN,en;q=0.9', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return { text: await res.text(), url: res.url };
}

// Runs fn over items with at most `limit` in flight; failures become null.
export async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        console.warn(`  ! ${err.message}`);
        out[i] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
