import { invitationSummarySchema } from '../../worker/src/polls/schemas.js';
import {
  eventSlugSchema,
  invitationSchema,
  type EventInvitationType,
  invitationPreviewSchema,
} from '../../worker/src/events/schemas.js';

function apiOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Set AINOOGA_API_URL to an API origin.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error('Use HTTPS for the API URL, except on localhost.');
  if (
    [url.username, url.password, url.search, url.hash].some((part) => part !== '') ||
    url.pathname !== '/'
  )
    throw new Error(
      'AINOOGA_API_URL must be an origin without credentials, path, query or fragment.',
    );
  return url;
}

function failure(message: string, preview: boolean): Error {
  return new Error(
    message +
      (preview
        ? ''
        : ' Some invitations may already have been sent. Check Cloudflare Email Sending activity before rerunning.'),
  );
}

export class EventClient {
  private readonly base: URL;
  constructor(
    private readonly token: string,
    url: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new Error('Set AINOOGA_API_TOKEN to your organizer token.');
    this.base = apiOrigin(url);
  }
  async invite(
    slug: string,
    preview: boolean,
    fields: Omit<EventInvitationType, 'slug'>,
  ) {
    if (!eventSlugSchema.safeParse(slug).success) throw new Error('Invalid event slug.');
    const body = JSON.stringify(invitationSchema.parse(fields));
    if (new TextEncoder().encode(body).length > 16384)
      throw new Error(
        'Event invitation exceeds the API request size limit. Shorten the message.',
      );
    let response: Response;
    try {
      response = await fetch(
        new URL(
          `/api/admin/events/${slug}/invite${preview ? '/preview' : ''}`,
          this.base,
        ),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(preview ? 15000 : 600000),
        },
      );
    } catch {
      throw failure(
        'API request failed. Check the API URL and connection; redirects are refused.',
        preview,
      );
    }
    if (!response.ok) {
      const message = `API request failed (HTTP ${response.status}). Check the token, event state, and invitation tags.`;
      throw response.status >= 500 ? failure(message, preview) : new Error(message);
    }
    try {
      const result: unknown = await response.json();
      return preview
        ? invitationPreviewSchema.parse(result)
        : invitationSummarySchema.parse(result);
    } catch {
      throw failure('Invalid event invitation API response.', preview);
    }
  }
}
