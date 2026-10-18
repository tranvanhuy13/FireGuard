/* eslint-disable */
/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import React, { useCallback, useEffect, useState } from "react";
import { API_URL } from "../config";
import { useAuth } from "../context/AuthContext";

interface CameraInfo {
  id: number;
  name: string;
  is_active: boolean;
  status: "connected" | "disconnected" | "connecting";
}

const VideoFeed = () => {
  const { streamToken, refreshStreamToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [camera, setCamera] = useState<CameraInfo | null>(null);
  const [toggling, setToggling] = useState(false);
  const [streamKey, setStreamKey] = useState(0);

  // /video_feed always streams the first camera, so we control that same camera here.
  // The key forces the <img> to open a fresh stream after the camera is turned back on.
  const videoUrl = `${API_URL}/video_feed?k=${streamKey}${streamToken ? `&token=${encodeURIComponent(streamToken)}` : ''}`;

  const fetchCamera = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/cameras`);
      if (!res.ok) return;
      const data = await res.json();
      setCamera(data.cameras?.[0] ?? null);
    } catch (e) {
      // Backend unreachable: keep the last known state
    }
  }, []);

  useEffect(() => {
    fetchCamera();
    const interval = setInterval(fetchCamera, 3000);
    return () => clearInterval(interval);
  }, [fetchCamera]);

  const handleToggle = async (active: boolean) => {
    if (!camera || toggling) return;
    setToggling(true);
    // Optimistic update so the switch reacts instantly
    setCamera({
      ...camera,
      is_active: active,
      status: active ? "connecting" : "disconnected",
    });
    if (active) {
      setLoading(true);
      setStreamKey((k) => k + 1);
    }
    try {
      const res = await fetch(
        `${API_URL}/cameras/${camera.id}/toggle?active=${active}`,
        {
          method: "POST",
        },
      );
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || error.message || `Backend responded with ${res.status}`);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to toggle camera status");
    } finally {
      setToggling(false);
      fetchCamera(); // resync with the real state
    }
  };

  // Before the first response we assume "on" so the feed behaves as it did before.
  const isActive = camera ? camera.is_active : true;
  const status = camera?.status ?? "connected";
  const name = camera?.name ?? "Live Camera";

  const dotClass = !isActive
    ? "bg-gray-500"
    : status === "connected"
      ? "bg-green-500 animate-pulse"
      : status === "connecting"
        ? "bg-yellow-500 animate-bounce"
        : "bg-red-500 animate-pulse";

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden shadow-2xl border border-gray-800 bg-black">
      {/* Header Overlay: camera name + status */}
      <div className="absolute top-4 left-4 z-10 hidden md:block">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-full border border-white/10">
          <div className={`w-2 h-2 rounded-full ${dotClass}`} />
          <span className="text-xs font-semibold text-white tracking-widest uppercase">
            {name}
            {!isActive
              ? " (Off)"
              : status === "disconnected"
                ? " (Disconnected)"
                : ""}
          </span>
        </div>
      </div>

      {/* ON / OFF switch (always visible, also on mobile) */}
      {camera && (
        <div className="absolute top-4 right-4 z-10">
          <button
            role="switch"
            aria-checked={isActive}
            onClick={() => handleToggle(!isActive)}
            disabled={toggling}
            title={isActive ? "Turn camera off" : "Turn camera on"}
            className="flex items-center gap-2 px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-full border border-white/10 hover:border-white/30 transition-colors disabled:opacity-60"
          >
            <span
              className={`text-xs font-bold font-mono ${isActive ? "text-green-400" : "text-gray-400"}`}
            >
              {isActive ? "ON" : "OFF"}
            </span>
            <span
              className={`relative w-9 h-5 rounded-full transition-colors ${isActive ? "bg-green-500" : "bg-gray-600"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${isActive ? "translate-x-4" : ""}`}
              />
            </span>
          </button>
        </div>
      )}

      {/* Video Stream / Off placeholder */}
      <div className="w-full h-full flex items-center justify-center bg-gray-900">
        {isActive ? (
          <>
            <img
              key={streamKey}
              src={videoUrl}
              alt="Live Video Stream"
              className="w-full h-full object-contain"
              onLoad={() => setLoading(false)}
              onError={() => {
                refreshStreamToken();
                setLoading(true);
              }}
            />

            {(loading || status !== "connected") && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50 gap-2 bg-gray-900/60">
                <div className="w-8 h-8 border-2 border-red-500/50 border-t-red-500 rounded-full animate-spin" />
                <span className="text-sm">
                  {status === "disconnected"
                    ? "Connection lost. Reconnecting..."
                    : "Connecting..."}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 text-gray-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="opacity-40"
            >
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
              <line x1="12" y1="2" x2="12" y2="12" />
            </svg>
            <span className="text-sm font-medium">Camera is off</span>
            <button
              onClick={() => handleToggle(true)}
              disabled={toggling}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
            >
              Turn on camera
            </button>
          </div>
        )}
      </div>

      {/* Footer Overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
        <div className="flex justify-between items-end">
          <div className="text-xs text-gray-400 font-mono">
            FPS: 30 | RES: 1080p | AI: YOLOv8
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoFeed;
