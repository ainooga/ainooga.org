// @vitest-environment node
import { expect, it } from 'vitest';
import { database, migration } from '../helpers/d1';
import { backfill } from '../../scripts/db/backfill';
import { readLegacy, fingerprint } from '../../scripts/db/legacy';

it('measures an empty schema and a representative synthetic chapter', async () => {
  const context = await database();
  const size = async () => (await context.db.prepare('SELECT 1').all()).meta.size_after;
  try {
    await migration(context.store, '0001_create_subscribers.sql');
    const legacyEmpty = await size();
    await migration(context.store, '0002_chapter_schema.sql');
    const chapterEmpty = await size();
    for (let id = 1; id <= 200; id++) {
      await context.store.execute([
        `INSERT INTO subscribers (id,email,name,confirmed,confirmation_token) VALUES (${id},'member${id}@example.com','Member ${id}',0,'synthetic-${id}')`,
      ]);
    }
    const legacy = await readLegacy(context.store);
    await backfill(context.store, {
      version: 1,
      target: 'capacity',
      fingerprint: fingerprint(legacy),
      migratedAt: '2026-09-28T00:00:00.000Z',
    });
    const migrated200 = await size();
    await context.store.execute([
      "INSERT INTO memberships (person_id,status,source) SELECT person_id,'active',id FROM person_sources",
      "INSERT INTO polls (id,slug,title,identity_mode,min_selections,results_visibility,starts_at,ends_at,created_by) VALUES (1,'synthetic','Synthetic','honor',1,'never','2026-01-01','2026-02-01',1)",
      "INSERT INTO poll_options (id,poll_id,label,normalized_label,origin) VALUES (1,1,'A','a','predefined')",
      'INSERT INTO poll_allowlist (poll_id,person_id) SELECT 1,id FROM people',
      'INSERT INTO poll_ballots (poll_id,person_id) SELECT 1,id FROM people',
      'INSERT INTO poll_ballot_choices (ballot_id,poll_id,option_id) SELECT id,1,1 FROM poll_ballots',
    ]);
    for (let id = 1; id <= 10; id++) {
      await context.store.execute([
        `INSERT INTO events (id,name,starts_at) VALUES (${id},'Synthetic ${id}','2026-01-01T00:00:00.000Z')`,
      ]);
    }
    for (let offset = 0; offset < 734; offset += 25) {
      const statements = Array.from({ length: Math.min(25, 734 - offset) }, (_, n) => {
        const index = offset + n;
        return `INSERT INTO event_participation (event_id,person_id,registration_status,source) VALUES (${(index % 10) + 1},${Math.floor(index / 10) + 1},'approved','synthetic')`;
      });
      await context.store.execute(statements);
    }
    const chapterWithPoll = await size();
    expect(chapterEmpty).toBeGreaterThan(legacyEmpty);
    expect(migrated200).toBeGreaterThan(chapterEmpty);
    expect(chapterWithPoll).toBeGreaterThan(migrated200);
    expect(chapterWithPoll).toBeLessThan(500_000_000);
    console.info(
      'Synthetic D1 allocated bytes:',
      JSON.stringify({ legacyEmpty, chapterEmpty, migrated200, chapterWithPoll }),
    );
  } finally {
    await context.dispose();
  }
}, 30000);
