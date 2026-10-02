// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { pollFixture, submission, pollInput } from '../helpers/polls';
import { pauseBatch } from '../helpers/background';
import { responseCookie, verifiedLogin } from '../helpers/auth';
let f: Awaited<ReturnType<typeof pollFixture>>;
afterEach(async () => {
  await f?.dispose();
});

it('accepts one concurrent first submission and one concurrent edit, with no losing write-ins', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const send = (name: string, revision: number) =>
    f.request('/api/polls/topics/ballot', 'PUT', submission([], revision, name), {
      Cookie: cookie,
    });
  expect(
    (await Promise.all([send('A', 0), send('B', 0)])).map((r) => r.status).sort(),
  ).toEqual([200, 409]);
  const options = ((await (await f.admin('/topics')).json()) as { options: string[] })
    .options;
  expect(
    (await Promise.all([send(options[0]!, 1), send(options[1]!, 1)]))
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
    await f.store.query('SELECT count(*) AS n FROM poll_submission_receipts'),
  ).toEqual([{ n: 1 }]);
});
it('makes simultaneous identical retries idempotent and rejects changed payloads', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
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
  expect(
    await (
      await f.request('/api/polls/topics/ballot', 'PUT', input, {
        Cookie: responseCookie(login),
      })
    ).json(),
  ).toMatchObject({ revision: 1 });
  expect(await f.store.query('SELECT count(*) AS n FROM poll_ballots')).toEqual([
    { n: 1 },
  ]);
});
it('uses one ballot across linked verified and honor sessions', async () => {
  f = await pollFixture();
  const honor = await f.ready();
  const verified = responseCookie(await verifiedLogin(f));
  const discord = responseCookie(
    await f.request('/api/polls/topics/auth/honor', 'POST', {
      identifier: { kind: 'discord', value: '123456789012345678' },
      turnstileToken: 'bot',
    }),
  );
  const responses = await Promise.all([
    f.request('/api/polls/topics/ballot', 'PUT', submission([], 0, 'Discord'), {
      Cookie: discord,
    }),
    f.request('/api/polls/topics/ballot', 'PUT', submission([], 0, 'Honor'), {
      Cookie: honor,
    }),
    f.request('/api/polls/topics/ballot', 'PUT', submission([], 0, 'Verified'), {
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
  const responses = await Promise.all([
    f.request('/api/polls/topics/ballot', 'PUT', submission([], 0, 'Space  Robots'), {
      Cookie: first,
    }),
    f.request('/api/polls/topics/ballot', 'PUT', submission([], 0, ' space robots '), {
      Cookie: second,
    }),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(
    await f.store.query("SELECT count(*) AS n FROM poll_options WHERE origin='write_in'"),
  ).toEqual([{ n: 1 }]);
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
          action: 'revoke',
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
    for (const table of [
      'poll_ballots',
      'poll_submission_receipts',
      'poll_ballot_choices',
    ])
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
  for (const table of ['poll_ballots', 'poll_submission_receipts'])
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
  const update = f.admin('/topics', 'PUT', pollInput({ options: ['Replacement'] }));
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
  });
});
