"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { WS_URL } from "../config";

interface CameraDetection {
  camera_id: number; stale: boolean; confirmed: string[];
  detections: { class: string; confidence: number }[]; latency_ms?: number;
  generation?: number; capture_frame_id?: number; frame_fresh?: boolean; frame_age_ms?: number | null;
}
export function useCameraDetections(enabled = true) {
  const { streamToken, refreshStreamToken } = useAuth();
  const [states, setStates] = useState<Record<number, CameraDetection>>({});
  const [stateToken, setStateToken] = useState<string | null>(null);
  useEffect(() => {
    if (!streamToken || !enabled) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let receivedAt = 0;
    const connect = () => {
      socket = new WebSocket(`${WS_URL}/ws/detections?token=${encodeURIComponent(streamToken)}`);
      socket.onmessage = (event) => {
        if (disposed || event.target !== socket) return;
        try {
          const data: { cameras: CameraDetection[] } = JSON.parse(event.data);
          receivedAt = Date.now();
          setStateToken(streamToken);
          setStates(Object.fromEntries(data.cameras.map(camera => [camera.camera_id, camera])));
        } catch { setStates({}); }
      };
      socket.onclose = async (event) => {
        if (disposed || event.target !== socket) return;
        setStates({});
        if (event.code === 1008) {
          try { await refreshStreamToken(); } catch { /* Retry the transport below. */ }
        }
        if (!disposed) retry = setTimeout(connect, 1500);
      };
      socket.onerror = event => { if (!disposed && event.target === socket) socket?.close(); };
    };
    connect();
    const expiry = setInterval(() => { if (Date.now() - receivedAt > 1500) setStates({}); }, 500);
    return () => { disposed = true; clearTimeout(retry); clearInterval(expiry); socket?.close(); };
  }, [streamToken, refreshStreamToken, enabled]);
  return streamToken && enabled && stateToken === streamToken ? states : {};
}

export default function CameraDetectionStatus({ state }: { state?: CameraDetection }) {
  const names = state && !state.stale ? Array.from(new Set(state.detections.map(detection => detection.class))) : [];
  return <div className="absolute bottom-3 left-3 z-20 max-w-[90%] rounded-lg bg-black/80 px-3 py-2 text-xs text-white pointer-events-none" aria-live="polite">
    {!state || state.stale ? "AI: waiting for fresh detection" : names.length ? names.map(name => {
      const confidence = Math.max(...state.detections.filter(d => d.class === name).map(d => d.confidence));
      return `${name.toUpperCase()} ${(confidence * 100).toFixed(0)}%${state.confirmed.includes(name) ? " confirmed" : " confirming…"}`;
    }).join(" · ") : "AI: no fire or smoke detected"}
    {state && !state.stale && <span className="ml-2 text-gray-300">{state.latency_ms} ms</span>}
  </div>;
}
