/* eslint-disable */
"use client";

import React, { useEffect, useRef, useState } from "react";
import { startPolling } from "../lib/dashboardConnection";
import { authFetch } from "../lib/api/authFetch";
import { useLanguage } from "../context/LanguageContext";
import { API_URL } from "../config";
import { isMockData } from "../lib/api/client";
import VideoAnalysisModal from "./VideoAnalysisModal";
import CameraDetectionStatus, { useCameraDetections } from "./CameraDetectionStatus";
import { useAuth } from "../context/AuthContext";
import { isHlsSource, USE_DEMO_CAMERAS } from "../lib/demoCameras";

interface Camera {
  id: number;
  name: string;
  source: string;
  is_active: boolean;
  status: string;
}

const LAYOUTS = [4, 9, 16, 25] as const;
type LayoutSize = (typeof LAYOUTS)[number];

/**
 * Plays a public HLS (.m3u8) stream directly in the browser (view only, no AI).
 * Camera sources that are not http(s) .m3u8 URLs keep using the backend MJPEG feed.
 */
const HlsVideo = ({ src, label }: { src: string; label: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setFailed(false);
    let disposed = false;
    let hls: any = null;
    let retries = 0;

    const start = async () => {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;                       // Safari plays HLS natively
        video.onerror = () => !disposed && setFailed(true);
        video.play().catch(() => {});
        return;
      }
      const { default: Hls } = await import("hls.js");
      if (disposed) return;
      if (!Hls.isSupported()) { setFailed(true); return; }
      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
        if (!data.fatal || disposed) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retries++ < 3) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retries++ < 3) hls.recoverMediaError();
        else { hls.destroy(); setFailed(true); }
      });
    };
    start().catch(() => !disposed && setFailed(true));

    return () => { disposed = true; hls?.destroy(); video.removeAttribute("src"); video.load(); };
  }, [src]);

  return (
    <div className="relative w-full h-full bg-black">
      <video ref={videoRef} aria-label={label} className="w-full h-full object-cover bg-black" autoPlay muted playsInline />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-black text-[#ff5252] text-xs font-semibold tracking-wide uppercase">
          {"MẤT KẾT NỐI"}
        </div>
      )}
    </div>
  );
};

