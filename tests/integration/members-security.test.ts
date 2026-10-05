// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { memberFixture, memberInput } from '../helpers/members';
import { ORGANIZER_TOKEN, SITE } from '../helpers/auth';
import { handleAuth } from '../../worker/src/auth/router';
let f: Awaited<ReturnType<typeof memberFixture>>;
afterEach(async () => {
  await f?.dispose();
});

it('requires a current organizer token for both endpoints before inspecting private input', async () => {
  f = await memberFixture();
  for (const preview of [true, false]) {
    for (const token of [
      '',
      'Bearer wrong',
      `Bearer ${'b'.repeat(64)}`,
      `Bearer ${ORGANIZER_TOKEN} trailing`,
    ]) {
      const response = await f.importMember({ invalid: 'private@example.com' }, preview, {
        Authorization: token,
        Cookie: 'voter_session=anything',
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.text()).not.toContain('private@example.com');
    }
    expect(
      (await f.importMember(memberInput(), preview, { Origin: 'https://evil.test' }))
        .status,
    ).toBe(403);
  }
  f.env.ORGANIZER_API_TOKENS = JSON.stringify([
    { name: 'replacement', personId: 1, token: 'b'.repeat(64) },
  ]);
  expect((await f.importMember(memberInput())).status).toBe(401);
  expect(await f.store.query('SELECT * FROM memberships')).toEqual([]);
});

it('enforces readiness, methods, JSON limits and rate limiting', async () => {
  f = await memberFixture();
  const request = (method: string, body?: string, type = 'application/json') =>
    handleAuth(
      new Request(`${SITE}/api/admin/members/import`, {
        method,
        body,
        headers: { Authorization: `Bearer ${ORGANIZER_TOKEN}`, 'Content-Type': type },
      }),
      f.env,
      f.deps,
      f.deps,
    );
  expect((await request('GET')).status).toBe(405);
  expect((await request('POST', '{}', 'text/plain')).status).toBe(415);
  expect((await request('POST', '{')).status).toBe(400);
  expect((await request('POST', 'x'.repeat(16385))).status).toBe(413);
  expect((await request('POST', JSON.stringify(memberInput()))).status).toBe(200);
  f.deps.allowed = false;
  expect((await f.importMember(memberInput(), true)).status).toBe(429);
  f.deps.allowed = true;
  f.env.AUTH_READY = 'false';
  expect((await f.importMember(memberInput())).status).toBe(503);
});

it('rejects privilege fields, unsafe URLs and malformed records without writes', async () => {
  f = await memberFixture();
  const invalid = [
    { ...memberInput(), personId: 1 },
    { ...memberInput(), verifiedAt: '2026-01-01' },
    { ...memberInput(), permissions: ['members:import'] },
    { ...memberInput(), email: 'invalid' },
    { ...memberInput(), linkedin: '//evil.test/steal' },
    { ...memberInput(), linkedin: 'data:text/plain,unsafe' },
    { ...memberInput(), eventInvites: { status: 'confirmed', unsubscribedAt: null } },
    {
      ...memberInput(),
      participations: [...memberInput().participations, ...memberInput().participations],
    },
    { ...memberInput(), tags: ['x', 'x'] },
  ];
  for (const input of invalid) expect((await f.importMember(input)).status).toBe(400);
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 3 }]);
});

it('blocks conflicting source/email associations atomically, including racing imports', async () => {
  f = await memberFixture();
  const one = memberInput();
  const other = { ...memberInput(), email: 'other-import@example.com' };
  const responses = await Promise.all([f.importMember(one), f.importMember(other)]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  const saved = await f.store.query('SELECT * FROM people');
  const winner = responses[0]!.status === 200 ? one : other;
  const loser = responses[0]!.status === 200 ? other : one;
  const conflict = await f.importMember(loser, true);
  expect(await conflict.json()).toEqual({
    actions: [],
    conflicts: ['identity_conflict'],
  });
  expect((await f.importMember({ ...winner, sourceKey: 'changed-key' })).status).toBe(
    409,
  );
  expect(await f.store.query('SELECT * FROM people')).toEqual(saved);
  expect(await f.store.query('SELECT count(*) AS n FROM events')).toEqual([{ n: 1 }]);
  const existingOther = { ...winner, email: 'other@example.com' };
  expect((await f.importMember(existingOther)).status).toBe(409);
});

it('treats SQL and HTML shaped fields as values without echoing them in reports', async () => {
  f = await memberFixture();
  const input = memberInput();
  input.name = "Robert'); DROP TABLE people; -- <script>bad</script>";
  input.sourceKey = "source');DELETE FROM people;--";
  const response = await f.importMember(input);
  expect(response.status).toBe(200);
  const body = await response.text();
  for (const value of [input.name, input.sourceKey, input.email, ORGANIZER_TOKEN])
    expect(body).not.toContain(value);
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 4 }]);
  expect(await f.store.query('SELECT name FROM people ORDER BY id DESC LIMIT 1')).toEqual(
    [{ name: input.name }],
  );
});
