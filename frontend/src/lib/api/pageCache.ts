import { getAuthHeader } from './client';
import { authFetch } from './authFetch';

// Keep private pages in memory for five seconds, scoped to the active session.
const pages = new Map<string, { body: string; expires: number }>();
let session: string | null = null;
let generation = 0;

export function clearPageCache() { pages.clear(); generation++; }

export async function fetchPage(url: string, signal?: AbortSignal): Promise<Response> {
  const owner = getAuthHeader();
  if (owner !== session) { pages.clear(); session = owner; }
  const version = generation;
  const cached = pages.get(url);
  if (cached && cached.expires > Date.now()) {
    signal?.throwIfAborted();
    return new Response(cached.body, { headers: { 'Content-Type': 'application/json' } });
  }
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await authFetch(url, { signal: controller.signal, cache: 'no-store' });
    if (response.ok) {
      const body = await response.clone().text();
      signal?.throwIfAborted();
      if (getAuthHeader() === owner && session === owner && version === generation) {
        if (pages.size >= 30) pages.delete(pages.keys().next().value!);
        pages.set(url, { body, expires: Date.now() + 5000 });
      }
    }
    return response;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }

}