const CameraGrid = ({ cameraData, onRefresh }: { cameraData?: Camera[]; onRefresh?: () => void }) => {
  const detections = useCameraDetections();
  const { t } = useLanguage();
  const { user, can, streamToken, refreshStreamToken } = useAuth();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newCamSource, setNewCamSource] = useState("0");
  const [newCamName, setNewCamName] = useState("");
  const [loading, setLoading] = useState(true);
  const [layoutMode, setLayoutMode] = useState<LayoutSize>(4);
  const [now, setNow] = useState("");
  const [isAnalyzerOpen, setIsAnalyzerOpen] = useState(false);
  const [toggling, setToggling] = useState<Record<number, boolean>>({});
  const polling = useRef<ReturnType<typeof startPolling> | null>(null);

  const toggleFullscreen = (camId: number) => {
    const el = document.getElementById(`cam-container-${camId}`);
    if (!document.fullscreenElement) {
      el?.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen();
    }
  };

  const canManage = can("add_camera");
  const canToggle = !!user;
  const canAnalyze = user?.role === "admin" || user?.role === "user";

  const fetchCameras = () => { if (onRefresh) onRefresh(); else polling.current?.retry(); };

  useEffect(() => {
    if (cameraData !== undefined) { setCameras(cameraData); setLoading(false); }
  }, [cameraData]);

  // One shared clock for every tile's timestamp.
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleString("vi-VN"));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (onRefresh) return;
    const controller = startPolling<{ cameras: Camera[] }>({
      url: `${API_URL}/cameras`, interval: 3000, request: authFetch,
      onState: state => { if (state !== "loading") setLoading(false); },
      onData: data => {
        if (!Array.isArray(data.cameras)) throw new Error("Invalid cameras response");
        setCameras(data.cameras); setLoading(false);
      },
    });
    polling.current = controller;
    const recover = () => { if (!document.hidden) controller.retry(); };
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      controller.dispose(); polling.current = null;
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, [onRefresh]);

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

  // Same as the CCTV wall: a square grid (2x2, 3x3, 4x4, 5x5) that fills the panel.
  const side = Math.sqrt(layoutMode);
  const itemsToRender = cameras.slice(0, layoutMode);
  const emptySlots = layoutMode - itemsToRender.length;

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center mb-4 px-2">
        <div>
          <h2 className="text-white font-bold text-lg">
            {USE_DEMO_CAMERAS ? "CCTV MONITORING (DEMO)" : `${t.camera.activeCameras} (${activeCount}/${cameras.length} running)`}
          </h2>
          {!USE_DEMO_CAMERAS && <span className="text-xs text-sky-200/70">{t.camera.supportsBadConditions}</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {LAYOUTS.map(size => (
              <button
                key={size}
                onClick={() => setLayoutMode(size)}
                aria-pressed={layoutMode === size}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors text-white ${layoutMode === size ? "bg-[#3b63ff]" : "bg-[#3b63ff]/50 hover:bg-[#5678ff]"}`}
              >
                {size} CAM
              </button>
            ))}
          </div>
          {canAnalyze && (
            <button
              onClick={() => setIsAnalyzerOpen(true)}
              className="px-3 py-1 bg-white hover:bg-gray-100 rounded text-xs text-navy-900 font-medium transition-colors"
            >
              {t.camera.analyzeVideo}
            </button>
          )}
          {canManage && !USE_DEMO_CAMERAS && (
            <button
              onClick={() => setIsAdding(true)}
              className="px-3 py-1 bg-sky-500 hover:bg-sky-400 rounded text-xs text-white font-medium transition-colors shadow-sm"
            >
              + {t.camera.addCamera}
            </button>
          )}
        </div>
      </div>

      {isAdding && canManage && !USE_DEMO_CAMERAS && (
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
        className="grid gap-1 flex-1 min-h-0 overflow-hidden p-1"
        style={{ gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${side}, minmax(0, 1fr))` }}
      >
        {itemsToRender.map((cam) => (
          <div
            key={cam.id}
            id={`cam-container-${cam.id}`}
            onDoubleClick={() => toggleFullscreen(cam.id)}
            className="relative bg-black border border-[#1f3251] overflow-hidden group min-h-0 min-w-0"
          >
            {/* Header bar (name + controls) */}
            <div className="absolute left-0 top-0 right-0 z-20 h-8 flex items-center justify-between px-2.5 bg-black/45 text-white">
              <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
                <span
                  className={`shrink-0 w-2 h-2 rounded-full ${
                    !cam.is_active
                      ? "bg-gray-500"
                      : cam.status === "connected"
                        ? "bg-[#0fd36a]"
                        : cam.status === "connecting"
                          ? "bg-yellow-500 animate-bounce"
                          : "bg-red-500 animate-pulse"
                  }`}
                />
                <span className="truncate">
                  {cam.name}
                  {!cam.is_active
                    ? ` · ${t.camera.inactive}`
                    : cam.status === "connecting"
                      ? ` · ${t.camera.connecting}`
                      : cam.status === "disconnected"
                        ? ` · ${t.camera.disconnected}`
                        : ""}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {canToggle && (
                  <button
                    role="switch"
                    aria-checked={cam.is_active}
                    onClick={() => handleToggleCamera(cam.id, !cam.is_active)}
                    disabled={!!toggling[cam.id]}
                    className="flex items-center gap-1.5 disabled:opacity-60"
                    title={cam.is_active ? "Turn camera off" : "Turn camera on"}
                  >
                    <span className={`text-[10px] font-bold font-mono ${cam.is_active ? "text-green-400" : "text-gray-400"}`}>
                      {cam.is_active ? "ON" : "OFF"}
                    </span>
                    <span className={`relative w-7 h-3.5 rounded-full transition-colors ${cam.is_active ? "bg-green-500" : "bg-gray-600"}`}>
                      <span className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform ${cam.is_active ? "translate-x-3.5" : ""}`} />
                    </span>
                  </button>
                )}
                {canManage && cam.id !== 1 && (
                  <button
                    onClick={() => handleDeleteCamera(cam.id)}
                    className="text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity"
                    title={t.camera.deleteVideo}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                )}
                <button
                  onClick={() => toggleFullscreen(cam.id)}
                  className="text-base leading-none hover:text-sky-300"
                  title="Toàn màn hình"
                >
                  ⛶
                </button>
              </div>
            </div>

            {cam.is_active && !isMockData && cam.status === "connected" && !isHlsSource(cam.source) && <CameraDetectionStatus state={detections[cam.id]} />}

            {!cam.is_active ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-[#071728] text-sky-200/50 text-xs gap-2">
                <span className="font-medium font-sans">{t.camera.cameraIsInactive}</span>
                {canToggle && (
                  <button
                    onClick={() => handleToggleCamera(cam.id, true)}
                    disabled={!!toggling[cam.id]}
                    className="px-3 py-1.5 bg-[#3b63ff] hover:bg-[#5678ff] text-white rounded text-[11px] font-medium transition-colors disabled:opacity-50"
                  >
                    {t.camera.turnOnCamera}
                  </button>
                )}
              </div>
            ) : cam.status === "disconnected" ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-black text-[#ff5252] text-xs gap-1">
                <span className="font-semibold tracking-wide uppercase">{t.camera.connectionLost}</span>
                <span className="text-[10px] text-red-300/60">{t.camera.reconnecting}</span>
                {canToggle && (
                  <button
                    onClick={() => handleToggleCamera(cam.id, true)}
                    className="mt-1 px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-[11px] font-medium transition-colors"
                  >
                    Reconnect
                  </button>
                )}
              </div>
            ) : cam.status === "connecting" ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-black text-yellow-400 text-xs gap-2">
                <div className="w-6 h-6 border-2 border-yellow-500/30 border-t-yellow-400 rounded-full animate-spin" />
                <span className="font-semibold tracking-wide uppercase text-[10px]">{t.camera.connecting}</span>
              </div>
            ) : isHlsSource(cam.source) ? (
              <HlsVideo key={cam.source} src={cam.source} label={cam.name} />
            ) : (
              <div className="relative w-full h-full bg-black">
                <img
                  key={streamToken}
                  src={streamToken ? `${API_URL}/video_feed/${cam.id}?token=${encodeURIComponent(streamToken)}` : undefined}
                  alt={cam.name}
                  className="w-full h-full object-contain bg-black"
                  onError={(e) => {
                    refreshStreamToken();
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            )}

            {/* Timestamp */}
            <div className="absolute right-2.5 bottom-2.5 z-20 text-white text-xs bg-black/50 px-2 py-0.5 rounded pointer-events-none">
              {now}
            </div>
          </div>
        ))}

        {/* Empty slots keep the grid shape */}
        {Array.from({ length: emptySlots }, (_, i) => (
          <div key={`empty-${i}`} className="bg-black border border-[#1f3251] min-h-0 min-w-0" />
        ))}
      </div>

      <VideoAnalysisModal
        isOpen={isAnalyzerOpen}
        onClose={() => setIsAnalyzerOpen(false)}
      />
    </div>
  );
};

export default CameraGrid;
