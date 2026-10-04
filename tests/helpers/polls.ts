import { authFixture, ORGANIZER_TOKEN, SITE, responseCookie } from './auth';
import { pollClock } from './poll-clock';
import { migration } from './d1';
import { handleAuth } from '../../worker/src/auth/router';
import type { PollInput } from '../../worker/src/polls/schemas';

export function pollInput(overrides: Partial<PollInput> = {}): PollInput {
  return {
    slug: 'topics',
    title: 'Next talk',
    description: 'Pick **one**.',
    identityMode: 'honor',
    minSelections: 1,
    maxSelections: 1,
    allowWriteIns: true,
    resultsVisibility: 'after_vote',
    startsAt: '2026-09-29T12:00:00.000Z',
    endsAt: '2026-10-30T12:00:00.000Z',
    allowEdits: true,
    editDeadline: null,
    options: ['Robotics', 'Language models'],
    eligibleTags: [],
    ...overrides,
  };
}
export async function pollFixture() {
  const f = await authFixture();
  await migration(f.store, '0004_poll_api.sql');
  f.env.POLLS_READY = 'true';
  const clock = await pollClock(f.db, f.deps.time);
  f.deps.db = clock.db;
  function request(
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return handleAuth(
      new Request(`${SITE}${path}`, {
        method,
        headers: {
          Origin: SITE,
          ...headers,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      f.env,
      f.deps,
      f.deps,
    );
  }
  const admin = (path = '', method = 'GET', body?: unknown) =>
    request(`/api/admin/polls${path}`, method, body, {
      Authorization: `Bearer ${ORGANIZER_TOKEN}`,
    });
  async function create(input = pollInput()) {
    return admin('', 'POST', input);
  }
  async function ready(input = pollInput()) {
    const result = await create(input);
    if (result.status !== 201) throw new Error(`Create failed: ${await result.text()}`);
    await admin(`/${input.slug}/allowlist`, 'POST', {
      action: 'add',
      identifiers: [{ kind: 'email', value: 'voter@example.com' }],
    });
    const published = await admin(`/${input.slug}/publish`, 'POST');
    if (published.status !== 200)
      throw new Error(`Publish failed: ${await published.text()}`);
    const login = await request(`/api/polls/${input.slug}/auth/honor`, 'POST', {
      identifier: { kind: 'email', value: 'voter@example.com' },
      turnstileToken: 'bot',
    });
    return responseCookie(login);
  }
  return {
    ...f,
    db: clock.db,
    rawDb: f.db,
    prepared: clock.prepared,
    request,
    admin,
    create,
    ready,
    async ballotFor(cookie: string, slug = 'topics') {
      const response = await request(`/api/polls/${slug}`, 'GET', undefined, {
        Cookie: cookie,
      });
      if (response.status !== 200) throw new Error('Cannot load voter context');
      const { sessionContext } = (await response.json()) as { sessionContext: string };
      if (!/^[a-f0-9]{64}$/.test(sessionContext))
        throw new Error('Missing voter context');
      return (optionIds: number[], expectedRevision = 0, writeIn: string | null = null) =>
        submission(sessionContext, optionIds, expectedRevision, writeIn);
    },
    async setTime(value: string) {
      f.deps.time = new Date(value);
      await clock.set(f.deps.time);
    },
    setDatabaseTime: (value: string) => clock.set(new Date(value)),
  };
}
export function submission(
  sessionContext: string,
  optionIds: number[],
  expectedRevision = 0,
  writeIn: string | null = null,
) {
  return {
    requestId: crypto.randomUUID(),
    sessionContext,
    expectedRevision,
    optionIds,
    writeIn,
  };
}
