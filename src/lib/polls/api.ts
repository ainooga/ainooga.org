import { z } from 'zod';
import {
  accessSchema,
  ballotSchema,
  detailSchema,
  resultsSchema,
  PollError,
} from './types';
import type { GuestIdentifier, PollService, Submission } from './types';

const signedIn = z
  .object({ authenticated: z.literal(true), assurance: z.literal('honor') })
  .strict();
const signedOut = z.object({ authenticated: z.literal(false) }).strict();

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  try {
    const response = await fetch(`/api/${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data: unknown = await response.json();
    if (!response.ok) throw responseError(response.status, data);
    const parsed = schema.safeParse(data);
    if (!parsed.success)
      throw new PollError(
        0,
        'response',
        'The server returned an unreadable response. Please retry.',
      );
    return parsed.data;
  } catch (error) {
    if (error instanceof PollError) throw error;
    throw new PollError(
      0,
      'network',
      'Could not reach the poll. Check your connection and retry.',
    );
  }
}
function responseError(status: number, data: unknown): PollError {
  const parsed = z.object({ code: z.string(), error: z.string() }).safeParse(data);
  return new PollError(
    status,
    parsed.success ? parsed.data.code : 'server',
    parsed.success ? parsed.data.error : 'Could not complete the request. Please retry.',
  );
}
const path = (slug: string) => `polls/${encodeURIComponent(slug)}`;
export class BrowserPollService implements PollService {
  access(slug: string) {
    return request(`${path(slug)}/access`, accessSchema);
  }
  detail(slug: string) {
    return request(path(slug), detailSchema);
  }
  results(slug: string) {
    return request(`${path(slug)}/results`, resultsSchema);
  }
  async identify(slug: string, identifier: GuestIdentifier, token: string) {
    await request(`${path(slug)}/auth/honor`, signedIn, 'POST', {
      identifier,
      turnstileToken: token,
    });
  }
  submit(slug: string, input: Submission) {
    return request(`${path(slug)}/ballot`, ballotSchema, 'PUT', input);
  }
  async logout() {
    await request('auth/logout', signedOut, 'POST', {});
  }
}
