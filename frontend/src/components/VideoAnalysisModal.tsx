"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, WS_URL } from "../config";

interface Detection { class: string; confidence: number; bbox: number[] }
interface AnalysisEvent { time: number; class: string; confidence: number; snapshot: string }
interface Job {
  id: string; filename: string; status: "queued" | "processing" | "paused" | "done" | "error" | "cancelled";
  progress: number | null; duration: number | null; current_time: number; sample_fps: number;
  frames_analyzed: number; effective_fps: number; buffering: boolean; frame?: string | null;
  detections: Detection[]; confirmed: string[]; events: AnalysisEvent[];
  summary: Record<string, { samples: number; max_confidence: number; first_time: number }>;
  verdict: string | null; error: string | null;
}
const terminal = (status?: string) => ["done", "error", "cancelled"].includes(status ?? "");
const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
const button = "px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 text-sm";

export default function VideoAnalysisModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sampleFps, setSampleFps] = useState("10");
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [lightbox, setLightbox] = useState<AnalysisEvent | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const jobRef = useRef<Job | null>(null);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const frameReceivedRef = useRef(0);
  const [waitingForFrame, setWaitingForFrame] = useState(false);
  const active = !!job && !terminal(job.status);

  const watch = useCallback((id: string) => {
    generationRef.current += 1;
    jobRef.current = null;
    setJob(null);
    setConnected(false);
    const placeholder: Job = {
      id, filename: "", status: "queued", progress: 0, duration: null,
      current_time: 0, sample_fps: 10, frames_analyzed: 0, effective_fps: 0,
      buffering: false, detections: [], confirmed: [], events: [], summary: {},
      verdict: null, error: null,
    };
    jobRef.current = placeholder;
    setJob(placeholder);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      xhrRef.current?.abort();
      socketRef.current?.close();
      const current = jobRef.current;
      if (current && !terminal(current.status)) {
        void fetch(`${API_URL}/video-analysis/${current.id}/playback`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pause" }), keepalive: true,
        }).catch(() => {});
      }
    };
  }, []);

  const jobId = job?.id;
  useEffect(() => {
    if (!isOpen || !jobId) return;
    const generation = generationRef.current;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | null = null;
    const connect = () => {
      setConnected(false);
      socket = new WebSocket(`${WS_URL}/ws/video-analysis/${jobId}`);
      socketRef.current = socket;
      socket.onopen = () => { if (!disposed && generation === generationRef.current) { setConnected(true); setError(null); } };
      socket.onmessage = (event) => {
        if (disposed || generation !== generationRef.current) return;
        try {
          const next: Job = JSON.parse(event.data);
          const previous = jobRef.current;
          const merged = { ...next, frame: next.frame === undefined ? previous?.frame : next.frame };
          if (next.frame) frameReceivedRef.current = Date.now();
          jobRef.current = merged;
          setJob(merged);
        } catch { setError("Invalid playback update received."); }
      };
      socket.onclose = (event) => {
        if (disposed || generation !== generationRef.current) return;
        setConnected(false);
        if (event.code === 1008) { setError("This video has expired. Upload it again."); return; }
        if (!terminal(jobRef.current?.status)) {
          setError("Playback disconnected. Reconnecting...");
          retry = setTimeout(connect, 1500);
        }
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => { disposed = true; clearTimeout(retry); socket?.close(); };
  }, [isOpen, jobId]);

  useEffect(() => {
    const timer = setInterval(() => {
      setWaitingForFrame(jobRef.current?.status === "processing" && Date.now() - frameReceivedRef.current > 1200);
    }, 300);
    return () => clearInterval(timer);
  }, []);

  const close = () => {
    xhrRef.current?.abort();
    const current = jobRef.current;
    if (current && !terminal(current.status)) {
      void fetch(`${API_URL}/video-analysis/${current.id}/playback`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pause" }),
      }).catch(() => {});
    }
    onClose();
  };

  const start = () => {
    if (!file) return;
    setError(null); setJob(null); jobRef.current = null; setUploadPct(0);
    const form = new FormData();
    form.append("file", file); form.append("sample_fps", sampleFps);
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", `${API_URL}/video-analysis`);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) setUploadPct(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => {
      xhrRef.current = null;
      if (!mountedRef.current) return;
      setUploadPct(null);
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300) throw new Error(data.detail ?? "Upload failed");
        frameReceivedRef.current = Date.now();
        watch(data.job_id);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Upload failed"); }
    };
    xhr.onerror = () => { xhrRef.current = null; setUploadPct(null); setError("Could not reach the server."); };
    xhr.onabort = () => { xhrRef.current = null; if (mountedRef.current) setUploadPct(null); };
    xhr.send(form);
  };

  const control = async (action: "pause" | "resume" | "restart" | "cancel") => {
    if (!jobId || controlling) return;
    const generation = generationRef.current;
    setControlling(true); setError(null);
    try {
      const response = await fetch(`${API_URL}/video-analysis/${jobId}/${action === "cancel" ? "cancel" : "playback"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        ...(action !== "cancel" ? { body: JSON.stringify({ action }) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail ?? "Playback command failed");
      if (!mountedRef.current || generation !== generationRef.current) return;
      if (action === "restart") watch(data.job_id);
    } catch (cause) { if (mountedRef.current) setError(cause instanceof Error ? cause.message : "Playback command failed"); }
    finally { if (mountedRef.current) setControlling(false); }
  };

  const reset = () => {
    generationRef.current += 1;
    jobRef.current = null; socketRef.current?.close();
    setJob(null); setFile(null); setError(null); setLightbox(null);
  };

  if (!isOpen) return null;
  const events = job?.events ?? [];
  const buffering = active && job?.status === "processing" && (job.buffering || waitingForFrame);
  const confirmed = job?.confirmed ?? [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <section role="dialog" aria-modal="true" aria-label="Analyze Video" className="bg-[#0a0a0a] text-white border border-white/10 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <header className="p-5 border-b border-white/10 flex justify-between gap-4">
          <div><h2 className="text-xl font-bold">Analyze Video</h2><p className="text-xs text-gray-400 mt-1">Watch fire and smoke detection during playback. Video checks do not send camera alarms.</p></div>
          <button onClick={close} className={button} aria-label="Close video analysis">Close</button>
        </header>
        <div className="p-5 overflow-y-auto space-y-4">
          {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
          {!job && uploadPct === null && <>
            <label className="block p-6 rounded-xl border border-dashed border-white/25 cursor-pointer text-sm">
              Choose video (MP4, AVI, MOV, MKV, WEBM; up to 500 MB)
              <input type="file" accept="video/*,.mkv,.avi,.wmv" className="block mt-3 w-full" onChange={(event) => {
                const selected = event.target.files?.[0];
                if (!selected) return;
                if (selected.size > 500 * 1024 * 1024) { setError("Maximum upload size is 500 MB."); return; }
                setFile(selected); setError(null);
              }} />
            </label>
            <label className="block text-sm">Detection updates per second
              <select value={sampleFps} onChange={(event) => setSampleFps(event.target.value)} className="ml-3 p-2 bg-gray-900 rounded">
                <option value="5">5 FPS</option><option value="10">10 FPS</option><option value="15">15 FPS</option>
              </select>
            </label>
          </>}
          {uploadPct !== null && <p role="status">Uploading… {uploadPct}%</p>}
          {job && <>
            <div className="relative bg-black rounded-xl overflow-hidden aspect-video flex items-center justify-center">
              {job.frame ? <img src={`data:image/jpeg;base64,${job.frame}`} alt={`Analyzed video at ${formatTime(job.current_time ?? 0)}`} className="w-full h-full object-contain" /> : <p className="text-gray-400">{job.status === "paused" ? "Paused" : "Waiting for first analyzed frame…"}</p>}
              <div className="absolute top-3 left-3 bg-black/80 rounded px-3 py-2 text-xs" aria-live="polite">
                {job.status === "paused" ? "Paused" : job.status === "done" ? "Playback complete" : buffering ? "Buffering / inference below playback rate" : job.status === "queued" ? "Queued" : job.status === "processing" ? "Detecting" : job.status}
                <span className="ml-3">{job.effective_fps ?? 0} FPS</span>
              </div>
              <div className="absolute bottom-3 left-3 flex gap-2">
                {confirmed.map(name => <span key={name} className={`rounded px-3 py-1 text-xs font-bold ${name === "fire" ? "bg-red-600" : "bg-amber-600"}`}>{name.toUpperCase()} CONFIRMED</span>)}
              </div>
            </div>
            <div className="flex flex-wrap justify-between gap-3 text-sm text-gray-400">
              <span>{formatTime(job.current_time ?? 0)} / {job.duration ? formatTime(job.duration) : "--:--"}</span>
              <span>{job.frames_analyzed ?? 0} frames checked · {active ? connected ? "Connected" : "Connecting…" : "Finished"}</span>
            </div>
            <progress className="w-full h-2 accent-amber-500" max={1} value={job.progress ?? undefined} aria-label="Analysis progress" />
            <div className="flex flex-wrap gap-2">
              {active && <button className={button} disabled={controlling} onClick={() => control(job.status === "paused" ? "resume" : "pause")}>{job.status === "paused" ? "Play" : "Pause"}</button>}
              <button className={button} disabled={controlling} onClick={() => control("restart")}>Restart</button>
              {active && <button className={button} disabled={controlling} onClick={() => control("cancel")}>Stop</button>}
            </div>
            {!!job.detections?.length && <p className="text-sm text-amber-300">{Array.from(new Set(job.detections.map(d => d.class))).map(name => {
              const confidence = Math.max(...job.detections.filter(d => d.class === name).map(d => d.confidence));
              return `${name}: ${(confidence * 100).toFixed(0)}%${confirmed.includes(name) ? "" : " (confirming…)"}`;
            }).join(" · ")}</p>}
            {job.status === "error" && <p role="alert" className="text-red-400">{job.error}</p>}
            {job.status === "done" && <div className="p-3 bg-white/5 rounded-lg text-sm">
              {Object.keys(job.summary ?? {}).length ? Object.entries(job.summary).map(([name, info]) => <p key={name}>{name.toUpperCase()} — first at {formatTime(info.first_time)}, maximum confidence {(info.max_confidence * 100).toFixed(1)}%</p>) : "No fire or smoke confirmed in the analyzed frames."}
            </div>}
            {events.length > 0 && <div><h3 className="text-sm mb-2">Detection timeline — select an event to view its evidence</h3>
              <div className="flex gap-3 overflow-x-auto pb-2">{events.map((event, index) => <button key={index} onClick={() => setLightbox(event)} className="shrink-0 w-36 text-left rounded-lg overflow-hidden border border-white/15">
                <img src={`${API_URL}${event.snapshot}`} alt={`${event.class} evidence`} className="w-full h-20 object-cover" />
                <span className="block p-2 text-xs">{formatTime(event.time)} · {event.class} {(event.confidence * 100).toFixed(0)}%</span>
              </button>)}</div>
            </div>}
          </>}
        </div>
        <footer className="p-5 border-t border-white/10 flex justify-end gap-3">
          {uploadPct !== null ? <button className={button} onClick={() => xhrRef.current?.abort()}>Cancel upload</button> : !job ? <button className={button} disabled={!file} onClick={start}>Upload and play</button> : terminal(job.status) ? <button className={button} onClick={reset}>Analyze another video</button> : null}
        </footer>
      </section>
      {lightbox && <button className="fixed inset-0 z-[60] bg-black/95 p-6 flex flex-col items-center justify-center" onClick={() => setLightbox(null)} aria-label="Close evidence image">
        <img src={`${API_URL}${lightbox.snapshot}`} alt={`${lightbox.class} at ${formatTime(lightbox.time)}`} className="max-w-full max-h-[80vh] object-contain" />
        <span className="text-white mt-3">{formatTime(lightbox.time)} · {lightbox.class} · click to close</span>
      </button>}
    </div>
  );
}
