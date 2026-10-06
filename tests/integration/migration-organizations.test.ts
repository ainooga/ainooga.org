// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { database, migration } from '../helpers/d1';
import { seedLegacy } from '../helpers/legacy';
import { migrate, verifyLive } from '../../db/migrate';

let fixture: Awaited<ReturnType<typeof database>>;
afterEach(async () => {
  await fixture?.dispose();
});

async function setup() {
  fixture = await database();
  await migration(fixture.store, '0001_create_subscribers.sql');
  await seedLegacy(fixture.store);
  for (const name of [
    '0002_chapter_schema.sql',
    '0003_voter_auth.sql',
    '0004_poll_api.sql',
  ])
    await migration(fixture.store, name);
  await fixture.store.execute([
    "INSERT INTO people(id,name) VALUES(20,'Private Person')",
    "INSERT INTO organizations(id,name) VALUES(12,'Private Alpha'),(2,'Private Alpha'),(10,'Private Beta'),(8,' private BETA ')",
    "INSERT INTO sponsorships(organization_id,tier) VALUES(12,'gold'),(2,'silver')",
    "INSERT INTO organization_people VALUES(12,20,'contact'),(2,20,'employee')",
  ]);
}

const tables = [
  'organizations',
  'sponsorships',
  'organization_people',
  'people',
  'person_identifiers',
  'person_sources',
  'subscriptions',
  'contact_requests',
  'subscribers',
  'legacy_contact_requests',
];
const snapshot = () =>
  Promise.all(tables.map((table) => fixture.store.query(`SELECT * FROM ${table}`)));

it('reports ordered collision IDs before reconciliation or migration writes', async () => {
  await setup();
  const before = await snapshot();
  let writes = 0;
  let migrations = 0;
  const error = await migrate({
    remote: true,
    query: (sql) => fixture.store.query(sql),
    execute(sql) {
      writes++;
      return fixture.store.execute(sql);
    },
    async applyMigrations() {
      migrations++;
      await migration(fixture.store, '0005_simplify_chapter.sql');
    },
  }).catch((error: Error) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain('Organization name collisions');
  expect((error as Error).message).toContain('[2, 12]; [8, 10]');
  expect((error as Error).message).toContain('Rename');
  for (const value of ['Private', 'private', 'Legacy@Example.com', 'old-token'])
    expect((error as Error).message).not.toContain(value);
  expect(writes).toBe(0);
  expect(migrations).toBe(0);
  expect(await snapshot()).toEqual(before);
});

it('migrates distinct organizations and permits subsequent migration verification', async () => {
  await setup();
  await fixture.store.execute([
    "UPDATE organizations SET name='Distinct Alpha' WHERE id=2",
    "UPDATE organizations SET name='Distinct Beta' WHERE id=8",
  ]);
  const organizations = await fixture.store.query('SELECT * FROM organizations');
  const relationships = await fixture.store.query('SELECT * FROM organization_people');
  const sponsorships = await fixture.store.query('SELECT * FROM sponsorships');
  const store = {
    remote: false,
    query: (sql: string) => fixture.store.query(sql),
    execute: (sql: string[]) => fixture.store.execute(sql),
    applyMigrations: () => migration(fixture.store, '0005_simplify_chapter.sql'),
  };
  await migrate(store);
  await verifyLive(store);
  expect(await fixture.store.query('SELECT * FROM organizations')).toEqual(organizations);
  expect(await fixture.store.query('SELECT * FROM organization_people')).toEqual(
    relationships,
  );
  expect(await fixture.store.query('SELECT * FROM sponsorships')).toEqual(sponsorships);
  expect(
    await fixture.store.query('SELECT count(*) AS total FROM subscriptions'),
  ).toEqual([{ total: 2 }]);
  await expect(migrate({ ...store, applyMigrations() {} })).resolves.toBeUndefined();
});
