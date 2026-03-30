const memoryCache = new Map();
const inFlightRequests = new Map();

const buildCacheKey = (url, options = {}, customKey) => {
  if (customKey) return customKey;
  const method = (options.method || 'GET').toUpperCase();
  const headers = options.headers ? JSON.stringify(options.headers) : '';
  return `${method}:${url}:${headers}`;
};

export const cachedFetchJson = async (
  url,
  {
    ttlMs = 60 * 1000,
    forceRefresh = false,
    cacheKey,
    fetchOptions = {},
  } = {}
) => {
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const key = buildCacheKey(url, fetchOptions, cacheKey);
  const now = Date.now();

  if (!forceRefresh && method === 'GET') {
    const cached = memoryCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const pending = inFlightRequests.get(key);
    if (pending) {
      return pending;
    }
  }

  const requestPromise = fetch(url, fetchOptions).then(async (response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));
      throw new Error(error.detail || `Request failed (${response.status})`);
    }

    const data = await response.json();

    if (method === 'GET' && ttlMs > 0) {
      memoryCache.set(key, {
        data,
        expiresAt: Date.now() + ttlMs,
      });
    }

    return data;
  }).finally(() => {
    inFlightRequests.delete(key);
  });

  if (method === 'GET') {
    inFlightRequests.set(key, requestPromise);
  }

  return requestPromise;
};

export const clearRequestCache = (predicate) => {
  if (!predicate) {
    memoryCache.clear();
    inFlightRequests.clear();
    return;
  }

  for (const key of memoryCache.keys()) {
    if (predicate(key)) {
      memoryCache.delete(key);
    }
  }

  for (const key of inFlightRequests.keys()) {
    if (predicate(key)) {
      inFlightRequests.delete(key);
    }
  }
};
