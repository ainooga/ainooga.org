export type Route = {
  page: string;
  params: Record<string, string>;
};

export const ROUTE_CHANGE_EVENT = 'app:routechange';

const DETAIL_SECTIONS = ['events', 'posts', 'members'];
const SERVER_PREFIXES = ['/api/', '/confirm', '/data/', '/images/'];

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  const [section, slug] = parts;

  // /events/train-llm-from-scratch → { page: 'events/:slug', params: { slug: 'train-llm-from-scratch' } }
  if (section !== undefined && slug !== undefined && DETAIL_SECTIONS.includes(section)) {
    return { page: `${section}/:slug`, params: { slug } };
  }

  if (
    section === 'polls' &&
    parts.length === 2 &&
    /^[a-zA-Z0-9_-]{1,160}$/.test(slug ?? '')
  ) {
    return { page: 'polls/:slug', params: { slug: slug! } };
  }

  return { page: section ?? 'home', params: {} };
}

/** Converts a legacy hash route (`#/events/x`) to its path (`/events/x`). */
export function legacyHashPath(hash: string): string | null {
  return hash.startsWith('#/') ? hash.slice(1) : null;
}

/** Returns true when a link to `target` should be handled by the SPA router. */
export function isSpaNavigation(target: URL, current: URL): boolean {
  if (target.origin !== current.origin) return false;
  if (SERVER_PREFIXES.some((prefix) => target.pathname.startsWith(prefix))) return false;
  const samePage =
    target.pathname === current.pathname && target.search === current.search;
  return !(samePage && target.hash !== '');
}
