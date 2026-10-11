import { z } from 'zod';
import type { D1Database } from '@cloudflare/workers-types';
import {
  AicSource,
  AicTransport,
  checkSession,
  project,
  type TransportOptionsType,
} from './source.js';
import { active, guarded, renew, SyncError, type SyncLeaseType } from './state.js';

const sessionName = /^__Secure-authjs\.session-token(?:\.\d+)?$/;
const safeValue = /^[\x21-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/;

export class SessionCookies {
  private values: Record<string, string>;
  constructor(values: Record<string, string> = {}) {
    this.values = {};
    for (const [name, value] of Object.entries(values)) this.set(name, value);
  }
  private set(name: string, value: string): void {
    if (
      !sessionName.test(name) ||
      typeof value !== 'string' ||
      !safeValue.test(value) ||
      value.length > 8192
    )
      throw new SyncError('session_invalid');
    this.values[name] = value;
    if (Object.keys(this.values).length > 16) throw new SyncError('session_invalid');
  }
  header(): string {
    return Object.entries(this.values)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
  serialize(): string {
    return JSON.stringify(this.values);
  }
  update(headers: Headers, now: number): boolean {
    const before = this.serialize();
    for (const cookie of setCookieHeaders(headers)) this.accept(cookie, now);
    return before !== this.serialize();
  }
  private accept(cookie: string, now: number): void {
    const [pair, ...attributes] = cookie.split(';');
    const index = pair!.indexOf('=');
    const name = pair!.slice(0, index).trim();
    if (!sessionName.test(name)) return;
    const attrs = new Map(
      attributes.map((a) => {
        const split = a.indexOf('=');
        return split < 0
          ? [a.trim().toLowerCase(), '']
          : [a.slice(0, split).trim().toLowerCase(), a.slice(split + 1).trim()];
      }),
    );
    const expired = attrs.has('max-age')
      ? Number(attrs.get('max-age')) <= 0
      : Date.parse(attrs.get('expires') ?? '') <= now;
    if (expired) delete this.values[name];
    else this.set(name, pair!.slice(index + 1));
  }
}

function setCookieHeaders(headers: Headers): string[] {
  const cookies = headers as Headers & {
    getSetCookie?(): string[];
    getAll?(name: string): string[];
  };
  if (cookies.getSetCookie) return cookies.getSetCookie();
  if (cookies.getAll) return cookies.getAll('Set-Cookie');
  throw new SyncError('session_headers_unsupported');
}

export function exportedSessionCookies(value: unknown, now = Date.now()): SessionCookies {
  const schema = z
    .object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string(),
      secure: z.boolean(),
      expirationDate: z.number().optional(),
    })
    .strict();
  try {
    if (!Array.isArray(value) || value.length > 1000) throw new Error();
    const cookies = value.map((cookie) =>
      schema.parse(project(cookie, Object.keys(schema.shape))),
    );
    const selected = cookies.filter(
      (cookie) =>
        sessionName.test(cookie.name) &&
        cookie.domain.replace(/^\./, '') === 'platform.aicollective.com' &&
        cookie.path === '/' &&
        cookie.secure,
    );
    if (
      !selected.length ||
      selected.some(
        (cookie) =>
          cookie.expirationDate !== undefined && cookie.expirationDate * 1000 <= now,
      )
    )
      throw new Error();
    return new SessionCookies(
      Object.fromEntries(selected.map((cookie) => [cookie.name, cookie.value])),
    );
  } catch {
    throw new SyncError('session_invalid');
  }
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
async function key(secret: string): Promise<CryptoKey> {
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new SyncError('session_key_invalid');
  const data = Uint8Array.from(secret.match(/../g)!, (v) => parseInt(v, 16));
  return crypto.subtle.importKey('raw', data, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const additionalData = new TextEncoder().encode('ainooga:chattanooga:session:v1');

export async function encryptSession(
  cookies: SessionCookies,
  secret: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData },
    await key(secret),
    new TextEncoder().encode(cookies.serialize()),
  );
  return `1.${base64(iv)}.${base64(new Uint8Array(body))}`;
}

export async function decryptSession(
  value: string,
  secret: string,
): Promise<SessionCookies> {
  const encryptionKey = await key(secret);
  try {
    const [version, iv, body, extra] = value.split('.');
    if (version !== '1' || !iv || !body || extra) throw new Error();
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(iv), additionalData },
      encryptionKey,
      bytes(body),
    );
    const decoded: unknown = JSON.parse(new TextDecoder().decode(plain));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
      throw new Error();
    return new SessionCookies(decoded as Record<string, string>);
  } catch {
    throw new SyncError('session_invalid');
  }
}

export interface SyncEnvType {
  DB: D1Database;
  AIC_BOT_EMAIL: string;
  AIC_SESSION_KEY: string;
}

const defaults = {
  fetch: (request: Request) => fetch(request),
  sleep: (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
};

async function storedCookies(
  lease: SyncLeaseType,
  secret: string,
): Promise<SessionCookies> {
  const row = await guarded(
    lease,
    `SELECT session_ciphertext FROM member_sync_state WHERE id=1 AND ${active}`,
  ).first<{ session_ciphertext: string | null }>();
  if (!row) throw new SyncError('lease_lost');
  if (!row.session_ciphertext) throw new SyncError('authentication_required');
  return decryptSession(row.session_ciphertext, secret);
}

function sessionSaver(lease: SyncLeaseType, secret: string) {
  let pending = Promise.resolve();
  return (cookies: SessionCookies): Promise<void> => {
    pending = pending.then(async () => {
      const encrypted = await encryptSession(cookies, secret);
      const result = await guarded(
        lease,
        `UPDATE member_sync_state SET session_ciphertext=? WHERE id=1 AND ${active}`,
        [encrypted],
      ).run();
      if (!result.meta.changes) throw new SyncError('lease_lost');
    });
    return pending;
  };
}

export async function authenticatedSource(
  lease: SyncLeaseType,
  env: SyncEnvType,
  deps: Pick<TransportOptionsType, 'fetch' | 'sleep'> = defaults,
): Promise<AicSource> {
  if (!env.AIC_BOT_EMAIL || !/^[a-f0-9]{64}$/i.test(env.AIC_SESSION_KEY))
    throw new SyncError('authentication_configuration_invalid');
  const transport = new AicTransport({
    ...deps,
    cookies: await storedCookies(lease, env.AIC_SESSION_KEY),
    now: lease.now,
    save: sessionSaver(lease, env.AIC_SESSION_KEY),
    beforeRequest: () => renew(lease),
  });
  await checkSession(transport, env.AIC_BOT_EMAIL, lease.now());
  return new AicSource(transport);
}
