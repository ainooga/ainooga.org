// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { database, migration } from '../helpers/d1';
import { verifyLive, migrate } from '../../db/migrate';
import { backfill } from '../../db/backfill';
import { createDb } from '../../worker/src/db/client';
import { hashToken } from '../../worker/src/db/identifiers';

let context: Awaited<ReturnType<typeof database>> | undefined;
afterEach(async () => {
  await context?.dispose();
});

describe('authentication migration', () => {
  it('initializes a fresh database and verifies all current definitions', async () => {
    context = await database();
    const db = context.store;
    await migrate({
      remote: false,
      query: (sql) => db.query(sql),
      execute: (sql) => db.execute(sql),
      async applyMigrations() {
        for (const name of [
          '0001_create_subscribers.sql',
          '0002_chapter_schema.sql',
          '0003_voter_auth.sql',
          '0004_poll_api.sql',
          '0005_simplify_chapter.sql',
          '0006_member_sync.sql',
        ])
          await migration(db, name);
      },
    });
    await expect(verifyLive(db)).resolves.toBeUndefined();
  });
  it('preserves post-cutover form records and rejects legacy backfill on the new schema', async () => {
    context = await database();
    await migration(context.store, '0001_create_subscribers.sql');
    await migration(context.store, '0002_chapter_schema.sql');
    await context.store.execute([
      "INSERT INTO people(id,name) VALUES(1,'New person')",
      "INSERT INTO person_identifiers(id,person_id,kind,value,normalized_value) VALUES(1,1,'email','new@example.com','new@example.com')",
      `INSERT INTO subscriptions(person_id,email_identifier_id,kind,status,confirmation_token_hash)
        VALUES(1,1,'newsletter','pending','${await hashToken('pending-token')}')`,
    ]);
    const before = await context.store.query('SELECT * FROM subscriptions');
    const expected = { ...before[0]! };
    delete expected.status;
    expected.subscribed = 1;
    expected.confirmation_pending = 1;
    const db = context.store;
    await migrate({
      remote: true,
      query: (sql) => db.query(sql),
      execute: (sql) => db.execute(sql),
      async applyMigrations() {
        await migration(db, '0003_voter_auth.sql');
        await migration(db, '0004_poll_api.sql');
        await migration(db, '0005_simplify_chapter.sql');
        await migration(db, '0006_member_sync.sql');
      },
    });
    await expect(verifyLive(db)).resolves.toBeUndefined();
    expect(await context.store.query('SELECT * FROM subscriptions')).toEqual([expected]);
    expect(await createDb(context.db).confirmSubscription('pending-token')).toBe(1);
    await expect(
      backfill(context.store, {
        version: 1,
        target: 'local',
        fingerprint: '0'.repeat(64),
        migratedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('Unexpected chapter schema table set');
  });
  it('refuses routine migrations on populated legacy databases', async () => {
    context = await database();
    await migration(context.store, '0001_create_subscribers.sql');
    let applied = false;
    const db = context.store;
    await expect(
      migrate({
        remote: false,
        query: (sql) => db.query(sql),
        execute: (sql) => db.execute(sql),
        applyMigrations() {
          applied = true;
        },
      }),
    ).rejects.toThrow('legacy chapter cutover');
    expect(applied).toBe(false);
  });
});
