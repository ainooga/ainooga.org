// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { memberFixture, memberInput } from '../helpers/members';
import { insertSubscriber } from '../../worker/src/db/newsletter';
let f: Awaited<ReturnType<typeof memberFixture>>;
afterEach(async () => {
  await f?.dispose();
  vi.restoreAllMocks();
});

it('reuses a newsletter/poll person while preserving identity, consent, company relationships and attendance', async () => {
  f = await memberFixture();
  const input = memberInput();
  input.email = ' Voter@Example.com '.trim();
  await f.store.execute([
    'UPDATE people SET professional_role=NULL WHERE id=2',
    "INSERT INTO organizations(id,name) VALUES(1,'Existing')",
    "INSERT INTO organization_people VALUES(1,2,'employee')",
    "UPDATE person_identifiers SET verified_at='2026-01-01T00:00:00.000Z' WHERE id=2",
    "INSERT INTO subscriptions(person_id,email_identifier_id,kind,status,confirmation_token_hash) VALUES(2,2,'newsletter','pending','keep-token')",
    "INSERT INTO person_sources(id,person_id,source,source_key) VALUES(50,2,'manual','existing')",
  ]);
  const before = await f.store.query('SELECT * FROM person_identifiers');
  const companies = await f.store.query('SELECT * FROM organization_people');
  const newsletter = await f.store.query('SELECT * FROM subscriptions');
  const allowlist = await f.store.query(
    'SELECT id,allowed_person_ids FROM polls ORDER BY id',
  );
  const response = await f.importMember(input);
  expect(response.status).toBe(200);
  expect((await response.json()).actions).toEqual(
    expect.arrayContaining([
      { field: 'name', action: 'preserve' },
      { field: 'company', action: 'create' },
      { field: 'professionalRole', action: 'fill' },
      { field: 'member', action: 'create' },
    ]),
  );
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 3 }]);
  expect(
    await f.store.query('SELECT name,professional_role FROM people WHERE id=2'),
  ).toEqual([{ name: 'Voter', professional_role: 'Engineer' }]);
  expect(await f.store.query('SELECT * FROM person_identifiers WHERE id<=4')).toEqual(
    before,
  );
  expect(await f.store.query('SELECT * FROM organization_people')).toEqual(
    expect.arrayContaining(companies),
  );
  expect(await f.store.query('SELECT count(*) AS n FROM organization_people')).toEqual([
    { n: 2 },
  ]);
  expect(
    await f.store.query("SELECT * FROM subscriptions WHERE kind='newsletter'"),
  ).toEqual(newsletter);
  expect(
    await f.store.query('SELECT id,allowed_person_ids FROM polls ORDER BY id'),
  ).toEqual(allowlist);
  await f.store.execute([
    "UPDATE event_participation SET registration_status='cancelled',attendance_status='attended',checked_in_at='2026-01-01T18:00:00.000Z'",
  ]);
  const attendance = await f.store.query('SELECT * FROM event_participation');
  expect((await f.importMember(input)).status).toBe(200);
  expect(await f.store.query('SELECT * FROM event_participation')).toEqual(attendance);
});

it('applies invitation opt-outs, retains their dates and never restores consent', async () => {
  f = await memberFixture();
  const input = memberInput();
  await f.importMember(input);
  await f.store.execute([
    "UPDATE subscriptions SET status='confirmed',confirmed_at='2026-01-01T00:00:00.000Z'",
  ]);
  expect((await (await f.importMember(input, true)).json()).actions).toContainEqual({
    field: 'eventInvites',
    action: 'preserve',
  });
  await f.importMember(input);
  expect(await f.store.query('SELECT status FROM subscriptions')).toEqual([
    { status: 'confirmed' },
  ]);
  input.eventInvites = { status: 'unsubscribed', unsubscribedAt: null };
  await f.importMember(input);
  input.eventInvites.unsubscribedAt = '2026-02-01T00:00:00.000Z';
  await f.importMember(input);
  const saved = await f.store.query('SELECT * FROM subscriptions');
  expect(saved[0]).toMatchObject({
    status: 'unsubscribed',
    unsubscribed_at: input.eventInvites.unsubscribedAt,
    confirmation_token_hash: null,
  });
  await f.importMember(memberInput());
  expect(await f.store.query('SELECT * FROM subscriptions')).toEqual(saved);
});

