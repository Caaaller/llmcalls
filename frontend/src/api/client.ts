// API client utilities for react-query
import { getToken } from '../utils/auth';

// Get API URL from environment variable, default to localhost for development
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

/**
 * Get authorization headers
 */
export function getAuthHeaders(): HeadersInit {
  const token = getToken();
  return token ? {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  } : {
    'Content-Type': 'application/json',
  };
}

/**
 * Generic fetch wrapper with error handling
 */
export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options.headers,
    },
    mode: 'cors',
  });

  if (!response.ok) {
    let errorMessage = `HTTP error! status: ${response.status}`;
    try {
      const error = await response.json();
      errorMessage = error.error || error.message || errorMessage;
    } catch {
      // If response is not JSON, use status text
      errorMessage = response.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * API endpoints
 */
export const api = {
  // Auth endpoints
  auth: {
    me: () => apiFetch<{ user: { id: string; email: string; name: string } }>('/api/auth/me'),
    logout: () => apiFetch<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
    login: (email: string, password: string) => 
      apiFetch<{ success: boolean; token: string; user: { id: string; email: string; name: string } }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    signup: (email: string, password: string, name: string) =>
      apiFetch<{ success: boolean; token: string; user: { id: string; email: string; name: string } }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      }),
  },

  // Config endpoints
  config: {
    get: () => apiFetch<{ config: any }>('/api/config'),
    update: (settings: any) =>
      apiFetch<{ success: boolean }>('/api/settings', {
        method: 'POST',
        body: JSON.stringify(settings),
      }),
  },

  // Prompt endpoints
  prompt: {
    get: () => apiFetch<{ prompt: string }>('/api/prompt'),
  },

  // Call endpoints
  calls: {
    history: (limit: number = 50) =>
      apiFetch<{ calls: any[]; mongoConnected?: boolean }>(`/api/calls/history?limit=${limit}`),
    get: (callSid: string) =>
      apiFetch<any>(`/api/calls/${callSid}`),
    initiate: (data: {
      to: string;
      transferNumber: string;
      callPurpose: string;
      customInstructions: string;
    }) =>
      apiFetch<{ call: { sid: string; status: string; to: string } }>('/api/calls/initiate', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
};

