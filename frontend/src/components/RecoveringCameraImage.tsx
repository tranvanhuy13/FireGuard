"use client";

import { useEffect, useRef, useState } from "react";

/** MJPEG reconnects independently of token changes, with bounded automatic retries. */
export default function RecoveringCameraImage({ src, alt, refreshToken, onStatus }: {
  src: string; alt: string; refreshToken: () => Promise<string | null>;
  onStatus?: (ready: boolean) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [errorEpoch, setErrorEpoch] = useState(0);
  const budget = useRef(0);
  const refresh = useRef(refreshToken);
  const status = useRef(onStatus);
  useEffect(() => { refresh.current = refreshToken; }, [refreshToken]);
  useEffect(() => { status.current = onStatus; }, [onStatus]);
  useEffect(() => { status.current?.(false); }, [src]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (errorEpoch && budget.current < 5) {
      budget.current += 1;
      timer = setTimeout(async () => {
        try { await refresh.current(); }
        catch { /* A transport retry must also work when token refresh fails. */ }
        if (!disposed) setAttempt(value => value + 1);
      }, Math.min(15000, 2000 * budget.current));
    }
    const recover = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      budget.current = 0;
      setErrorEpoch(value => value + 1);
    };
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, [errorEpoch]);
  // MJPEG is a long-lived response, not an optimizable static Next image.
  // eslint-disable-next-line @next/next/no-img-element
  return <img key={attempt} src={`${src}${src.includes("?") ? "&" : "?"}reconnect=${attempt}`}
    alt={alt} className="w-full h-full object-contain"
    onLoad={() => { budget.current = 0; status.current?.(true); }}
    onError={() => { status.current?.(false); setErrorEpoch(value => value + 1); }} />;
}
