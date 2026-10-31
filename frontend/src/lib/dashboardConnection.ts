/** Dashboard transport lifecycle. Each controller owns its timers and generation. */
export type LoadState = "loading" | "ready" | "retrying" | "failed" | "forbidden" | "offline";
export type StreamState = "connecting" | "connected" | "retrying" | "waiting";

export function startPolling<T>(options: {
  url: string;
  interval: number;
  onData: (data: T) => void;
  onState: (state: LoadState) => void;
  request?: typeof fetch;
  online?: () => boolean;
  visible?: () => boolean;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
}) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  const online = options.online ?? (() => navigator.onLine);
  const visible = options.visible ?? (() => !document.hidden);
  let disposed = false;
  let generation = 0;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  // A server's Retry-After remains authoritative even when Retry is clicked.
  let notBefore = 0;

  const later = (delay: number) => { timer = schedule(() => { void run(); }, delay); };
  const stopRequest = () => {
    cancel(timer); cancel(deadline);
    controller?.abort();
  };
  const run = async () => {
    const current = ++generation;
    if (disposed) return;
    if (!online()) { options.onState("offline"); return; }
    if (Date.now() < notBefore) { later(notBefore - Date.now()); return; }
    if (!visible()) { later(15000); return; }
    controller = new AbortController();
    const signal = controller.signal;
    deadline = schedule(() => controller?.abort(), 30000);
    let retryDelay = Math.min(30000, 2000 * 2 ** failures);
    try {
      const response = await (options.request ?? fetch)(options.url, { signal });
      if (disposed || current !== generation) return;
      if (response.status === 401 || response.status === 403) {
        options.onState("forbidden"); return;
      }
      if (response.status === 429) {
        const value = response.headers.get("Retry-After");
        const seconds = value && /^\d+$/.test(value) ? Number(value) * 1000 : 0;
        const dateDelay = value && !seconds ? Date.parse(value) - Date.now() : 0;
        retryDelay = Math.min(2147483647, Math.max(retryDelay, seconds || dateDelay || 0));
        notBefore = Date.now() + retryDelay;
        throw new Error("rate limited");
      }
      if (!response.ok) {
        if (response.status < 500) { options.onState("failed"); return; }
        throw new Error("server unavailable");
      }
      const data = await response.json() as T;
      if (disposed || current !== generation || signal.aborted) return;
      options.onData(data);
      options.onState("ready");
      failures = 0;
      later(options.interval);
    } catch {
      if (disposed || current !== generation) return;
      failures += 1;
      options.onState(failures <= 5 ? "retrying" : "failed");
      if (failures <= 5) later(retryDelay);
    } finally {
      if (current === generation) cancel(deadline);
    }
  };
  const retry = () => {
    if (disposed) return;
    generation += 1;
    stopRequest();
    failures = 0;
    options.onState("loading");
    void run();
  };
  retry();
  return {
    retry,
    dispose() { disposed = true; generation += 1; stopRequest(); },
  };
}

export function startAlertStream(options: {
  url: string;
  onState: (state: StreamState) => void;
  onAlert: (data: unknown) => void;
  onConnected: () => void;
  refreshToken: () => Promise<unknown>;
  createSocket?: (url: string) => WebSocket;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
}) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let disposed = false;
  let attempts = 0;
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    if (disposed) return;
    options.onState(attempts ? "retrying" : "connecting");
    const retry = () => {
      if (disposed) return;
      options.onState("retrying");
      timer = schedule(connect, Math.min(30000, 2000 * 2 ** Math.min(attempts++, 4)));
    };
    let current: WebSocket;
    try { current = (options.createSocket ?? (url => new WebSocket(url)))(options.url); }
    catch { retry(); return; }
    socket = current;
    const active = () => !disposed && socket === current;
    deadline = schedule(() => { if (active()) current.close(); }, 30000);
    current.onopen = () => {
      if (!active()) return;
      cancel(deadline); attempts = 0;
      options.onState("connected"); options.onConnected();
    };
    current.onmessage = event => {
      if (!active()) return;
      try { options.onAlert(JSON.parse(event.data)); } catch { /* Ignore malformed frames. */ }
    };
    current.onerror = () => { if (active()) current.close(); };
    current.onclose = async event => {
      if (!active()) return;
      // Invalidate the socket immediately so duplicate/late events are ignored.
      socket = undefined;
      cancel(deadline);
      options.onState("retrying");
      if (event.code === 1008) {
        try { await options.refreshToken(); } catch { /* Auth provider handles logout. */ }
      }
      retry();
    };
  };
  connect();
  return () => {
    disposed = true; cancel(timer); cancel(deadline);
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
  };
}

export function mergeAlerts<T extends { id?: string | number; timestamp: string; type: string }>(incoming: T[], existing: T[]): T[] {
  const seen = new Set<string>();
  return [...incoming, ...existing].filter(alert => {
    const key = alert.id != null ? String(alert.id) : `${alert.timestamp}:${alert.type}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 200);
}
