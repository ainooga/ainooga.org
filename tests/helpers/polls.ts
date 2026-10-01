import { authFixture, ORGANIZER_TOKEN, SITE, responseCookie } from './auth';
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
  return { ...f, request, admin, create, ready };
}
export function submission(
  optionIds: number[],
  expectedRevision = 0,
  writeIn: string | null = null,
) {
  return { requestId: crypto.randomUUID(), expectedRevision, optionIds, writeIn };
}
