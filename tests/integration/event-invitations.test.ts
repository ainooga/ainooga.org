// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authFixture, ORGANIZER_TOKEN } from '../helpers/auth';
import { EventFrontmatter } from '../../scripts/types';
import type { ParsedDoc } from '../../scripts/types';
import { deferred } from '../helpers/background';
import { handleAuth } from '../../worker/src/auth/router';

let f: Awaited<ReturnType<typeof authFixture>>;
type Message = Parameters<SendEmail['send']>[0];
let sent: Message[];
let rejected: Set<string>;
let fields: Record<string, unknown>;
const event: ParsedDoc = {
  type: 'events',
  slug: 'meeting',
  filePath: 'content/events/meeting.md',
  body: '',
  frontmatter: {
    title: 'Chapter meeting',
    date: '2026-10-17T17:00:00Z',
    location: 'Library',
    organizer: 'Chapter',
    tags: ['workshop'],
    status: 'published',
  },
};
beforeEach(async () => {
  f = await authFixture();
  sent = [];
  rejected = new Set();
  configure();
  f.env.EMAIL = {
    async send(message) {
      sent.push(message);
      if (rejected.has(String(message.to))) throw new Error('Private provider details');
      return { messageId: String(sent.length) };
    },
  };
});
afterEach(async () => {
  vi.useRealTimers();
  await f?.dispose();
});

function document(fields: Record<string, unknown> = {}): ParsedDoc {
  return {
    ...event,
    frontmatter: { ...event.frontmatter, inviteTags: ['member'], ...fields },
  };
}
function configure(overrides: Record<string, unknown> = {}) {
  const source = EventFrontmatter.parse(document(overrides).frontmatter);
  fields = {
    title: source.title,
    date: source.date.toISOString(),
    endDate: source.endDate?.toISOString(),
    timezone: source.timezone,
    location: source.location,
    status: source.status,
    inviteTags: source.inviteTags,
    inviteMessage: source.inviteMessage,
    links: source.links?.map(({ platform, url }) => ({ platform, url })),
  };
}
function invite(preview = false) {
  return f.call(
    `/api/admin/events/meeting/invite${preview ? '/preview' : ''}`,
    fields,
    undefined,
    {
      Authorization: `Bearer ${ORGANIZER_TOKEN}`,
    },
  );
}
async function ready(fields: Record<string, unknown> = {}) {
  await f.store.execute(["INSERT INTO person_tags VALUES(2,'member')"]);
  configure(fields);
}
function requestWithOrigin(path: string, origin: string) {
  return handleAuth(
    new Request(`${f.env.SITE_URL}${path}`, {
      method: 'POST',
      body: JSON.stringify(fields),
      headers: {
        Authorization: `Bearer ${ORGANIZER_TOKEN}`,
        'Content-Type': 'application/json',
        Origin: origin,
      },
    }),
    f.env,
    f.deps,
    f.deps,
  );
}

it('rejects a published event without invitation tags instead of using topic tags', async () => {
  configure({ inviteTags: [] });
  const response = await f.call('/api/admin/events/meeting/invite', fields, undefined, {
    Authorization: `Bearer ${ORGANIZER_TOKEN}`,
  });
  expect(response.status).toBe(400);
  expect(sent).toEqual([]);
});

it('invites the live tag union and aliases, excluding only explicit event opt-outs', async () => {
  await f.store.execute([
    "INSERT INTO people(id,name) VALUES(4,'No preference'),(5,'No email'),(6,'Opted out')",
    "INSERT INTO person_tags VALUES(1,'helper'),(2,'member'),(2,'helper'),(3,'helper'),(4,'member'),(5,'member'),(6,'helper')",
    "INSERT INTO person_identifiers(id,person_id,kind,value,normalized_value) VALUES(5,2,'email','Alias@Example.com','alias@example.com'),(6,3,'email','other-alias@example.com','other-alias@example.com'),(7,4,'email','unknown@example.com','unknown@example.com'),(8,6,'email','out@example.com','out@example.com'),(9,6,'email','out-alias@example.com','out-alias@example.com')",
    "INSERT INTO person_identifiers(person_id,kind,value,normalized_value) VALUES(2,'email',' VOTER@EXAMPLE.COM ',' VOTER@EXAMPLE.COM ')",
    "INSERT INTO subscriptions(person_id,email_identifier_id,kind,subscribed) VALUES(2,2,'newsletter',0),(2,2,'event_invites',1),(3,3,'event_invites',0),(6,8,'event_invites',0)",
  ]);
  configure({ inviteTags: ['member', 'helper'] });
  await f.store.execute([
    "INSERT INTO events(name,starts_at) VALUES('Meeting','2026-10-17T17:00:00Z')",
  ]);
  await f.store.execute([
    "INSERT INTO event_participation(event_id,person_id,registration_status,source) SELECT id,2,'approved','luma' FROM events",
  ]);
  const before = await f.store.query('SELECT * FROM event_participation');
  expect(sent).toEqual([]);
  expect(await (await invite()).json()).toEqual({
    recipients: 3,
    accepted: 3,
    failed: 0,
  });
  expect(sent.map((message) => message.to)).toEqual([
    'alias@example.com',
    'unknown@example.com',
    'voter@example.com',
  ]);
  expect(await f.store.query('SELECT * FROM event_participation')).toEqual(before);
  for (const message of sent) {
    expect(message.cc).toBeUndefined();
    expect(message.bcc).toBeUndefined();
  }
});

