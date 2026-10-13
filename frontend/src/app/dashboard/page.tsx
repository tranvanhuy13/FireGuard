/* eslint-disable */
"use client";

import CameraGrid from "@/components/CameraGrid";
import AlertPanel, { Alert } from "@/components/AlertPanel";
import StatsChart from "@/components/StatsChart";
import HistoryModal from "@/components/HistoryModal";
import SettingsModal from "@/components/SettingsModal";
import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { API_URL, WS_URL } from "@/config";
import { 
  normalizeAlert, 
  normalizeAlerts, 
  normalizeCameras, 
  calculateDashboardKPIs, 
  NormalizedCamera 
} from "@/lib/api/client";

export default function Home() {
  const { t, language, setLanguage } = useLanguage();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [cameras, setCameras] = useState<NormalizedCamera[]>([]);
  const [error, setError] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    const fetchAlerts = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(`${API_URL}/alerts`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error("Backend unavailable");
        const data = await res.json();
        setAlerts(normalizeAlerts(data.alerts || []));
        setError(false);
      } catch (err) {
        clearTimeout(timeoutId);
        console.warn("Backend connection failed, trying WebSocket...", err);
        setError(true);
      }
    };
    fetchAlerts();

    const fetchCameras = async () => {
      try {
        const res = await fetch(`${API_URL}/cameras`);
        if (res.ok) {
          const data = await res.json();
          setCameras(normalizeCameras(data.cameras || []));
        }
      } catch (err) {
        console.warn("Failed to fetch cameras in dashboard", err);
      }
    };
    fetchCameras();
    const camInterval = setInterval(fetchCameras, 3000);

    // 2. Establish WebSocket connection for real-time updates
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;

    const connectWebSocket = () => {
      ws = new WebSocket(`${WS_URL}/ws/alerts`);

      ws.onopen = () => {
        console.log("[WebSocket] Connected to FastAPI backend!");
        setError(false);
      };

      ws.onmessage = (event) => {
        try {
          const rawAlert = JSON.parse(event.data);
          const newAlert = normalizeAlert(rawAlert);
          setAlerts(prevAlerts => {
            // Avoid duplicate additions in state
            if (prevAlerts.some(a => a.id === newAlert.id || (a.timestamp === newAlert.timestamp && a.type === newAlert.type))) {
              return prevAlerts;
            }
            return [newAlert, ...prevAlerts];
          });
        } catch (e) {
          console.error("[WebSocket] Error parsing message:", e);
        }
      };

      ws.onerror = (err) => {
        console.warn("[WebSocket] Error:", err);
      };

      ws.onclose = () => {
        console.log("[WebSocket] Disconnected. Reconnecting in 3s...");
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
      };
    };

    connectWebSocket();

    return () => {
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      clearInterval(camInterval);
    };
  }, []);

  const kpis = calculateDashboardKPIs(cameras, alerts);

  return (
    <div className="h-full flex flex-col relative">
      <HistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      
      {/* Red flashing banner if there is a new fire alert within last 15 seconds */}
      {alerts.some(a => a.type === 'fire' && (Date.now() - new Date(a.timestamp.replace(' ', 'T')).getTime() < 15000)) && (
        <div className="absolute top-0 left-0 w-full bg-red-600/90 text-white text-center py-2 text-sm font-bold animate-pulse z-50 rounded-lg mb-4">
          {t.alerts.warningFireDetected}
        </div>
      )}

      {error && (
        <div className="absolute inset-0 bg-navy-900/90 z-50 flex items-center justify-center backdrop-blur-sm rounded-2xl">
           <div className="bg-white p-8 rounded-xl shadow-xl max-w-md w-full text-center">
              <h2 className="text-xl font-bold text-navy-900 mb-2">{t.dashboard.connectionError}</h2>
              <p className="text-gray-600 mb-6">{t.dashboard.failedToConnect}</p>
              <div className="flex gap-4 justify-center">
                 <button onClick={() => window.location.reload()} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">{t.dashboard.retry}</button>
                 <button onClick={() => { localStorage.setItem('force_mock', 'true'); window.location.reload(); }} className="px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700">{t.dashboard.useDemoMode}</button>
              </div>
           </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {[
          { label: t.dashboard.totalCameras, value: kpis.totalCameras.toString(), color: "text-navy-900" },
          { label: t.dashboard.activeCameras, value: kpis.activeCameras.toString(), color: "text-green-600" },
          { label: t.dashboard.totalDetections, value: kpis.totalDetections.toString(), color: "text-sky-600" },
          { label: t.dashboard.fireAlerts, value: kpis.fireAlerts.toString(), color: "text-red-600" },
          { label: t.dashboard.smokeAlerts, value: kpis.smokeAlerts.toString(), color: "text-yellow-500" }
        ].map((kpi, idx) => (
          <div key={idx} className="bg-white rounded-xl p-4 shadow-sm border border-sky-100 flex flex-col justify-center items-center">
             <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">{kpi.label}</span>
             <span className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</span>
          </div>
        ))}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-220px)] overflow-hidden">
        {/* Video Feed Section - Takes 2/3 width */}
        <div className="lg:col-span-2 h-full flex flex-col gap-6 overflow-hidden">
          <div className="flex-1 rounded-2xl overflow-hidden bg-[#0B2540] border border-sky-100 relative p-2 shadow-sm">
            <CameraGrid />
          </div>
          
           {/* Bottom Stats Area (Under Video) */}
           <div className="h-48 rounded-2xl bg-white border border-sky-100 overflow-hidden hidden lg:block shadow-sm">
              <StatsChart />
           </div>
        </div>

        {/* Sidebar / Alerts - Takes 1/3 width */}
        <div className="h-full flex flex-col gap-6 overflow-hidden">
          <div className="flex-1 min-h-0 bg-white border border-sky-100 shadow-sm rounded-2xl overflow-hidden">
            <AlertPanel alerts={alerts} error={error} />
          </div>
          
          {/* Daily Count Widget */}
          <div className="h-32 shrink-0 rounded-2xl bg-white border border-sky-100 shadow-sm p-4 flex flex-col justify-center items-center relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-sky-50 to-white opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="text-4xl font-bold text-navy-900 mb-2 relative z-10">{alerts.filter(a => new Date(a.timestamp.replace(' ', 'T')).toDateString() === new Date().toDateString()).length}</span>
            <span className="text-xs text-gray-500 uppercase tracking-widest relative z-10">
              {t.stats.dailyCount}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

