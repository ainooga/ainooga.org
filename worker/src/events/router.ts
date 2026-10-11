import { invitationSchema } from './schemas.js';
import type { Env } from '../types.js';
import type { AuthDependencies } from '../auth/types.js';
import { jsonBody, reject } from '../auth/http.js';
import { eventInvitationMessage } from './message.js';

export async function adminEvents(request: Request, deps: AuthDependencies, env: Env) {
  const match =
    /^\/api\/admin\/events\/([a-zA-Z0-9_-]{1,160})\/invite(?:\/(preview))?$/.exec(
      new URL(request.url).pathname,
    );
  if (!match) reject(404, 'not_found', 'Endpoint not found.');
  if (request.method !== 'POST') reject(405, 'method', 'Method not allowed.');
  const fields = await jsonBody(request, invitationSchema);
  const preview = match[2] === 'preview';
  const event = { ...fields, slug: match[1]! };
  if (new Date(event.date) <= deps.now())
    reject(409, 'not_invitable', 'Invitations require an event that has not started.');
  if (!preview && !env.EMAIL)
    reject(503, 'configuration', 'Email sending is not configured.');
  const recipients = await invitationRecipients(deps.db, event.inviteTags);
  const message = eventInvitationMessage(event, event.links ?? [], env.SITE_URL);
  if (preview) {
    const { subject, text, html } = message;
    return Response.json({ recipients: recipients.length, subject, text, html });
  }
  return Response.json(await deliverInvitations(env.EMAIL, recipients, message));
}

async function invitationRecipients(db: D1Database, tags: string[]) {
  const missing = await db
    .prepare(
      `SELECT value FROM json_each(?)
    WHERE NOT EXISTS (SELECT 1 FROM person_tags WHERE tag=value) LIMIT 1`,
    )
    .bind(JSON.stringify(tags))
    .first();
  if (missing)
    reject(409, 'missing_tags', 'Some invitation tags do not exist. Check inviteTags.');
  const result = await db
    .prepare(
      `SELECT DISTINCT lower(trim(i.normalized_value)) AS email
    FROM person_identifiers i WHERE i.kind='email'
    AND EXISTS (SELECT 1 FROM person_tags t JOIN json_each(?) j ON j.value=t.tag
      WHERE t.person_id=i.person_id)
    AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.person_id=i.person_id
      AND s.kind='event_invites' AND s.subscribed=0) ORDER BY email`,
    )
    .bind(JSON.stringify(tags))
    .all<{ email: string }>();
  return result.results.map((row) => row.email);
}

async function send(
  email: SendEmail,
  message: Parameters<SendEmail['send']>[0],
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      email.send(message),
      new Promise<never>((_resolve, fail) => {
        timer = setTimeout(() => fail(new Error('Invitation send timed out')), 10000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function deliverInvitations(
  email: SendEmail,
  recipients: string[],
  message: ReturnType<typeof eventInvitationMessage>,
) {
  const summary = { recipients: recipients.length, accepted: 0, failed: 0 };
  for (let offset = 0; offset < recipients.length; offset += 5) {
    const outcomes = await Promise.allSettled(
      recipients.slice(offset, offset + 5).map((to) => send(email, { ...message, to })),
    );
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') summary.accepted++;
      else summary.failed++;
    }
  }
  return summary;
}
