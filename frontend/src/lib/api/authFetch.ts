import { getAuthHeader as sessionHeader, setAuthHeader, clearAuthSession } from "./client";

export function setCredentials(username: string, password: string) {
  setAuthHeader("Basic " + btoa(unescape(encodeURIComponent(`${username}:${password}`))));
}

export function clearCredentials() { clearAuthSession(); }

export function getAuthHeader(): Record<string, string> {
  const header = sessionHeader();
  return header ? { Authorization: header } : {};
}

// Compatibility wrapper using the same credential source as the application.
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  const auth = sessionHeader();
  if (auth && !headers.has("Authorization")) headers.set("Authorization", auth);
  return fetch(input, { ...init, headers });
}
