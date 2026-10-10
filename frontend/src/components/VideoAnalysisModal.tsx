/* eslint-disable */
"use client";

import React, { useEffect, useRef, useState } from "react";
import { API_URL } from "../config";

interface AnalysisEvent {
  time: number;
  class: string;
  confidence: number;
  snapshot: string;
}

interface ClassSummary {
  samples: number;
  max_confidence: number;
  first_time: number | null;
}

interface Job {
  id: string;
  filename: string;
  status: "queued" | "processing" | "done" | "error" | "cancelled";
  progress: number | null;
  sample_fps: number;
  duration: number | null;
  frames_analyzed: number;
  verdict: "fire" | "smoke" | "detected" | "none" | null;
  summary: Record<string, ClassSummary>;
  events: AnalysisEvent[];
  error: string | null;
}

interface VideoAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_MB = 500;

const formatTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

const VERDICTS = {
  fire: {
    text: "FIRE DETECTED",
    style: "bg-red-500/15 border-red-500/40 text-red-400",
  },
  smoke: {
    text: "SMOKE DETECTED",
    style: "bg-orange-500/15 border-orange-500/40 text-orange-400",
  },
  detected: {
    text: "OBJECTS DETECTED",
    style: "bg-amber-500/15 border-amber-500/40 text-amber-400",
  },
  none: {
    text: "NO FIRE OR SMOKE DETECTED",
    style: "bg-green-500/15 border-green-500/40 text-green-400",
  },
} as const;

