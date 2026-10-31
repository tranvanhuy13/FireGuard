/* eslint-disable */
const isDev = process.env.NODE_ENV !== "production";
const forceMock = isDev && typeof window !== 'undefined' && localStorage.getItem('force_mock') === 'true';

export const isMockMode = process.env.NEXT_PUBLIC_USE_MOCK === "true" || forceMock;
export const isMockAuth = process.env.NEXT_PUBLIC_USE_MOCK_AUTH !== undefined ? process.env.NEXT_PUBLIC_USE_MOCK_AUTH === "true" : isMockMode;
export const isMockData = process.env.NEXT_PUBLIC_USE_MOCK_DATA !== undefined ? process.env.NEXT_PUBLIC_USE_MOCK_DATA === "true" : isMockMode;

type FetchOptions = RequestInit & {
  params?: Record<string, string>;
  timeout?: number;
};

import { API_URL } from '@/config';

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// In-memory auth session cache (never stored in localStorage)
let currentAuthHeader: string | null = typeof window !== 'undefined' ? sessionStorage.getItem('auth_header') : null;

export function getAuthHeader(): string | null {
  if (currentAuthHeader) return currentAuthHeader;
  if (typeof window !== 'undefined') {
    currentAuthHeader = sessionStorage.getItem('auth_header');
  }
  return currentAuthHeader;
}

export function setAuthHeader(header: string | null): void {
  currentAuthHeader = header;
  if (typeof window !== 'undefined') {
    if (header) {
      sessionStorage.setItem('auth_header', header);
    } else {
      sessionStorage.removeItem('auth_header');
    }
  }
}

export function clearAuthSession(): void {
  currentAuthHeader = null;
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('auth_header');
    sessionStorage.removeItem('user_profile');
    sessionStorage.removeItem('stream_token');
    sessionStorage.removeItem('verifyEmail');
    sessionStorage.removeItem('loginToastSuccess');
  }
}

declare global {
  interface Window {
    __fireguard_fetch_wrapped?: boolean;
  }
}

const API_PREFIXES = [
  '/auth',
  '/cameras',
  '/alerts',
  '/stats',
  '/history',
  '/settings',
  '/video-analysis',
  '/test-notification',
  '/users',
  '/api',
  '/snapshots',
  '/notifications',
  '/audit-logs',
];

// Global fetch auto-injection of Basic Authorization and 401 handling
if (typeof window !== 'undefined' && !window.__fireguard_fetch_wrapped) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    
    let isApiCall = false;
    let pathname = '';
    try {
      const parsedUrl = new URL(urlStr, window.location.origin);
      const apiOrigin = new URL(API_URL, window.location.origin).origin;
      pathname = parsedUrl.pathname;

      const isSameOriginAsApi = parsedUrl.origin === apiOrigin && apiOrigin !== window.location.origin;
      const isRelativeApiCall =
        parsedUrl.origin === window.location.origin &&
        API_PREFIXES.some((prefix) => parsedUrl.pathname.startsWith(prefix));

      isApiCall = isSameOriginAsApi || isRelativeApiCall;
    } catch {
      isApiCall = false;
    }

    let modifiedInit = init;
    const authHeader = getAuthHeader();

    if (isApiCall && authHeader) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has('Authorization')) {
        headers.set('Authorization', authHeader);
      }
      modifiedInit = {
        ...init,
        headers,
      };
    }

    const response = await originalFetch(input, modifiedInit);

    if (isApiCall && response.status === 401 && !pathname.includes('/auth/login')) {
      clearAuthSession();
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/dashboard')) {
        const currentPath = window.location.pathname + window.location.search;
        window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
      }
    }

    return response;
  };
  window.__fireguard_fetch_wrapped = true;
}

export async function apiClient<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { params, timeout = 10000, ...customConfig } = options;

  let url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(customConfig.headers as Record<string, string>),
  };

  const authHeader = getAuthHeader();
  if (authHeader && !headers["Authorization"]) {
    headers["Authorization"] = authHeader;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const config: RequestInit = {
    ...customConfig,
    headers,
    signal: customConfig.signal || controller.signal,
  };

  try {
    const response = await fetch(url, config);
    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMsg = "An error occurred";
      let errorData: any = null;
      try {
        errorData = await response.json();
        errorMsg = errorData.detail || errorData.message || errorMsg;
      } catch (e) {
        // Not JSON
      }

      if (response.status === 401 && !endpoint.includes('/auth/login')) {
        clearAuthSession();
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/dashboard')) {
          const currentPath = window.location.pathname + window.location.search;
          window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
        }
      }

      if (response.status === 429) {
        errorData = { ...errorData, retryAfter: Number(response.headers.get("Retry-After")) || errorData?.retryAfter || 60 };
      }
      throw new ApiError(errorMsg, response.status, errorData);
    }

    return response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new ApiError("REQUEST_TIMEOUT", 408);
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(error.message || "NETWORK_ERROR", 0);
  }
}

