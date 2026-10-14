const KEY = "fg_basic";

export function setCredentials(username: string, password: string) {
  sessionStorage.setItem(KEY, btoa(`${username}:${password}`));
}

export function clearCredentials() {
  sessionStorage.removeItem(KEY);
}

export function getAuthHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const v = sessionStorage.getItem(KEY);
  return v ? { Authorization: `Basic ${v}` } : {};
}

/** fetch() tự gắn header Authorization; gặp 401 thì xoá phiên và phát sự kiện "fg-unauthorized". */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  const auth = getAuthHeader();
  if (auth.Authorization) headers.set("Authorization", auth.Authorization);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    clearCredentials();
    window.dispatchEvent(new Event("fg-unauthorized"));
  }
  return res;
}
