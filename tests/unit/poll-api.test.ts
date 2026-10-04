import { afterEach, expect, it, vi } from 'vitest';
import { BrowserPollService } from '../../src/lib/polls/api';
import { BrowserPollRuntime } from '../../src/lib/polls/runtime';
import { uiPoll } from '../helpers/poll-ui';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});
class HttpFake {
  calls: { url: string; init: RequestInit }[] = [];
  responses: Response[] = [];
  fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    this.calls.push({ url: String(url), init: init ?? {} });
    const response = this.responses.shift();
    if (response === undefined) throw new TypeError('Connection lost');
    return response;
  };
}
it('sends only same-origin cookies and JSON, never organizer credentials or cached requests', async () => {
  const http = new HttpFake();
  globalThis.fetch = http.fetch;
  http.responses.push(
    Response.json({ authenticated: true, assurance: 'honor' }),
    Response.json({ authenticated: false }),
  );
  const api = new BrowserPollService();
  await api.identify(
    'topics',
    { kind: 'discord_username', value: 'chapter.user' },
    'proof',
  );
  await api.logout();
  expect(http.calls[0]!.url).toBe('/api/polls/topics/auth/honor');
  for (const call of http.calls) {
    expect(call.init.credentials).toBe('same-origin');
    expect(call.init.cache).toBe('no-store');
    expect(call.init.redirect).toBe('error');
    expect(new Headers(call.init.headers).has('Authorization')).toBe(false);
    expect(new Headers(call.init.headers).get('Content-Type')).toBe('application/json');
  }
  expect(JSON.parse(String(http.calls[0]!.init.body))).toEqual({
    identifier: { kind: 'discord_username', value: 'chapter.user' },
    turnstileToken: 'proof',
  });
  expect(http.calls[1]!.init.body).toBe('{}');
});
it('validates detail/access/results responses and encodes the entire slug', async () => {
  const http = new HttpFake();
  globalThis.fetch = http.fetch;
  const poll = uiPoll();
  http.responses.push(
    Response.json(poll),
    Response.json({ identityMode: 'honor', methods: ['honor'] }),
    Response.json({ eligibleCount: 0, ballotCount: 0, options: [] }),
  );
  const api = new BrowserPollService();
  expect(await api.detail('topics')).toEqual(poll);
  expect(await api.access('../admin')).toEqual({
    identityMode: 'honor',
    methods: ['honor'],
  });
  expect(http.calls[1]!.url).toBe('/api/polls/..%2Fadmin/access');
  expect(await api.results('topics')).toMatchObject({ ballotCount: 0 });
});
it('preserves submission UUID/revision and rejects malformed successful responses', async () => {
  const http = new HttpFake();
  globalThis.fetch = http.fetch;
  const ballot = { revision: 1, optionIds: [1], submittedAt: 'now', updatedAt: 'now' };
  http.responses.push(Response.json(ballot), Response.json({ privateRoster: [] }));
  const api = new BrowserPollService();
  const input = {
    requestId: 'same-id',
    sessionContext: 'a'.repeat(64),
    expectedRevision: 0,
    optionIds: [1],
    writeIn: null,
  };
  expect(await api.submit('topics', input)).toEqual(ballot);
  expect(JSON.parse(String(http.calls[0]!.init.body))).toEqual(input);
  await expect(api.detail('topics')).rejects.toMatchObject({
    status: 0,
    code: 'response',
  });
});
it.each([401, 403, 404, 409, 429, 503])(
  'retains HTTP %s and the machine-readable error code',
  async (status) => {
    const http = new HttpFake();
    globalThis.fetch = http.fetch;
    http.responses.push(
      Response.json(
        { code: 'example', error: 'Readable', requestId: 'redacted' },
        { status },
      ),
    );
    await expect(new BrowserPollService().detail('topics')).rejects.toMatchObject({
      status,
      code: 'example',
      message: 'Readable',
    });
  },
);
it('treats malformed JSON and transport failures as uncertain failures', async () => {
  const http = new HttpFake();
  globalThis.fetch = http.fetch;
  http.responses.push(new Response('<html>upstream unavailable</html>', { status: 502 }));
  const api = new BrowserPollService();
  await expect(api.detail('topics')).rejects.toMatchObject({
    status: 0,
    code: 'network',
  });
  await expect(api.detail('topics')).rejects.toMatchObject({
    status: 0,
    code: 'network',
  });
});
it('the browser runtime focuses headings and stops its deadline timer on cleanup', () => {
  vi.useFakeTimers();
  const runtime = new BrowserPollRuntime();
  const heading = document.createElement('h1');
  heading.tabIndex = -1;
  document.body.append(heading);
  runtime.focus(heading);
  expect(document.activeElement).toBe(heading);
  heading.remove();
  expect(runtime.uuid()).toMatch(/^[a-f0-9-]{36}$/);
  expect(runtime.now()).toBe(Date.now());
  let ticks = 0;
  const stop = runtime.everySecond(() => {
    ticks++;
  });
  vi.advanceTimersByTime(1000);
  stop();
  vi.advanceTimersByTime(3000);
  expect(ticks).toBe(1);
});