it('previews escaped plain-text copy, local event links and the event timezone without email configuration', async () => {
  await ready({
    title: '<img src=x> & chapter\nmeeting',
    inviteMessage: 'Bring <your laptop> & a task.\n\nAll skill levels welcome.',
    endDate: '2026-10-17T21:00:00Z',
    timezone: 'America/New_York',
    links: [
      {
        platform: 'luma',
        externalId: 'evt-meeting',
        url: 'https://luma.com/example?a=1&b=2',
      },
    ],
  });
  f.env.POLLS_READY = 'false';
  f.env.EMAIL = undefined as unknown as SendEmail;
  f.env.SITE_URL = 'http://localhost:5173';
  const response = await requestWithOrigin(
    '/api/admin/events/meeting/invite/preview',
    'http://localhost:5173',
  );
  expect(response.status).toBe(200);
  const preview = (await response.json()) as {
    recipients: number;
    subject: string;
    text: string;
    html: string;
  };
  expect(preview).toMatchObject({
    recipients: 1,
    subject: 'AI Nooga event: <img src=x> & chapter meeting',
  });
  expect(preview.text).toContain(
    'Bring <your laptop> & a task.\n\nAll skill levels welcome.',
  );
  expect(preview.text).toContain('1:00 PM');
  expect(preview.text).toContain('5:00 PM');
  expect(preview.text).toContain('(America/New_York)');
  expect(preview.text).toContain('http://localhost:5173/#/events/meeting');
  expect(preview.html).toContain('Bring &lt;your laptop&gt; &amp; a task.<br><br>');
  expect(preview.html).toContain('https://luma.com/example?a=1&amp;b=2');
  expect(preview.html).not.toContain('<img');
  expect(JSON.stringify(preview)).not.toContain('voter@example.com');
  expect(sent).toEqual([]);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(
    (await requestWithOrigin('/api/admin/events/meeting/invite', 'http://localhost:5173'))
      .status,
  ).toBe(503);
});

it('sends the previewed message and standard copy with UTC when optional fields are absent', async () => {
  await ready();
  const preview = await (await invite(true)).json();
  expect(await (await invite()).json()).toEqual({
    recipients: 1,
    accepted: 1,
    failed: 0,
  });
  expect(sent[0]).toMatchObject({
    from: 'noreply@ainooga.org',
    replyTo: 'contact@ainooga.org',
    subject: preview.subject,
    text: preview.text,
    html: preview.html,
  });
  expect(preview.text).toContain('You are invited to join us.');
  expect(preview.text).toContain('(UTC)');
  expect(preview.text).toContain('Where: Library');
  expect(await f.store.query('SELECT * FROM events')).toEqual([]);
});

