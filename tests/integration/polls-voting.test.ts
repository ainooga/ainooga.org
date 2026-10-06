// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { pollFixture, pollInput } from '../helpers/polls';
import { responseCookie } from '../helpers/auth';
let f: Awaited<ReturnType<typeof pollFixture>>;
afterEach(async () => {
  await f?.dispose();
});

it.each([
  [1, 1, [0], 200],
  [1, 1, [], 409],
  [1, 1, [0, 1], 409],
  [2, 2, [0, 1], 200],
  [2, 2, [0], 409],
  [1, 2, [0, 1], 200],
  [1, null, [0, 1], 200],
  [1, null, [], 409],
  [1, 1, [0, 0], 200],
] as const)('enforces min=%s max=%s selections=%s', async (min, max, indexes, status) => {
  f = await pollFixture();
  const cookie = await f.ready(pollInput({ minSelections: min, maxSelections: max }));
  const submission = await f.ballotFor(cookie);
  const options = (
    (await (await f.admin('/topics')).json()) as { optionRecords: { id: number }[] }
  ).optionRecords;
  const r = await f.request(
    '/api/polls/topics/ballot',
    'PUT',
    submission(indexes.map((i) => options[i]!.id)),
    { Cookie: cookie },
  );
  expect(r.status).toBe(status);
  expect(await f.store.query('SELECT count(*) AS n FROM poll_ballots')).toEqual([
    { n: status === 200 ? 1 : 0 },
  ]);
});
it.each([
  ['2026-09-29T11:59:59.999Z', 409],
  ['2026-09-29T12:00:00.000Z', 200],
  ['2026-10-30T11:59:59.999Z', 200],
  ['2026-10-30T12:00:00.000Z', 409],
])('checks voting boundary %s', async (now, status) => {
  f = await pollFixture();
  await f.ready();
  await f.setTime(now);
  // Refresh the session at this time so the test isolates the poll window, not session expiry.
  const login = await f.request('/api/polls/topics/auth/honor', 'POST', {
    identifier: { kind: 'email', value: 'voter@example.com' },
    turnstileToken: 'bot',
  });
  const submission = await f.ballotFor(responseCookie(login));
  expect(
    (
      await f.request('/api/polls/topics/ballot', 'PUT', submission([], 0, 'Boundary'), {
        Cookie: responseCookie(login),
      })
    ).status,
  ).toBe(status);
});
it.each([
  [true, '2026-09-29T13:00:00.000Z', '2026-09-29T12:59:59.999Z', 200],
  [true, '2026-09-29T13:00:00.000Z', '2026-09-29T13:00:00.000Z', 409],
  [false, null, '2026-09-29T12:01:00.000Z', 409],
  [true, null, '2026-10-30T11:59:59.999Z', 200],
  [true, null, '2026-10-30T12:00:00.000Z', 409],
] as const)(
  'checks edit policy %s deadline=%s now=%s',
  async (allowEdits, editDeadline, now, status) => {
    f = await pollFixture();
    const cookie = await f.ready(pollInput({ allowEdits, editDeadline }));
    const submission = await f.ballotFor(cookie);
    expect(
      (
        await f.request('/api/polls/topics/ballot', 'PUT', submission([], 0, 'First'), {
          Cookie: cookie,
        })
      ).status,
    ).toBe(200);
    await f.setTime(now);
    const login = await f.request('/api/polls/topics/auth/honor', 'POST', {
      identifier: { kind: 'email', value: 'voter@example.com' },
      turnstileToken: 'bot',
    });
    const renewed = await f.ballotFor(responseCookie(login));
    expect(
      (
        await f.request('/api/polls/topics/ballot', 'PUT', renewed([], 1, 'First'), {
          Cookie: responseCookie(login),
        })
      ).status,
    ).toBe(status);
  },
);
it.each(['before_vote', 'after_vote', 'never'] as const)(
  'enforces %s results before/after voting and after close',
  async (visibility) => {
    f = await pollFixture();
    let cookie = await f.ready(pollInput({ resultsVisibility: visibility }));
    const submission = await f.ballotFor(cookie);
    const results = () =>
      f.request('/api/polls/topics/results', 'GET', undefined, { Cookie: cookie });
    expect((await results()).status).toBe(visibility === 'before_vote' ? 200 : 403);
    await f.request('/api/polls/topics/ballot', 'PUT', submission([], 0, 'Choice'), {
      Cookie: cookie,
    });
    expect((await results()).status).toBe(visibility === 'never' ? 403 : 200);
    await f.setTime('2026-10-30T12:00:00.000Z');
    cookie = responseCookie(
      await f.request('/api/polls/topics/auth/honor', 'POST', {
        identifier: { kind: 'email', value: 'voter@example.com' },
        turnstileToken: 'bot',
      }),
    );
    expect((await results()).status).toBe(visibility === 'never' ? 403 : 200);
    expect((await f.admin('/topics/results')).status).toBe(200);
  },
);
it('deduplicates normalized write-ins, retains them on edits, and retains accepted ballots after eligibility removal', async () => {
  f = await pollFixture();
  const cookie = await f.ready();
  const submission = await f.ballotFor(cookie);
  const options = (
    (await (await f.admin('/topics')).json()) as { optionRecords: { id: number }[] }
  ).optionRecords;
  expect(
    (
      await f.request(
        '/api/polls/topics/ballot',
        'PUT',
        submission([options[0]!.id], 0, ' ROBOTICS '),
        { Cookie: cookie },
      )
    ).status,
  ).toBe(200);
  const next = await f.request(
    '/api/polls/topics/ballot',
    'PUT',
    submission([], 1, 'Space   Robots'),
    { Cookie: cookie },
  );
  expect(next.status).toBe(200);
  expect(
    (
      await f.request(
        '/api/polls/topics/ballot',
        'PUT',
        submission([options[0]!.id], 2),
        { Cookie: cookie },
      )
    ).status,
  ).toBe(200);
  const detail = (await (
    await f.request('/api/polls/topics', 'GET', undefined, { Cookie: cookie })
  ).json()) as { options: { label: string }[] };
  expect(detail.options).toHaveLength(3);
  expect(detail.options.map((o) => o.label)).toContain('Space   Robots');
  const change = (action: string) =>
    f.admin('/topics/allowlist', 'POST', {
      action,
      identifiers: [{ kind: 'email', value: 'voter@example.com' }],
    });
  await change('remove');
  expect(
    (await f.request('/api/polls/topics', 'GET', undefined, { Cookie: cookie })).status,
  ).toBe(401);
  expect(await (await f.admin('/topics/results')).json()).toMatchObject({
    ballotCount: 1,
    eligibleCount: 0,
    options: expect.arrayContaining([expect.objectContaining({ votes: 1 })]),
  });
  expect(await (await f.admin('/topics/ballots')).json()).toMatchObject([
    { personId: 2, revision: 3, currentlyEligible: false },
  ]);
  await change('add');
  expect(await (await f.admin('/topics/results')).json()).toMatchObject({
    ballotCount: 1,
    eligibleCount: 1,
  });
  expect(
    await (
      await f.request('/api/polls/topics/ballot', 'GET', undefined, { Cookie: cookie })
    ).json(),
  ).toMatchObject({ revision: 3 });
});
it('rejects foreign options, disabled write-ins and invalid write-in lengths without writes', async () => {
  f = await pollFixture();
  const cookie = await f.ready(pollInput({ allowWriteIns: false }));
  const submission = await f.ballotFor(cookie);
  await f.create(pollInput({ slug: 'foreign' }));
  const foreign = (
    (await (await f.admin('/foreign')).json()) as { optionRecords: { id: number }[] }
  ).optionRecords[0]!.id;
  for (const input of [
    submission([foreign]),
    submission([], 0, 'New'),
    submission([], 0, 'x'.repeat(201)),
    submission([], 0, '  '),
  ])
    expect([400, 409]).toContain(
      (await f.request('/api/polls/topics/ballot', 'PUT', input, { Cookie: cookie }))
        .status,
    );
  expect(
    await f.store.query(
      'SELECT count(*) AS n FROM poll_ballots WHERE request_id IS NOT NULL',
    ),
  ).toEqual([{ n: 0 }]);
});
