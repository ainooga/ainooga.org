// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { database, migration } from '../helpers/d1';
import { seedLegacy } from '../helpers/legacy';
import { reconcileLegacy } from '../../db/reconcile';
import { verifyLive } from '../../db/migrate';
import { createDb } from '../../worker/src/db/client';

let f: Awaited<ReturnType<typeof database>>;
afterEach(async () => {
  await f?.dispose();
});
async function setup() {
  f = await database();
  await migration(f.store, '0001_create_subscribers.sql');
  await seedLegacy(f.store);
  await migration(f.store, '0002_chapter_schema.sql');
  await migration(f.store, '0003_voter_auth.sql');
  await migration(f.store, '0004_poll_api.sql');
}

it('fills missing legacy records, discards obsolete preferences and preserves old links', async () => {
  await setup();
  await f.store.execute([
    "ALTER TABLE subscribers ADD COLUMN preferences TEXT NOT NULL DEFAULT '[]'",
    "UPDATE subscribers SET preferences='obsolete data'",
  ]);
  await reconcileLegacy(f.store);
  const before = await f.store.query('SELECT * FROM subscriptions ORDER BY id');
  await reconcileLegacy(f.store);
  expect(await f.store.query('SELECT * FROM subscriptions ORDER BY id')).toEqual(before);
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 2 }]);
  expect(await f.store.query('SELECT count(*) AS n FROM person_sources')).toEqual([
    { n: 2 },
  ]);
  await migration(f.store, '0005_simplify_chapter.sql');
  await migration(f.store, '0006_member_sync.sql');
  await verifyLive(f.store);
  expect(await createDb(f.db).confirmSubscription('old-token')).toBe(1);
  expect(await createDb(f.db).confirmSubscription('old-token')).toBe(0);
  expect(await createDb(f.db).confirmSubscription('used-token')).toBe(0);
  expect(
    await f.store.query('SELECT id,person_id,submitted_name FROM contact_requests'),
  ).toEqual([{ id: 7, person_id: null, submitted_name: 'Inquiry Only' }]);
});

it.each(['confirmed', 'unsubscribed', 'pending'])(
  'preserves current %s state and does not restore a consumed legacy token',
  async (status) => {
    await setup();
    await reconcileLegacy(f.store);
    await f.store.execute([
      `UPDATE subscriptions SET status='${status}',confirmation_token_hash=NULL,confirmed_at='2026-02-01T00:00:00.000Z',unsubscribed_at='2026-03-01T00:00:00.000Z'`,
      "UPDATE people SET name='Current name'",
    ]);
    const before = await f.store.query('SELECT * FROM subscriptions');
    await reconcileLegacy(f.store);
    expect(await f.store.query('SELECT * FROM subscriptions')).toEqual(before);
    await migration(f.store, '0005_simplify_chapter.sql');
    const expected = before.map((row) => {
      const converted = { ...row };
      delete converted.status;
      return {
        ...converted,
        subscribed: Number(status !== 'unsubscribed'),
        confirmation_pending: Number(status === 'pending'),
      };
    });
    expect(await f.store.query('SELECT * FROM subscriptions')).toEqual(expected);
    expect(await createDb(f.db).confirmSubscription('old-token')).toBe(0);
    expect(await f.store.query('SELECT DISTINCT name FROM people')).toEqual([
      { name: 'Current name' },
    ]);
  },
);

it.each([
  "INSERT INTO people(id) VALUES(1); INSERT INTO person_sources(person_id,source,source_key) VALUES(1,'legacy_subscribers','3')",
  "INSERT INTO contact_requests(id,submitted_name,submitted_phone) VALUES(7,'Different inquiry','555')",
])('rejects conflicts before importing any records', async (sql) => {
  await setup();
  await f.store.execute(sql.split(';').map((s) => s.trim()));
  await expect(reconcileLegacy(f.store)).rejects.toThrow('conflicting');
  expect(await f.store.query('SELECT * FROM subscriptions')).toEqual([]);
  expect(await f.store.query('SELECT * FROM person_identifiers')).toEqual([]);
});

it('refuses destructive migration until legacy records are reconciled', async () => {
  await setup();
  await expect(migration(f.store, '0005_simplify_chapter.sql')).rejects.toThrow();
  expect(await f.store.query('SELECT count(*) AS n FROM subscribers')).toEqual([
    { n: 2 },
  ]);
  expect(
    await f.store.query('SELECT count(*) AS n FROM legacy_contact_requests'),
  ).toEqual([{ n: 1 }]);
  expect(
    await f.store.query(
      "SELECT name FROM sqlite_master WHERE name='simplification_guard'",
    ),
  ).toEqual([]);
});

it('rejects a legacy token owned by another person before filling missing records', async () => {
  await setup();
  const hash = createHash('sha256').update('old-token').digest('hex');
  await f.store.execute([
    'INSERT INTO people(id) VALUES(1)',
    "INSERT INTO person_identifiers(id,person_id,kind,value,normalized_value) VALUES(1,1,'email','different@example.com','different@example.com')",
    `INSERT INTO subscriptions(person_id,email_identifier_id,kind,status,confirmation_token_hash) VALUES(1,1,'newsletter','pending','${hash}')`,
  ]);
  await expect(reconcileLegacy(f.store)).rejects.toThrow(
    'confirmation token is already in use',
  );
  expect(await f.store.query('SELECT count(*) AS n FROM people')).toEqual([{ n: 1 }]);
  expect(await f.store.query('SELECT * FROM person_sources')).toEqual([]);
});
