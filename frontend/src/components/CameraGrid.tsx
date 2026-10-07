"use client";

import React, { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { API_URL } from "../config";
import VideoAnalysisModal from "./VideoAnalysisModal";

interface Camera {
  id: number;
  name: string;
  source: string;
  is_active: boolean;
  status: "connected" | "disconnected" | "connecting";
}

const CameraGrid = () => {
  const { t } = useLanguage();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newCamSource, setNewCamSource] = useState("");
  const [newCamName, setNewCamName] = useState("");
  const [loading, setLoading] = useState(true);
  const [isAnalyzerOpen, setIsAnalyzerOpen] = useState(false);
  const [toggling, setToggling] = useState<Record<number, boolean>>({});

  const fetchCameras = async () => {
    console.info("[Frontend Camera] Fetching camera statuses", {
      url: `${API_URL}/cameras`,
    });
    try {
      const res = await fetch(`${API_URL}/cameras`);
      console.info("[Frontend Camera] Camera status response", {
        status: res.status,
        ok: res.ok,
      });
      if (!res.ok) throw new Error("Backend responded with error");
      const data = await res.json();
      console.info("[Frontend Camera] Camera statuses received", {
        cameras: data.cameras.map((camera: Camera) => ({
          id: camera.id,
          name: camera.name,
          status: camera.status,
          active: camera.is_active,
        })),
      });
      setCameras(data.cameras);
      setLoading(false);
    } catch (error) {
      console.error("[Frontend Camera] Failed to fetch camera statuses", error);
      setLoading(true);
    }
  };

  useEffect(() => {
    fetchCameras();
    // Poll cameras status every 3 seconds
    const interval = setInterval(fetchCameras, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    cameras.forEach((camera) => {
      console.info("[Frontend Camera] Status update", {
        id: camera.id,
        name: camera.name,
        status: camera.status,
        active: camera.is_active,
        streamUrl: `${API_URL}/video_feed/${camera.id}`,
      });
    });
  }, [cameras]);

  const handleAddCamera = async () => {
    if (!newCamSource) return;

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
      setNewCamSource("");
      setNewCamName("");
      fetchCameras();
    } catch (e) {
      alert("Failed to add camera");
    }
  };

  const handleDeleteCamera = async (id: number) => {
    if (!confirm(t.camera.confirmDelete)) return;
    try {
      await fetch(`${API_URL}/cameras/${id}`, { method: "DELETE" });
      fetchCameras();
    } catch (e) {
      alert("Failed to delete");
    }
  };

  const handleToggleCamera = async (id: number, active: boolean) => {
    if (toggling[id]) return;
    setToggling((prev) => ({ ...prev, [id]: true }));
    // Optimistic update so the switch reacts instantly
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
      if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
    } catch (e) {
      alert("Failed to toggle camera status");
    } finally {
      setToggling((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      fetchCameras(); // resync with the real state
    }
  };

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#050505] text-gray-400 text-sm gap-3 py-10 min-h-[300px]">
        <div className="w-8 h-8 border-2 border-red-500/20 border-t-red-500 rounded-full animate-spin"></div>
        <div className="flex flex-col items-center gap-1">
          <span className="font-semibold text-white">System Initializing</span>
          <span className="text-xs text-gray-500">
            Connecting to AI server, please wait...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center mb-4 px-2">
        <h2 className="text-white font-bold">
          {t.camera.activeCameras} ({cameras.length})
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAnalyzerOpen(true)}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-500 rounded text-xs text-white transition-colors"
          >
            Analyze video
          </button>
          <button
            onClick={() => setIsAdding(true)}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white transition-colors"
          >
            + {t.camera.addCamera}
          </button>
        </div>
      </div>

      {/* Add Camera Form */}
      {isAdding && (
        <div className="mb-4 p-4 bg-gray-900 border border-white/10 rounded-xl space-y-3 animate-in slide-in-from-top-2">
          <h3 className="text-sm text-white font-medium">
            {t.camera.addCamera}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder={t.camera.cameraName}
              className="bg-black/20 border border-white/10 rounded px-3 py-2 text-white text-xs outline-none focus:border-blue-500"
              value={newCamName}
              onChange={(e) => setNewCamName(e.target.value)}
            />
            <input
              type="text"
              placeholder={t.camera.cameraSource}
              className="bg-black/20 border border-white/10 rounded px-3 py-2 text-white text-xs outline-none focus:border-blue-500"
              value={newCamSource}
              onChange={(e) => setNewCamSource(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setIsAdding(false)}
              className="px-3 py-1 text-gray-400 hover:text-white text-xs"
            >
              {t.camera.cancel}
            </button>
            <button
              onClick={handleAddCamera}
              className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded text-xs"
            >
              {t.settings.save}
            </button>
          </div>
        </div>
      )}

      <div
        className={`grid gap-4 flex-1 overflow-y-auto min-h-0 ${cameras.length <= 1 ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"}`}
      >
        {cameras.map((cam) => (
          <div
            key={cam.id}
            className="relative rounded-xl overflow-hidden bg-black border border-gray-800 group h-[200px] md:h-[250px]"
          >
            {/* Controls Overlay */}
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
              {/* ON / OFF switch (always visible) */}
              <button
                role="switch"
                aria-checked={cam.is_active}
                onClick={() => handleToggleCamera(cam.id, !cam.is_active)}
                disabled={!!toggling[cam.id]}
                className="flex items-center gap-2 px-2 py-1 bg-black/70 backdrop-blur-md rounded-lg border border-white/5 hover:border-white/20 transition-colors disabled:opacity-60"
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

              {/* Delete Button */}
              {cam.id !== 1 && ( // Protect default seeded camera
                <button
                  onClick={() => handleDeleteCamera(cam.id)}
                  className="p-1.5 bg-red-500/80 text-white rounded hover:bg-red-500 transition-all opacity-0 group-hover:opacity-100"
                  title={t.camera.deleteVideo}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              )}
            </div>

            {/* Status Badge */}
            <div className="absolute top-2 left-2 z-10 flex items-center gap-2 px-2 py-1 bg-black/70 backdrop-blur-md rounded-lg border border-white/5">
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
                  ? "(Inactive)"
                  : cam.status === "connecting"
                    ? "(Connecting...)"
                    : cam.status === "disconnected"
                      ? "(Disconnected)"
                      : ""}
              </span>
            </div>

            {/* Video Feed / Grey Screen / Error Placeholder */}
            {!cam.is_active ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gray-950 text-gray-500 text-xs gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="opacity-40"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                </svg>
                <span className="font-medium font-sans">
                  Camera is Inactive
                </span>
                <button
                  onClick={() => handleToggleCamera(cam.id, true)}
                  disabled={!!toggling[cam.id]}
                  className="mt-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded text-[11px] font-medium transition-colors disabled:opacity-50"
                >
                  Turn on camera
                </button>
              </div>
            ) : cam.status === "disconnected" ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-red-950/20 border border-red-500/10 text-red-400 text-xs gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="opacity-55 animate-pulse"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <span className="font-semibold tracking-wide uppercase text-[10px]">
                  Connection Lost
                </span>
                <span className="text-[10px] text-gray-500">
                  Reconnecting...
                </span>
              </div>
            ) : cam.status === "connecting" ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gray-950 text-yellow-400 text-xs gap-2">
                <div className="w-6 h-6 border-2 border-yellow-500/30 border-t-yellow-400 rounded-full animate-spin" />
                <span className="font-semibold tracking-wide uppercase text-[10px]">
                  Connecting...
                </span>
              </div>
            ) : (
              <img
                src={`${API_URL}/video_feed/${cam.id}`}
                alt={cam.name}
                className="w-full h-full object-cover"
                onLoad={(event) => {
                  console.info("[Frontend Camera] Stream image loaded", {
                    id: cam.id,
                    name: cam.name,
                    url: event.currentTarget.currentSrc,
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  });
                }}
                onError={(event) => {
                  console.error("[Frontend Camera] Stream image failed", {
                    id: cam.id,
                    name: cam.name,
                    url: event.currentTarget.currentSrc,
                    status: cam.status,
                  });
                }}
              />
            )}
          </div>
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
