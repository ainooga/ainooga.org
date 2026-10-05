// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chapterDatabase } from '../helpers/d1';
import { createDb } from '../../worker/src/db/client';
import { handleSubscribe } from '../../worker/src/subscribe';
import { BackgroundTasks } from '../helpers/background';
import worker from '../../worker/src/index';
import type { Env } from '../../worker/src/types';

let f: Awaited<ReturnType<typeof chapterDatabase>>;
beforeEach(async () => {
  f = await chapterDatabase();
});
afterEach(async () => {
  await f.dispose();
  vi.unstubAllGlobals();
});

it('allows exactly one retry after failed delivery and invalidates the failed token', async () => {
  const db = createDb(f.db);
  const tokens: string[] = [];
  let fail = true;
  const deps = {
    db,
    siteUrl: 'https://ainooga.org',
    turnstile: { verify: async () => true },
    email: {
      sendConfirmation: async (_to: string, _name: string | null, token: string) => {
        tokens.push(token);
        if (fail) throw new Error('private provider failure');
      },
    },
  };
  const input = {
    email: 'synthetic@example.com',
    name: 'Synthetic',
    turnstileToken: 'test',
  };
  await expect(handleSubscribe(input, deps)).rejects.toMatchObject({ status: 503 });
  expect(await db.confirmSubscription(tokens[0]!)).toBe(0);
  fail = false;
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => handleSubscribe(input, deps)),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
  expect(tokens).toHaveLength(2);
  expect(await db.confirmSubscription(tokens[1]!)).toBe(1);
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 1 }]);
});

it.each(['/confirm', '/api/subscribe', '/api/contact-sponsor'])(
  'protects headers on %s failures',
  async (path) => {
    const env = { DB: f.db, CHAPTER_SCHEMA_READY: 'true' } as Env;
    const response = await worker.fetch(
      new Request(`https://ainooga.org${path}`, {
        method: path === '/confirm' ? 'GET' : 'POST',
      }),
      env,
      new BackgroundTasks(),
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  },
);

it('a late invalidation cannot remove a replacement token or undo confirmation', async () => {
  const db = createDb(f.db);
  await db.insertSubscriber('synthetic@example.com', 'Synthetic', 'first');
  await db.invalidateConfirmation('first');
  expect(
    await db.insertSubscriber('synthetic@example.com', 'Replacement name', 'second'),
  ).toBe(true);
  await db.invalidateConfirmation('first');
  expect(await db.confirmSubscription('second')).toBe(1);
  await db.invalidateConfirmation('second');
  expect(await db.insertSubscriber('synthetic@example.com', null, 'third')).toBe(false);
  expect(await f.store.query('SELECT name FROM people')).toEqual([{ name: 'Synthetic' }]);
  expect(await f.store.query('SELECT status FROM subscriptions')).toEqual([
    { status: 'confirmed' },
  ]);
});

it('does not retry other consent states or legacy pending records', async () => {
  const db = createDb(f.db);
  for (const status of ['unknown', 'unsubscribed', 'confirmed']) {
    await db.insertSubscriber('synthetic@example.com', null, 'original');
    await f.db
      .prepare('UPDATE subscriptions SET status=?,confirmation_token_hash=NULL')
      .bind(status)
      .run();
    expect(await db.insertSubscriber('synthetic@example.com', null, 'replacement')).toBe(
      false,
    );
  }
  await f.store.execute(["UPDATE subscriptions SET status='pending', source='legacy'"]);
  expect(await db.insertSubscriber('synthetic@example.com', null, 'replacement')).toBe(
    false,
  );
});

it('rejects wrong-purpose proof before writes through the complete Worker', async () => {
  const env = {
    DB: f.db,
    CHAPTER_SCHEMA_READY: 'true',
    SITE_URL: 'https://ainooga.org',
    TURNSTILE_SECRET_KEY: 'synthetic',
  } as Env;
  vi.stubGlobal('fetch', async () =>
    Response.json({ success: true, hostname: 'ainooga.org', action: 'poll-auth' }),
  );
  for (const path of ['/api/subscribe', '/api/contact-sponsor']) {
    const body =
      path === '/api/subscribe'
        ? { email: 'synthetic@example.com', turnstileToken: 'test' }
        : { name: 'Synthetic', phone: '+12025550100', turnstileToken: 'test' };
    const response = await worker.fetch(
      new Request(`https://ainooga.org${path}`, {
        method: 'POST',
        headers: { Origin: env.SITE_URL, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
      new BackgroundTasks(),
    );
    expect(response.status).toBe(400);
  }
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 0 }]);
  expect(await f.store.query('SELECT count(*) AS n FROM contact_requests')).toEqual([
    { n: 0 },
  ]);
});

it('returns a redacted delivery error and then accepts a retry through the Worker', async () => {
  let failing = true;
  const env = {
    DB: f.db,
    CHAPTER_SCHEMA_READY: 'true',
    SITE_URL: 'https://ainooga.org',
    TURNSTILE_SECRET_KEY: 'synthetic',
    EMAIL: {
      send: async () => {
        if (failing) throw new Error('private provider details');
        return { messageId: 'synthetic' };
      },
    },
  } as Env;
  vi.stubGlobal('fetch', async () =>
    Response.json({
      success: true,
      hostname: 'ainooga.org',
      action: 'turnstile-spin-v1',
    }),
  );
  const request = () =>
    new Request('https://ainooga.org/api/subscribe', {
      method: 'POST',
      headers: { Origin: env.SITE_URL, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'synthetic@example.com', turnstileToken: 'test' }),
    });
  const failure = await worker.fetch(request(), env, new BackgroundTasks());
  expect(failure.status).toBe(503);
  expect(await failure.text()).not.toContain('private provider details');
  failing = false;
  const success = await worker.fetch(request(), env, new BackgroundTasks());
  expect(success.status).toBe(201);
  expect(success.headers.get('Cache-Control')).toBe('no-store');
});
