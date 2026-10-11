// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { authFixture } from '../helpers/auth';
import { syncEvents } from '../../scripts/event-sync';
import type { ParsedDoc } from '../../scripts/types';

let f: Awaited<ReturnType<typeof authFixture>>;
function event(slug = 'meeting', externalId = 'evt-example'): ParsedDoc {
  return {
    type: 'events',
    slug,
    filePath: `content/events/${slug}.md`,
    body: '',
    frontmatter: {
      title: "Agent's workshop",
      date: new Date('2026-10-17T17:00:00Z'),
      endDate: new Date('2026-10-17T21:00:00Z'),
      location: 'BDC',
      organizer: 'Chapter',
      tags: [],
      status: 'published',
      timezone: 'America/New_York',
      links: [{ platform: 'luma', externalId, url: 'https://luma.com/example' }],
    },
  };
}
const rows = () => f.store.query('SELECT * FROM events ORDER BY id');
const links = () => f.store.query('SELECT * FROM event_links ORDER BY event_id,platform');
beforeEach(async () => {
  f = await authFixture();
});
afterEach(async () => {
  await f?.dispose();
});

it('creates an event and reference, verifies writes, and leaves identical reruns untouched', async () => {
  expect(await syncEvents(f.store, [event()])).toMatchObject({ created: 1, updated: 0 });
  const before = await rows();
  expect(before[0]).toMatchObject({
    name: "Agent's workshop",
    starts_at: '2026-10-17T17:00:00.000Z',
    ainooga_url: 'https://ainooga.org/#/events/meeting',
  });
  expect(await links()).toEqual([
    {
      event_id: before[0]!.id,
      platform: 'luma',
      external_id: 'evt-example',
      url: 'https://luma.com/example',
    },
  ]);
  expect(await syncEvents(f.store, [event()])).toMatchObject({
    unchanged: 1,
    updated: 0,
  });
  expect(await rows()).toEqual(before);
});

it('attaches imported events and preserves registrations, omitted fields, and other links', async () => {
  await f.store.execute([
    "INSERT INTO events(id,name,starts_at,ends_at,timezone,capacity) VALUES(42,'Imported','2026-10-17T17:00:00.000Z','2026-10-17T21:00:00.000Z','America/New_York',60)",
    "INSERT INTO event_links VALUES(42,'luma','evt-example','https://luma.com/old'),(42,'other','other-id','https://example.com/event')",
    "INSERT INTO event_participation(event_id,person_id,registration_status,source) VALUES(42,2,'approved','luma')",
  ]);
  const participation = await f.store.query('SELECT * FROM event_participation');
  const doc = event();
  delete doc.frontmatter.endDate;
  delete doc.frontmatter.timezone;
  expect(await syncEvents(f.store, [doc])).toMatchObject({ updated: 1, created: 0 });
  expect(await rows()).toHaveLength(1);
  expect((await rows())[0]).toMatchObject({
    id: 42,
    name: "Agent's workshop",
    capacity: 60,
    timezone: 'America/New_York',
    ends_at: '2026-10-17T21:00:00.000Z',
  });
  expect(await f.store.query('SELECT * FROM event_participation')).toEqual(participation);
  expect(await links()).toContainEqual({
    event_id: 42,
    platform: 'other',
    external_id: 'other-id',
    url: 'https://example.com/event',
  });
  expect(await syncEvents(f.store, [event('renamed')])).toMatchObject({
    updated: 1,
    created: 0,
  });
  expect((await rows())[0]?.id).toBe(42);
});

it('previews changes without writes and skips drafts or absent files without deleting data', async () => {
  expect(await syncEvents(f.store, [event()], true)).toMatchObject({ created: 1 });
  expect(await rows()).toEqual([]);
  await syncEvents(f.store, [event()]);
  const before = await rows();
  const draft = event();
  draft.frontmatter.status = 'draft';
  expect(await syncEvents(f.store, [draft])).toMatchObject({ skipped: 1 });
  await syncEvents(f.store, []);
  expect(await rows()).toEqual(before);
});

