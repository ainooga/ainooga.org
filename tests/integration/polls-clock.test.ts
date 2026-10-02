// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { pollFixture, pollInput, submission } from '../helpers/polls';
import { pauseBatch } from '../helpers/background';
import { DATABASE_NOW } from '../../worker/src/polls/clock';
let f: Awaited<ReturnType<typeof pollFixture>>;
afterEach(async () => {
  await f?.dispose();
});

it.each(['close', 'edit', 'session'] as const)(
  'rejects a queued request crossing the %s boundary without writes',
  async (boundary) => {
    f = await pollFixture();
    const cookie = await f.ready(
      pollInput({
        endsAt: '2026-09-29T12:02:00.000Z',
        editDeadline: '2026-09-29T12:01:00.000Z',
      }),
    );
    let revision = 0;
    if (boundary === 'edit') {
      expect(
        (
          await f.request('/api/polls/topics/ballot', 'PUT', submission([], 0, 'First'), {
            Cookie: cookie,
          })
        ).status,
      ).toBe(200);
      revision = 1;
    }
    if (boundary === 'session')
      await f.store.execute([
        "UPDATE voter_sessions SET expires_at='2026-09-29T12:01:00.000Z'",
      ]);
    await f.setTime(
      boundary === 'close' ? '2026-09-29T12:01:59.999Z' : '2026-09-29T12:00:59.999Z',
    );
    const tables = [
      'poll_ballots',
      'poll_options',
      'poll_ballot_choices',
      'poll_submission_receipts',
    ];
    const before = await Promise.all(
      tables.map((t) => f.store.query(`SELECT * FROM ${t}`)),
    );
    const gate = pauseBatch(f.db, 'before');
    f.deps.db = gate.db;
    const pending = f.request(
      '/api/polls/topics/ballot',
      'PUT',
      submission([], revision, 'First'),
      { Cookie: cookie },
    );
    await gate.reached;
    try {
      await f.setDatabaseTime(
        boundary === 'close' ? '2026-09-29T12:02:00.000Z' : '2026-09-29T12:01:00.000Z',
      );
    } finally {
      gate.release();
    }
    const response = await pending;
    expect(response.status).toBe(boundary === 'session' ? 401 : 409);
    expect(await response.json()).toMatchObject({
      code: { session: 'login_required', edit: 'edits_closed', close: 'closed' }[
        boundary
      ],
    });
    expect(
      await Promise.all(tables.map((t) => f.store.query(`SELECT * FROM ${t}`))),
    ).toEqual(before);
  },
);
it('returns an accepted ballot even if session expiry passes later in its transaction', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  await f.store.execute([
    "UPDATE voter_sessions SET expires_at='2026-09-29T12:00:01.000Z'",
  ]);
  const db = f.db;
  f.deps.db = new Proxy(db, {
    get(target, key) {
      if (key === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch([
            statements[0]!,
            f.rawDb.prepare("UPDATE test_poll_clock SET now='2026-09-29T12:00:02.000Z'"),
            ...statements.slice(1),
          ]);
          result.splice(1, 1);
          return result;
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const input = submission([], 0, 'Accepted');
  expect(
    (await f.request('/api/polls/topics/ballot', 'PUT', input, { Cookie: cookie }))
      .status,
  ).toBe(200);
  f.deps.db = db;
  expect(
    (await f.request('/api/polls/topics/ballot', 'PUT', input, { Cookie: cookie }))
      .status,
  ).toBe(401);
  expect(await f.store.query('SELECT revision FROM poll_ballots')).toEqual([
    { revision: 1 },
  ]);
});
it('rejects an expired-session retry after close but allows the same retry after login', async () => {
  f = await pollFixture();
  const cookie = await f.ready(pollInput({ endsAt: '2026-09-29T12:01:00.000Z' }));
  const input = submission([], 0, 'Accepted');
  expect(
    (await f.request('/api/polls/topics/ballot', 'PUT', input, { Cookie: cookie }))
      .status,
  ).toBe(200);
  await f.setDatabaseTime('2026-09-30T12:00:00.000Z');
  expect(
    (await f.request('/api/polls/topics/ballot', 'PUT', input, { Cookie: cookie }))
      .status,
  ).toBe(401);
  await f.setTime('2026-09-30T12:00:00.000Z');
  const login = await f.request('/api/polls/topics/auth/honor', 'POST', {
    identifier: { kind: 'email', value: 'voter@example.com' },
    turnstileToken: 'bot',
  });
  const fresh = login.headers.get('set-cookie')!.split(';')[0]!;
  expect(
    await (
      await f.request('/api/polls/topics/ballot', 'PUT', input, { Cookie: fresh })
    ).json(),
  ).toMatchObject({ revision: 1 });
});
it('uses the production SQLite clock for authentication and stored timestamps', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  await f.store.execute([
    "UPDATE polls SET starts_at='1970-01-01T00:00:00.000Z',ends_at='9999-01-01T00:00:00.000Z' WHERE slug='topics'",
    "UPDATE voter_sessions SET expires_at='9999-01-01T00:00:00.000Z'",
  ]);
  f.deps.db = f.rawDb;
  f.deps.time = new Date('1900-01-01T00:00:00.000Z');
  const before = await f.rawDb
    .prepare(`SELECT ${DATABASE_NOW} AS now`)
    .first<{ now: string }>();
  const response = await f.request(
    '/api/polls/topics/ballot',
    'PUT',
    submission([], 0, 'Native clock'),
    { Cookie: cookie },
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { submittedAt: string; updatedAt: string };
  const after = await f.rawDb
    .prepare(`SELECT ${DATABASE_NOW} AS now`)
    .first<{ now: string }>();
  expect(body.submittedAt >= before!.now && body.submittedAt <= after!.now).toBe(true);
  expect(body.updatedAt).toBe(body.submittedAt);
});
it('rechecks session expiration before returning a queued detail read', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const gate = pauseBatch(f.db, 'before');
  f.deps.db = gate.db;
  const pending = f.request('/api/polls/topics', 'GET', undefined, { Cookie: cookie });
  await gate.reached;
  try {
    await f.setDatabaseTime('2026-09-30T12:00:00.000Z');
  } finally {
    gate.release();
  }
  expect((await pending).status).toBe(401);
});
