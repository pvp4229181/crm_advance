import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// index.html carries the defaults crawlers see before the bundle runs. Once the app is up,
// each route gets its own tab title, and everything except the sign-in page is marked
// noindex: the workspace is private, and signup only works for the very first account.
const BRAND = 'Lead CRM';
const PUBLIC_DESCRIPTION =
  'Lead CRM is a sales workspace for capturing leads, moving deals through a drag-and-drop pipeline, scheduling activities and following up on WhatsApp — with reports and an AI assistant built in.';

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Dashboard'],
  [/^\/login$/, 'Sign in'],
  [/^\/signup$/, 'Create your workspace'],
  [/^\/accept-invite$/, 'Accept invitation'],
  [/^\/pipeline$/, 'Pipeline'],
  [/^\/leads$/, 'Leads'],
  [/^\/leads\/import$/, 'Import leads'],
  [/^\/leads\/[^/]+$/, 'Lead'],
  [/^\/opportunities\/[^/]+$/, 'Opportunity'],
  [/^\/activities$/, 'Activities'],
  [/^\/calendar$/, 'Calendar'],
  [/^\/contacts$/, 'Contacts'],
  [/^\/inbox$/, 'Inbox'],
  [/^\/automation$/, 'Automation'],
  [/^\/whatsapp$/, 'WhatsApp'],
  [/^\/ai$/, 'AI assistant'],
  [/^\/reporting$/, 'Reporting'],
  [/^\/configuration$/, 'Configuration'],
  [/^\/notifications$/, 'Notifications'],
];

function setMeta(
  selector: string,
  attribute: 'content' | 'href',
  value: string,
) {
  document.head.querySelector(selector)?.setAttribute(attribute, value);
}

export function useRouteSeo() {
  const { pathname } = useLocation();
  useEffect(() => {
    const page = TITLES.find(([pattern]) => pattern.test(pathname))?.[1];
    const indexable = pathname === '/login';
    const url = `${window.location.origin}${pathname}`;
    document.title = indexable
      ? `${BRAND} — Sign in to your sales workspace`
      : page
        ? `${page} · ${BRAND}`
        : BRAND;
    setMeta(
      'meta[name="robots"]',
      'content',
      indexable ? 'index,follow' : 'noindex,nofollow',
    );
    if (indexable)
      setMeta('meta[name="description"]', 'content', PUBLIC_DESCRIPTION);
    setMeta('link[rel="canonical"]', 'href', url);
    setMeta('meta[property="og:url"]', 'content', url);
  }, [pathname]);
}
