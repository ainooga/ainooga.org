import { literal, type Row, type SqlStore } from '../db/types.js';
import { EventFrontmatter, type ParsedDoc } from './types.js';

type EventSnapshotType = { events: Row[]; links: Row[] };
type EventPlanType = {
  file: string;
  status: 'created' | 'updated' | 'unchanged' | 'skipped';
  id: number | null;
  fields: Row;
  links: Row[];
  changes: { field: string; before: unknown; after: unknown }[];
};

async function snapshot(store: SqlStore): Promise<EventSnapshotType> {
  return {
    events: await store.query('SELECT * FROM events'),
    links: await store.query('SELECT * FROM event_links'),
  };
}

export function eventRecord(doc: ParsedDoc) {
  const fields = EventFrontmatter.parse(doc.frontmatter);
  return {
    file: doc.filePath,
    published: fields.status === 'published',
    fields: {
      name: fields.title,
      starts_at: fields.date.toISOString(),
      location: fields.location,
      ainooga_url: `https://ainooga.org/#/events/${doc.slug}`,
      ...(fields.endDate === undefined ? {} : { ends_at: fields.endDate.toISOString() }),
      ...(fields.timezone === undefined ? {} : { timezone: fields.timezone }),
      ...(fields.capacity === undefined ? {} : { capacity: fields.capacity }),
    } as Row,
    links: (fields.links ?? []).map(
      (link): Row => ({
        platform: link.platform,
        external_id: link.externalId,
        url: link.url,
      }),
    ),
  };
}

function matchEvent(record: ReturnType<typeof eventRecord>, data: EventSnapshotType) {
  const ids = new Set(
    data.events
      .filter((row) => row.ainooga_url === record.fields.ainooga_url)
      .map((row) => row.id),
  );
  for (const link of record.links) {
    data.links
      .filter(
        (row) => row.platform === link.platform && row.external_id === link.external_id,
      )
      .forEach((row) => ids.add(row.event_id));
  }
  if (ids.size > 1) throw new Error(`${record.file}: conflicting event identities.`);
  return data.events.find((row) => ids.has(row.id));
}

function linkChanges(
  record: ReturnType<typeof eventRecord>,
  current: Row | undefined,
  data: EventSnapshotType,
): EventPlanType['changes'] {
  const changes: EventPlanType['changes'] = [];
  for (const link of record.links) {
    const old = data.links.find(
      (row) => row.event_id === current?.id && row.platform === link.platform,
    );
    if (
      old !== undefined &&
      old.external_id !== null &&
      old.external_id !== link.external_id
    )
      throw new Error(`${record.file}: conflicting ${String(link.platform)} identity.`);
    if (old?.external_id !== link.external_id || old?.url !== link.url)
      changes.push({
        field: `links.${String(link.platform)}`,
        before: old ?? null,
        after: link,
      });
  }
  return changes;
}

function planEvent(doc: ParsedDoc, data: EventSnapshotType): EventPlanType {
  const record = eventRecord(doc);
  if (!record.published) return { ...record, id: null, status: 'skipped', changes: [] };
  const current = matchEvent(record, data);
  const combined = { ...current, ...record.fields };
  if (
    typeof combined.ends_at === 'string' &&
    combined.ends_at <= String(combined.starts_at)
  )
    throw new Error(
      `${record.file}: end date in D1 is before the new start; supply endDate.`,
    );
  const changes: EventPlanType['changes'] = Object.entries(record.fields)
    .filter(([key, value]) => current?.[key] !== value)
    .map(([field, after]) => ({ field, before: current?.[field] ?? null, after }));
  changes.push(...linkChanges(record, current, data));
  const status = changes.length > 0 ? 'updated' : 'unchanged';
  return {
    ...record,
    id: current === undefined ? null : Number(current.id),
    changes,
    status: current === undefined ? 'created' : status,
  };
}

function eventStatements(plan: EventPlanType): string[] {
  const fields = Object.entries(plan.fields);
  const eventId =
    plan.id === null
      ? `(SELECT id FROM events WHERE ainooga_url=${literal(plan.fields.ainooga_url!)})`
      : String(plan.id);
  const write =
    plan.id === null
      ? `INSERT INTO events (${fields.map(([key]) => key).join(',')}) VALUES (${fields.map(([, value]) => literal(value)).join(',')})`
      : `UPDATE events SET ${fields.map(([key, value]) => `${key}=${literal(value)}`).join(',')},
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=${eventId}`;
  return [
    write,
    ...plan.links.map(
      (link) =>
        // A concurrent change to the platform identity must abort the whole event batch.
        `INSERT INTO event_links(event_id,platform,external_id,url)
     VALUES(${eventId},${literal(link.platform!)},${literal(link.external_id!)},${literal(link.url!)})
     ON CONFLICT(event_id,platform) DO UPDATE SET
       event_id=CASE WHEN event_links.external_id IS NULL OR event_links.external_id=excluded.external_id
         THEN excluded.event_id ELSE NULL END,
       external_id=excluded.external_id,url=excluded.url
     WHERE event_links.external_id IS NOT excluded.external_id OR event_links.url IS NOT excluded.url`,
    ),
  ];
}

function assertDistinctTargets(plans: EventPlanType[]): void {
  const seen = new Set<number>();
  for (const plan of plans) {
    if (plan.id === null) continue;
    if (seen.has(plan.id))
      throw new Error(`${plan.file}: conflicting files target the same D1 event.`);
    seen.add(plan.id);
  }
}

export async function syncEvents(store: SqlStore, docs: ParsedDoc[], dryRun = false) {
  const events = docs.filter((doc) => doc.type === 'events');
  const data = await snapshot(store);
  const plans = events.map((doc) => planEvent(doc, data));
  assertDistinctTargets(plans);
  if (!dryRun) {
    for (const plan of plans.filter((plan) =>
      ['created', 'updated'].includes(plan.status),
    )) {
      try {
        await store.execute(eventStatements(plan));
      } catch {
        throw new Error(
          `${plan.file}: D1 write failed or could not be confirmed. Rerun sync to reconcile.`,
        );
      }
    }
    const actual = await snapshot(store);
    for (const doc of events) {
      const verified = planEvent(doc, actual);
      if (!['unchanged', 'skipped'].includes(verified.status))
        throw new Error(
          `${doc.filePath}: D1 read-back did not match the requested event.`,
        );
    }
  }
  return {
    dryRun,
    created: plans.filter((plan) => plan.status === 'created').length,
    updated: plans.filter((plan) => plan.status === 'updated').length,
    unchanged: plans.filter((plan) => plan.status === 'unchanged').length,
    skipped: plans.filter((plan) => plan.status === 'skipped').length,
    events: plans.map(({ file, status, changes }) => ({ file, status, changes })),
  };
}
