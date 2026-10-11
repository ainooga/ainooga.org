// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { authFixture } from '../helpers/auth';
import { migration } from '../helpers/d1';
import { migrate, verifyLive } from '../../db/migrate';

let f: Awaited<ReturnType<typeof authFixture>>;
afterEach(async () => {
  await f?.dispose();
});

it('upgrades populated version 0005 without changing existing data and verifies version 0006', async () => {
  f = await authFixture(false);
  await migration(f.store, '0004_poll_api.sql');
  await migration(f.store, '0005_simplify_chapter.sql');
  const tables = [
    'people',
    'person_identifiers',
    'person_sources',
    'polls',
    'subscriptions',
  ];
  const before = await Promise.all(
    tables.map((t) => f.store.query(`SELECT * FROM ${t}`)),
  );
  await expect(verifyLive(f.store)).rejects.toThrow('current schema');
  await migrate({
    remote: false,
    query: (sql) => f.store.query(sql),
    execute: (sql) => f.store.execute(sql),
    applyMigrations: () => migration(f.store, '0006_member_sync.sql'),
  });
  await expect(verifyLive(f.store)).resolves.toBeUndefined();
  expect(
    await Promise.all(tables.map((t) => f.store.query(`SELECT * FROM ${t}`))),
  ).toEqual(before);
  await f.db.prepare('ALTER TABLE member_sync_state ADD COLUMN unexpected TEXT').run();
  await expect(verifyLive(f.store, true)).rejects.toThrow('current schema');
});
