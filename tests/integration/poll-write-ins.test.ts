// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { pollFixture, submission } from '../helpers/polls';
import type { PollDetail } from '../../src/lib/polls/types';
import { responseCookie } from '../helpers/auth';
import { hashToken } from '../../worker/src/auth/crypto';

import { fileDatabase } from '../helpers/file-database';

const open = fileDatabase();
let f: Awaited<ReturnType<typeof pollFixture>>;
afterEach(async () => f?.dispose());

it('keeps an edited-away write-in selectable by another voter', async () => {
  f = await pollFixture(open, false);
  const cookie = await f.votingPoll();
  const author = await voterDetail(cookie);
  const predefined = author.options.find((option) => option.origin === 'predefined')!.id;
  const first = await f.request(
    '/api/polls/topics/ballot',
    'PUT',
    {
      ...submission(author.sessionContext, [], 0, 'Space  Robots'),
      writeInDescription: ' Original description ',
    },
    { Cookie: cookie },
  );
  expect(first.status).toBe(200);
  const { optionIds } = (await first.json()) as { optionIds: number[] };
  expect(optionIds).toHaveLength(1);
  const edited = await f.request(
    '/api/polls/topics/ballot',
    'PUT',
    submission(author.sessionContext, [predefined], 1),
    { Cookie: cookie },
  );
  expect(edited.status).toBe(200);
  expect(await edited.json()).toMatchObject({ revision: 2, optionIds: [predefined] });
  const other = await otherVoter();
  const reader = await voterDetail(other);
  const published = reader.options.find((option) => option.id === optionIds[0]);
  expect(published).toMatchObject({
    label: 'Space  Robots',
    description: 'Original description',
    origin: 'write_in',
  });
  expect(reader.ballot).toBeNull();
  const second = await f.request(
    '/api/polls/topics/ballot',
    'PUT',
    submission(reader.sessionContext, [published!.id]),
    { Cookie: other },
  );
  expect(second.status).toBe(200);
  expect(await second.json()).toMatchObject({
    revision: 1,
    optionIds,
  });
  expect(
    await f.store.query(
      "SELECT label,description FROM poll_options WHERE origin='write_in'",
    ),
  ).toEqual([{ label: 'Space  Robots', description: 'Original description' }]);
});

it('rejects write-ins after an initial ballot without one and leaves all state unchanged', async () => {
  f = await pollFixture(open, false);
  const cookie = await f.votingPoll();
  const submission = await f.ballotFor(cookie);
  const option = await f.db
    .prepare('SELECT id FROM poll_options ORDER BY id LIMIT 1')
    .first<{ id: number }>();
  const send = (input: unknown) =>
    f.request('/api/polls/topics/ballot', 'PUT', input, { Cookie: cookie });
  expect((await send(submission([option!.id]))).status).toBe(200);
  const before = await f.store.query('SELECT * FROM poll_ballots');
  const choices = await f.store.query('SELECT * FROM poll_ballot_choices');
  const options = await f.store.query('SELECT * FROM poll_options');
  for (const revision of [1, 0]) {
    const denied = await send(submission([], revision, 'Late topic'));
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({ code: 'write_in_first_vote_only' });
  }
  expect(await f.store.query('SELECT * FROM poll_ballots')).toEqual(before);
  expect(await f.store.query('SELECT * FROM poll_ballot_choices')).toEqual(choices);
  expect(await f.store.query('SELECT * FROM poll_options')).toEqual(options);
});

it.each([undefined, null, '', '  ', 'x'.repeat(1000)])(
  'accepts an optional description (%#)',
  async (description) => {
    f = await pollFixture(open, false);
    const cookie = await f.votingPoll();
    const submission = await f.ballotFor(cookie);
    const response = await f.request(
      '/api/polls/topics/ballot',
      'PUT',
      {
        ...submission([], 0, 'Topic'),
        writeInDescription: description,
      },
      { Cookie: cookie },
    );
    expect(response.status).toBe(200);
    expect(
      await f.store.query("SELECT description FROM poll_options WHERE origin='write_in'"),
    ).toEqual([{ description: description?.trim() || null }]);
  },
);

it.each([
  { writeIn: 'Topic', writeInDescription: 'x'.repeat(1001) },
  { writeIn: 'Topic', writeInDescription: 123 },
  { writeIn: null, writeInDescription: 'Missing topic' },
  { writeIn: '   ', writeInDescription: 'Empty topic' },
  { writeIn: 'Topic', writeInDescription: 'Details', extra: true },
])('rejects invalid descriptions without writes (%#)', async (fields) => {
  f = await pollFixture(open, false);
  const cookie = await f.votingPoll();
  const submission = await f.ballotFor(cookie);
  const response = await f.request(
    '/api/polls/topics/ballot',
    'PUT',
    {
      ...submission([]),
      ...fields,
    },
    { Cookie: cookie },
  );
  expect(response.status).toBe(400);
  expect(await f.store.query('SELECT * FROM poll_ballots')).toEqual([]);
  expect(
    await f.store.query("SELECT * FROM poll_options WHERE origin='write_in'"),
  ).toEqual([]);
});

