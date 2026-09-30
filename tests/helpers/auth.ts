import { chapterDatabase, migration } from './d1';
import type { Env } from '../../worker/src/types';
import type { AuthDependencies } from '../../worker/src/auth/types';
import { randomToken } from '../../worker/src/auth/crypto';
import { handleAuth } from '../../worker/src/auth/router';

export const ORGANIZER_TOKEN = 'a'.repeat(64);
export const SITE = 'https://ainooga.test';

export class AuthFakes implements AuthDependencies {
  time = new Date('2026-09-29T12:00:00.000Z');
  sent: { address: string; code: string }[] = [];
  sendFails = false;
  botValid = true;
  allowed = true;
  discordId = '123456789012345678';
  discordFails = false;
  exchanges = 0;
  constructor(readonly db: D1Database) {}
  now() {
    return this.time;
  }
  random = randomToken;
  code() {
    return '123456';
  }
  async sendCode(address: string, code: string) {
    if (this.sendFails) throw new Error('Private provider error');
    this.sent.push({ address, code });
  }
  async verifyBot() {
    return this.botValid;
  }
  async limit() {
    return this.allowed;
  }
  async discordIdentity() {
    this.exchanges++;
    if (this.discordFails) throw new Error('Private OAuth error');
    return this.discordId;
  }
}

export async function authFixture() {
  const context = await chapterDatabase();
  await migration(context.store, '0003_voter_auth.sql');
  await context.store.execute([
    "INSERT INTO people (id,name) VALUES (1,'Organizer'),(2,'Voter'),(3,'Other')",
    "INSERT INTO person_identifiers (id,person_id,kind,value,normalized_value) VALUES (2,2,'email','voter@example.com','voter@example.com'),(3,3,'email','other@example.com','other@example.com'),(4,2,'discord','123456789012345678','123456789012345678')",
    ...['honor', 'verified', 'other'].map(
      (slug, index) => `INSERT INTO polls
      (id,slug,title,status,identity_mode,min_selections,max_selections,allow_write_ins,results_visibility,starts_at,ends_at,allow_edits,created_by)
      VALUES (${index + 1},'${slug}','Test','published','${index === 0 ? 'honor' : 'verified'}',1,1,0,'never','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z',0,1)`,
    ),
    'INSERT INTO poll_allowlist (poll_id,person_id) VALUES (1,2),(2,2),(3,3)',
  ]);
  const env: Env = {
    DB: context.db,
    EMAIL: undefined as unknown as SendEmail,
    SITE_URL: SITE,
    TURNSTILE_SECRET_KEY: 'test',
    AUTH_READY: 'true',
    CHAPTER_SCHEMA_READY: 'true',
    AUTH_SECRET: 's'.repeat(64),
    DISCORD_CLIENT_ID: 'client',
    DISCORD_CLIENT_SECRET: 'secret',
    ORGANIZER_API_TOKENS: JSON.stringify([
      { name: 'organizer', personId: 1, token: ORGANIZER_TOKEN },
    ]),
  };
  const deps = new AuthFakes(context.db);
  function call(
    path: string,
    body?: unknown,
    cookies?: string,
    extra: Record<string, string> = {},
  ) {
    const headers = new Headers({ ...extra });
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
      headers.set('Origin', SITE);
    }
    if (cookies) headers.set('Cookie', cookies);
    return handleAuth(
      new Request(`${SITE}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      deps,
    );
  }
  return { ...context, env, deps, call };
}

export function responseCookie(response: Response): string {
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

export async function emailChallenge(fixture: Awaited<ReturnType<typeof authFixture>>) {
  const response = await fixture.call('/api/polls/verified/auth/email/request', {
    email: ' Voter@Example.com ',
    turnstileToken: 'bot',
  });
  const body = (await response.json()) as { challengeId: string };
  return { id: body.challengeId, browser: responseCookie(response), response };
}

export async function verifiedLogin(fixture: Awaited<ReturnType<typeof authFixture>>) {
  const challenge = await emailChallenge(fixture);
  return fixture.call(
    '/api/polls/verified/auth/email/verify',
    { challengeId: challenge.id, code: '123456' },
    challenge.browser,
  );
}
