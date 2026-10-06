// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { pollFixture, pollInput } from '../helpers/polls';
import { seedOptions, optionIds } from '../helpers/poll-options';
import { responseCookie } from '../helpers/auth';
let f: Awaited<ReturnType<typeof pollFixture>>;
afterEach(async () => {
  await f?.dispose();
});

it('allows one new write-in, preserves it through edits/revocation, and rejects another without writes', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const submission = await f.ballotFor(cookie);
  const send = (input: ReturnType<typeof submission>) =>
    f.request('/api/polls/topics/ballot', 'PUT', input, { Cookie: cookie });
  const first = submission([], 0, 'My suggestion');
  expect((await send(first)).status).toBe(200);
  const before = await f.store.query(
    'SELECT request_id,payload_hash,attempt_nonce FROM poll_ballots WHERE request_id IS NOT NULL',
  );
  expect(
    await (await send(submission([], 1, 'Another suggestion'))).json(),
  ).toMatchObject({ code: 'write_in_limit' });
  expect(
    await f.store.query(
      'SELECT request_id,payload_hash,attempt_nonce FROM poll_ballots WHERE request_id IS NOT NULL',
    ),
  ).toEqual(before);
  expect(await (await send(first)).json()).toMatchObject({ revision: 1 });
  expect((await send(submission([], 1, ' MY   SUGGESTION '))).status).toBe(200);
  const ids = await optionIds(f.db);
  expect((await send(submission([ids[0]!], 2))).status).toBe(200);
  for (const action of ['revoke', 'add'])
    await f.admin('/topics/allowlist', 'POST', {
      action,
      identifiers: [{ kind: 'email', value: 'voter@example.com' }],
    });
  const rejected = await send(submission([], 3, 'Still another'));
  expect(rejected.status).toBe(409);
  expect(await rejected.json()).toMatchObject({ code: 'write_in_limit' });
  expect(
    await f.store.query("SELECT count(*) AS n FROM poll_options WHERE origin='write_in'"),
  ).toEqual([{ n: 1 }]);
  expect(await f.store.query('SELECT revision FROM poll_ballots')).toEqual([
    { revision: 3 },
  ]);
});
it('does not spend an allowance when a submitted label already exists', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const submission = await f.ballotFor(cookie);
  const send = (input: ReturnType<typeof submission>) =>
    f.request('/api/polls/topics/ballot', 'PUT', input, { Cookie: cookie });
  expect((await send(submission([], 0, ' ROBOTICS '))).status).toBe(200);
  expect((await send(submission([], 1, 'New suggestion'))).status).toBe(200);
});
it('allows only one creator when different voters compete for the final option slot', async () => {
  f = await pollFixture();
  const first = await f.ready();
  const submission = await f.ballotFor(first);
  await seedOptions(f.db, 497);
  await f.admin('/topics/allowlist', 'POST', {
    action: 'add',
    identifiers: [{ kind: 'email', value: 'other@example.com' }],
  });
  const second = responseCookie(
    await f.request('/api/polls/topics/auth/honor', 'POST', {
      identifier: { kind: 'email', value: 'other@example.com' },
      turnstileToken: 'bot',
    }),
  );
  const secondSubmission = await f.ballotFor(second);
  const attempts = [submission([], 0, 'Final A'), secondSubmission([], 0, 'Final B')];
  const cookies = [first, second];
  const replies = await Promise.all(
    attempts.map((input, i) =>
      f.request('/api/polls/topics/ballot', 'PUT', input, { Cookie: cookies[i]! }),
    ),
  );
  expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
  const winner = replies.findIndex((r) => r.status === 200);
  const loser = 1 - winner;
  expect(await replies[loser]!.json()).toMatchObject({ code: 'write_in_limit' });
  expect(await optionIds(f.db)).toHaveLength(500);
  expect(
    (
      await f.request('/api/polls/topics/ballot', 'PUT', attempts[winner], {
        Cookie: cookies[winner]!,
      })
    ).status,
  ).toBe(200);
  const ids = await optionIds(f.db);
  expect(
    (
      await f.request(
        '/api/polls/topics/ballot',
        'PUT',
        (loser === 0 ? submission : secondSubmission)([ids[0]!]),
        {
          Cookie: cookies[loser]!,
        },
      )
    ).status,
  ).toBe(200);
});
it.each([101, 500])('accepts all %s options on an unrestricted poll', async (count) => {
  f = await pollFixture();
  const cookie = await f.ready(pollInput({ maxSelections: null }));
  const submission = await f.ballotFor(cookie);
  await seedOptions(f.db, count - 2);
  const ids = await optionIds(f.db);
  const input = submission([...ids, ids[0]!]);
  expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(16384);
  const response = await f.request('/api/polls/topics/ballot', 'PUT', input, {
    Cookie: cookie,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ optionIds: ids });
});
it('still enforces a configured maximum against larger selection lists', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const submission = await f.ballotFor(cookie);
  await seedOptions(f.db, 100);
  expect(
    (
      await f.request(
        '/api/polls/topics/ballot',
        'PUT',
        submission(await optionIds(f.db)),
        { Cookie: cookie },
      )
    ).status,
  ).toBe(409);
  expect(await f.store.query('SELECT * FROM poll_ballots')).toEqual([]);
});
it('preserves historical options above the limit while blocking more creation', async () => {
  f = await pollFixture();
  const cookie = await f.ready(pollInput({ maxSelections: null }));
  const submission = await f.ballotFor(cookie);
  await seedOptions(f.db, 501);
  const ids = await optionIds(f.db);
  const denied = await f.request(
    '/api/polls/topics/ballot',
    'PUT',
    submission([], 0, 'Excess'),
    { Cookie: cookie },
  );
  expect(denied.status).toBe(409);
  expect(await denied.json()).toMatchObject({ code: 'write_in_limit' });
  expect(
    (
      await f.request('/api/polls/topics/ballot', 'PUT', submission(ids), {
        Cookie: cookie,
      })
    ).status,
  ).toBe(200);
  expect(await optionIds(f.db)).toEqual(ids);
});
it('keeps the streamed body limit for large selection arrays', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const submission = await f.ballotFor(cookie);
  const input = submission(Array.from({ length: 10000 }, () => 1));
  expect(
    (await f.request('/api/polls/topics/ballot', 'PUT', input, { Cookie: cookie }))
      .status,
  ).toBe(413);
});
it('reuses the same new label when two voters compete for the final slot', async () => {
  f = await pollFixture();
  const first = await f.ready();
  const submission = await f.ballotFor(first);
  await seedOptions(f.db, 497);
  await f.admin('/topics/allowlist', 'POST', {
    action: 'add',
    identifiers: [{ kind: 'email', value: 'other@example.com' }],
  });
  const second = responseCookie(
    await f.request('/api/polls/topics/auth/honor', 'POST', {
      identifier: { kind: 'email', value: 'other@example.com' },
      turnstileToken: 'bot',
    }),
  );
  const secondSubmission = await f.ballotFor(second);
  const replies = await Promise.all(
    [first, second].map((Cookie, index) =>
      f.request(
        '/api/polls/topics/ballot',
        'PUT',
        (index === 0 ? submission : secondSubmission)([], 0, 'Shared last option'),
        { Cookie },
      ),
    ),
  );
  expect(replies.map((response) => response.status)).toEqual([200, 200]);
  expect(await optionIds(f.db)).toHaveLength(500);
  expect(
    await f.store.query(
      "SELECT count(*) AS n FROM poll_options WHERE normalized_label='shared last option'",
    ),
  ).toEqual([{ n: 1 }]);
});
it('preserves a person’s older multiple write-ins and does not grant a fresh allowance', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const submission = await f.ballotFor(cookie);
  await f.store.execute([
    "INSERT INTO poll_options (poll_id,label,normalized_label,origin,created_by_person_id) SELECT id,'Older A','older a','write_in',2 FROM polls WHERE slug='topics'",
    "INSERT INTO poll_options (poll_id,label,normalized_label,origin,created_by_person_id) SELECT id,'Older B','older b','write_in',2 FROM polls WHERE slug='topics'",
  ]);
  const before = await optionIds(f.db);
  const denied = await f.request(
    '/api/polls/topics/ballot',
    'PUT',
    submission([], 0, 'New'),
    { Cookie: cookie },
  );
  expect(denied.status).toBe(409);
  expect(await denied.json()).toMatchObject({ code: 'write_in_limit' });
  expect(
    (
      await f.request('/api/polls/topics/ballot', 'PUT', submission([], 0, 'Older B'), {
        Cookie: cookie,
      })
    ).status,
  ).toBe(200);
  expect(await optionIds(f.db)).toEqual(before);
});
