import { cachedFetchJson } from '@/utils/requestCache';

const API_URL = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000') + '/api';

// Default API client (axios-like)
const api = {
  get: async (url, config = {}) => {
    const data = await cachedFetchJson(`${API_URL.replace('/api', '')}${url}`, {
      ttlMs: config.ttlMs ?? 60 * 1000,
      forceRefresh: Boolean(config.forceRefresh),
      fetchOptions: {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...config.headers,
        },
      },
    });

    return { data };
  },

  post: async (url, data, config = {}) => {
    const isFormData = data instanceof FormData;
    const response = await fetch(`${API_URL.replace('/api', '')}${url}`, {
      method: 'POST',
      headers: isFormData ? config.headers || {} : {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: isFormData ? data : JSON.stringify(data),
      ...config
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));
      throw new Error(error.detail || 'Request failed');
    }

    return { data: await response.json() };
  },
};

export default api;

export const authAPI = {
  register: async (userData) => {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(userData),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Registration failed');
    }

    return response.json();
  },

  login: async (credentials) => {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Login failed');
    }

    return response.json();
  },

  getCurrentUser: async (token) => {
    const response = await fetch(`${API_URL}/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get user');
    }

    return response.json();
  },
};
