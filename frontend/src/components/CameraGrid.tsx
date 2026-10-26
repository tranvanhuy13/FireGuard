/* eslint-disable */
"use client";

import React, { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { API_URL } from "../config";
import VideoAnalysisModal from "./VideoAnalysisModal";
import { useAuth } from "../context/AuthContext";
import { isMockData } from "../lib/api/client";

interface Camera {
  id: number;
  name: string;
  source: string;
  is_active: boolean;
  status: "connected" | "disconnected" | "connecting";
}

const CameraGrid = () => {
  const { t } = useLanguage();
  const { user, streamToken, refreshStreamToken } = useAuth();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newCamSource, setNewCamSource] = useState("0");
  const [newCamName, setNewCamName] = useState("");
  const [loading, setLoading] = useState(true);
  const [layoutMode, setLayoutMode] = useState<"auto" | "1" | "4">("auto");
  const [isAnalyzerOpen, setIsAnalyzerOpen] = useState(false);
  const [toggling, setToggling] = useState<Record<number, boolean>>({});

  const toggleFullscreen = (camId: number) => {
    const el = document.getElementById(`cam-container-${camId}`);
    if (!document.fullscreenElement) {
      el?.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen();
    }
  };

  const canManage = user?.role === "admin";
  const canToggle = !!user;
  const canAnalyze = user?.role === "admin" || user?.role === "operator";

  // Mock animation states for bounding boxes
  const [time, setTime] = useState(0);

  const fetchCameras = async () => {
    try {
      const res = await fetch(`${API_URL}/cameras`);
      if (!res.ok) throw new Error("Backend responded with error");
      const data = await res.json();
      setCameras(data.cameras);
      setLoading(false);
    } catch (error) {
      console.error("[Frontend Camera] Failed to fetch camera statuses", error);
      setLoading(true);
    }
  };

  useEffect(() => {
    fetchCameras();
    const interval = setInterval(fetchCameras, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTime(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleAddCamera = async () => {
    if (!newCamSource || !canManage) return;

    try {
      await fetch(`${API_URL}/cameras`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: newCamSource,
          name: newCamName || `Kamera ${cameras.length + 1}`,
        }),
      });
      setIsAdding(false);
      setNewCamSource("0");
      setNewCamName("");
      fetchCameras();
    } catch (error) {
      console.error(error);
      alert("Failed to add camera");
    }
  };

  const handleDeleteCamera = async (id: number) => {
    if (!canManage) return;
    if (!confirm(t.camera.confirmDelete)) return;
    try {
      await fetch(`${API_URL}/cameras/${id}`, { method: "DELETE" });
      fetchCameras();
    } catch (error) {
      console.error(error);
      alert("Failed to delete");
    }
  };

  const handleToggleCamera = async (id: number, active: boolean) => {
    if (!canToggle || toggling[id]) return;

    if (!active) {
      const confirmMsg = t.camera?.confirmTurnOffCamera || "Tắt camera sẽ ngừng phát hiện cháy ở camera này. Bạn có chắc không?";
      if (!window.confirm(confirmMsg)) return;
    }

    const currentCam = cameras.find((c) => c.id === id);
    const prevActive = currentCam ? currentCam.is_active : !active;
    const prevStatus = currentCam ? currentCam.status : (prevActive ? "connected" : "disconnected");

    setToggling((prev) => ({ ...prev, [id]: true }));
    setCameras((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              is_active: active,
              status: active ? "connecting" : "disconnected",
            }
          : c,
      ),
    );
    try {
      const res = await fetch(
        `${API_URL}/cameras/${id}/toggle?active=${active}`,
        {
          method: "POST",
        },
      );
      if (!res.ok) {
        let errorMsg = t.camera?.toggleErrorNetwork || "Lỗi kết nối khi thay đổi trạng thái camera.";
        if (res.status === 401) {
          errorMsg = t.camera?.toggleError401 || "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
        } else if (res.status === 403) {
          errorMsg = t.camera?.toggleError403 || "Bạn không có quyền thực hiện thao tác này.";
        } else {
          try {
            const data = await res.json();
            if (data.detail) errorMsg = data.detail;
          } catch {}
        }
        throw new Error(errorMsg);
      }
    } catch (error: any) {
      setCameras((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, is_active: prevActive, status: prevStatus } : c,
        ),
      );
      alert(error.message || t.camera?.toggleErrorNetwork || "Lỗi kết nối khi thay đổi trạng thái camera.");
    } finally {
      setToggling((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await fetchCameras();
    }
  };

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-transparent text-gray-400 text-sm gap-3 py-10 min-h-[300px]">
        <div className="w-8 h-8 border-2 border-sky-500/20 border-t-sky-500 rounded-full animate-spin"></div>
        <div className="flex flex-col items-center gap-1">
          <span className="font-semibold text-white">{t.dashboard.systemInitializing}</span>
          <span className="text-xs text-sky-200/50">
            {t.dashboard.connectingAi}
          </span>
        </div>
      </div>
    );
  }

  const activeCount = cameras.filter(c => c.is_active && c.status === 'connected').length;

  let gridCols = "grid-cols-1";
  let itemsToRender = cameras;

  if (layoutMode === "1") {
    gridCols = "grid-cols-1";
    itemsToRender = cameras.slice(0, 1);
  } else if (layoutMode === "4") {
    gridCols = "grid-cols-1 md:grid-cols-2";
    itemsToRender = cameras.slice(0, 4);
  } else {
    // auto
    if (cameras.length === 1) gridCols = "grid-cols-1";
    else if (cameras.length === 2) gridCols = "grid-cols-1 md:grid-cols-2";
    else if (cameras.length === 3 || cameras.length === 4) gridCols = "grid-cols-1 md:grid-cols-2";
    else gridCols = "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"; // or whatever fits best
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center mb-4 px-2">
        <div>
          <h2 className="text-white font-bold text-lg">
            {t.camera.activeCameras} ({activeCount}/{cameras.length} running)
          </h2>
          <span className="text-xs text-sky-200/70">{t.camera.supportsBadConditions}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex bg-navy-900/50 rounded-lg p-0.5 border border-sky-900/30">
            <button
              onClick={() => setLayoutMode("auto")}
              className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${layoutMode === "auto" ? "bg-sky-500 text-white" : "text-sky-200 hover:text-white"}`}
            >
              Auto
            </button>
            <button
              onClick={() => setLayoutMode("1")}
              className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${layoutMode === "1" ? "bg-sky-500 text-white" : "text-sky-200 hover:text-white"}`}
            >
              1
            </button>
            <button
              onClick={() => setLayoutMode("4")}
              className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${layoutMode === "4" ? "bg-sky-500 text-white" : "text-sky-200 hover:text-white"}`}
            >
              4
            </button>
          </div>
          {canAnalyze && (
            <button
              onClick={() => setIsAnalyzerOpen(true)}
              className="px-3 py-1 bg-white hover:bg-gray-100 rounded text-xs text-navy-900 font-medium transition-colors"
            >
              {t.camera.analyzeVideo}
            </button>
          )}
          {canManage && (
            <button
              onClick={() => setIsAdding(true)}
              className="px-3 py-1 bg-sky-500 hover:bg-sky-400 rounded text-xs text-white font-medium transition-colors shadow-sm"
            >
              + {t.camera.addCamera}
            </button>
          )}
        </div>
      </div>

      {isAdding && canManage && (
        <div className="mb-4 p-4 bg-white border border-sky-100 rounded-xl space-y-3 shadow-sm animate-in slide-in-from-top-2">
          <h3 className="text-sm text-navy-900 font-medium">
            {t.camera.addCamera}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder={t.camera.cameraName}
              className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-navy-900 text-xs outline-none focus:border-sky-500"
              value={newCamName}
              onChange={(e) => setNewCamName(e.target.value)}
            />
            <input
              type="text"
              placeholder={t.camera.cameraSource}
              className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-navy-900 text-xs outline-none focus:border-sky-500"
              value={newCamSource}
              readOnly
              title="PC webcam (source 0)"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setIsAdding(false)}
              className="px-3 py-1 text-gray-500 hover:text-navy-900 text-xs font-medium"
            >
              {t.camera.cancel}
            </button>
            <button
              onClick={handleAddCamera}
              className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-medium"
            >
              {t.settings.save}
            </button>
          </div>
        </div>
      )}

      <div
        className={`grid gap-4 flex-1 min-h-0 overflow-y-auto ${gridCols} ${itemsToRender.length === 1 ? 'place-items-center' : ''}`}
      >
        {itemsToRender.map((cam, idx) => {
          const isSmoke = idx % 2 === 1;
          const boxType = isSmoke ? "SMOKE" : "FIRE";
          const boxColor = isSmoke ? "border-yellow-400 bg-yellow-400/10 text-yellow-400" : "border-red-500 bg-red-500/10 text-white";
          const labelBg = isSmoke ? "bg-yellow-400 text-black" : "bg-red-500 text-white";
          
          const topPos = 20 + Math.sin(time + idx) * 10;
          const leftPos = 20 + Math.cos(time + idx) * 10;
          const wSize = 30 + (idx * 5);
          const hSize = 40 + (idx * 2);
          const conf = (85 + (Math.sin(time * 0.5 + idx) * 10)).toFixed(1);

          return (
          <div
            key={cam.id}
            id={`cam-container-${cam.id}`}
            className={`relative rounded-xl overflow-hidden bg-[#0B2540] border border-sky-900/50 group shadow-sm flex items-center justify-center w-full ${itemsToRender.length === 1 ? 'max-w-[800px]' : ''}`}
            style={{ aspectRatio: '4/3' }}
          >
            {/* Controls Overlay */}
            <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
              {canToggle && (
                <button
                  role="switch"
                  aria-checked={cam.is_active}
                  onClick={() => handleToggleCamera(cam.id, !cam.is_active)}
                  disabled={!!toggling[cam.id]}
                  className="flex items-center gap-2 px-2 py-1 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 hover:border-white/30 transition-colors disabled:opacity-60"
                  title={cam.is_active ? "Turn camera off" : "Turn camera on"}
                >
                  <span
                    className={`text-[10px] font-bold font-mono ${cam.is_active ? "text-green-400" : "text-gray-400"}`}
                  >
                    {cam.is_active ? "ON" : "OFF"}
                  </span>
                  <span
                    className={`relative w-8 h-4 rounded-full transition-colors ${cam.is_active ? "bg-green-500" : "bg-gray-600"}`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${cam.is_active ? "translate-x-4" : ""}`}
                    />
                  </span>
                </button>
              )}

              <button
                onClick={() => toggleFullscreen(cam.id)}
                className="p-1.5 bg-black/60 backdrop-blur-md text-white rounded-lg border border-white/10 hover:bg-black/80 transition-all opacity-0 group-hover:opacity-100"
                title="Toàn màn hình"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
              </button>

              {canManage && cam.id !== 1 && (
                <button
                  onClick={() => handleDeleteCamera(cam.id)}
                  className="p-1.5 bg-red-500/80 text-white rounded hover:bg-red-500 transition-all opacity-0 group-hover:opacity-100"
                  title={t.camera.deleteVideo}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2v2"></path></svg>
                </button>
              )}
            </div>

            {/* Status Badge */}
            <div className="absolute top-2 left-2 z-20 flex items-center gap-2 px-2 py-1 bg-black/60 backdrop-blur-md rounded-lg border border-white/10">
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  !cam.is_active
                    ? "bg-gray-500"
                    : cam.status === "connected"
                      ? "bg-green-500 animate-pulse"
                      : cam.status === "connecting"
                        ? "bg-yellow-500 animate-bounce"
                        : "bg-red-500 animate-pulse"
                }`}
              ></div>
              <span className="text-[10px] font-semibold text-white/90 tracking-wide font-mono">
                {cam.name}{" "}
                {!cam.is_active
                  ? t.camera.inactive
                  : cam.status === "connecting"
                    ? t.camera.connecting
                    : cam.status === "disconnected"
                      ? t.camera.disconnected
                      : ""}
              </span>
            </div>

            {!cam.is_active ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-[#071728] text-sky-200/50 text-xs gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-40"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>
                <span className="font-medium font-sans">{t.camera.cameraIsInactive}</span>
                {canToggle && (
                  <button
                    onClick={() => handleToggleCamera(cam.id, true)}
                    disabled={!!toggling[cam.id]}
                    className="mt-1 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-[11px] font-medium transition-colors disabled:opacity-50"
                  >
                    {t.camera.turnOnCamera}
                  </button>
                )}
              </div>
            ) : cam.status === "disconnected" ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-[#0B2540] text-red-400 text-xs gap-2 relative">
                <div className="absolute inset-0 bg-red-900/10 pointer-events-none" />
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-55 animate-pulse z-10"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                <span className="font-semibold tracking-wide uppercase text-[10px] z-10">{t.camera.connectionLost}</span>
                <span className="text-[10px] text-red-300/50 z-10">{t.camera.reconnecting}</span>
                {canToggle && (
                  <button 
                    onClick={() => handleToggleCamera(cam.id, true)}
                    className="mt-2 px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-[11px] font-medium transition-colors z-10"
                  >
                    Reconnect
                  </button>
                )}
              </div>
            ) : cam.status === "connecting" ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-[#0B2540] text-yellow-400 text-xs gap-2">
                <div className="w-6 h-6 border-2 border-yellow-500/30 border-t-yellow-400 rounded-full animate-spin" />
                <span className="font-semibold tracking-wide uppercase text-[10px]">{t.camera.connecting}</span>
              </div>
            ) : (
              <div className="relative w-full h-full bg-[#071728]">
                {isMockData && (
                <div className="absolute inset-0 pointer-events-none z-10 p-4 overflow-hidden">
                   <div className={`absolute bottom-0 left-0 w-full h-1 ${isSmoke ? 'bg-yellow-400' : 'bg-red-500'} animate-pulse`}></div>
                   
                   <div 
                     className={`absolute border-2 ${boxColor} transition-all duration-1000 ease-in-out`}
                     style={{ top: `${topPos}%`, left: `${leftPos}%`, width: `${wSize}%`, height: `${hSize}%` }}
                   >
                     <div className={`absolute -top-5 left-[-2px] ${labelBg} text-[10px] font-bold px-1 py-0.5 whitespace-nowrap`}>
                       {boxType} ({conf}%)
                     </div>
                   </div>
                   
                   <div className="absolute bottom-4 right-4 bg-black/60 text-white text-[10px] px-2 py-1 rounded font-mono border border-white/10 backdrop-blur-sm">
                     {new Date().toLocaleTimeString()}
                   </div>
                </div>
                )}
                <img
                  src={`${API_URL}/video_feed/${cam.id}${streamToken ? `?token=${encodeURIComponent(streamToken)}` : ''}`}
                  alt={cam.name}
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    refreshStreamToken();
                    e.currentTarget.style.display = 'none';
                    e.currentTarget.parentElement!.style.backgroundImage = 'linear-gradient(45deg, #0f2027, #203a43, #2c5364)';
                  }}
                />
              </div>
            )}
          </div>
        )})}
      </div>

      <VideoAnalysisModal
        isOpen={isAnalyzerOpen}
        onClose={() => setIsAnalyzerOpen(false)}
      />
    </div>
  );
};

export default CameraGrid;
