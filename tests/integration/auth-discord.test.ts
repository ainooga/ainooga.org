// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authFixture, responseCookie } from '../helpers/auth';

let f: Awaited<ReturnType<typeof authFixture>>;
beforeEach(async () => {
  f = await authFixture();
});
afterEach(async () => {
  await f.dispose();
});

async function start() {
  const response = await f.call('/api/polls/verified/auth/discord/start', {
    turnstileToken: 'bot',
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { url: string };
  const url = new URL(body.url);
  expect(url.searchParams.get('scope')).toBe('identify');
  expect(url.searchParams.get('redirect_uri')).toBe(
    'https://ainooga.test/api/auth/discord/callback',
  );
  return {
    browser: responseCookie(response),
    path: `/api/auth/discord/callback?code=test&state=${url.searchParams.get('state')}`,
  };
}

describe('Discord OAuth', () => {
  it('verifies the linked Discord ID and consumes state once', async () => {
    const c = await start();
    expect((await f.call(c.path)).status).toBe(400);
    const response = await f.call(c.path, undefined, c.browser);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(
      'https://ainooga.test/#/polls/verified',
    );
    expect(
      await (
        await f.call('/api/polls/verified/session', undefined, responseCookie(response))
      ).json(),
    ).toMatchObject({ personId: 2, assurance: 'verified' });
    expect((await f.call(c.path, undefined, c.browser)).status).toBe(400);
    expect(f.deps.exchanges).toBe(1);
    expect(
      await f.store.query('SELECT verified_at FROM person_identifiers WHERE id=4'),
    ).toEqual([{ verified_at: f.deps.time.toISOString() }]);
  });
  it('rejects unlinked Discord accounts without creating people', async () => {
    const c = await start();
    f.deps.discordId = '999999999999999999';
    expect((await f.call(c.path, undefined, c.browser)).status).toBe(403);
    expect(await f.store.query('SELECT COUNT(*) AS n FROM people')).toEqual([{ n: 3 }]);
  });
  it('expires OAuth state and handles cancellation', async () => {
    const c = await start();
    expect(
      (await f.call(c.path + '&error=access_denied', undefined, c.browser)).status,
    ).toBe(400);
    const second = await start();
    f.deps.time = new Date(f.deps.time.getTime() + 600000);
    expect((await f.call(second.path, undefined, second.browser)).status).toBe(400);
    expect(f.deps.exchanges).toBe(0);
  });
  it('does not leak provider failures or allow state retry', async () => {
    const c = await start();
    f.deps.discordFails = true;
    const response = await f.call(c.path, undefined, c.browser);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('Private');
    expect((await f.call(c.path, undefined, c.browser)).status).toBe(400);
  });
});
