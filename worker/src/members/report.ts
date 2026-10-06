import { z } from 'zod';
import { contacts, type MemberInput, type ImportEvent } from './schemas.js';
import type { Row } from './schemas.js';

const fieldSchema = z
  .string()
  .refine(
    (value) =>
      [
        'person',
        'name',
        'company',
        'professionalRole',
        'email',
        'source',
        'member',
        'phone',
        'linkedin',
        'eventInvites',
      ].includes(value) ||
      /^tags\.\d+$/.test(value) ||
      /^participations\.\d+\.(registration|event)$/.test(value) ||
      /^participations\.\d+\.event\.(name|startsAt|endsAt|timezone|location|capacity|url)$/.test(
        value,
      ),
  );
export const importResultSchema = z
  .object({
    actions: z.array(
      z
        .object({
          field: fieldSchema,
          action: z.enum(['create', 'fill', 'preserve', 'unchanged']),
        })
        .strict(),
    ),
    conflicts: z.array(z.literal('identity_conflict')),
  })
  .strict();
export type ImportResult = z.infer<typeof importResultSchema>;
type Action = ImportResult['actions'][number]['action'];
function fieldAction(existing: unknown, incoming: unknown): Action {
  if (incoming === null || existing === incoming) return 'unchanged';
  return existing === null ||
    existing === undefined ||
    (typeof existing === 'string' && existing.trim() === '')
    ? 'fill'
    : 'preserve';
}
function conflict(rows: Row[][], input: MemberInput): boolean {
  const person = rows[0]![0];
  return rows[1]!.some(
    (source) => source.person_id !== person?.id || source.source_key !== input.sourceKey,
  );
}

export function importReport(rows: Row[][], input: MemberInput): ImportResult {
  if (conflict(rows, input)) return { actions: [], conflicts: ['identity_conflict'] };
  const result: ImportResult = { actions: [], conflicts: [] };
  const add = (field: string, action: Action) => {
    result.actions.push({ field, action });
  };
  const person = rows[0]![0];
  add('person', person ? 'unchanged' : 'create');
  if (person) {
    add('name', fieldAction(person.name, input.name));
    add(
      'professionalRole',
      fieldAction(person.professional_role, input.professionalRole),
    );
  }
  add('email', person ? 'unchanged' : 'create');
  add('source', rows[1]!.length ? 'unchanged' : 'create');
  add('member', rows[5]!.some((r) => r.tag === 'member') ? 'unchanged' : 'create');
  add('company', companyAction(rows[3]![0], input.company));
  for (const contact of contacts(input))
    add(
      contact.kind,
      rows[2]!.some(
        (r) => r.kind === contact.kind && r.normalized_value === contact.normalized,
      )
        ? 'unchanged'
        : 'create',
    );
  input.tags.forEach((tag, index) =>
    add(`tags.${index}`, rows[5]!.some((r) => r.tag === tag) ? 'unchanged' : 'create'),
  );
  add('eventInvites', subscriptionAction(rows[4]![0], input));
  input.participations.forEach((p, index) => {
    result.actions.push(...eventActions(rows[6 + index * 2]![0], p.event, index));
    const existing = rows[7 + index * 2]![0];
    add(
      `participations.${index}.registration`,
      registrationAction(existing, p.registrationStatus),
    );
  });
  return result;
}

function registrationAction(row: Row | undefined, status: string): Action {
  if (!row) return 'create';
  return row.registration_status === status ? 'unchanged' : 'preserve';
}
function companyAction(row: Row | undefined, company: string | null): Action {
  if (company === null || row?.person_id != null) return 'unchanged';
  return row ? 'fill' : 'create';
}
function subscriptionAction(row: Row | undefined, input: MemberInput): Action {
  if (!row) return 'create';
  if (input.eventInvites.status === 'unknown')
    return row.status === 'unknown' ? 'unchanged' : 'preserve';
  return row.status !== 'unsubscribed' ||
    (row.unsubscribed_at === null && input.eventInvites.unsubscribedAt !== null)
    ? 'fill'
    : 'unchanged';
}
function eventActions(
  row: Row | undefined,
  event: ImportEvent,
  index: number,
): ImportResult['actions'] {
  const base = `participations.${index}.event`;
  if (!row) return [{ field: base, action: 'create' }];
  const fields: [string, string, string | number | null][] = [
    ['name', 'name', event.name],
    ['startsAt', 'starts_at', event.startsAt],
    ['endsAt', 'ends_at', event.endsAt],
    ['timezone', 'timezone', event.timezone],
    ['location', 'location', event.location],
    ['capacity', 'capacity', event.capacity],
    ['url', 'url', event.url],
  ];
  return fields.map(([field, column, value]) => {
    const invalidEnd =
      field === 'endsAt' && value !== null && String(value) <= String(row.starts_at);
    return {
      field: `${base}.${field}`,
      action: invalidEnd ? 'preserve' : fieldAction(row[column], value),
    };
  });
}
