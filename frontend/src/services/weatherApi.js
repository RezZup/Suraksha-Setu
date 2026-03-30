import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

const responseCache = new Map();
const inFlight = new Map();

const buildQueryString = (params = {}) => {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  return new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
};

const cachedApiGet = async (url, { params = {}, ttlMs = 60 * 1000, forceRefresh = false } = {}) => {
  const query = buildQueryString(params);
  const cacheKey = query ? `${url}?${query}` : url;
  const now = Date.now();

  if (!forceRefresh) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const pending = inFlight.get(cacheKey);
    if (pending) {
      return pending;
    }
  }

  const request = api.get(url, { params }).then((response) => {
    const data = response.data;
    if (ttlMs > 0) {
      responseCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + ttlMs,
      });
    }
    return data;
  }).finally(() => {
    inFlight.delete(cacheKey);
  });

  inFlight.set(cacheKey, request);
  return request;
};

// Weather APIs
export const getWeatherByLocation = async (location) => {
  try {
    const params = {};
    if (typeof location === 'string') {
      params.q = location;
    } else if (location.lat && location.lon) {
      params.lat = location.lat;
      params.lon = location.lon;
    }
    return await cachedApiGet('/api/weather/location', { params, ttlMs: 2 * 60 * 1000 });
  } catch (error) {
    console.error('Error fetching weather:', error);
    throw error;
  }
};

export const getRainfallTrends = async (lat, lon, days = 7) => {
  try {
    return await cachedApiGet('/api/weather/rainfall-trends', {
      params: { lat, lon, days },
      ttlMs: 10 * 60 * 1000,
    });
  } catch (error) {
    console.error('Error fetching rainfall trends:', error);
    throw error;
  }
};

// AQI APIs
export const getAQIByLocation = async (location) => {
  try {
    const params = {};
    if (typeof location === 'string') {
      params.q = location;
    } else if (location.lat && location.lon) {
      params.lat = location.lat;
      params.lon = location.lon;
    }
    return await cachedApiGet('/api/aqi/location', { params, ttlMs: 2 * 60 * 1000 });
  } catch (error) {
    console.error('Error fetching AQI:', error);
    throw error;
  }
};

export const getRealtimeAQIStations = async (lat, lon, radius = 100000) => {
  try {
    return await cachedApiGet('/api/aqi/realtime-stations', {
      params: { lat, lon, radius },
      ttlMs: 90 * 1000,
    });
  } catch (error) {
    console.error('Error fetching AQI stations:', error);
    throw error;
  }
};

// Cyclone APIs
export const getCycloneData = async () => {
  try {
    return await cachedApiGet('/api/cyclone', { ttlMs: 60 * 1000 });
  } catch (error) {
    console.error('Error fetching cyclone data:', error);
    throw error;
  }
};

export const getCycloneTrack = async () => {
  try {
    return await cachedApiGet('/api/cyclone/track', { ttlMs: 60 * 1000 });
  } catch (error) {
    console.error('Error fetching cyclone track:', error);
    throw error;
  }
};

export default api;
