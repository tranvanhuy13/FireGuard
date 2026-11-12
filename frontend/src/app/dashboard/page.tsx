/* eslint-disable */
"use client";

import CameraGrid from "@/components/CameraGrid";
import AlertPanel, { Alert } from "@/components/AlertPanel";
import StatsChart from "@/components/StatsChart";
import HistoryModal from "@/components/HistoryModal";
import SettingsModal from "@/components/SettingsModal";
import ResizeHandle from "@/components/ResizeHandle";
import { useCallback, useEffect, useState, useRef } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { API_URL, WS_URL } from "@/config";
import { authFetch } from "@/lib/api/authFetch";
import { applyStreamFailures } from "@/lib/cameraView";
import { startPolling, startAlertStream, mergeAlerts, type LoadState, type StreamState } from "@/lib/dashboardConnection";
import { 
  normalizeAlert, 
  normalizeAlerts, 
  normalizeCameras, 
  calculateDashboardKPIs, 
  NormalizedCamera 
} from "@/lib/api/client";

export default function Home() {
  const { t } = useLanguage();
  const { user, streamToken, refreshStreamToken } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [cameras, setCameras] = useState<NormalizedCamera[]>([]);
  const [historyState, setHistoryState] = useState<LoadState>("loading");
  const [cameraState, setCameraState] = useState<LoadState>("loading");
  const [streamState, setStreamState] = useState<StreamState>("waiting");
  const [online, setOnline] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [streamEpoch, setStreamEpoch] = useState(0);
  const historyRetry = useRef<() => void>(() => {});
  const cameraRetry = useRef<() => void>(() => {});
  const retryCameras = useCallback(() => cameraRetry.current(), []);
  const [failedStreamIds, setFailedStreamIds] = useState<number[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const cameraColumnRef = useRef<HTMLDivElement>(null);
  const alertColumnRef = useRef<HTMLDivElement>(null);
  const [alertWidth, setAlertWidth] = useState(30);
  const [statsHeight, setStatsHeight] = useState(26);
  const [dailyHeight, setDailyHeight] = useState(22);
  const [cameraFocus, setCameraFocus] = useState(false);

  // HTTP lifecycles deliberately do not depend on stream-token refreshes.
  useEffect(() => {
    const history = startPolling<{ alerts: Alert[] }>({
      url: `${API_URL}/alerts`, interval: 30000, request: authFetch,
      onState: setHistoryState,
      onData: data => {
        if (!Array.isArray(data.alerts)) throw new Error("Invalid alerts response");
        setAlerts(previous => mergeAlerts(normalizeAlerts(data.alerts), previous));
        setLastUpdated(Date.now());
      },
    });
    const camera = startPolling<{ cameras: NormalizedCamera[] }>({
      url: `${API_URL}/cameras`, interval: 3000, request: authFetch,
      onState: setCameraState,
      onData: data => {
        if (!Array.isArray(data.cameras)) throw new Error("Invalid cameras response");
        setCameras(normalizeCameras(data.cameras));
      },
    });
    historyRetry.current = history.retry;
    cameraRetry.current = camera.retry;
    const recover = () => {
      setOnline(navigator.onLine);
      if (!document.hidden) { history.retry(); camera.retry(); }
    };
    const offline = () => { setOnline(false); history.retry(); camera.retry(); };
    setOnline(navigator.onLine);
    window.addEventListener("online", recover);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", recover);
    return () => {
      history.dispose(); camera.dispose();
      historyRetry.current = cameraRetry.current = () => {};
      window.removeEventListener("online", recover);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", recover);
    };
  }, []);

  useEffect(() => {
    if (!streamToken || !online) { setStreamState("waiting"); return; }
    return startAlertStream({
      url: `${WS_URL}/ws/alerts?token=${encodeURIComponent(streamToken)}`,
      onState: setStreamState,
      refreshToken: refreshStreamToken,
      onConnected: () => historyRetry.current(),
      onAlert: data => {
        const raw = data as Alert;
        if (!raw || typeof raw.timestamp !== "string" || typeof raw.type !== "string") return;
        setAlerts(previous => mergeAlerts([normalizeAlert(raw)], previous));
        setLastUpdated(Date.now());
      },
    });
  }, [streamToken, refreshStreamToken, streamEpoch, online]);

  const retry = () => {
    historyRetry.current(); cameraRetry.current();
    if (streamState !== "connected") setStreamEpoch(value => value + 1);
  };
  const historyUnavailable = historyState !== "ready" && historyState !== "loading";
  const cameraUnavailable = cameraState !== "ready" && cameraState !== "loading";
  const notices = [
    !online ? t.dashboard.networkOffline : null,
    historyState === "loading" ? t.dashboard.loadingHistory : null,
    historyState === "forbidden" || cameraState === "forbidden" ? t.dashboard.accessError : null,
    historyUnavailable && historyState !== "forbidden" ? t.dashboard.historyUnavailable : null,
    cameraUnavailable && cameraState !== "forbidden" ? t.dashboard.camerasUnavailable : null,
    streamState !== "connected" ? t.dashboard.reconnectingLive : null,
  ].filter(Boolean);

  // Cameras whose HLS stream failed in the browser must not be counted as running.
  const kpis = calculateDashboardKPIs(applyStreamFailures(cameras, failedStreamIds), alerts);

  return (
    <div className="h-full min-h-0 flex flex-col relative">
      <HistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
      <SettingsModal isOpen={isSettingsOpen && user?.role === "admin"} onClose={() => setIsSettingsOpen(false)} />
      
      {/* Red flashing banner if there is a new fire alert within last 15 seconds */}
      {alerts.some(a => a.type === 'fire' && (Date.now() - new Date(a.timestamp.replace(' ', 'T')).getTime() < 15000)) && (
        <div className="absolute top-0 left-0 w-full bg-red-600/90 text-white text-center py-2 text-sm font-bold animate-pulse z-50 rounded-lg mb-4">
          {t.alerts.warningFireDetected}
        </div>
      )}

      {notices.length > 0 && (
        <div role="status" aria-live="polite" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          {notices.map(message => <p key={message}>{message}</p>)}
          {lastUpdated && <p>{t.dashboard.lastUpdated}: {new Date(lastUpdated).toLocaleTimeString()}</p>}
          <button type="button" onClick={retry} className="mt-2 rounded-lg bg-sky-600 px-4 py-2 text-white hover:bg-sky-700">{t.dashboard.retry}</button>
        </div>
      )}

      {/* KPI Cards */}
      <div className={`grid grid-cols-2 md:grid-cols-5 gap-3 mb-3 shrink-0 ${cameraFocus ? "hidden" : ""}`}>
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

      <div className="mb-2 flex shrink-0 justify-end gap-2">
        <button type="button" aria-pressed={cameraFocus} onClick={() => setCameraFocus(value => !value)}
          className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50">
          {cameraFocus ? t.dashboard.restorePanels : t.dashboard.expandCameras}
        </button>
        <button type="button" onClick={() => { setAlertWidth(30); setStatsHeight(26); setDailyHeight(22); setCameraFocus(false); }}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
          {t.dashboard.resetPanels}
        </button>
      </div>
      <div ref={workspaceRef} data-testid="monitoring-workspace"
        className="flex flex-1 min-h-[640px] lg:min-h-0 flex-col lg:flex-row overflow-hidden"
        style={{ "--alert-width": `${alertWidth}%` } as React.CSSProperties}>
        <div ref={cameraColumnRef} className="flex-1 min-w-0 lg:min-w-[300px] min-h-0 flex flex-col overflow-hidden">
          <div id="live-camera-panel" data-testid="live-camera-panel" className="flex-1 min-h-[280px] lg:min-h-0 rounded-2xl overflow-hidden bg-[#0B2540] border border-sky-100 relative p-2 shadow-sm">
            <CameraGrid cameraLoadState={cameraState} cameraData={cameras} onRefresh={retryCameras} onStreamFailures={setFailedStreamIds} />
          </div>
          <ResizeHandle orientation="horizontal" label={t.dashboard.resizeStats} value={statsHeight} min={12} max={45}
            inverted onChange={setStatsHeight} containerRef={cameraColumnRef} controls="monitoring-stats"
            className={`h-3 w-full shrink-0 ${cameraFocus ? "hidden" : "hidden lg:flex"}`} />
           <div id="monitoring-stats" className={`shrink-0 rounded-2xl bg-white border border-sky-100 overflow-hidden ${cameraFocus ? "hidden" : "hidden lg:block"}`}
             style={{ height: `${statsHeight}%` }}>
              <StatsChart />
           </div>
        </div>
        <ResizeHandle orientation="vertical" label={t.dashboard.resizeAlerts} value={alertWidth} min={18} max={45}
          inverted onChange={setAlertWidth} containerRef={workspaceRef} controls="monitoring-alerts"
          className={`w-3 h-full shrink-0 ${cameraFocus ? "hidden" : "hidden lg:flex"}`} />
        <div ref={alertColumnRef} className={`w-full lg:w-[var(--alert-width)] lg:min-w-[180px] lg:shrink-0 h-[480px] lg:h-full min-h-0 flex flex-col overflow-hidden ${cameraFocus ? "hidden" : ""}`}>
          <div id="monitoring-alerts" className="flex-1 min-h-0 bg-white border border-sky-100 shadow-sm rounded-2xl overflow-hidden">
            <AlertPanel alerts={alerts} error={historyUnavailable && alerts.length === 0 && streamState !== "connected"} />
          </div>
          <ResizeHandle orientation="horizontal" label={t.dashboard.resizeDaily} value={dailyHeight} min={12} max={40}
            inverted onChange={setDailyHeight} containerRef={alertColumnRef} controls="monitoring-daily"
            className="flex h-3 w-full shrink-0" />
          <div id="monitoring-daily" style={{ height: `${dailyHeight}%` }} className="min-h-[80px] shrink-0 rounded-2xl bg-white border border-sky-100 shadow-sm p-3 flex flex-col justify-center items-center relative overflow-hidden group">
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

