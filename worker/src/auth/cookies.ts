import { reject } from './http.js';

type CookieKind = 'voter' | 'honor' | 'challenge';

function settings(siteUrl: string): { prefix: string; secure: string } {
  const url = new URL(siteUrl);
  if (url.protocol === 'https:') return { prefix: '__Host-', secure: '; Secure' };
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    return { prefix: 'dev-', secure: '' };
  return reject(503, 'configuration', 'Authentication configuration is unavailable.');
}

export function cookie(
  request: Request,
  siteUrl: string,
  kind: CookieKind,
): string | null {
  const name = `${settings(siteUrl).prefix}ainooga-${kind}=`;
  const value = request.headers
    .get('Cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(name))
    ?.slice(name.length);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

export function setCookie(
  response: Response,
  siteUrl: string,
  kind: CookieKind,
  value: string,
  seconds: number,
): void {
  const { prefix, secure } = settings(siteUrl);
  response.headers.append(
    'Set-Cookie',
    `${prefix}ainooga-${kind}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${seconds}`,
  );
}