const VideoAnalysisModal = ({ isOpen, onClose }: VideoAnalysisModalProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [sampleFps, setSampleFps] = useState("5");
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopPolling();
      xhrRef.current?.abort();
    };
  }, []);

  const pollJob = (jobId: string) => {
    stopPolling();
    const tick = async () => {
      try {
        const res = await fetch(`${API_URL}/video-analysis/${jobId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Job = await res.json();
        setJob(data);
        if (["done", "error", "cancelled"].includes(data.status)) stopPolling();
      } catch (e) {
        setError("Lost connection to the server.");
        stopPolling();
      }
    };
    tick();
    pollRef.current = setInterval(tick, 1000);
  };

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`Video is too large (max ${MAX_MB} MB).`);
      return;
    }
    setError(null);
    setJob(null);
    setFile(f);
  };

  const startAnalysis = () => {
    if (!file) return;
    setError(null);
    setJob(null);
    setUploadPct(0);

    const form = new FormData();
    form.append("file", file);
    form.append("sample_fps", sampleFps);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", `${API_URL}/video-analysis`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        setUploadPct(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      xhrRef.current = null;
      setUploadPct(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          pollJob(JSON.parse(xhr.responseText).job_id);
        } catch {
          setError("Unexpected response from the server.");
        }
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try {
          const detail = JSON.parse(xhr.responseText).detail;
          if (typeof detail === "string") msg = detail;
        } catch {}
        setError(msg);
      }
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      setUploadPct(null);
      setError("Could not reach the server.");
    };
    xhr.onabort = () => {
      xhrRef.current = null;
      setUploadPct(null);
    };
    xhr.send(form);
  };

  const cancel = async () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      return;
    }
    if (!job) return;
    try {
      await fetch(`${API_URL}/video-analysis/${job.id}/cancel`, {
        method: "POST",
      });
    } catch (e) {
      setError("Failed to cancel.");
    }
  };

  const reset = () => {
    stopPolling();
    setFile(null);
    setJob(null);
    setError(null);
    setUploadPct(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  if (!isOpen) return null;

  const uploading = uploadPct !== null;
  const running =
    !!job && (job.status === "queued" || job.status === "processing");
  const busy = uploading || running;
  const finished = !!job && ["done", "error", "cancelled"].includes(job.status);
  const verdict =
    job?.status === "done" && job.verdict ? VERDICTS[job.verdict] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={`${API_URL}${lightbox}`}
            alt="Detection snapshot"
            className="max-w-full max-h-full rounded-xl border border-white/10"
          />
        </div>
      )}

      <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Analyze Video</h2>
            <p className="text-xs text-gray-500 mt-1">
              Checks an uploaded video for fire and smoke with the same AI model
              and settings as the live cameras. No alerts are sent.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto min-h-0">
          {error && (
            <div className="p-3 rounded text-sm bg-red-500/10 text-red-400">
              {error}
            </div>
          )}

          {/* Picker */}
          {!busy && !finished && (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  pickFile(e.dataTransfer.files?.[0] ?? null);
                }}
                onClick={() => inputRef.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                  dragOver
                    ? "border-amber-500 bg-amber-500/5"
                    : "border-white/10 hover:border-white/30"
                }`}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="video/*,.mkv"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <div className="space-y-1">
                    <p className="text-sm text-white font-medium break-all">
                      {file.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {(file.size / (1024 * 1024)).toFixed(1)} MB - click to
                      choose another
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm text-white font-medium">
                      Drop a video here or click to browse
                    </p>
                    <p className="text-xs text-gray-500">
                      MP4, AVI, MOV, MKV, WEBM - up to {MAX_MB} MB
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-400 font-medium">
                  Analysis speed
                </label>
                <select
                  value={sampleFps}
                  onChange={(e) => setSampleFps(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white text-sm focus:border-amber-500 outline-none"
                >
                  <option value="2">Fast - 2 frames per second</option>
                  <option value="5">Normal - 5 frames per second</option>
                  <option value="10">Thorough - 10 frames per second</option>
                </select>
              </div>
            </>
          )}

          {/* Upload / analysis progress */}
          {busy && (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-white font-medium">
                  {uploading
                    ? `Uploading... ${uploadPct}%`
                    : job?.status === "queued"
                      ? "Waiting for another analysis to finish..."
                      : `Analyzing... ${job?.progress != null ? Math.round(job.progress * 100) + "%" : ""}`}
                </span>
                {job && !uploading && (
                  <span className="text-xs text-gray-500 font-mono">
                    {job.frames_analyzed} frames checked
                  </span>
                )}
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-amber-500 transition-all duration-300 ${
                    !uploading && job?.progress == null
                      ? "w-full animate-pulse"
                      : ""
                  }`}
                  style={
                    uploading
                      ? { width: `${uploadPct}%` }
                      : job?.progress != null
                        ? { width: `${Math.round(job.progress * 100)}%` }
                        : undefined
                  }
                />
              </div>
              {job && job.events.length > 0 && (
                <p className="text-xs text-red-400">
                  {job.events.length} detection
                  {job.events.length > 1 ? "s" : ""} so far...
                </p>
              )}
            </div>
          )}

          {/* Result */}
          {job?.status === "done" && verdict && (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-xl border text-center font-bold tracking-wide ${verdict.style}`}
              >
                {verdict.text}
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-lg bg-white/5">
                  <div className="text-xs text-gray-500">Duration</div>
                  <div className="text-sm text-white font-mono">
                    {job.duration ? formatTime(job.duration) : "-"}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-white/5">
                  <div className="text-xs text-gray-500">Frames checked</div>
                  <div className="text-sm text-white font-mono">
                    {job.frames_analyzed}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-white/5">
                  <div className="text-xs text-gray-500">Checked at</div>
                  <div className="text-sm text-white font-mono">
                    {job.sample_fps} fps
                  </div>
                </div>
              </div>

              {Object.keys(job.summary).length > 0 && (
                <div className="space-y-2">
                  {(
                    Object.entries(job.summary) as [string, ClassSummary][]
                  ).map(([cls, info]) => (
                    <div
                      key={cls}
                      className="flex items-center justify-between p-3 rounded-lg bg-white/5 text-sm"
                    >
                      <span className="text-white font-medium capitalize">
                        {cls}
                      </span>
                      <span className="text-xs text-gray-400 font-mono">
                        first at{" "}
                        {info.first_time != null
                          ? formatTime(info.first_time)
                          : "-"}{" "}
                        - max confidence{" "}
                        {(info.max_confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {job.events.length > 0 && (
                <div>
                  <h3 className="text-xs text-gray-400 font-medium mb-2">
                    Evidence frames (click to enlarge)
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {job.events.map((ev, i) => (
                      <button
                        key={i}
                        onClick={() => setLightbox(ev.snapshot)}
                        className="group relative rounded-lg overflow-hidden border border-white/10 hover:border-white/30 transition-colors text-left"
                      >
                        <img
                          src={`${API_URL}${ev.snapshot}`}
                          alt={`${ev.class} at ${formatTime(ev.time)}`}
                          className="w-full h-24 object-cover"
                        />
                        <div className="absolute bottom-0 inset-x-0 px-2 py-1 bg-black/70 text-[10px] text-white font-mono capitalize">
                          {ev.class} {(ev.confidence * 100).toFixed(0)}% -{" "}
                          {formatTime(ev.time)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {job?.status === "error" && (
            <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-400">
              Analysis failed: {job.error ?? "unknown error"}
            </div>
          )}
          {job?.status === "cancelled" && (
            <div className="p-4 rounded-xl border border-white/10 bg-white/5 text-sm text-gray-400">
              Analysis cancelled.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/5 flex justify-end gap-3 bg-black/20">
          {busy ? (
            <button
              onClick={cancel}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-sm transition-colors"
            >
              Cancel
            </button>
          ) : finished ? (
            <button
              onClick={reset}
              className="px-4 py-2 bg-white text-black hover:bg-gray-200 rounded text-sm font-medium transition-colors"
            >
              Analyze another video
            </button>
          ) : (
            <button
              onClick={startAnalysis}
              disabled={!file}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Start analysis
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoAnalysisModal;
