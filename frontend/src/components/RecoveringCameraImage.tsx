"use client";

import { useEffect, useRef, useState } from "react";

/** MJPEG reconnects independently of token changes, with bounded automatic retries. */
export default function RecoveringCameraImage({ src, alt, refreshToken }: {
  src: string; alt: string; refreshToken: () => Promise<string | null>;
}) {
  const [attempt, setAttempt] = useState(0);
  const [errorEpoch, setErrorEpoch] = useState(0);
  const budget = useRef(0);
  const refresh = useRef(refreshToken);
  useEffect(() => { refresh.current = refreshToken; }, [refreshToken]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (errorEpoch && budget.current < 5) {
      budget.current += 1;
      timer = setTimeout(async () => {
        await refresh.current();
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
    onLoad={() => { budget.current = 0; }}
    onError={() => setErrorEpoch(value => value + 1)} />;
}
