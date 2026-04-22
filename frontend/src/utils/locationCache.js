const TIMED_CACHE_PREFIX = 'suraksha_timed_cache:';

export const saveTimedCache = (key, value, ttlMs = 10 * 60 * 1000) => {
  if (!key) return;
  try {
    const payload = {
      value,
      expiresAt: Date.now() + Math.max(1, Number(ttlMs) || 0),
    };
    localStorage.setItem(`${TIMED_CACHE_PREFIX}${key}`, JSON.stringify(payload));
  } catch {
    // Ignore storage/quota errors.
  }
};

export const readTimedCache = (key) => {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(`${TIMED_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() > Number(parsed.expiresAt || 0)) {
      localStorage.removeItem(`${TIMED_CACHE_PREFIX}${key}`);
      return null;
    }
    return parsed.value ?? null;
  } catch {
    return null;
  }
};

export const clearTimedCache = (key) => {
  if (!key) return;
  try {
    localStorage.removeItem(`${TIMED_CACHE_PREFIX}${key}`);
  } catch {
    // Ignore storage errors.
  }
};

const LOCATION_CACHE_KEY = 'current_location';
const LOCATION_CACHE_TTL_MS = 15 * 60 * 1000;

export const saveLocationCache = (location) => {
  saveTimedCache(LOCATION_CACHE_KEY, location, LOCATION_CACHE_TTL_MS);
};

export const readLocationCache = () => readTimedCache(LOCATION_CACHE_KEY);

export const clearLocationCache = () => clearTimedCache(LOCATION_CACHE_KEY);
