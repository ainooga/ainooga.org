import { afterEach, beforeEach, expect, it, vi } from 'vitest';

class ContentServer {
  requests: string[] = [];
  responses: Response[] = [];
  fetch: typeof fetch = async (input) => {
    this.requests.push(String(input));
    const response = this.responses.shift();
    if (!response) throw new Error('Unexpected content request');
    return response;
  };
}
let server: ContentServer;
beforeEach(() => {
  vi.resetModules();
  server = new ContentServer();
  vi.stubGlobal('fetch', server.fetch);
});
afterEach(() => vi.unstubAllGlobals());

it('loads a fresh version once and applies it to list/detail requests', async () => {
  server.responses.push(
    Response.json({ v: 'release-1' }),
    Response.json({ items: [{ slug: 'meeting' }] }),
    Response.json({ title: 'Meeting' }),
  );
  const { fetchData } = await import('../../src/lib/fetch');
  expect(await fetchData('/data/events/index.json')).toEqual({
    items: [{ slug: 'meeting' }],
  });
  expect(await fetchData('/data/events/meeting.json?preview=1')).toEqual({
    title: 'Meeting',
  });
  expect(server.requests).toEqual([
    expect.stringMatching(/^\/data\/version.json\?_t=\d+$/),
    '/data/events/index.json?v=release-1',
    '/data/events/meeting.json?preview=1&v=release-1',
  ]);
});

it('propagates version failure and allows a fresh retry before fetching content', async () => {
  server.responses.push(
    new Response('', { status: 503 }),
    Response.json({ v: 'release-2' }),
    Response.json({ items: [] }),
  );
  const { fetchData } = await import('../../src/lib/fetch');
  await expect(fetchData('/data/posts/index.json')).rejects.toThrow(
    'Failed to fetch version: HTTP 503',
  );
  expect(server.requests).toHaveLength(1);
  expect(await fetchData('/data/posts/index.json')).toEqual({ items: [] });
  expect(server.requests[2]).toBe('/data/posts/index.json?v=release-2');
});

it('propagates missing detail errors and retries without refetching the version', async () => {
  server.responses.push(
    Response.json({ v: 'release-3' }),
    new Response('', { status: 404 }),
    Response.json({ title: 'Recovered' }),
  );
  const { fetchData } = await import('../../src/lib/fetch');
  await expect(fetchData('/data/posts/missing.json')).rejects.toThrow(
    'Fetch failed: /data/posts/missing.json (HTTP 404)',
  );
  expect(await fetchData('/data/posts/missing.json')).toEqual({ title: 'Recovered' });
  expect(server.requests.slice(1)).toEqual([
    '/data/posts/missing.json?v=release-3',
    '/data/posts/missing.json?v=release-3',
  ]);
});
