import { z } from 'zod';
import { identifierSchema } from './organizers.js';
import { eligibleIdentity, insertSession } from './store.js';
import type { AuthDependencies, Poll } from './types.js';

export const honorIdentifier = z.union([
  identifierSchema,
  z
    .object({
      kind: z.literal('discord_username'),
      value: z.string().trim().min(1).max(32),
    })
    .strict(),
]);

export async function identifyGuest(
  deps: AuthDependencies,
  poll: Poll,
  input: z.infer<typeof honorIdentifier>,
  hash: string,
): Promise<boolean> {
  if (input.kind === 'discord_username')
    return usernameSession(deps, poll, input.value.toLowerCase(), hash);
  const value = input.kind === 'email' ? input.value.toLowerCase() : input.value;
  const identity = await eligibleIdentity(deps.db, poll.id, input.kind, value);
  return (
    identity !== null && insertSession(deps.db, hash, identity, poll, 'honor', deps.now())
  );
}

async function usernameSession(
  deps: AuthDependencies,
  poll: Poll,
  username: string,
  hash: string,
): Promise<boolean> {
  const now = deps.now();
  // Resolve the label, reject ambiguity across people, and check eligibility in
  // the same INSERT. Never choose the first of several matching people.
  const result = await deps.db
    .prepare(
      `
    INSERT INTO voter_sessions
      (token_hash,person_id,identifier_id,identifier_value,assurance,poll_id,created_at,expires_at)
    SELECT ?,i.person_id,i.id,i.normalized_value,'honor',p.id,?,?
    FROM person_identifiers i
    JOIN poll_allowlist a ON a.person_id=i.person_id
    JOIN polls p ON p.id=a.poll_id
    WHERE i.kind='discord' AND lower(trim(i.display_label, char(9,10,11,12,13,32)))=?
      AND p.id=? AND p.status='published' AND p.identity_mode='honor' AND a.revoked_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM person_identifiers other WHERE other.kind='discord'
          AND lower(trim(other.display_label, char(9,10,11,12,13,32)))=?
          AND other.person_id!=i.person_id
      )
    ORDER BY i.id LIMIT 1
  `,
    )
    .bind(
      hash,
      now.toISOString(),
      new Date(now.getTime() + 86400000).toISOString(),
      username,
      poll.id,
      username,
    )
    .run();
  return result.meta.changes === 1;
}
