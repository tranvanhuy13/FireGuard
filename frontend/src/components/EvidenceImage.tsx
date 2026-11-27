"use client";

import { useEffect, useState } from "react";
import { ClockAlert, ImageOff } from "lucide-react";
import { API_URL } from "@/config";
import { authFetch } from "@/lib/api/authFetch";
import { mediaUrl } from "@/lib/api/client";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";

/** Account-authorized URL issuance; image bytes travel directly from Storage. */
export default function EvidenceImage({ snapshot, alt, className = "", compact = false }: {
  snapshot?: string; alt: string; className?: string; compact?: boolean;
}) {
  const { user, streamToken } = useAuth();
  const { t } = useLanguage();
  const [image, setImage] = useState<{ key: string; url?: string; expired?: boolean }>({ key: "" });
  const key = `${user?.id}:${snapshot ?? ""}`;
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      if (!snapshot) { setImage({ key }); return; }
      const path = new URL(snapshot, `${API_URL}/`).pathname;
      const name = path.match(/\/snapshots\/([^/]+)$/)?.[1];
      // Explicit demo/mock images keep their existing rendering path.
      if (!name) { setImage({ key, url: mediaUrl(snapshot, streamToken) }); return; }
      try {
        const response = await authFetch(`${API_URL}/snapshot-access/${name}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) {
          if (!disposed) setImage({ key, expired: response.status === 410 });
          if (response.status >= 500) timer = setTimeout(load, 30000);
          return;
        }
        const data: { url: string | null; expires_in: number } = await response.json();
        if (disposed) return;
        setImage({ key, url: data.url ?? mediaUrl(snapshot, streamToken) });
        timer = setTimeout(load, Math.max(1000, (data.expires_in - 15) * 1000));
      } catch {
        if (!disposed) { setImage({ key }); timer = setTimeout(load, 30000); }
      }
    }
    void load();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [key, snapshot, streamToken, retry]);
  if (image.key !== key || !image.url) {
    if (compact) {
      if (image.key !== key) {
        return (
          <div
            className={`flex items-center justify-center bg-gray-100 text-gray-500 text-xs text-center ${className}`}
            role="img"
            aria-label={alt}
          />
        );
      }
      const text = image.expired ? t.alerts.imageExpired : t.alerts.imageUnavailable;
      const Icon = image.expired ? ClockAlert : ImageOff;
      return (
        <div
          className={`flex items-center justify-center bg-gray-100 text-gray-500 text-xs text-center ${className}`}
          role="img"
          aria-label={text}
          title={text}
        >
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>
      );
    }
    return <div className={`flex items-center justify-center bg-gray-100 text-gray-500 text-xs text-center ${className}`} role="img" aria-label={alt}>
      {image.key === key && image.expired ? t.alerts.imageExpired : t.alerts.imageUnavailable}
    </div>;
  }
  // eslint-disable-next-line @next/next/no-img-element -- Private signed URLs bypass the shared image optimizer.
  return <img src={image.url} alt={alt} className={className} referrerPolicy="no-referrer" onError={() => {
    setImage({ key });
    // One immediate refresh per source; recurring network failures use timed recovery.
    if (retry === 0) setRetry(1);
  }} />;
}
