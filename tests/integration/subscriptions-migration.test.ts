// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { chapterDatabase, migration } from '../helpers/d1';

let fixture: Awaited<ReturnType<typeof chapterDatabase>>;
afterEach(async () => {
  await fixture?.dispose();
});

it('migrates subscription preferences independently of newsletter confirmation', async () => {
  fixture = await chapterDatabase();
  await migration(fixture.store, '0003_voter_auth.sql');
  await migration(fixture.store, '0004_poll_api.sql');
  const cases = [
    ['newsletter', 'unknown', 0, 0],
    ['newsletter', 'pending', 1, 1],
    ['newsletter', 'confirmed', 1, 0],
    ['newsletter', 'unsubscribed', 0, 0],
    ['event_invites', 'unknown', 1, 0],
    ['event_invites', 'pending', 1, 0],
    ['event_invites', 'confirmed', 1, 0],
    ['event_invites', 'unsubscribed', 0, 0],
  ] as const;
  for (const [index, [kind, status]] of cases.entries()) {
    const id = index + 1;
    await fixture.store.execute([
      `INSERT INTO people(id) VALUES(${id})`,
      `INSERT INTO person_identifiers(id,person_id,kind,value,normalized_value)
        VALUES(${id},${id},'email','person${id}@example.com','person${id}@example.com')`,
      `INSERT INTO subscriptions(id,person_id,email_identifier_id,kind,status,confirmation_token_hash,source)
        VALUES(${id},${id},${id},'${kind}','${status}','token-${id}','synthetic')`,
    ]);
  }
  const before = await fixture.store.query('SELECT * FROM subscriptions ORDER BY id');
  await migration(fixture.store, '0005_simplify_chapter.sql');
  const expected = before.map((row, index) => {
    const converted = { ...row };
    delete converted.status;
    return {
      ...converted,
      subscribed: cases[index]![2],
      confirmation_pending: cases[index]![3],
    };
  });
  expect(await fixture.store.query('SELECT * FROM subscriptions ORDER BY id')).toEqual(
    expected,
  );
  expect(await fixture.store.query('PRAGMA foreign_key_check')).toEqual([]);
  for (const sql of [
    'UPDATE subscriptions SET subscribed=2 WHERE id=1',
    "UPDATE subscriptions SET subscribed='false' WHERE id=1",
    'UPDATE subscriptions SET subscribed=NULL WHERE id=1',
    'UPDATE subscriptions SET confirmation_pending=2 WHERE id=1',
    'UPDATE subscriptions SET confirmation_pending=1 WHERE id=4',
    'UPDATE subscriptions SET confirmation_pending=1 WHERE id=5',
    'UPDATE subscriptions SET email_identifier_id=2 WHERE id=1',
  ])
    await expect(fixture.store.execute([sql])).rejects.toThrow();
});
