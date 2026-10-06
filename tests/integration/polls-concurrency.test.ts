// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { pollFixture, pollInput } from '../helpers/polls';
import { pauseBatch } from '../helpers/background';
import { responseCookie, verifiedLogin } from '../helpers/auth';
let f: Awaited<ReturnType<typeof pollFixture>>;
afterEach(async () => {
  await f?.dispose();
});

it('accepts one concurrent first submission and one concurrent edit, with no losing write-ins', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const submission = await f.ballotFor(cookie);
  const send = (name: string, revision: number) =>
    f.request('/api/polls/topics/ballot', 'PUT', submission([], revision, name), {
      Cookie: cookie,
    });
  expect(
    (await Promise.all([send('A', 0), send('B', 0)])).map((r) => r.status).sort(),
  ).toEqual([200, 409]);
  const options = (
    (await (await f.admin('/topics')).json()) as { optionRecords: { id: number }[] }
  ).optionRecords;
  const edit = (id: number) =>
    f.request('/api/polls/topics/ballot', 'PUT', submission([id], 1), { Cookie: cookie });
  expect(
    (await Promise.all([edit(options[0]!.id), edit(options[1]!.id)]))
      .map((r) => r.status)
      .sort(),
  ).toEqual([200, 409]);
  expect(await f.store.query('SELECT revision FROM poll_ballots')).toEqual([
    { revision: 2 },
  ]);
  expect(
    await f.store.query("SELECT count(*) AS n FROM poll_options WHERE origin='write_in'"),
  ).toEqual([{ n: 1 }]);
  expect(await f.store.query('SELECT count(*) AS n FROM poll_ballot_choices')).toEqual([
    { n: 1 },
  ]);
  expect(
    await f.store.query(
      'SELECT count(*) AS n FROM poll_ballots WHERE request_id IS NOT NULL',
    ),
  ).toEqual([{ n: 1 }]);
});
it('makes simultaneous identical retries idempotent and rejects changed payloads', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const submission = await f.ballotFor(cookie);
  const input = submission([], 0, 'First');
  const send = (body = input) =>
    f.request('/api/polls/topics/ballot', 'PUT', body, { Cookie: cookie });
  const replies = await Promise.all([send(), send()]);
  expect(await replies[0]!.json()).toEqual(await replies[1]!.json());
  expect((await send({ ...input, writeIn: 'Changed' })).status).toBe(409);
  await f.setTime('2026-10-30T12:00:00Z');
  const login = await f.request('/api/polls/topics/auth/honor', 'POST', {
    identifier: { kind: 'email', value: 'voter@example.com' },
    turnstileToken: 'bot',
  });
  const renewed = await f.ballotFor(responseCookie(login));
  expect(
    await (
      await f.request(
        '/api/polls/topics/ballot',
        'PUT',
        { ...input, sessionContext: renewed([]).sessionContext },
        {
          Cookie: responseCookie(login),
        },
      )
    ).json(),
  ).toMatchObject({ revision: 1 });
  expect(await f.store.query('SELECT count(*) AS n FROM poll_ballots')).toEqual([
    { n: 1 },
  ]);
});
it('uses one ballot across linked verified and honor sessions', async () => {
  f = await pollFixture();
  const honor = await f.ready();
  const submission = await f.ballotFor(honor);
  const verified = responseCookie(await verifiedLogin(f));
  const discord = responseCookie(
    await f.request('/api/polls/topics/auth/honor', 'POST', {
      identifier: { kind: 'discord', value: '123456789012345678' },
      turnstileToken: 'bot',
    }),
  );
  const discordSubmission = await f.ballotFor(discord);
  const verifiedSubmission = await f.ballotFor(verified);
  const responses = await Promise.all([
    f.request('/api/polls/topics/ballot', 'PUT', discordSubmission([], 0, 'Discord'), {
      Cookie: discord,
    }),
    f.request('/api/polls/topics/ballot', 'PUT', submission([], 0, 'Honor'), {
      Cookie: honor,
    }),
    f.request('/api/polls/topics/ballot', 'PUT', verifiedSubmission([], 0, 'Verified'), {
      Cookie: verified,
    }),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  expect(await f.store.query('SELECT person_id,revision FROM poll_ballots')).toEqual([
    { person_id: 2, revision: 1 },
  ]);
});
it('collapses simultaneous equivalent write-ins from different voters into one option', async () => {
  f = await pollFixture();
  const first = await f.ready();
  const submission = await f.ballotFor(first);
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
  const responses = await Promise.all([
    f.request(
      '/api/polls/topics/ballot',
      'PUT',
      { ...submission([], 0, 'Space  Robots'), writeInDescription: 'First description' },
      {
        Cookie: first,
      },
    ),
    f.request(
      '/api/polls/topics/ballot',
      'PUT',
      {
        ...secondSubmission([], 0, ' space robots '),
        writeInDescription: 'Second description',
      },
      {
        Cookie: second,
      },
    ),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(
    await f.store.query("SELECT count(*) AS n FROM poll_options WHERE origin='write_in'"),
  ).toEqual([{ n: 1 }]);
  const option = await f.db
    .prepare(
      "SELECT created_by_person_id AS creator,description FROM poll_options WHERE origin='write_in'",
    )
    .first<{ creator: number; description: string }>();
  expect(option!.description).toBe(
    option!.creator === 2 ? 'First description' : 'Second description',
  );
  expect(await (await f.admin('/topics/results')).json()).toMatchObject({
    ballotCount: 2,
    options: expect.arrayContaining([expect.objectContaining({ votes: 2 })]),
  });
});
it.each(['logout', 'revoke', 'archive', 'identifier'] as const)(
  'rechecks %s inside the ballot transaction',
  async (action) => {
    f = await pollFixture();
    const cookie = await f.ready();
    const submission = await f.ballotFor(cookie);
    const gate = pauseBatch(f.db, 'before');
    f.deps.db = gate.db;
    const pending = f.request(
      '/api/polls/topics/ballot',
      'PUT',
      submission([], 0, 'Denied'),
      { Cookie: cookie },
    );
    await gate.reached;
    try {
      if (action === 'logout')
        await f.request('/api/auth/logout', 'POST', {}, { Cookie: cookie });
      if (action === 'revoke')
        await f.admin('/topics/allowlist', 'POST', {
          action: 'remove',
          identifiers: [{ kind: 'email', value: 'voter@example.com' }],
        });
      if (action === 'archive') await f.admin('/topics/archive', 'POST');
      if (action === 'identifier')
        await f.store.execute([
          "UPDATE person_identifiers SET normalized_value='changed@example.com' WHERE id=2",
        ]);
    } finally {
      gate.release();
    }
    expect((await pending).status).toBe(401);
    for (const table of ['poll_ballots', 'poll_ballot_choices'])
      expect(await f.store.query(`SELECT count(*) AS n FROM ${table}`)).toEqual([
        { n: 0 },
      ]);
    expect(
      await f.store.query(
        "SELECT count(*) AS n FROM poll_options WHERE origin='write_in'",
      ),
    ).toEqual([{ n: 0 }]);
  },
);
it('rolls back the receipt and option on a later statement failure', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const submission = await f.ballotFor(cookie);
  const real = f.db;
  f.deps.db = new Proxy(real, {
    get(target, property) {
      if (property === 'batch')
        return (statements: D1PreparedStatement[]) =>
          target.batch([
            ...statements,
            real.prepare(
              'INSERT INTO poll_ballot_choices (ballot_id,poll_id,option_id) VALUES (-1,-1,-1)',
            ),
          ]);
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  expect(
    (
      await f.request('/api/polls/topics/ballot', 'PUT', submission([], 0, 'Rollback'), {
        Cookie: cookie,
      })
    ).status,
  ).toBe(500);
  for (const table of ['poll_ballots'])
    expect(await f.store.query(`SELECT count(*) AS n FROM ${table}`)).toEqual([{ n: 0 }]);
  expect(
    await f.store.query("SELECT count(*) AS n FROM poll_options WHERE origin='write_in'"),
  ).toEqual([{ n: 0 }]);
});
it('orders publication against draft edits without changing published options', async () => {
  f = await pollFixture();
  await f.create();
  await f.admin('/topics/allowlist', 'POST', {
    action: 'add',
    identifiers: [{ kind: 'email', value: 'voter@example.com' }],
  });
  const gate = pauseBatch(f.db, 'before');
  f.deps.db = gate.db;
  const update = f.admin(
    '/topics',
    'PUT',
    pollInput({ options: ['Replacement'], eligibleEmails: ['unwanted@example.com'] }),
  );
  await gate.reached;
  try {
    expect((await f.admin('/topics/publish', 'POST')).status).toBe(200);
  } finally {
    gate.release();
  }
  expect((await update).status).toBe(409);
  expect(await (await f.admin('/topics')).json()).toMatchObject({
    options: ['Robotics', 'Language models'],
    status: 'published',
    eligibleEmails: ['voter@example.com'],
  });
  expect(
    await f.store.query(
      "SELECT * FROM person_identifiers WHERE normalized_value='unwanted@example.com'",
    ),
  ).toEqual([]);
});
