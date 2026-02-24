// Auth utility functions

export interface User {
  id: string;
  email: string;
  name: string;
}

/**
 * Get stored token from localStorage
 */
export function getToken(): string | null {
  return localStorage.getItem('token');
}

/**
 * Get stored user from localStorage
 */
export function getStoredUser(): User | null {
  const userStr = localStorage.getItem('user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

/**
 * Check if user is authenticated (has token and user in storage)
 */
export function isAuthenticated(): boolean {
  return !!getToken() && !!getStoredUser();
}

/**
 * Store auth data
 */
export function setAuth(user: User, token: string): void {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

/**
 * Clear auth data
 */
export function clearAuth(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}