it('rejects conflicting website and platform identities before any writes', async () => {
  await syncEvents(f.store, [event('first', 'evt-first'), event('second', 'evt-second')]);
  const before = await rows();
  await expect(
    syncEvents(f.store, [event('new', 'evt-new'), event('first', 'evt-second')]),
  ).rejects.toThrow(/conflict/i);
  expect(await rows()).toEqual(before);
  await expect(syncEvents(f.store, [event('first', 'evt-replacement')])).rejects.toThrow(
    /conflict/i,
  );
  expect(await rows()).toEqual(before);
});

it('rolls back the event when its link fails and reports the offending file', async () => {
  await f.store.execute([
    "CREATE TRIGGER reject_link BEFORE INSERT ON event_links BEGIN SELECT RAISE(ABORT,'failure'); END",
  ]);
  await expect(syncEvents(f.store, [event()])).rejects.toThrow(
    'content/events/meeting.md',
  );
  expect(await rows()).toEqual([]);
  expect(await links()).toEqual([]);
});

it('updates dates and zero capacity, preserves omitted links, and rejects an incompatible retained end', async () => {
  await syncEvents(f.store, [event()]);
  const originalLinks = await links();
  const doc = event();
  doc.frontmatter.date = new Date('2026-10-18T17:00:00Z');
  delete doc.frontmatter.endDate;
  delete doc.frontmatter.links;
  const before = await rows();
  await expect(syncEvents(f.store, [doc])).rejects.toThrow('supply endDate');
  expect(await rows()).toEqual(before);
  doc.frontmatter.endDate = new Date('2026-10-18T21:00:00Z');
  doc.frontmatter.capacity = 0;
  expect(await syncEvents(f.store, [doc])).toMatchObject({ updated: 1 });
  expect((await rows())[0]).toMatchObject({
    starts_at: '2026-10-18T17:00:00.000Z',
    ends_at: '2026-10-18T21:00:00.000Z',
    capacity: 0,
  });
  expect(await links()).toEqual(originalLinks);
});

it('rejects two different files that resolve to one imported event', async () => {
  await syncEvents(f.store, [event()]);
  await f.store.execute([
    "INSERT INTO event_links VALUES(1,'other','other-id','https://example.com/event')",
  ]);
  const other = event('different');
  other.frontmatter.links = [
    { platform: 'other', externalId: 'other-id', url: 'https://example.com/event' },
  ];
  await expect(syncEvents(f.store, [event(), other])).rejects.toThrow(
    'conflicting files',
  );
});

it('rolls back an update if another writer changes the platform identity after preflight', async () => {
  await syncEvents(f.store, [event()]);
  const before = await rows();
  const doc = event();
  doc.frontmatter.title = 'Changed';
  const concurrent = {
    query: (sql: string) => f.store.query(sql),
    execute: async (sql: string[]) => {
      await f.store.execute(["UPDATE event_links SET external_id='evt-other'"]);
      await f.store.execute(sql);
    },
  };
  await expect(syncEvents(concurrent, [doc])).rejects.toThrow('D1 write failed');
  expect(await rows()).toEqual(before);
  expect((await links())[0]?.external_id).toBe('evt-other');
});

it('retains completed events on a later failure and safely resumes on rerun', async () => {
  const docs = [event('one', 'evt-one'), event('two', 'evt-two')];
  await f.store.execute([
    "CREATE TRIGGER reject_second BEFORE INSERT ON event_links WHEN NEW.external_id='evt-two' BEGIN SELECT RAISE(ABORT,'failure'); END",
  ]);
  await expect(syncEvents(f.store, docs)).rejects.toThrow('content/events/two.md');
  expect(await rows()).toHaveLength(1);
  await f.store.execute(['DROP TRIGGER reject_second']);
  expect(await syncEvents(f.store, docs)).toMatchObject({ created: 1, unchanged: 1 });
  expect(await rows()).toHaveLength(2);
});

it('fails verification when the database changes the requested values', async () => {
  await f.store.execute([
    "CREATE TRIGGER alter_title AFTER INSERT ON events BEGIN UPDATE events SET name='Unexpected' WHERE id=NEW.id; END",
  ]);
  await expect(syncEvents(f.store, [event()])).rejects.toThrow('D1 read-back');
});
