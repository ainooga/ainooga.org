// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { pollFixture, pollInput } from '../helpers/polls';
import { responseCookie, ORGANIZER_TOKEN } from '../helpers/auth';

let f: Awaited<ReturnType<typeof pollFixture>>;
beforeEach(async () => {
  f = await pollFixture();
  await f.ready(pollInput());
  await f.db
    .prepare("UPDATE person_identifiers SET display_label=' Chapter.User ' WHERE id=4")
    .run();
});
afterEach(async () => f.dispose());
function login(value = 'chapter.user', slug = 'topics') {
  return f.request(`/api/polls/${slug}/auth/honor`, 'POST', {
    identifier: { kind: 'discord_username', value },
    turnstileToken: 'bot',
  });
}
it('matches a normalized username and shares the existing email ballot', async () => {
  const email = await f.request('/api/polls/topics/auth/honor', 'POST', {
    identifier: { kind: 'email', value: 'voter@example.com' },
    turnstileToken: 'bot',
  });
  const submission = await f.ballotFor(responseCookie(email));
  const details = (await (
    await f.request('/api/polls/topics', 'GET', undefined, {
      Cookie: responseCookie(email),
    })
  ).json()) as { options: { id: number }[] };
  await f.request(
    '/api/polls/topics/ballot',
    'PUT',
    submission([details.options[0]!.id]),
    { Cookie: responseCookie(email) },
  );
  const response = await login(' CHAPTER.USER ');
  expect(response.status).toBe(200);
  const read = await f.request('/api/polls/topics/ballot', 'GET', undefined, {
    Cookie: responseCookie(response),
  });
  expect(await read.json()).toMatchObject({
    revision: 1,
    optionIds: [details.options[0]!.id],
  });
  const session = await f.db
    .prepare(
      'SELECT identifier_id,identifier_value,assurance FROM voter_sessions WHERE identifier_id=4',
    )
    .first();
  expect(session).toEqual({
    identifier_id: 4,
    identifier_value: '123456789012345678',
    assurance: 'honor',
  });
  expect(
    await f.db.prepare('SELECT verified_at FROM person_identifiers WHERE id=4').first(),
  ).toEqual({ verified_at: null });
});
it.each(['missing', 'Chapter User', ''])(
  'does not guess a username: %s',
  async (name) => {
    expect([400, 403]).toContain((await login(name)).status);
  },
);
it('rejects ambiguous names even if only one matching person is eligible', async () => {
  await f.db
    .prepare(
      "INSERT INTO person_identifiers(person_id,kind,value,normalized_value,display_label) VALUES(3,'discord','987654321012345678','987654321012345678','chapter.user')",
    )
    .run();
  const before = await f.db.prepare('SELECT count(*) AS n FROM voter_sessions').first();
  expect((await login()).status).toBe(403);
  expect(await f.db.prepare('SELECT count(*) AS n FROM voter_sessions').first()).toEqual(
    before,
  );
});
it('accepts multiple matching identifiers only when they belong to one person', async () => {
  await f.db
    .prepare(
      "INSERT INTO person_identifiers(person_id,kind,value,normalized_value,display_label) VALUES(2,'discord','987654321012345678','987654321012345678','chapter.user')",
    )
    .run();
  expect((await login()).status).toBe(200);
});
it('honors revocation for both new and existing sessions', async () => {
  const response = await login();
  await f.admin('/topics/allowlist', 'POST', {
    action: 'remove',
    identifiers: [{ kind: 'email', value: 'voter@example.com' }],
  });
  expect((await login()).status).toBe(403);
  expect(
    (
      await f.request('/api/polls/topics', 'GET', undefined, {
        Cookie: responseCookie(response),
      })
    ).status,
  ).toBe(401);
});
it('cannot use a username to downgrade verified polls', async () => {
  expect((await login('chapter.user', 'verified')).status).toBe(403);
});
it('keeps origin and bot checks and never accepts the username on organizer linking', async () => {
  f.deps.botValid = false;
  expect((await login()).status).toBe(400);
  f.deps.botValid = true;
  expect(
    (
      await f.request(
        '/api/polls/topics/auth/honor',
        'POST',
        {
          identifier: { kind: 'discord_username', value: 'chapter.user' },
          turnstileToken: 'bot',
        },
        { Origin: 'https://foreign.test' },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await f.request(
        '/api/admin/people/2/identifiers',
        'POST',
        {
          kind: 'discord_username',
          value: 'chapter.user',
        },
        { Authorization: `Bearer ${ORGANIZER_TOKEN}` },
      )
    ).status,
  ).toBe(400);
});
it('does not match a label changed before session insertion executes', async () => {
  const raw = f.deps.db;
  f.deps.db = new Proxy(raw, {
    get(target, property) {
      if (property === 'prepare')
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (!sql.includes('lower(trim(i.display_label')) return statement;
          return {
            bind: (...values: unknown[]) => ({
              run: async () => {
                await raw
                  .prepare(
                    "UPDATE person_identifiers SET display_label='renamed' WHERE id=4",
                  )
                  .run();
                return statement.bind(...values).run();
              },
            }),
          };
        };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  expect((await login()).status).toBe(403);
});
