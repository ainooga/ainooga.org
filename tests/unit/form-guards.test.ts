// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import worker from '../../worker/src/index';
import type { Env } from '../../worker/src/types';
import { BackgroundTasks } from '../helpers/background';

const SITE = 'https://ainooga.org';
const env = {
  DB: new Proxy(
    {},
    {
      get() {
        throw new Error('Guard touched D1');
      },
    },
  ),
  CHAPTER_SCHEMA_READY: 'true',
  SITE_URL: SITE,
  TURNSTILE_SECRET_KEY: 'synthetic',
} as Env;

afterEach(() => vi.unstubAllGlobals());
it.each([
  ['/confirm', 'GET', 400],
  ['/api/subscribe', 'POST', 415],
  ['/api/contact-sponsor', 'POST', 415],
] as const)(
  'protects response headers on early %s failure',
  async (path, method, status) => {
    const response = await worker.fetch(
      new Request(SITE + path, { method }),
      env,
      new BackgroundTasks(),
    );
    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  },
);

function streamedForm(size: number) {
  const json = Buffer.from(
    JSON.stringify({ email: 'voter@example.com', name: 'π', turnstileToken: 'proof' }),
  );
  const bytes = Buffer.concat([json, Buffer.alloc(size - json.length, ' ')]);
  const split = bytes.indexOf('π') + 1;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, split));
      controller.enqueue(bytes.subarray(split, 16384));
      if (size > 16384) controller.enqueue(bytes.subarray(16384));
      controller.close();
    },
  });
  return new Request(`${SITE}/api/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stream,
    duplex: 'half',
  } as RequestInit);
}

it.each([16384, 16385])(
  'counts streamed bytes before verifying proof (%i)',
  async (size) => {
    const verifier = vi.fn(async () => Response.json({ success: false }));
    vi.stubGlobal('fetch', verifier);
    const response = await worker.fetch(streamedForm(size), env, new BackgroundTasks());
    if (size === 16384) {
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: 'Verification failed. Try again.',
      });
      expect(verifier).toHaveBeenCalledOnce();
    } else {
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: 'body_too_large' });
      expect(verifier).not.toHaveBeenCalled();
    }
  },
);

const offline = {
  get DB(): D1Database {
    throw new Error('Database touched while gated');
  },
  get EMAIL(): SendEmail {
    throw new Error('Mail touched while gated');
  },
} as Env;

it.each(['/api/subscribe', '/api/contact-sponsor', '/confirm'])(
  'gates %s before parsing input or touching dependencies',
  async (path) => {
    const request = new Request(SITE + path, {
      method: path === '/confirm' ? 'GET' : 'POST',
      headers: { Origin: SITE },
    });
    const response = await worker.fetch(request, offline, new BackgroundTasks());
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
  },
);

it.each([
  ['OPTIONS', '/api/subscribe', 200],
  ['GET', '/unknown', 404],
] as const)('allows %s %s while gated', async (method, path, status) => {
  const response = await worker.fetch(
    new Request(SITE + path, { method }),
    offline,
    new BackgroundTasks(),
  );
  expect(response.status).toBe(status);
});
