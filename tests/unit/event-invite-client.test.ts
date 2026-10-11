// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { EventClient } from '../../scripts/events/client';

const originalFetch = globalThis.fetch;
const token = 'a'.repeat(64);
const fields = {
  title: 'Meeting',
  date: '2026-10-17T17:00:00Z',
  location: 'Library',
  status: 'published' as const,
  inviteTags: ['member'],
};
afterEach(() => {
  globalThis.fetch = originalFetch;
});

class HttpFake {
  calls: { url: string; init: RequestInit }[] = [];
  responses: Response[] = [];
  fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    this.calls.push({ url: String(url), init: init ?? {} });
    const response = this.responses.shift();
    if (!response) throw new Error('Private connection details');
    return response;
  };
}

it.each([
  'http://example.com',
  'https://user:secret@example.com',
  'https://example.com/api',
  'https://example.com/?token=secret',
  'https://example.com/#secret',
  'not a URL',
])('rejects unsafe API origins without exposing their contents: %s', (url) => {
  expect(() => new EventClient(token, url)).toThrow();
  try {
    new EventClient(token, url);
  } catch (error) {
    expect(String(error)).not.toContain('secret');
  }
});

it('validates tokens and slugs before making requests', async () => {
  const http = new HttpFake();
  globalThis.fetch = http.fetch;
  expect(() => new EventClient('invalid', 'https://ainooga.test')).toThrow(
    'AINOOGA_API_TOKEN',
  );
  await expect(
    new EventClient(token, 'https://ainooga.test').invite('../admin', false, fields),
  ).rejects.toThrow('Invalid event slug');
  expect(http.calls).toEqual([]);
});

it('does not retry uncertain sends or expose transport/provider values', async () => {
  const http = new HttpFake();
  globalThis.fetch = http.fetch;
  const client = new EventClient(token, 'https://ainooga.test');
  await expect(client.invite('meeting', false, fields)).rejects.toThrow(
    'Some invitations may already have been sent',
  );
  expect(http.calls).toHaveLength(1);
  expect(http.calls[0]?.init).toMatchObject({
    redirect: 'error',
    body: JSON.stringify(fields),
    method: 'POST',
  });
  expect(http.calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  await expect(client.invite('meeting', true, fields)).rejects.not.toThrow(
    'Some invitations',
  );
  http.responses.push(
    Response.json({ recipients: 2, accepted: 0, failed: 1, private: 'sensitive' }),
  );
  await expect(client.invite('meeting', false, fields)).rejects.toThrow(
    'Invalid event invitation API response. Some invitations',
  );
  http.responses.push(new Response('Private provider details', { status: 503 }));
  await expect(client.invite('meeting', false, fields)).rejects.toThrow('HTTP 503');
  expect(http.calls).toHaveLength(4);
});

it('rejects malformed JSON responses with uncertain delivery diagnostics', async () => {
  const http = new HttpFake();
  globalThis.fetch = http.fetch;
  http.responses.push(new Response('broken JSON'));
  await expect(
    new EventClient(token, 'https://ainooga.test').invite('meeting', false, fields),
  ).rejects.toThrow('Invalid event invitation API response. Some invitations');
});

it('rejects an oversized UTF-8 payload before making a request', async () => {
  const http = new HttpFake();
  globalThis.fetch = http.fetch;
  await expect(
    new EventClient(token, 'https://ainooga.test').invite('meeting', false, {
      ...fields,
      inviteMessage: '😀'.repeat(4000),
      location: 'x'.repeat(1000),
    }),
  ).rejects.toThrow('size limit');
  expect(http.calls).toEqual([]);
});