it('fills only missing event metadata and deduplicates shared contact values and events', async () => {
  f = await memberFixture();
  const first = memberInput();
  first.participations[0]!.event.endsAt = null;
  first.participations[0]!.event.location = null;
  first.phone = null;
  first.linkedin = null;
  first.tags = [];
  await f.importMember(first);
  const second = memberInput();
  second.sourceKey = 'member-2';
  second.email = 'second@example.com';
  second.participations[0]!.event.name = 'Different imported name';
  const preview = await (await f.importMember(second, true)).json();
  expect(preview.actions).toContainEqual({
    field: 'participations.0.event.name',
    action: 'preserve',
  });
  expect(preview.actions).toContainEqual({
    field: 'participations.0.event.location',
    action: 'fill',
  });
  expect(await (await f.importMember(second)).json()).toEqual(preview);
  await f.importMember(memberInput());
  expect(await f.store.query('SELECT count(*) AS n FROM events')).toEqual([{ n: 1 }]);
  expect(
    await f.store.query(
      "SELECT count(*) AS n FROM person_identifiers WHERE kind='phone'",
    ),
  ).toEqual([{ n: 2 }]);
  expect(
    await f.store.query(
      "SELECT count(*) AS n FROM person_identifiers WHERE kind='linkedin'",
    ),
  ).toEqual([{ n: 2 }]);
  const event = await f.store.query('SELECT name,ends_at,location FROM events');
  expect(event[0]).toMatchObject({
    name: 'Example event',
    ends_at: second.participations[0]!.event.endsAt,
    location: 'Example venue',
  });
});

it('preserves event dates when an imported end would precede an existing start', async () => {
  f = await memberFixture();
  await f.importMember(memberInput());
  await f.store.execute([
    "UPDATE events SET starts_at='2026-03-01T00:00:00.000Z',ends_at=NULL",
  ]);
  const response = await f.importMember(memberInput());
  expect(response.status).toBe(200);
  expect((await response.json()).actions).toContainEqual({
    field: 'participations.0.event.endsAt',
    action: 'preserve',
  });
  expect(await f.store.query('SELECT ends_at FROM events')).toEqual([{ ends_at: null }]);
});

it('rolls back the entire member on a late SQL failure and redacts diagnostics', async () => {
  f = await memberFixture();
  const logged: unknown[] = [];
  vi.spyOn(console, 'error').mockImplementation((value) => {
    logged.push(value);
  });
  await f.store.execute([
    "CREATE TRIGGER fail_import BEFORE INSERT ON event_participation BEGIN SELECT RAISE(ABORT,'private@example.com'); END",
  ]);
  const response = await f.importMember(memberInput());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private@example.com');
  expect(JSON.stringify(logged)).not.toContain('private@example.com');
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 3 }]);
  for (const table of [
    'events',
    'event_links',
    'organizations',
    'organization_people',
    'person_sources',
    'subscriptions',
    'person_tags',
  ])
    expect(await f.store.query(`SELECT * FROM ${table}`)).toEqual([]);
  await f.store.execute(['DROP TRIGGER fail_import']);
  expect((await f.importMember(memberInput())).status).toBe(200);
});

it('reports and fills blank fields consistently and races safely with newsletter signup', async () => {
  f = await memberFixture();
  const input = memberInput();
  const [response] = await Promise.all([
    f.importMember(input),
    insertSubscriber(f.db, input.email, null, 'test-confirmation'),
  ]);
  expect(response.status).toBe(200);
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 4 }]);
  expect(
    await f.store.query('SELECT kind,status FROM subscriptions ORDER BY kind'),
  ).toEqual([
    { kind: 'event_invites', status: 'unknown' },
    { kind: 'newsletter', status: 'pending' },
  ]);
  await f.store.execute([
    'DELETE FROM organization_people',
    "UPDATE events SET location=' '",
  ]);
  const proposed = await (await f.importMember(input, true)).json();
  expect(proposed.actions).toContainEqual({ field: 'company', action: 'fill' });
  expect(proposed.actions).toContainEqual({
    field: 'participations.0.event.location',
    action: 'fill',
  });
  expect(await (await f.importMember(input)).json()).toEqual(proposed);
  expect(
    await f.store.query(
      "SELECT o.name FROM organizations o JOIN organization_people op ON op.organization_id=o.id JOIN people p ON p.id=op.person_id WHERE p.name='Example Member'",
    ),
  ).toEqual([{ name: 'Example Company' }]);
  expect(await f.store.query('SELECT location FROM events')).toEqual([
    { location: 'Example venue' },
  ]);
});
