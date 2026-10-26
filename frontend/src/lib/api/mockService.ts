/* eslint-disable */
import { API_URL } from '@/config';

const MOCK_DATA_KEY = 'fireguard_mock_data_v2';

export const getMockData = () => {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(MOCK_DATA_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    if (!parsed.notifications) {
      parsed.notifications = {
        accounts: [
          { id: 'acc1', type: 'telegram', name: 'Giám đốc', chatId: '123456789', isActive: true },
          { id: 'acc2', type: 'zalo', name: 'Bảo vệ ca đêm', chatId: '987654321', isActive: true },
          { id: 'acc3', type: 'telegram', name: 'Kỹ thuật viên', chatId: '456123789', isActive: false }
        ],
        groups: [
          { id: 'grp1', type: 'telegram', name: 'Nhóm PCCC', chatId: '-100123456789', isActive: true },
          { id: 'grp2', type: 'zalo', name: 'Bảo vệ Toàn khu', chatId: 'zgrp123', isActive: true }
        ],
        rules: [
          { id: 'rule1', name: 'Cảnh báo cháy tầng 1', cameraIds: [1, 2], events: ['fire'], minConfidence: 85, recipientIds: ['acc1', 'grp1'] },
          { id: 'rule2', name: 'Cảnh báo khói khu kho', cameraIds: [4], events: ['smoke'], minConfidence: 70, recipientIds: ['acc2'] }
        ],
        systemConfig: {
          telegramToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
          zaloToken: 'aBcDeFgHiJkLmNoPqRsTuVwXyZ',
          webhookUrl: 'https://api.fireguard.vn/webhook/alerts',
          isConnected: true
        }
      };
      localStorage.setItem(MOCK_DATA_KEY, JSON.stringify(parsed));
    }
    return parsed;
  }
  
  const data = {
    cameras: [
      { id: 1, name: 'Main Gate', source: 'rtsp://...', is_active: true, status: 'connected' },
      { id: 2, name: 'Lobby', source: 'rtsp://...', is_active: true, status: 'connected' },
      { id: 3, name: 'Parking', source: 'rtsp://...', is_active: true, status: 'disconnected' },
      { id: 4, name: 'Warehouse', source: 'rtsp://...', is_active: false, status: 'disconnected' }
    ],
    alerts: Array.from({ length: 35 }).map((_, i) => ({
      id: `alert-${i}`,
      camera_id: (i % 4) + 1,
      type: i % 3 === 0 ? 'smoke' : 'fire',
      timestamp: new Date(Date.now() - i * 3600000).toISOString(),
      confidence: Math.round((0.85 + Math.random() * 0.14) * 100) / 100,
      status: i % 4 === 0 ? 'confirmed' : i % 5 === 0 ? 'false_alarm' : 'new',
      handler: i % 4 === 0 ? 'admin' : null,
      snapshot: '/placeholder-snapshot.jpg'
    })),
    auditLogs: [
      {
            "id": "log-1",
            "timestamp": "2026-10-09T17:14:17.549Z",
            "user": "admin",
            "fullName": "System Admin",
            "action": "LOGOUT",
            "target": "system",
            "ip": "192.168.1.10",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-2",
            "timestamp": "2026-10-09T15:24:29.074Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "LOGOUT",
            "target": "system",
            "ip": "192.168.1.51",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-3",
            "timestamp": "2026-10-09T14:09:10.739Z",
            "user": "admin",
            "fullName": "System Admin",
            "action": "LOGOUT",
            "target": "system",
            "ip": "10.0.0.5",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-4",
            "timestamp": "2026-10-09T13:44:52.901Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "LOGOUT",
            "target": "system",
            "ip": "192.168.1.51",
            "result": "failed",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-5",
            "timestamp": "2026-10-09T11:01:23.174Z",
            "user": "operator2",
            "fullName": "Night Shift Operator",
            "action": "FALSE_ALARM",
            "target": "Cảnh báo #1284",
            "ip": "192.168.1.60",
            "result": "success",
            "details": "Đánh dấu nhầm lẫn (có người hút thuốc)",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-6",
            "timestamp": "2026-10-09T09:00:55.712Z",
            "user": "operator2",
            "fullName": "Night Shift Operator",
            "action": "TEST_NOTIFICATION",
            "target": "Zalo (Bảo vệ ca đêm)",
            "ip": "192.168.1.60",
            "result": "success",
            "details": "Gửi tin nhắn thử nghiệm nghiệm thu hệ thống",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-7",
            "timestamp": "2026-10-09T06:49:45.822Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "TEST_NOTIFICATION",
            "target": "Zalo (Bảo vệ ca đêm)",
            "ip": "192.168.1.51",
            "result": "success",
            "details": "Gửi tin nhắn thử nghiệm nghiệm thu hệ thống",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-8",
            "timestamp": "2026-10-09T04:01:27.638Z",
            "user": "operator2",
            "fullName": "Night Shift Operator",
            "action": "TOGGLE_CAMERA",
            "target": "Camera Cổng chính",
            "ip": "192.168.1.60",
            "result": "success",
            "details": "status: active -> inactive",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-9",
            "timestamp": "2026-10-09T01:17:22.379Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "LOGIN",
            "target": "system",
            "ip": "192.168.1.51",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-10",
            "timestamp": "2026-10-08T23:30:45.943Z",
            "user": "admin",
            "fullName": "System Admin",
            "action": "TOGGLE_CAMERA",
            "target": "Camera Bãi xe",
            "ip": "192.168.1.10",
            "result": "success",
            "details": "status: active -> inactive",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-11",
            "timestamp": "2026-10-08T21:32:09.079Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "VIDEO_ANALYSIS",
            "target": "Cảnh báo #1060",
            "ip": "192.168.1.51",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-12",
            "timestamp": "2026-10-08T19:36:32.724Z",
            "user": "admin",
            "fullName": "System Admin",
            "action": "UPDATE_CAMERA",
            "target": "Camera Hành lang",
            "ip": "10.0.0.5",
            "result": "success",
            "details": "name: Cam1 -> Camera Hành lang",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-13",
            "timestamp": "2026-10-08T17:53:33.841Z",
            "user": "admin",
            "fullName": "System Admin",
            "action": "FALSE_ALARM",
            "target": "Cảnh báo #1105",
            "ip": "192.168.1.15",
            "result": "success",
            "details": "Đánh dấu nhầm lẫn (có người hút thuốc)",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-14",
            "timestamp": "2026-10-08T17:39:23.683Z",
            "user": "operator2",
            "fullName": "Night Shift Operator",
            "action": "TEST_NOTIFICATION",
            "target": "Nhóm PCCC",
            "ip": "192.168.1.60",
            "result": "success",
            "details": "Gửi tin nhắn thử nghiệm nghiệm thu hệ thống",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-15",
            "timestamp": "2026-10-08T16:34:31.305Z",
            "user": "operator2",
            "fullName": "Night Shift Operator",
            "action": "ACK_ALERT",
            "target": "Cảnh báo #1219",
            "ip": "192.168.1.60",
            "result": "success",
            "details": "Xác nhận cảnh báo cháy thực tế",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-16",
            "timestamp": "2026-10-08T15:22:48.731Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "LOGIN",
            "target": "system",
            "ip": "192.168.1.50",
            "result": "failed",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-17",
            "timestamp": "2026-10-08T12:44:52.038Z",
            "user": "operator2",
            "fullName": "Night Shift Operator",
            "action": "LOGIN",
            "target": "system",
            "ip": "192.168.1.60",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-18",
            "timestamp": "2026-10-08T11:24:42.451Z",
            "user": "operator2",
            "fullName": "Night Shift Operator",
            "action": "VIDEO_ANALYSIS",
            "target": "Cảnh báo #1325",
            "ip": "192.168.1.60",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-19",
            "timestamp": "2026-10-08T10:50:17.004Z",
            "user": "operator2",
            "fullName": "Night Shift Operator",
            "action": "VIDEO_ANALYSIS",
            "target": "Cảnh báo #1156",
            "ip": "192.168.1.60",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-20",
            "timestamp": "2026-10-08T08:53:49.869Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "TEST_NOTIFICATION",
            "target": "Zalo (Bảo vệ ca đêm)",
            "ip": "192.168.1.51",
            "result": "success",
            "details": "Gửi tin nhắn thử nghiệm nghiệm thu hệ thống",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-21",
            "timestamp": "2026-10-08T08:13:04.771Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "ACK_ALERT",
            "target": "Cảnh báo #1260",
            "ip": "192.168.1.50",
            "result": "success",
            "details": "Xác nhận cảnh báo cháy thực tế",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-22",
            "timestamp": "2026-10-08T07:57:19.547Z",
            "user": "admin",
            "fullName": "System Admin",
            "action": "CREATE_CAMERA",
            "target": "Camera Cổng chính",
            "ip": "192.168.1.15",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-23",
            "timestamp": "2026-10-08T05:10:55.948Z",
            "user": "admin",
            "fullName": "System Admin",
            "action": "VIDEO_ANALYSIS",
            "target": "Cảnh báo #1357",
            "ip": "192.168.1.10",
            "result": "failed",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-24",
            "timestamp": "2026-10-08T05:04:33.311Z",
            "user": "operator2",
            "fullName": "Night Shift Operator",
            "action": "FALSE_ALARM",
            "target": "Cảnh báo #1425",
            "ip": "192.168.1.60",
            "result": "success",
            "details": "Đánh dấu nhầm lẫn (có người hút thuốc)",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-25",
            "timestamp": "2026-10-08T02:56:31.764Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "LOGIN",
            "target": "system",
            "ip": "192.168.1.51",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-26",
            "timestamp": "2026-10-08T02:18:03.105Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "TEST_NOTIFICATION",
            "target": "Nhóm PCCC",
            "ip": "192.168.1.51",
            "result": "success",
            "details": "Gửi tin nhắn thử nghiệm nghiệm thu hệ thống",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-27",
            "timestamp": "2026-10-08T01:43:08.218Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "LOGOUT",
            "target": "system",
            "ip": "192.168.1.50",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-28",
            "timestamp": "2026-10-07T23:58:30.626Z",
            "user": "admin",
            "fullName": "System Admin",
            "action": "UNLOCK_USER",
            "target": "operator2",
            "ip": "192.168.1.10",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-29",
            "timestamp": "2026-10-07T22:55:42.880Z",
            "user": "admin",
            "fullName": "System Admin",
            "action": "TOGGLE_CAMERA",
            "target": "Camera Bãi xe",
            "ip": "192.168.1.15",
            "result": "success",
            "details": "status: active -> inactive",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-30",
            "timestamp": "2026-10-07T22:28:57.295Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "LOGOUT",
            "target": "system",
            "ip": "192.168.1.51",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-31",
            "timestamp": "2026-10-07T22:06:51.651Z",
            "user": "operator2",
            "fullName": "Night Shift Operator",
            "action": "VIDEO_ANALYSIS",
            "target": "Cảnh báo #1078",
            "ip": "192.168.1.60",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-32",
            "timestamp": "2026-10-07T20:34:55.435Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "TEST_NOTIFICATION",
            "target": "Nhóm PCCC",
            "ip": "192.168.1.50",
            "result": "success",
            "details": "Gửi tin nhắn thử nghiệm nghiệm thu hệ thống",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-33",
            "timestamp": "2026-10-07T19:08:13.207Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "ACK_ALERT",
            "target": "Cảnh báo #1081",
            "ip": "192.168.1.50",
            "result": "success",
            "details": "Xác nhận cảnh báo cháy thực tế",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-34",
            "timestamp": "2026-10-07T17:55:24.158Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "TEST_NOTIFICATION",
            "target": "Telegram (Giám đốc)",
            "ip": "192.168.1.50",
            "result": "success",
            "details": "Gửi tin nhắn thử nghiệm nghiệm thu hệ thống",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-35",
            "timestamp": "2026-10-07T16:23:45.048Z",
            "user": "operator2",
            "fullName": "Night Shift Operator",
            "action": "TEST_NOTIFICATION",
            "target": "Zalo (Bảo vệ ca đêm)",
            "ip": "192.168.1.60",
            "result": "success",
            "details": "Gửi tin nhắn thử nghiệm nghiệm thu hệ thống",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-36",
            "timestamp": "2026-10-07T15:32:21.738Z",
            "user": "admin",
            "fullName": "System Admin",
            "action": "DELETE_CAMERA",
            "target": "Camera Hành lang",
            "ip": "192.168.1.15",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-37",
            "timestamp": "2026-10-07T14:43:18.670Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "ACK_ALERT",
            "target": "Cảnh báo #1410",
            "ip": "192.168.1.50",
            "result": "success",
            "details": "Xác nhận cảnh báo cháy thực tế",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-38",
            "timestamp": "2026-10-07T13:04:49.514Z",
            "user": "operator2",
            "fullName": "Night Shift Operator",
            "action": "LOGIN",
            "target": "system",
            "ip": "192.168.1.60",
            "result": "success",
            "details": "",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-39",
            "timestamp": "2026-10-07T11:09:42.687Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "TEST_NOTIFICATION",
            "target": "Nhóm PCCC",
            "ip": "192.168.1.51",
            "result": "failed",
            "details": "Gửi tin nhắn thử nghiệm nghiệm thu hệ thống",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      {
            "id": "log-40",
            "timestamp": "2026-10-07T10:20:30.279Z",
            "user": "operator1",
            "fullName": "Camera Operator",
            "action": "FALSE_ALARM",
            "target": "Cảnh báo #1157",
            "ip": "192.168.1.50",
            "result": "success",
            "details": "Đánh dấu nhầm lẫn (có người hút thuốc)",
            "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
],
    users: [
      { id: 'u1', username: 'admin', name: 'System Admin', role: 'admin', status: 'active', lastLogin: new Date().toISOString() },
      { id: 'u2', username: 'operator1', name: 'Camera Operator', role: 'operator', status: 'active', lastLogin: new Date(Date.now() - 86400000).toISOString() },
      { id: 'u3', username: 'viewer1', name: 'Guest Viewer', role: 'viewer', status: 'blocked', lastLogin: new Date(Date.now() - 172800000).toISOString() }
    ],
    aiSettings: { fireThreshold: 75, smokeThreshold: 70, persistence: 5, cooldown: 60 },
    notifications: {
      accounts: [
        { id: 'acc1', channel: 'telegram', friendlyName: 'Giám đốc', chatId: '123456789', active: true },
        { id: 'acc2', channel: 'zalo', friendlyName: 'Bảo vệ ca đêm', chatId: '987654321', active: true },
        { id: 'acc3', channel: 'telegram', friendlyName: 'Kỹ thuật viên', chatId: '456123789', active: false }
      ],
      groups: [
        { id: 'grp1', channel: 'telegram', friendlyName: 'Nhóm PCCC', chatId: '-100123456789', active: true },
        { id: 'grp2', channel: 'zalo', friendlyName: 'Bảo vệ Toàn khu', chatId: 'zgrp123', active: true }
      ],
      rules: [
        { id: 'rule1', cameras: ['all'], events: ['fire'], minConfidence: 85, recipients: ['acc1', 'grp1'], active: true },
        { id: 'rule2', cameras: ['4'], events: ['smoke'], minConfidence: 70, recipients: ['acc2'], active: true }
      ],
      systemConfig: {
        telegramToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        zaloToken: 'aBcDeFgHiJkLmNoPqRsTuVwXyZ',
        webhookUrl: 'https://api.fireguard.vn/webhook/alerts',
        isConnected: true
      }
    }
  };
  localStorage.setItem(MOCK_DATA_KEY, JSON.stringify(data));
  return data;
};

export const saveMockData = (data: any) => {
  if (typeof window !== 'undefined') localStorage.setItem(MOCK_DATA_KEY, JSON.stringify(data));
};

export const addAuditLog = (user: string, action: string, target: string, ip: string, result: string, details: string = "", fullName: string = "", userAgent: string = "") => {
  const data = getMockData();
  if(!data) return;
  data.auditLogs.unshift({ id: `log-${Date.now()}`, timestamp: new Date().toISOString(), user, action, target, ip, result, details, fullName, userAgent });
  saveMockData(data);
};

export const setupMockService = () => {
  if (typeof window !== 'undefined') {
    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const parsedUrl = new URL(url, window.location.origin);
      // Camera controls and video feeds must use the same backend state,
      // including when other dashboard data is mocked.
      if (/^\/cameras(?:\/|$)/.test(parsedUrl.pathname)) {
        return originalFetch(input, init);
      }
      const data = getMockData();

      if (url.includes('/history')) {
        return new Response(JSON.stringify({ events: data.alerts }), { status: 200 });
      }

      if (url.includes('/alerts')) {
          if (init?.method === 'PUT') {
              const idMatch = url.match(/\/alerts\/([^/]+)/);
              if (idMatch) {
                  const id = idMatch[1];
                  const body = JSON.parse(init.body as string);
                  const index = data.alerts.findIndex((a: any) => a.id === id);
                  if (index !== -1) {
                      data.alerts[index] = { ...data.alerts[index], ...body };
                      saveMockData(data);
                      return new Response(JSON.stringify(data.alerts[index]), { status: 200 });
                  }
              }
          }
        return new Response(JSON.stringify({ alerts: data.alerts }), { status: 200 });
      }
      
      if (url.includes('/users')) {
          if (init?.method === 'PUT') {
              const idMatch = url.match(/\/users\/([^/]+)/);
              if (idMatch) {
                  const id = idMatch[1];
                  const body = JSON.parse(init.body as string);
                  const index = data.users.findIndex((u: any) => u.id === id);
                  if (index !== -1) {
                      const oldUser = data.users[index];
                      let action = 'UPDATE_USER';
                      let details = '';
                      if (body.role && body.role !== oldUser.role) {
                          action = 'CHANGE_ROLE';
                          details = `role: ${oldUser.role} -> ${body.role}`;
                      } else if (body.status && body.status !== oldUser.status) {
                          action = body.status === 'blocked' ? 'LOCK_USER' : 'UNLOCK_USER';
                          details = `status: ${oldUser.status} -> ${body.status}`;
                      }
                      
                      data.users[index] = { ...oldUser, ...body };
                      saveMockData(data);
                      addAuditLog('admin', action, data.users[index].username, '127.0.0.1', 'success', details, data.users[index].name, typeof window !== 'undefined' ? navigator.userAgent : 'Unknown');
                      return new Response(JSON.stringify(data.users[index]), { status: 200 });
                  }
              }
          }
          return new Response(JSON.stringify({ users: data.users }), { status: 200 });
      }

      if (url.includes('/audit-logs')) {
          return new Response(JSON.stringify({ auditLogs: data.auditLogs }), { status: 200 });
      }

      if (url.includes('/stats')) { const tf = url.includes('timeframe=month') ? 30 : 7; const stats = Array.from({ length: tf }).map((_, i) => { const date = new Date(Date.now() - (tf - 1 - i) * 86400000); return { date: date.toISOString().split('T')[0], count: Math.floor(Math.random() * 20), fireCount: Math.floor(Math.random() * 10), smokeCount: Math.floor(Math.random() * 15) }; }); return new Response(JSON.stringify({ stats }), { status: 200 }); }

      if (url.includes('/settings')) {
          if (init?.method === 'PUT') {
              const body = JSON.parse(init.body as string);
              data.aiSettings = { ...data.aiSettings, ...body };
              saveMockData(data);
              addAuditLog('admin', 'update_ai_settings', 'AI Settings', '127.0.0.1', 'success');
              return new Response(JSON.stringify(data.aiSettings), { status: 200 });
          }
          return new Response(JSON.stringify(data.aiSettings), { status: 200 });
      }
      
      if (url.includes('/notifications/')) {
        const typeMatch = url.match(/\/notifications\/(accounts|groups|rules|config)/);
        if (typeMatch) {
          const type = typeMatch[1];
          if (type === 'config') {
            if (init?.method === 'PUT') {
              const body = JSON.parse(init.body as string);
              data.notifications.systemConfig = { ...data.notifications.systemConfig, ...body };
              saveMockData(data);
              return new Response(JSON.stringify(data.notifications.systemConfig), { status: 200 });
            }
            return new Response(JSON.stringify(data.notifications.systemConfig), { status: 200 });
          } else {
            const list = data.notifications[type];
            if (init?.method === 'POST') {
              const body = JSON.parse(init.body as string);
              const newItem = { ...body, id: `${type.slice(0,3)}${Date.now()}` };
              list.push(newItem);
              saveMockData(data);
              return new Response(JSON.stringify(newItem), { status: 201 });
            } else if (init?.method === 'PUT') {
              const idMatch = url.match(new RegExp(`\/notifications\/${type}\/([^/]+)`));
              if (idMatch) {
                const id = idMatch[1];
                const body = JSON.parse(init.body as string);
                const index = list.findIndex((item: any) => item.id === id);
                if (index !== -1) {
                  list[index] = { ...list[index], ...body };
                  saveMockData(data);
                  return new Response(JSON.stringify(list[index]), { status: 200 });
                }
              }
            } else if (init?.method === 'DELETE') {
              const idMatch = url.match(new RegExp(`\/notifications\/${type}\/([^/]+)`));
              if (idMatch) {
                const id = idMatch[1];
                data.notifications[type] = list.filter((item: any) => item.id !== id);
                saveMockData(data);
                return new Response(null, { status: 204 });
              }
            }
            return new Response(JSON.stringify({ [type]: list }), { status: 200 });
          }
        }
      }

      return originalFetch(input, init);
    };
  }
};