// ==================== Data Normalization & KPI Helpers ====================

/**
 * Chuẩn hóa loại cảnh báo không phân biệt hoa thường (ví dụ: 'Fire', 'FIRE' -> 'fire', 'Smoke' -> 'smoke')
 */
export function normalizeAlertType(type?: string | null): string {
  if (!type) return '';
  const lower = String(type).trim().toLowerCase();
  if (lower === 'fire') return 'fire';
  if (lower === 'smoke') return 'smoke';
  return lower;
}

export interface NormalizedAlert {
  id?: number | string;
  timestamp: string;
  type: string;
  confidence: number;
  snapshot?: string;
  snapshot_path?: string;
  status?: string;
  camera_name?: string;
  camera_id?: number | string;
  [key: string]: any;
}

/**
 * Chuẩn hóa một bản ghi cảnh báo (không phân biệt hoa thường type, đồng bộ snapshot)
 */
export function normalizeAlert<T extends Record<string, any>>(raw: T): T & { type: string; snapshot?: string } {
  if (!raw) return raw;
  const type = normalizeAlertType(raw.type);
  const snapshot = raw.snapshot || raw.snapshot_path;
  return {
    ...raw,
    type,
    ...(snapshot ? { snapshot } : {}),
  };
}

/**
 * Chuẩn hóa danh sách cảnh báo
 */
export function normalizeAlerts<T extends Record<string, any>>(list: T[]): Array<T & { type: string; snapshot?: string }> {
  if (!Array.isArray(list)) return [];
  return list.map(item => normalizeAlert(item));
}

export interface NormalizedCamera {
  id: number;
  name: string;
  source: string;
  is_active: boolean;
  status: 'connected' | 'disconnected' | 'connecting' | string;
  [key: string]: any;
}

/**
 * Chuẩn hóa một bản ghi camera
 */
export function normalizeCamera<T extends Record<string, any>>(raw: T): T & NormalizedCamera {
  return {
    ...raw,
    id: Number(raw.id),
    name: raw.name || `Camera ${raw.id}`,
    source: String(raw.source || ''),
    is_active: Boolean(raw.is_active),
    status: raw.status || (raw.is_active ? 'connected' : 'disconnected'),
  };
}

/**
 * Chuẩn hóa danh sách camera
 */
export function normalizeCameras<T extends Record<string, any>>(list: T[]): Array<T & NormalizedCamera> {
  if (!Array.isArray(list)) return [];
  return list.map(item => normalizeCamera(item));
}

export interface DashboardKPIs {
  totalCameras: number;
  activeCameras: number;
  totalDetections: number;
  fireAlerts: number;
  smokeAlerts: number;
}

/**
 * Tính toán 5 thẻ KPI trên Dashboard từ dữ liệu thật
 */
export function calculateDashboardKPIs(cameras: any[], alerts: any[]): DashboardKPIs {
  const normCameras = normalizeCameras(cameras || []);
  const normAlerts = normalizeAlerts(alerts || []);

  const totalCameras = normCameras.length;
  // Camera đang hoạt động: được bật (is_active) và kết nối (status === 'connected' hoặc 'connecting')
  const activeCameras = normCameras.filter(c => {
    if (!c.is_active) return false;
    if (c.status) return c.status === 'connected' || c.status === 'connecting';
    return true;
  }).length;

  const totalDetections = normAlerts.length;
  const fireAlerts = normAlerts.filter(a => normalizeAlertType(a.type) === 'fire').length;
  const smokeAlerts = normAlerts.filter(a => normalizeAlertType(a.type) === 'smoke').length;

  return {
    totalCameras,
    activeCameras,
    totalDetections,
    fireAlerts,
    smokeAlerts,
  };
}

// Only attach media credentials to this backend's snapshot route.
export function mediaUrl(path: string, token: string | null): string | undefined {
  const backend = new URL(API_URL, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  const url = new URL(/^https?:\/\//.test(path) ? path : `${backend.href.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
  if (url.origin === backend.origin && url.pathname.startsWith(`${backend.pathname.replace(/\/$/, '')}/snapshots/`)) {
    if (!token) return undefined;
    url.searchParams.set('token', token);
  }
  return url.toString();
}
