import type { QueryClient } from '@tanstack/react-query';
import { api } from './api';

// The code chunk behind each route. App builds its lazy() routes from these and Shell
// warms them on hover, so by the time a click lands the chunk is usually already in
// memory instead of being downloaded during the navigation itself.
export const routeChunk = {
  '/': () => import('../pages/Dashboard'),
  '/pipeline': () => import('../pages/Pipeline'),
  '/leads': () => import('../pages/Leads'),
  '/activities': () => import('../pages/Operations'),
  '/calendar': () => import('../pages/Operations'),
  '/contacts': () => import('../pages/Operations'),
  '/reporting': () => import('../pages/Reporting'),
  '/configuration': () => import('../pages/Configuration'),
  '/notifications': () => import('../pages/Notifications'),
};

// Requests a route makes on its first render, written with the same key and fetcher the
// page uses so the result lands in the cache entry the page will read. Only queries
// whose keys carry no page state are listed here — a key that drifted from the page's
// would simply fetch the same data twice.
const routeData: Record<string, { queryKey: unknown[]; queryFn: () => Promise<unknown> }[]> = {
  '/': [{ queryKey: ['dashboard'], queryFn: () => api('/dashboard') }],
  '/pipeline': [{ queryKey: ['metadata'], queryFn: () => api('/metadata') }],
  '/leads': [{ queryKey: ['metadata'], queryFn: () => api('/metadata') }],
  '/activities': [{ queryKey: ['activities'], queryFn: () => api('/activities') }],
  '/calendar': [{ queryKey: ['activities'], queryFn: () => api('/activities') }],
  '/contacts': [{ queryKey: ['contacts'], queryFn: () => api('/contacts') }],
};

const chunks = routeChunk as Record<string, (() => Promise<unknown>) | undefined>;

// Safe to call repeatedly: the module system dedupes the import and React Query drops a
// prefetch whose data is still fresh, so hovering a link a dozen times costs one fetch.
export function prefetchRoute(path: string, queryClient: QueryClient) {
  void chunks[path]?.();
  for (const query of routeData[path] ?? []) void queryClient.prefetchQuery(query);
}

// Touch devices never fire hover, so warm every chunk once the browser goes idle. This
// is the same total download as before the routes were split, just moved off the path
// that blocks first paint.
export function warmRouteChunks() {
  const run = () => { for (const load of Object.values(routeChunk)) void load(); };
  const idle = window.requestIdleCallback;
  if (typeof idle === 'function') idle(run, { timeout: 4000 });
  else window.setTimeout(run, 2000);
}
