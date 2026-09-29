// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { database, migration } from '../helpers/d1';
import { seedLegacy } from '../helpers/legacy';
import { backfill, verify } from '../../db/backfill';
import { fingerprint, preflight, readLegacy } from '../../db/legacy';
import { transform } from '../../db/transform';
import { insertSql, type Manifest } from '../../db/types';
import { createDb } from '../../worker/src/db/client';

let context: Awaited<ReturnType<typeof database>>;
let manifest: Manifest;
beforeEach(async () => {
  context = await database();
  await migration(context.store, '0001_create_subscribers.sql');
});
afterEach(async () => {
  await context.dispose();
});

async function prepare(seed = true) {
  if (seed) await seedLegacy(context.store);
  const legacy = await readLegacy(context.store);
  preflight(legacy);
  manifest = {
    version: 1,
    target: 'test',
    fingerprint: fingerprint(legacy),
    migratedAt: '2026-09-28T00:00:00.000Z',
  };
  await migration(context.store, '0002_chapter_schema.sql');
  return legacy;
}

describe('chapter migration', () => {
  it('preserves production preference data in the retained legacy table', async () => {
    await context.store.execute([
      "ALTER TABLE subscribers ADD COLUMN preferences TEXT NOT NULL DEFAULT '[]'",
    ]);
    await seedLegacy(context.store);
    await context.store.execute([
      `UPDATE subscribers SET preferences='["validate","updates"]' WHERE id=3`,
    ]);
    await prepare(false);
    await backfill(context.store, manifest);
    expect(
      await context.store.query('SELECT preferences FROM subscribers WHERE id=3'),
    ).toEqual([{ preferences: '["validate","updates"]' }]);
    expect(await context.store.query('SELECT DISTINCT kind FROM subscriptions')).toEqual([
      { kind: 'newsletter' },
    ]);
    await context.store.execute(["UPDATE subscribers SET preferences='[]' WHERE id=3"]);
    await expect(verify(context.store, manifest)).rejects.toThrow('Legacy data changed');
  });

  it('installs a fresh schema and verifies an empty backfill', async () => {
    await prepare(false);
    await backfill(context.store, manifest);
    expect(await context.store.query('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('preserves records, nullable history and old confirmation links', async () => {
    await prepare();
    await backfill(context.store, manifest);
    expect(await context.store.query('SELECT id,name FROM people ORDER BY id')).toEqual([
      { id: 3, name: 'Full Name' },
      { id: 8, name: null },
    ]);
    expect(
      await context.store.query(
        'SELECT id,status,source,created_at FROM subscriptions ORDER BY id',
      ),
    ).toEqual([
      {
        id: 3,
        status: 'pending',
        source: 'website',
        created_at: '2026-01-02T03:04:05.000Z',
      },
      { id: 8, status: 'confirmed', source: null, created_at: null },
    ]);
    expect(
      await context.store.query(
        'SELECT id,person_id,submitted_phone,preferred_time FROM contact_requests',
      ),
    ).toEqual([
      {
        id: 7,
        person_id: null,
        submitted_phone: '+1 (555) 012-3456',
        preferred_time: '14:00',
      },
    ]);
    const adapter = createDb(context.db);
    expect(await adapter.confirmSubscription('old-token')).toBe(1);
    expect(await adapter.confirmSubscription('old-token')).toBe(0);
    expect(
      await context.store.query('SELECT verified_at FROM person_identifiers'),
    ).toEqual([{ verified_at: null }, { verified_at: null }]);
  });

  it('resumes a partially applied backfill and repeats without duplicates', async () => {
    const legacy = await prepare();
    await context.store.execute(
      transform(legacy, manifest.migratedAt).slice(0, 2).map(insertSql),
    );
    await backfill(context.store, manifest);
    await backfill(context.store, manifest);
    expect(await context.store.query('SELECT COUNT(*) AS n FROM people')).toEqual([
      { n: 2 },
    ]);
    expect(await context.store.query('SELECT COUNT(*) AS n FROM memberships')).toEqual([
      { n: 0 },
    ]);
    expect(
      await context.store.query('SELECT COUNT(*) AS n FROM organizer_permissions'),
    ).toEqual([{ n: 0 }]);
  });

  it('preserves quoted and multiline text as data during backfill', async () => {
    await context.store.execute([
      insertSql({
        table: 'subscribers',
        row: {
          id: 12,
          email: 'quoted@example.com',
          name: "O'Brien; --\nSecond line",
          confirmed: 0,
          confirmation_token: 'quoted-token',
        },
      }),
    ]);
    await prepare(false);
    await backfill(context.store, manifest);
    expect(await context.store.query('SELECT name FROM people')).toEqual([
      { name: "O'Brien; --\nSecond line" },
    ]);
  });

  it('rejects altered target rows before adding missing rows', async () => {
    await prepare();
    await context.store.execute(["INSERT INTO people (id,name) VALUES (3,'Different')"]);
    await expect(backfill(context.store, manifest)).rejects.toThrow('target differs');
    expect(
      await context.store.query('SELECT COUNT(*) AS n FROM person_identifiers'),
    ).toEqual([{ n: 0 }]);
  });

  it('rejects altered index definitions before starting the backfill', async () => {
    await prepare();
    await context.store.execute(['DROP INDEX idx_memberships_status']);
    await expect(backfill(context.store, manifest)).rejects.toThrow('schema definition');
    expect(await context.store.query('SELECT COUNT(*) AS n FROM people')).toEqual([
      { n: 0 },
    ]);
  });

  it('rejects changes to legacy data after preflight', async () => {
    await prepare();
    await context.store.execute(["UPDATE subscribers SET name='Changed' WHERE id=3"]);
    await expect(backfill(context.store, manifest)).rejects.toThrow(
      'Legacy data changed',
    );
  });

  it('rejects missing rows and unexpected schema during verification', async () => {
    await prepare();
    await expect(verify(context.store, manifest)).rejects.toThrow('missing');
    await context.store.execute(['CREATE TABLE unexpected (id INTEGER)']);
    await expect(backfill(context.store, manifest)).rejects.toThrow('table set');
  });

  it('can restore the preserved legacy shape and rehearse the migration again', async () => {
    await seedLegacy(context.store);
    const backup = await readLegacy(context.store);
    await migration(context.store, '0002_chapter_schema.sql');
    // Restore a pre-migration SQL export into a separate database, never over new writes.
    const restored = await database();
    try {
      await migration(restored.store, '0001_create_subscribers.sql');
      const rows = [
        ...backup.subscribers.map((row) => ({ table: 'subscribers', row })),
        ...backup.contacts.map((row) => ({ table: 'contact_requests', row })),
      ];
      await restored.store.execute(rows.map(insertSql));
      expect(await readLegacy(restored.store)).toEqual(backup);
      await migration(restored.store, '0002_chapter_schema.sql');
      await backfill(restored.store, {
        version: 1,
        target: 'restored',
        fingerprint: fingerprint(backup),
        migratedAt: '2026-09-28T00:00:00.000Z',
      });
    } finally {
      await restored.dispose();
    }
  });
});
