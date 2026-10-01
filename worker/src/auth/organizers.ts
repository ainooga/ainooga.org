import { z } from 'zod';
import { hashToken, sameHash } from './crypto.js';
import { jsonBody, reject } from './http.js';
import { normalizeEmail } from '../db/identifiers.js';

const tokensSchema = z
  .array(
    z
      .object({
        name: z.string().min(1).max(100),
        personId: z.number().int().positive(),
        token: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  )
  .min(1)
  .max(20);

export async function organizer(request: Request, configured: string | undefined) {
  let entries: z.infer<typeof tokensSchema>;
  try {
    entries = tokensSchema.parse(JSON.parse(configured ?? ''));
  } catch {
    return reject(503, 'configuration', 'Organizer access is not configured.');
  }
  const supplied = request.headers
    .get('Authorization')
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!supplied)
    return reject(401, 'unauthorized', 'An organizer API token is required.');
  const suppliedHash = await hashToken(supplied);
  let match: (typeof entries)[number] | undefined;
  for (const entry of entries) {
    if (sameHash(suppliedHash, await hashToken(entry.token))) match = entry;
  }
  if (!match) return reject(401, 'unauthorized', 'Invalid organizer API token.');
  return { name: match.name, personId: match.personId };
}

export const identifierSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('email'), value: z.string().trim().max(254).email() })
    .strict(),
  z
    .object({ kind: z.literal('discord'), value: z.string().regex(/^\d{17,20}$/) })
    .strict(),
]);

export async function linkIdentifier(
  request: Request,
  db: D1Database,
  personId: number,
): Promise<Response> {
  const input = await jsonBody(request, identifierSchema);
  const value = input.kind === 'email' ? normalizeEmail(input.value) : input.value;
  const person = await db
    .prepare('SELECT id FROM people WHERE id = ?')
    .bind(personId)
    .first();
  if (!person) return reject(404, 'not_found', 'Person not found.');
  await db
    .prepare(
      `INSERT INTO person_identifiers (person_id,kind,value,normalized_value)
    VALUES (?,?,?,?) ON CONFLICT DO NOTHING`,
    )
    .bind(personId, input.kind, value, value)
    .run();
  const row = await db
    .prepare(
      'SELECT id, person_id FROM person_identifiers WHERE kind = ? AND normalized_value = ?',
    )
    .bind(input.kind, value)
    .first<{ id: number; person_id: number }>();
  if (row?.person_id !== personId)
    return reject(
      409,
      'identity_conflict',
      'Identifier already belongs to another person.',
    );
  return Response.json({ id: row.id, personId });
}
