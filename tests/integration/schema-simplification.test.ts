// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { chapterDatabase, migration } from '../helpers/d1';

let f: Awaited<ReturnType<typeof chapterDatabase>>;
afterEach(async () => {
  await f?.dispose();
});

it('converts populated chapter data without losing ballots or multiplying eligibility', async () => {
  f = await chapterDatabase();
  await migration(f.store, '0003_voter_auth.sql');
  await migration(f.store, '0004_poll_api.sql');
  await f.store.execute([
    "INSERT INTO people(id,name,company) VALUES(1,'Organizer',NULL),(2,'Member','Example'),(3,'Guest',' example '),(4,'Tagged',NULL)",
    "INSERT INTO person_sources(id,person_id,source,source_key) VALUES(1,2,'test','member')",
    "INSERT INTO memberships VALUES(2,'active',NULL,NULL,1)",
    "INSERT INTO polls(id,slug,title,status,identity_mode,min_selections,results_visibility,starts_at,ends_at,created_by) VALUES(1,'test','Test','published','honor',1,'after_vote','2026-01-01','2027-01-01',1)",
    "INSERT INTO poll_eligible_tags VALUES(1,'member')",
    'INSERT INTO poll_allowlist(poll_id,person_id) VALUES(1,2),(1,3)',
    "INSERT INTO person_tags VALUES(4,'member')",
    "INSERT INTO poll_allowlist(poll_id,person_id,revoked_at) VALUES(1,4,'2026-01-01')",
    "INSERT INTO poll_options(id,poll_id,label,normalized_label,origin) VALUES(1,1,'Option','option','predefined')",
    'INSERT INTO poll_ballots(id,poll_id,person_id,revision) VALUES(10,1,2,3)',
    'INSERT INTO poll_ballot_choices VALUES(10,1,1)',
    `INSERT INTO poll_submission_receipts VALUES(1,2,'request','${'a'.repeat(64)}','${'b'.repeat(64)}')`,
    "INSERT INTO events(id,name,starts_at) VALUES(1,'Event','2026-01-01')",
    "INSERT INTO event_participation(event_id,person_id,registration_status,source) VALUES(1,2,'approved','test'),(1,3,'invited','test')",
  ]);
  await f.store.execute([
    "INSERT INTO person_identifiers(id,person_id,kind,value,normalized_value) VALUES(2,2,'email','member@example.com','member@example.com')",
    "INSERT INTO voter_sessions VALUES('session',2,2,'member@example.com','honor',1,'2026-01-01','2027-01-01')",
  ]);
  const sessions = await f.store.query('SELECT * FROM voter_sessions');
  await migration(f.store, '0005_simplify_chapter.sql');
  expect(await f.store.query('SELECT * FROM voter_sessions')).toEqual(sessions);
  expect(await f.store.query('SELECT tag FROM person_tags WHERE person_id=2')).toEqual([
    { tag: 'member' },
  ]);
  expect(await f.store.query('SELECT count(*) AS n FROM organizations')).toEqual([
    { n: 1 },
  ]);
  expect(await f.store.query('SELECT count(*) AS n FROM organization_people')).toEqual([
    { n: 2 },
  ]);
  expect(
    await f.store.query('SELECT eligible_tags,allowed_person_ids FROM polls'),
  ).toEqual([{ eligible_tags: '["member"]', allowed_person_ids: '[3]' }]);
  expect(
    await f.store.query(
      'SELECT id,revision,request_id,payload_hash,attempt_nonce FROM poll_ballots',
    ),
  ).toEqual([
    {
      id: 10,
      revision: 3,
      request_id: 'request',
      payload_hash: 'a'.repeat(64),
      attempt_nonce: 'b'.repeat(64),
    },
  ]);
  expect(await f.store.query('SELECT * FROM poll_ballot_choices')).toEqual([
    { ballot_id: 10, poll_id: 1, option_id: 1 },
  ]);
  expect(await f.store.query('SELECT registered FROM events_with_counts')).toEqual([
    { registered: 1 },
  ]);
  expect(await f.store.query('PRAGMA foreign_key_check')).toEqual([]);
  await f.store.execute([
    "UPDATE event_participation SET registration_status='cancelled' WHERE person_id=2",
  ]);
  expect(await f.store.query('SELECT registered FROM events_with_counts')).toEqual([
    { registered: 0 },
  ]);
  const tables = (
    await f.store.query("SELECT name FROM sqlite_master WHERE type='table'")
  ).map((r) => r.name);
  for (const name of [
    'memberships',
    'organizer_permissions',
    'poll_allowlist',
    'poll_eligible_tags',
    'poll_submission_receipts',
    'subscribers',
    'legacy_contact_requests',
  ])
    expect(tables).not.toContain(name);
});
