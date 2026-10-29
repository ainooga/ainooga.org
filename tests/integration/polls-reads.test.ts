// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { pollFixture, pollInput } from '../helpers/polls';
let f: Awaited<ReturnType<typeof pollFixture>>;
afterEach(async () => {
  await f?.dispose();
});

type Add = <T>(result: D1Result<T>) => D1Result<T>;
function forward(target: object, property: string | symbol) {
  const value: unknown = Reflect.get(target, property);
  return typeof value === 'function' ? value.bind(target) : value;
}
function override<T extends object>(target: T, overrides: Record<string, unknown>): T {
  return new Proxy(target, {
    get: (t, property) =>
      typeof property === 'string' && Object.hasOwn(overrides, property)
        ? overrides[property]
        : forward(t, property),
  });
}
function meteredStatement(statement: D1PreparedStatement, add: Add): D1PreparedStatement {
  return override(statement, {
    bind: (...values: unknown[]) => meteredStatement(statement.bind(...values), add),
    all: async () => add(await statement.all()),
    run: async () => add(await statement.run()),
    // Served via all() so every execution path reports rows_read.
    first: async () => add(await statement.all()).results[0] ?? null,
    raw: () => {
      throw new Error('raw() is not metered');
    },
  });
}
// Counts D1 `meta.rows_read` for every statement the worker executes through
// deps.db. "Does not aggregate" is asserted as "the read costs the same no
// matter how many other ballots exist", which survives any SQL rewrite of the
// aggregate; the permitted-results test is the control proving the meter sees it.
function meterReads() {
  let rows = 0;
  const add: Add = (result) => {
    rows += result.meta.rows_read;
    return result;
  };
  const db = f.deps.db;
  f.deps.db = override(db, {
    prepare: (sql: string) => meteredStatement(db.prepare(sql), add),
    batch: async (statements: D1PreparedStatement[]) =>
      (await db.batch(statements)).map(add),
  });
  return async (path: string, cookie: string) => {
    rows = 0;
    const response = await f.request(path, 'GET', undefined, { Cookie: cookie });
    return { status: response.status, body: (await response.json()) as unknown, rows };
  };
}
// Three other people vote for the first predefined option.
async function otherBallots() {
  await f.rawDb.batch(
    [
      "INSERT INTO people (id,name) VALUES (10,'A'),(11,'B'),(12,'C')",
      "INSERT INTO poll_ballots (poll_id,person_id) SELECT p.id,x.id FROM polls p, people x WHERE p.slug='topics' AND x.id>=10",
      'INSERT INTO poll_ballot_choices SELECT b.id,b.poll_id,(SELECT min(id) FROM poll_options WHERE poll_id=b.poll_id) FROM poll_ballots b WHERE b.person_id>=10',
    ].map((sql) => f.rawDb.prepare(sql)),
  );
}
const resultKeys = ['ballotCount', 'eligibleCount', 'votes'];
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]);
}

it('does not aggregate results for the poll read', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const read = meterReads();
  const before = await read('/api/polls/topics', cookie);
  await otherBallots();
  const after = await read('/api/polls/topics', cookie);
  expect(after.status).toBe(200);
  expect(after.body).toMatchObject({ options: [{}, {}], ballot: null });
  expect(keysOf(after.body).filter((key) => resultKeys.includes(key))).toEqual([]);
  expect(after.rows).toBe(before.rows);
});
it('reads neither results nor options for the ballot read', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const read = meterReads();
  const before = await read('/api/polls/topics/ballot', cookie);
  await otherBallots();
  await f.rawDb
    .prepare(
      "INSERT INTO poll_options (poll_id,label,normalized_label,position,origin) SELECT id,'X','x',9,'predefined' FROM polls WHERE slug='topics'",
    )
    .run();
  const after = await read('/api/polls/topics/ballot', cookie);
  expect(after).toEqual({ status: 200, body: null, rows: before.rows });
});
it.each(['never', 'after_vote'] as const)(
  'does not reveal or aggregate denied %s results',
  async (resultsVisibility) => {
    f = await pollFixture();
    const cookie = await f.ready(pollInput({ resultsVisibility }));
    const read = meterReads();
    const before = await read('/api/polls/topics/results', cookie);
    await otherBallots();
    const after = await read('/api/polls/topics/results', cookie);
    expect(after).toEqual({
      status: 403,
      body: {
        error: 'Results are not available to this voter.',
        code: 'hidden_results',
        requestId: expect.any(String),
      },
      rows: before.rows,
    });
  },
);
it('computes permitted results over every ballot', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const submission = await f.ballotFor(cookie);
  const vote = await f.request(
    '/api/polls/topics/ballot',
    'PUT',
    submission([], 0, 'Choice'),
    { Cookie: cookie },
  );
  expect(vote.status).toBe(200);
  const read = meterReads();
  const before = await read('/api/polls/topics/results', cookie);
  await otherBallots();
  const after = await read('/api/polls/topics/results', cookie);
  expect(before.body).toMatchObject({ ballotCount: 1 });
  expect(after.status).toBe(200);
  expect(after.body).toMatchObject({
    ballotCount: 4,
    options: [
      { label: 'Robotics', votes: 3 },
      { label: 'Language models', votes: 0 },
      { label: 'Choice', votes: 1 },
    ],
  });
  // Control: proves the meter sees aggregation, so equal counts above mean none ran.
  expect(after.rows).toBeGreaterThan(before.rows);
});
