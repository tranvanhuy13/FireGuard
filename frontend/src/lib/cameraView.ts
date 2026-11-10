/** Pure helpers (no imports) so they can be unit-tested with plain node. */

/** Demo cameras only make sense when mock data is on AND the demo flag is on. */
export const computeDemoEnabled = (isMockData: boolean, useDemoCameras: boolean): boolean =>
  Boolean(isMockData) && Boolean(useDemoCameras);

/** Number of pages needed to show `total` cameras, `perPage` at a time (min 1). */
export const pageCount = (total: number, perPage: number): number =>
  Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, perPage)));

/** Keep a 0-based page index inside [0, pageCount-1]. */
export const clampPage = (page: number, total: number, perPage: number): number =>
  Math.min(Math.max(0, Math.floor(page) || 0), pageCount(total, perPage) - 1);

/** The cameras shown on a given 0-based page. */
export const pageSlice = <T,>(items: T[], page: number, perPage: number): T[] => {
  const safe = clampPage(page, items.length, perPage);
  return items.slice(safe * perPage, safe * perPage + perPage);
};

/**
 * Path of a request without the API base prefix, so "/api/cameras" and "/cameras"
 * both become "/cameras" (NEXT_PUBLIC_API_URL may be "https://host/api").
 */
export const apiPathname = (pathname: string, apiUrl: string): string => {
  let prefix = "";
  try { prefix = new URL(apiUrl, "http://localhost").pathname.replace(/\/+$/, ""); } catch { prefix = ""; }
  if (prefix && (pathname === prefix || pathname.startsWith(prefix + "/"))) return pathname.slice(prefix.length) || "/";
  return pathname;
};

/** A camera whose HLS stream failed is shown as disconnected, even if the backend says "connected". */
export const effectiveStatus = (isActive: boolean, status: string, streamFailed: boolean): string =>
  isActive && status === "connected" && streamFailed ? "disconnected" : status;

/** True when a video frame advanced recently (so the on-screen clock is not misleading). */
export const isFrameFresh = (lastFrameMs: number | undefined, nowMs: number, maxAgeMs = 6000): boolean =>
  lastFrameMs !== undefined && nowMs - lastFrameMs <= maxAgeMs;

/** Copy of the camera list where cameras with a failed HLS stream are marked disconnected (for KPIs). */
export const applyStreamFailures = <T extends { id: number; is_active: boolean; status: string }>(
  cameras: T[], failedIds: number[],
): T[] => cameras.map(c => (failedIds.includes(c.id) ? { ...c, status: effectiveStatus(c.is_active, c.status, true) } : c));
