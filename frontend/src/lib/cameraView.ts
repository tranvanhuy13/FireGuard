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
