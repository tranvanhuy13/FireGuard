/* eslint-disable */
export const isMockMode = process.env.NEXT_PUBLIC_USE_MOCK === "true" || (typeof window !== 'undefined' && localStorage.getItem('force_mock') === 'true');
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

  const headers = {
    "Content-Type": "application/json",
    ...customConfig.headers,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const config: RequestInit = {
    ...customConfig,
    headers,
    signal: customConfig.signal || controller.signal,
  };

  // Add auth token if exists
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  if (token) {
    (config.headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, config);
    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMsg = "An error occurred";
      let errorData: any = null;
      try {
        errorData = await response.json();
        errorMsg = errorData.message || errorData.detail || errorMsg;
      } catch (e) {
        // Not JSON
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
