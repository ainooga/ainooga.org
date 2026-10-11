import type { EventInvitationType, EventLinksType } from './schemas.js';

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

function schedule(event: EventInvitationType): string {
  const timezone = event.timezone ?? 'UTC';
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    dateStyle: 'full',
    timeStyle: 'short',
  });
  const start = formatter.format(new Date(event.date));
  const end =
    event.endDate === undefined ? '' : ` to ${formatter.format(new Date(event.endDate))}`;
  return `When: ${start}${end} (${timezone})`;
}

export function eventInvitationMessage(
  event: EventInvitationType,
  links: EventLinksType,
  siteUrl: string,
) {
  const url = new URL('/', siteUrl);
  url.hash = `/events/${event.slug}`;
  const introduction = event.inviteMessage ?? 'You are invited to join us.';
  const paragraphs = [introduction, event.title, schedule(event)];
  if (event.location) paragraphs.push(`Where: ${event.location}`);
  const eventLinks = [{ platform: 'Event details', url: url.href }, ...links];
  return {
    from: 'noreply@ainooga.org',
    replyTo: 'contact@ainooga.org',
    subject: `AI Nooga event: ${event.title.replace(/[\r\n]+/g, ' ')}`,
    text: [
      ...paragraphs,
      ...eventLinks.map((link) => `${link.platform}: ${link.url}`),
    ].join('\n\n'),
    html:
      paragraphs
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`)
        .join('') +
      eventLinks
        .map(
          (link) =>
            `<p><a href="${escapeHtml(link.url)}">${escapeHtml(link.platform)}</a></p>`,
        )
        .join(''),
  };
}
