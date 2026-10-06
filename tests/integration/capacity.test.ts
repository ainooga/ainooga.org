// @vitest-environment node
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { exercisePoll } from '../helpers/capacity-queries';
import { expect, it } from 'vitest';
import { database, migration } from '../helpers/d1';
import { seedChapter, seedPoll, seedTemporaryAuth } from '../helpers/capacity';
import { cleanupAuth } from '../../worker/src/auth/cleanup';
import { organizerResults, organizerBallots } from '../../worker/src/polls/results';

async function inspectStorage(directory: string) {
  const files = await readdir(directory, { recursive: true });
  const file = files.find((name) => name.endsWith('.sqlite'));
  if (!file) throw new Error('Capacity database file missing');
  const report = execFileSync(
    '/usr/bin/sqlite3',
    [
      '-json',
      join(directory, file),
      `SELECT coalesce(m.type,'internal') AS kind,sum(d.pgsize) AS bytes
          FROM dbstat d LEFT JOIN sqlite_master m ON m.name=d.name GROUP BY kind;`,
    ],
    { encoding: 'utf8' },
  );
  console.info('Synthetic table/index pages:', report.trim());
}

it('measures the current schema with 200 synthetic members and 120 retained polls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ainooga-capacity-'));
  const f = await database(directory);
  const size = async () => (await f.db.prepare('SELECT 1').all()).meta.size_after;
  const measured: Record<string, number> = {};
  try {
    for (const name of [
      '0001_create_subscribers.sql',
      '0002_chapter_schema.sql',
      '0003_voter_auth.sql',
      '0004_poll_api.sql',
      '0005_simplify_chapter.sql',
    ])
      await migration(f.store, name);
    measured.empty = await size();
    await seedChapter(f.store);
    measured.chapter = await size();
    for (let id = 1; id <= 120; id++) {
      await seedPoll(f.store, id);
      if ([1, 24, 120].includes(id)) measured[`polls${id}`] = await size();
    }
    expect(await f.store.query('SELECT count(*) AS n FROM poll_ballots')).toEqual([
      { n: 24000 },
    ]);
    expect(await f.store.query('SELECT count(*) AS n FROM poll_ballot_choices')).toEqual([
      { n: 48000 },
    ]);
    expect(
      await f.store.query(
        'SELECT count(*) AS n FROM poll_ballots WHERE request_id IS NOT NULL',
      ),
    ).toEqual([{ n: 24000 }]);
    expect(
      await f.store.query(
        "SELECT count(*) AS n FROM subscriptions WHERE kind='newsletter' OR status='confirmed'",
      ),
    ).toEqual([{ n: 0 }]);
    const results = await organizerResults(f.db, 'capacity-120');
    expect(results).toMatchObject({ eligibleCount: 200, ballotCount: 200 });
    expect(results.options.reduce((sum, row) => sum + Number(row.votes), 0)).toBe(400);
    expect(await organizerBallots(f.db, 'capacity-120')).toHaveLength(200);
    await exercisePoll(f.db);
    measured.edited = await size();
    await seedTemporaryAuth(f.store);
    measured.auth = await size();
    expect(await cleanupAuth(f.db, new Date('2026-02-01T00:00:00.000Z'))).toEqual({
      sessionsDeleted: 200,
      challengesDeleted: 1000,
      capped: false,
    });
    measured.cleaned = await size();
    await seedTemporaryAuth(f.store);
    measured.reused = await size();
    expect(measured.reused).toBeLessThanOrEqual(measured.auth! + 4096);
    expect(measured.polls120).toBeGreaterThan(measured.chapter!);
    expect(measured.reused).toBeLessThan(8_000_000_000);
    expect(await f.store.query('PRAGMA foreign_key_check')).toEqual([]);
    expect(await f.store.query('PRAGMA quick_check')).toEqual([{ quick_check: 'ok' }]);
    console.info('Synthetic capacity allocated bytes:', JSON.stringify(measured));
  } finally {
    await f.dispose();
    try {
      if (process.env.AINOOGA_CAPACITY_INDEXES === '1') await inspectStorage(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}, 60000);
