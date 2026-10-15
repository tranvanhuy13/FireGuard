export const getBackendUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }
  return "http://localhost:8000";
};

export const getWsUrl = () => {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL.replace(/\/$/, "");
  }
  const api = getBackendUrl();
  // Relative API URL (e.g. "/api" behind a reverse proxy): use the page's own host
  if (api.startsWith("/") && typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}${api}`;
  }
  return api.replace(/^http/, "ws");
};

export const API_URL = getBackendUrl();
export const WS_URL = getWsUrl();