async function voterDetail(cookie: string): Promise<PollDetail> {
  const response = await f.request('/api/polls/topics', 'GET', undefined, {
    Cookie: cookie,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as PollDetail;
}

async function otherVoter() {
  await f.admin('/topics/allowlist', 'POST', {
    action: 'add',
    identifiers: [{ kind: 'email', value: 'other@example.com' }],
  });
  return responseCookie(
    await f.request('/api/polls/topics/auth/honor', 'POST', {
      identifier: { kind: 'email', value: 'other@example.com' },
      turnstileToken: 'bot',
    }),
  );
}

it('keeps the first topic and description when another voter supplies the same normalized topic', async () => {
  f = await pollFixture(open, false);
  const cookie = await f.votingPoll();
  const author = await f.ballotFor(cookie);
  const first = await f.request(
    '/api/polls/topics/ballot',
    'PUT',
    { ...author([], 0, 'Space  Robots'), writeInDescription: 'Original description' },
    { Cookie: cookie },
  );
  expect(first.status).toBe(200);
  const { optionIds } = (await first.json()) as { optionIds: number[] };
  const other = await otherVoter();
  const reader = await f.ballotFor(other);
  const second = await f.request(
    '/api/polls/topics/ballot',
    'PUT',
    { ...reader([], 0, ' space robots '), writeInDescription: 'Replacement description' },
    { Cookie: other },
  );
  expect(second.status).toBe(200);
  expect(await second.json()).toMatchObject({ optionIds });
  expect(
    await f.store.query(
      "SELECT label,description FROM poll_options WHERE origin='write_in'",
    ),
  ).toEqual([{ label: 'Space  Robots', description: 'Original description' }]);
});

it('retries descriptions exactly, conflicts on changes, and preserves accepted retries after close', async () => {
  f = await pollFixture(open, false);
  let cookie = await f.votingPoll();
  const submission = await f.ballotFor(cookie);
  let input = { ...submission([], 0, 'Gardens'), writeInDescription: 'AI plants' };
  const send = (body = input) =>
    f.request('/api/polls/topics/ballot', 'PUT', body, { Cookie: cookie });
  const first = await send();
  expect(first.status).toBe(200);
  const saved = await first.json();
  const before = await f.store.query('SELECT * FROM poll_ballots');
  expect(await (await send()).json()).toEqual(saved);
  expect((await send({ ...input, writeInDescription: 'Different' })).status).toBe(409);
  expect((await send({ ...input, writeInDescription: '' })).status).toBe(409);
  expect(await f.store.query('SELECT * FROM poll_ballots')).toEqual(before);
  await f.setTime('2026-10-30T12:00:00.000Z');
  cookie = responseCookie(
    await f.request('/api/polls/topics/auth/honor', 'POST', {
      identifier: { kind: 'email', value: 'voter@example.com' },
      turnstileToken: 'bot',
    }),
  );
  const renewed = await f.ballotFor(cookie);
  input = { ...input, sessionContext: renewed([]).sessionContext };
  expect(await (await send()).json()).toEqual(saved);
  expect(await f.store.query('SELECT * FROM poll_ballots')).toEqual(before);
});

it.each([0, 1])(
  'preserves retries with legacy hashes for an accepted revision %s request',
  async (revision) => {
    f = await pollFixture(open, false);
    const cookie = await f.votingPoll();
    const submission = await f.ballotFor(cookie);
    const input = submission([], 0, 'Legacy topic');
    const send = (body: unknown) =>
      f.request('/api/polls/topics/ballot', 'PUT', body, { Cookie: cookie });
    expect((await send(input)).status).toBe(200);
    const hash = await hashToken(JSON.stringify([revision, [], 'legacy topic']));
    if (revision === 0) {
      expect(await f.store.query('SELECT payload_hash FROM poll_ballots')).toEqual([
        { payload_hash: hash },
      ]);
    } else {
      // Simulate the latest receipt for an edit accepted before the first-vote-only rule.
      await f.db
        .prepare('UPDATE poll_ballots SET revision=2,payload_hash=?')
        .bind(hash)
        .run();
    }
    const before = await f.store.query('SELECT * FROM poll_ballots');
    for (const description of [undefined, null, '', '  ']) {
      const replay = await send({
        ...input,
        expectedRevision: revision,
        writeInDescription: description,
      });
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ revision: revision + 1 });
    }
    expect(await f.store.query('SELECT * FROM poll_ballots')).toEqual(before);
  },
);

it('rolls back a new topic and description if its ballot choices cannot be saved', async () => {
  f = await pollFixture(open, false);
  const cookie = await f.votingPoll();
  const submission = await f.ballotFor(cookie);
  await f.store.execute([
    `CREATE TRIGGER fail_choices BEFORE INSERT ON poll_ballot_choices
    BEGIN SELECT RAISE(ABORT,'intentional test failure'); END`,
  ]);
  const response = await f.request(
    '/api/polls/topics/ballot',
    'PUT',
    {
      ...submission([], 0, 'Rollback topic'),
      writeInDescription: 'Rollback description',
    },
    { Cookie: cookie },
  );
  expect(response.status).toBe(500);
  expect(await f.store.query('SELECT * FROM poll_ballots')).toEqual([]);
  expect(
    await f.store.query("SELECT * FROM poll_options WHERE origin='write_in'"),
  ).toEqual([]);
});
