// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { EventClient } from '../../scripts/events/client';
import { commandOptions, runInvitation } from '../../scripts/events/commands';

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

function eventDoc(status: string) {
  return {
    type: 'events' as const,
    slug: 'meeting',
    filePath: 'meeting.md',
    body: '',
    frontmatter: {
      ...fields,
      date: new Date(fields.date),
      status,
      organizer: 'Chapter',
      tags: [],
    },
  };
}

it('refuses remote invite mode, missing files and drafts before delivery', () => {
  expect(() => commandOptions(['invite', 'meeting', '--remote'])).toThrow('Usage:');
  const invoke = (docs: ReturnType<typeof eventDoc>[]) =>
    runInvitation(commandOptions(['invite', 'meeting']), { docs, errors: [] }, () => {
      throw new Error('Unexpected API access');
    });
  expect(() => invoke([])).toThrow('Event not found: meeting');
  expect(() => invoke([eventDoc('draft')])).toThrow(/meeting\.md.*status/s);
});

it('routes dry-run invitations to preview and reports 401 without the private response body', async () => {
  const http = new HttpFake();
  globalThis.fetch = http.fetch;
  const client = new EventClient(token, 'https://ainooga.test');
  const options = commandOptions(['invite', 'meeting', '--dry-run']);
  const preview = {
    recipients: 1,
    subject: 'Meeting',
    text: 'Preview',
    html: '<p>Preview</p>',
  };
  http.responses.push(
    Response.json(preview),
    new Response('Private provider details', { status: 401 }),
  );
  const send = () =>
    runInvitation(options, { docs: [eventDoc('published')], errors: [] }, () => client);
  expect(await send()).toEqual(preview);
  await expect(send()).rejects.toThrow(
    /^API request failed \(HTTP 401\)\. Check the token, event state, and invitation tags\.$/,
  );
  expect(http.calls.map((call) => call.url)).toEqual(
    Array(2).fill('https://ainooga.test/api/admin/events/meeting/invite/preview'),
  );
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
