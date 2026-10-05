import { reject } from './auth/http.js';

export function allowedFormOrigin(origin: string): boolean {
  return (
    ['https://ainooga.org', 'https://www.ainooga.org'].includes(origin) ||
    /^https:\/\/[a-z0-9-]+\.ainooga-org\.pages\.dev$/.test(origin) ||
    /^http:\/\/localhost:\d+$/.test(origin)
  );
}

export function formHostname(request: Request, siteUrl: string): string {
  const origin = request.headers.get('Origin');
  const site = new URL(siteUrl);
  if (origin === null) return site.hostname;
  if (origin !== site.origin && !allowedFormOrigin(origin))
    reject(403, 'origin', 'This request must come from the site.');
  return new URL(origin).hostname;
}

export function formHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin':
      origin && allowedFormOrigin(origin) ? origin : 'https://ainooga.org',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Robots-Tag': 'noindex',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
}
