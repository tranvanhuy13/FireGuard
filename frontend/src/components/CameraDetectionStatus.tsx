"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { WS_URL } from "../config";

interface CameraDetection {
  camera_id: number; stale: boolean; confirmed: string[];
  detections: { class: string; confidence: number }[]; latency_ms?: number;
}
export function useCameraDetections() {
  const { streamToken, refreshStreamToken } = useAuth();
  const [states, setStates] = useState<Record<number, CameraDetection>>({});
  useEffect(() => {
    if (!streamToken) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let receivedAt = 0;
    const connect = () => {
      socket = new WebSocket(`${WS_URL}/ws/detections?token=${encodeURIComponent(streamToken)}`);
      socket.onmessage = (event) => {
        if (disposed) return;
        try {
          const data: { cameras: CameraDetection[] } = JSON.parse(event.data);
          receivedAt = Date.now();
          setStates(Object.fromEntries(data.cameras.map(camera => [camera.camera_id, camera])));
        } catch { setStates({}); }
      };
      socket.onclose = (event) => {
        if (!disposed && event.code === 1008) { setStates({}); void refreshStreamToken(); return; }
        if (!disposed) { setStates({}); retry = setTimeout(connect, 1500); }
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    const expiry = setInterval(() => { if (Date.now() - receivedAt > 1500) setStates({}); }, 500);
    return () => { disposed = true; clearTimeout(retry); clearInterval(expiry); socket?.close(); };
  }, [streamToken, refreshStreamToken]);
  return states;
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
