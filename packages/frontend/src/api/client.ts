// API client utilities for react-query
import { getToken } from '../utils/auth';

// Get API URL from environment variable, default to relative URL in production or localhost for development
const API_URL =
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');

/**
 * Shared API types
 */
export interface ApiUser {
  id: string;
  email: string;
  name: string;
}

export interface ApiAISettings {
  model: string;
  maxTokens: number;
  temperature: number;
  voice?: string;
  language?: string;
}

export interface ApiConfig {
  transferNumber: string;
  userPhone: string;
  userEmail: string;
  aiSettings: ApiAISettings;
}

export interface ApiConfigResponse {
  success: boolean;
  config: ApiConfig;
}

export interface ApiUpdateSettingsPayload extends ApiConfig {
  /**
   * Optional extra fields used by the frontend only
   */
  toPhoneNumber?: string;
  callPurpose?: string;
  customInstructions?: string;
  prompt: string;
}

export type CallStatus = 'in-progress' | 'completed' | 'failed' | 'terminated';

export interface CallMetadata {
  to?: string;
  from?: string;
  transferNumber?: string;
  callPurpose?: string;
}

export interface CallSummary {
  callSid: string;
  startTime: string | Date;
  endTime?: string | Date;
  duration?: number;
  status: CallStatus;
  metadata?: CallMetadata;
  conversationCount?: number;
  dtmfCount?: number;
  eventCount?: number;
}

export interface CallHistoryResponse {
  success: boolean;
  calls: CallSummary[];
  mongoConnected: boolean;
}

export interface DTMFPress {
  digit: string;
  reason?: string;
  timestamp?: Date | string;
}

export interface ConversationEntry {
  type: 'user' | 'ai' | 'system';
  text: string;
  timestamp?: Date | string;
}

export interface MenuOption {
  digit: string;
  option: string;
}

export interface CallEvent {
  eventType: 'conversation' | 'dtmf' | 'ivr_menu' | 'transfer' | 'termination';
  type?: 'user' | 'ai' | 'system';
  text?: string;
  digit?: string;
  reason?: string;
  menuOptions?: MenuOption[];
  transferNumber?: string;
  success?: boolean;
  timestamp?: Date | string;
}

export interface CallDetails extends CallSummary {
  conversation: ConversationEntry[];
  dtmfPresses: DTMFPress[];
  events: CallEvent[];
}

export interface CallDetailsResponse {
  success: boolean;
  call: CallDetails;
}

export interface InitiateCallPayload {
  to: string;
  transferNumber: string;
  callPurpose: string;
  customInstructions: string;
}

export interface InitiateCallResponse {
  call: {
    sid: string;
    status: string;
    to: string;
    from?: string;
  };
}

export interface EvaluationMetrics {
  totalCalls: number;
  successfulAgentReach: {
    count: number;
    percentage: number;
  };
  transferAfterAgentJoin: {
    count: number;
    percentage: number;
  };
  droppedOrFailed: {
    count: number;
    percentage: number;
  };
  period?: {
    startDate: string;
    endDate: string;
  };
}

export interface EvaluationResponse {
  success: boolean;
  metrics: EvaluationMetrics;
}

export interface BreakdownResponse {
  success: boolean;
  breakdown: {
    byStatus: {
      'in-progress': number;
      completed: number;
      failed: number;
      terminated: number;
    };
    withTransfers: number;
    withSuccessfulTransfers: number;
    averageDuration: number;
  };
}

/**
 * Get authorization headers
 */
export function getAuthHeaders(): HeadersInit {
  const token = getToken();
  return token
    ? {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    : {
        'Content-Type': 'application/json',
      };
}

/**
 * Build query string from object, filtering out undefined/null values
 */
function buildQueryString(
  params: Record<string, string | number | undefined | null>
): string {
  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, value.toString());
    }
  });
  const queryString = queryParams.toString();
  return queryString ? `?${queryString}` : '';
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
      errorMessage =
        (error as { error?: string; message?: string }).error ||
        (error as { message?: string }).message ||
        errorMessage;
    } catch {
      // If response is not JSON, use status text
      errorMessage = response.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  return response.json() as Promise<T>;
}

/**
 * API endpoints
 */
export const api = {
  // Auth endpoints
  auth: {
    me: () => apiFetch<{ user: ApiUser }>('/api/auth/me'),
    logout: () =>
      apiFetch<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
    login: (email: string, password: string) =>
      apiFetch<
        | { success: true; token: string; user: ApiUser }
        | { success: false; error: string }
      >('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    signup: (email: string, password: string, name: string) =>
      apiFetch<{ success: boolean; token: string; user: ApiUser }>(
        '/api/auth/signup',
        {
          method: 'POST',
          body: JSON.stringify({ email, password, name }),
        }
      ),
  },

  // Config endpoints
  config: {
    get: () => apiFetch<ApiConfigResponse>('/api/config'),
    update: (settings: ApiUpdateSettingsPayload) =>
      apiFetch<{ success: boolean }>('/api/settings', {
        method: 'POST',
        body: JSON.stringify(settings),
      }),
  },

  // Prompt endpoints
  prompt: {
    get: () => apiFetch<{ success: boolean; prompt: string }>('/api/prompt'),
  },

  // Call endpoints
  calls: {
    history: (limit: number = 50) =>
      apiFetch<CallHistoryResponse>(
        `/api/calls/history${buildQueryString({ limit })}`
      ),
    get: (callSid: string) =>
      apiFetch<CallDetailsResponse>(`/api/calls/${callSid}`),
    initiate: (data: InitiateCallPayload) =>
      apiFetch<{ success: boolean } & InitiateCallResponse>(
        '/api/calls/initiate',
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      ),
  },

  // Evaluation endpoints
  evaluations: {
    get: (params?: { days?: number; startDate?: string; endDate?: string }) => {
      return apiFetch<EvaluationResponse>(
        `/api/evaluations${buildQueryString(params || {})}`
      );
    },
    breakdown: (params?: { startDate?: string; endDate?: string }) => {
      return apiFetch<BreakdownResponse>(
        `/api/evaluations/breakdown${buildQueryString(params || {})}`
      );
    },
  },
};
