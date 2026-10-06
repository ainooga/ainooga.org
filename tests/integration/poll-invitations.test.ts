// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pollFixture, pollInput } from '../helpers/polls';
import { ORGANIZER_TOKEN } from '../helpers/auth';
import { deferred } from '../helpers/background';

let f: Awaited<ReturnType<typeof pollFixture>>;
type Message = Parameters<SendEmail['send']>[0];
let sent: Message[];
let rejected: Set<string>;

beforeEach(async () => {
  f = await pollFixture();
  sent = [];
  rejected = new Set();
  f.env.EMAIL = {
    async send(message) {
      if (!('subject' in message)) throw new Error('Expected structured email');
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

it('invites the union of tag and explicit emails once, without exposing other recipients', async () => {
  await f.store.execute([
    "INSERT INTO person_tags VALUES (1,'organizer'),(2,'organizer'),(2,'helper'),(3,'member')",
    "INSERT INTO person_identifiers(person_id,kind,value,normalized_value) VALUES (2,'email','alias@example.com','alias@example.com')",
    "INSERT INTO subscriptions(person_id,email_identifier_id,kind,subscribed) VALUES (2,2,'event_invites',0)",
  ]);
  const input = {
    ...pollInput({ eligibleTags: ['organizer', 'helper'], maxSelections: null }),
    title: '<img src=x> & hackers',
    eligibleEmails: [' VOTER@example.com ', 'extra@example.com', 'extra@example.com'],
  };
  expect((await f.create(input)).status).toBe(201);
  expect(sent).toEqual([]);
  expect((await f.admin('/topics/publish', 'POST', {})).status).toBe(200);
  expect(sent).toEqual([]);
  const result = await f.admin('/topics/invite', 'POST', {});
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ recipients: 3, accepted: 3, failed: 0 });
  expect(sent.map((m) => m.to).sort()).toEqual([
    'alias@example.com',
    'extra@example.com',
    'voter@example.com',
  ]);
  for (const message of sent) {
    expect(message).toMatchObject({
      from: 'noreply@ainooga.org',
      replyTo: 'contact@ainooga.org',
    });
    expect(message.cc).toBeUndefined();
    expect(message.bcc).toBeUndefined();
    expect(message.html).toContain('&lt;img src=x&gt; &amp; hackers');
    expect(message.html).not.toContain('<img');
    expect(message.text).toContain('https://ainooga.test/#/polls/topics');
    for (const address of ['alias@example.com', 'extra@example.com', 'voter@example.com'])
      expect(message.text + message.html).not.toContain(address);
  }
  expect(result.headers.get('Cache-Control')).toBe('no-store');
});

it('checks authentication, origin, readiness and strict input before sending', async () => {
  const cookie = await f.ready();
  for (const headers of [
    {},
    { Cookie: cookie },
    { Authorization: `Bearer ${'b'.repeat(64)}` },
  ]) {
    expect(
      (await f.request('/api/admin/polls/topics/invite', 'POST', {}, headers)).status,
    ).toBe(401);
  }
  expect(
    (
      await f.request(
        '/api/admin/polls/topics/invite',
        'POST',
        {},
        {
          Authorization: `Bearer ${ORGANIZER_TOKEN}`,
          Origin: 'https://elsewhere.test',
        },
      )
    ).status,
  ).toBe(403);
  expect(
    (await f.admin('/topics/invite', 'POST', { to: 'stranger@example.com' })).status,
  ).toBe(400);
  expect((await f.admin('/topics/invite')).status).toBe(405);
  f.env.POLLS_READY = 'false';
  expect((await f.admin('/topics/invite', 'POST', {})).status).toBe(503);
  f.env.POLLS_READY = 'true';
  f.deps.allowed = false;
  expect((await f.admin('/topics/invite', 'POST', {})).status).toBe(429);
  expect(sent).toEqual([]);
});

it('rejects drafts, closed and archived polls without sending', async () => {
  await f.create();
  expect((await f.admin('/topics/invite', 'POST', {})).status).toBe(409);
  await f.admin('/topics/allowlist', 'POST', {
    action: 'add',
    identifiers: [{ kind: 'email', value: 'voter@example.com' }],
  });
  await f.admin('/topics/publish', 'POST', {});
  await f.setTime('2026-10-30T12:00:00.000Z');
  expect((await f.admin('/topics/invite', 'POST', {})).status).toBe(409);
  await f.admin('/topics/archive', 'POST', {});
  expect((await f.admin('/topics/invite', 'POST', {})).status).toBe(409);
  expect(sent).toEqual([]);
});

it('uses current eligibility, reports partial failures and only resends on another command', async () => {
  await f.store.execute([
    "INSERT INTO person_tags VALUES (2,'organizer'),(3,'organizer')",
  ]);
  await f.create(pollInput({ eligibleTags: ['organizer'] }));
  await f.admin('/topics/publish', 'POST', {});
  rejected.add('other@example.com');
  const result = await f.admin('/topics/invite', 'POST', {});
  expect(await result.json()).toEqual({ recipients: 2, accepted: 1, failed: 1 });
  expect(sent).toHaveLength(2);
  await f.store.execute(['DELETE FROM person_tags WHERE person_id=3']);
  expect(await (await f.admin('/topics/invite', 'POST', {})).json()).toEqual({
    recipients: 1,
    accepted: 1,
    failed: 0,
  });
  expect(sent).toHaveLength(3);
  await f.store.execute(['DELETE FROM person_tags WHERE person_id=2']);
  expect(await (await f.admin('/topics/invite', 'POST', {})).json()).toEqual({
    recipients: 0,
    accepted: 0,
    failed: 0,
  });
});

it('reports missing email configuration without exposing provider details', async () => {
  await f.ready();
  f.env.EMAIL = undefined as unknown as SendEmail;
  expect((await f.admin('/topics/invite', 'POST', {})).status).toBe(503);
  expect(sent).toEqual([]);
});

it('bounds provider waits and reports uncertain delivery without an automatic retry', async () => {
  await f.ready();
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
  const pending = f.admin('/topics/invite', 'POST', {});
  await started.promise;
  await vi.advanceTimersByTimeAsync(10000);
  expect(await (await pending).json()).toEqual({ recipients: 1, accepted: 0, failed: 1 });
  finish.resolve();
  expect(attempts).toBe(1);
});