it('validates authentication, origin, readiness, methods and strict bodies before delivery', async () => {
  await ready();
  const path = '/api/admin/events/meeting/invite';
  expect((await f.call(path, {})).status).toBe(401);
  expect(
    (await f.call(path, {}, undefined, { Authorization: `Bearer ${'b'.repeat(64)}` }))
      .status,
  ).toBe(401);
  expect((await requestWithOrigin(path, 'https://elsewhere.test')).status).toBe(403);
  expect(
    (
      await f.call(path, { to: 'stranger@example.com' }, undefined, {
        Authorization: `Bearer ${ORGANIZER_TOKEN}`,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await f.call(path, undefined, undefined, {
        Authorization: `Bearer ${ORGANIZER_TOKEN}`,
      })
    ).status,
  ).toBe(405);
  for (const flag of ['AUTH_READY', 'CHAPTER_SCHEMA_READY'] as const) {
    f.env[flag] = 'false';
    expect((await invite()).status).toBe(503);
    f.env[flag] = 'true';
  }
  f.deps.allowed = false;
  expect((await invite()).status).toBe(429);
  expect(sent).toEqual([]);
});

it('rejects started, draft and missing-tag invitations without sending', async () => {
  await ready({ inviteTags: ['missing'] });
  expect((await invite()).status).toBe(409);
  configure();
  f.deps.time = new Date('2026-10-17T17:00:00Z');
  expect((await invite()).status).toBe(409);
  f.deps.time = new Date('2026-10-16T17:00:00Z');
  configure({ status: 'draft' });
  expect((await invite()).status).toBe(400);
  expect(sent).toEqual([]);
});

// eslint-disable-next-line sonarjs/code-eval -- Deliberately unsafe URL fixture tests rejection; it is never executed.
it.each(['javascript:alert(1)', 'not a URL', 'https://user:password@example.com'])(
  'rejects an unsafe event link %s',
  async (url) => {
    await ready();
    fields.links = [{ platform: 'other', url }];
    expect((await invite()).status).toBe(400);
    expect((await invite(true)).status).toBe(400);
    expect(sent).toEqual([]);
  },
);

it('reports partial failures and resends only when explicitly invoked, using current preferences and tags', async () => {
  await ready();
  await f.store.execute(["INSERT INTO person_tags VALUES(3,'member')"]);
  rejected.add('other@example.com');
  expect(await (await invite()).json()).toEqual({
    recipients: 2,
    accepted: 1,
    failed: 1,
  });
  expect(sent).toHaveLength(2);
  await f.store.execute([
    "INSERT INTO subscriptions(person_id,email_identifier_id,kind,subscribed) VALUES(3,3,'event_invites',0)",
  ]);
  expect(await (await invite()).json()).toEqual({
    recipients: 1,
    accepted: 1,
    failed: 0,
  });
  expect(sent).toHaveLength(3);
  await f.store.execute(['DELETE FROM person_tags WHERE person_id=2']);
  expect(await (await invite()).json()).toEqual({
    recipients: 0,
    accepted: 0,
    failed: 0,
  });
  expect(sent).toHaveLength(3);
});

it('limits concurrent provider calls to five while sending the entire audience', async () => {
  await ready();
  await f.store.execute(
    Array.from({ length: 6 }, (_, index) => {
      const id = index + 10;
      return `INSERT INTO people(id) VALUES(${id})`;
    }),
  );
  await f.store.execute(
    Array.from({ length: 6 }, (_, index) => {
      const id = index + 10;
      return `INSERT INTO person_identifiers(person_id,kind,value,normalized_value) VALUES(${id},'email','person${id}@example.com','person${id}@example.com')`;
    }),
  );
  await f.store.execute(
    Array.from(
      { length: 6 },
      (_, index) => `INSERT INTO person_tags VALUES(${index + 10},'member')`,
    ),
  );
  const started = deferred();
  const finish = deferred();
  let active = 0;
  let maximum = 0;
  f.env.EMAIL = {
    async send(message) {
      sent.push(message);
      maximum = Math.max(maximum, ++active);
      if (active === 5) started.resolve();
      await finish.promise;
      active--;
      return { messageId: String(sent.length) };
    },
  };
  const pending = invite();
  await started.promise;
  expect(sent).toHaveLength(5);
  finish.resolve();
  expect(await (await pending).json()).toEqual({ recipients: 7, accepted: 7, failed: 0 });
  expect(maximum).toBe(5);
});

it('bounds provider waits and reports uncertain delivery without retrying', async () => {
  await ready();
  const started = deferred();
  const finish = deferred();
  let attempts = 0;
  f.env.EMAIL = {
    async send() {
      attempts++;
      started.resolve();
      await finish.promise;
      return { messageId: 'late' };
    },
  };
  vi.useFakeTimers();
  const pending = invite();
  await started.promise;
  await vi.advanceTimersByTimeAsync(10000);
  expect(await (await pending).json()).toEqual({ recipients: 1, accepted: 0, failed: 1 });
  finish.resolve();
  expect(attempts).toBe(1);
});

it.each([
  ['2026-10-17T17:00:00.000Z', '2026-10-17T17:00:00Z', 400],
  ['2026-10-17T17:00:00Z', '2026-10-17T17:00:00.001Z', 200],
])(
  'compares schedule timestamps chronologically: %s to %s',
  async (date, endDate, status) => {
    await ready();
    fields.date = date;
    fields.endDate = endDate;
    expect((await invite(true)).status).toBe(status);
    expect(sent).toEqual([]);
  },
);
