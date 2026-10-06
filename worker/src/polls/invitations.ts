import type { Env } from '../types.js';
import type { AuthDependencies } from '../auth/types.js';
import { reject } from '../auth/http.js';
import { eligiblePerson } from './eligibility.js';
import { getPoll, type PollRow } from './store.js';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

function invitation(poll: PollRow, siteUrl: string) {
  const url = new URL('/', siteUrl);
  url.hash = `/polls/${poll.slug}`;
  const maximum =
    poll.max_selections === null ? 'with no maximum' : `up to ${poll.max_selections}`;
  const instructions =
    `Choose at least ${poll.min_selections} option(s), ${maximum}.` +
    (poll.allow_write_ins
      ? ' You can add one write-in; it becomes a choice for everyone.'
      : '') +
    (poll.allow_edits
      ? ` You can edit until ${poll.edit_deadline ?? poll.ends_at}.`
      : '');
  const schedule = `Voting opens ${poll.starts_at} and closes ${poll.ends_at} (UTC).`;
  return {
    from: 'noreply@ainooga.org',
    replyTo: 'contact@ainooga.org',
    subject: `AI Nooga poll: ${poll.title.replace(/[\r\n]+/g, ' ')}`,
    text: `${poll.title}\n\nYou are invited to vote:\n${url.href}\n\n${instructions}\n${schedule}`,
    html: `<p>${escapeHtml(poll.title)}</p><p>You are invited to <a href="${escapeHtml(url.href)}">vote in this poll</a>.</p><p>${escapeHtml(instructions)}</p><p>${escapeHtml(schedule)}</p>`,
  };
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

export async function invitePoll(deps: AuthDependencies, env: Env, slug: string) {
  const poll = await getPoll(deps.db, slug);
  if (poll.status !== 'published' || poll.ends_at <= deps.now().toISOString())
    reject(
      409,
      'not_invitable',
      'Invitations require a published poll that has not closed.',
    );
  if (!env.EMAIL) reject(503, 'configuration', 'Email sending is not configured.');
  const result = await deps.db
    .prepare(
      `SELECT DISTINCT lower(trim(i.normalized_value)) AS email
    FROM person_identifiers i JOIN polls p ON ${eligiblePerson('i.person_id')}
    WHERE p.id=? AND i.kind='email' ORDER BY email`,
    )
    .bind(poll.id)
    .all<{ email: string }>();
  const summary = { recipients: result.results.length, accepted: 0, failed: 0 };
  const message = invitation(poll, env.SITE_URL);
  // Limit concurrent provider calls while handling the entire audience in one request.
  for (let offset = 0; offset < result.results.length; offset += 5) {
    const outcomes = await Promise.allSettled(
      result.results
        .slice(offset, offset + 5)
        .map(({ email }) => send(env.EMAIL, { ...message, to: email })),
    );
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') summary.accepted++;
      else summary.failed++;
    }
  }
  return summary;
}
