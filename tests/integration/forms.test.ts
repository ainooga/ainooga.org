// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chapterDatabase } from '../helpers/d1';
import { createDb } from '../../worker/src/db/client';
import { handleSubscribe } from '../../worker/src/subscribe';
import { handleContactSponsor } from '../../worker/src/contact-sponsor';
import { handleConfirm } from '../../worker/src/confirm';
import worker from '../../worker/src/index';
import type { EmailSender, Env } from '../../worker/src/types';

class EmailRecorder implements EmailSender {
  sent: { to: string; token: string }[] = [];
  async sendConfirmation(to: string, _name: string | null, token: string): Promise<void> {
    this.sent.push({ to, token });
  }
}

let context: Awaited<ReturnType<typeof chapterDatabase>>;
beforeEach(async () => {
  context = await chapterDatabase();
});
afterEach(async () => {
  await context.dispose();
});
function dependencies() {
  return {
    db: createDb(context.db),
    email: new EmailRecorder(),
    turnstile: {
      async verify() {
        return true;
      },
    },
    siteUrl: 'https://example.com',
  };
}
function env(): Env {
  return {
    DB: context.db,
    EMAIL: undefined as unknown as SendEmail,
    TURNSTILE_SECRET_KEY: 'test',
    SITE_URL: 'https://example.com',
  };
}

describe('forms against local D1', () => {
  it('creates one person/subscription and sends one email under concurrent duplicate signup', async () => {
    const deps = dependencies();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        handleSubscribe(
          { email: ' USER@Example.com ', name: 'User', turnstileToken: 'test' },
          deps,
        ),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(deps.email.sent).toHaveLength(1);
    expect(await context.store.query('SELECT COUNT(*) AS n FROM people')).toEqual([
      { n: 1 },
    ]);
    expect(await context.store.query('SELECT COUNT(*) AS n FROM subscriptions')).toEqual([
      { n: 1 },
    ]);
    const token = deps.email.sent[0]!.token;
    const response = await handleConfirm(
      new Request(`https://example.com/confirm?token=${token}`),
      env(),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Confirmed!');
    expect(
      (
        await handleConfirm(
          new Request(`https://example.com/confirm?token=${token}`),
          env(),
        )
      ).status,
    ).toBe(404);
    expect(
      await context.store.query('SELECT confirmation_token_hash FROM subscriptions'),
    ).toEqual([{ confirmation_token_hash: null }]);
  });

  it('reuses an email owner without overwriting their name or grants', async () => {
    await context.store.execute([
      "INSERT INTO people (id,name) VALUES (4,'Existing')",
      "INSERT INTO person_identifiers (person_id,kind,value,normalized_value) VALUES (4,'email','member@example.com','member@example.com')",
    ]);
    const deps = dependencies();
    expect(
      (
        await handleSubscribe(
          { email: 'member@example.com', name: 'Replacement', turnstileToken: 'test' },
          deps,
        )
      ).status,
    ).toBe(201);
    expect(await context.store.query('SELECT id,name FROM people')).toEqual([
      { id: 4, name: 'Existing' },
    ]);
    expect(await context.store.query('SELECT COUNT(*) AS n FROM memberships')).toEqual([
      { n: 0 },
    ]);
    expect(
      await context.store.query('SELECT COUNT(*) AS n FROM organizer_permissions'),
    ).toEqual([{ n: 0 }]);
  });

  it('rolls back person and identifier creation when the subscription write fails', async () => {
    const db = createDb(context.db);
    await db.insertSubscriber('first@example.com', null, 'same-token');
    await expect(
      db.insertSubscriber('second@example.com', null, 'same-token'),
    ).rejects.toThrow();
    expect(await context.store.query('SELECT COUNT(*) AS n FROM people')).toEqual([
      { n: 1 },
    ]);
    expect(
      await context.store.query('SELECT COUNT(*) AS n FROM person_identifiers'),
    ).toEqual([{ n: 1 }]);
    expect(await db.findSubscriberByEmail(' FIRST@Example.com ')).toEqual({ id: 1 });
  });

  it('does not reactivate an unsubscribed newsletter preference', async () => {
    const deps = dependencies();
    await deps.db.insertSubscriber('user@example.com', null, 'token');
    await context.store.execute(["UPDATE subscriptions SET status='unsubscribed'"]);
    expect(
      (await handleSubscribe({ email: 'user@example.com', turnstileToken: 'test' }, deps))
        .status,
    ).toBe(200);
    expect(await deps.db.confirmSubscription('token')).toBe(0);
    expect(deps.email.sent).toHaveLength(0);
  });

  it('rejects expired and invalid tokens and handles missing tokens', async () => {
    const db = createDb(context.db);
    await db.insertSubscriber('user@example.com', null, 'expired');
    await context.store.execute([
      "UPDATE subscriptions SET confirmation_expires_at='2000-01-01T00:00:00.000Z'",
    ]);
    expect(await db.confirmSubscription('expired')).toBe(0);
    expect(await db.confirmSubscription('invalid')).toBe(0);
    expect(
      (await handleConfirm(new Request('https://example.com/confirm'), env())).status,
    ).toBe(400);
  });

  it('keeps inquiries independent of email or person identity', async () => {
    const deps = dependencies();
    const response = await handleContactSponsor(
      {
        name: 'Caller',
        phone: '+1 (555) 012-3456',
        preferredDate: '2026-10-01',
        preferredTime: '14:00',
        turnstileToken: 'test',
      },
      deps,
    );
    expect(response.status).toBe(201);
    expect(
      await context.store.query(
        'SELECT submitted_name,submitted_phone,person_id,preferred_date FROM contact_requests',
      ),
    ).toEqual([
      {
        submitted_name: 'Caller',
        submitted_phone: '+15550123456',
        person_id: null,
        preferred_date: '2026-10-01',
      },
    ]);
    expect(await context.store.query('SELECT COUNT(*) AS n FROM people')).toEqual([
      { n: 0 },
    ]);
  });

  it.each(['/api/subscribe', '/api/contact-sponsor', '/confirm'])(
    'gates %s before parsing input or touching dependencies',
    async (path) => {
      const inaccessible = {
        get DB(): D1Database {
          throw new Error('Database touched');
        },
        get EMAIL(): SendEmail {
          throw new Error('Email touched');
        },
      } as Env;
      const request = new Request(`https://example.com${path}`, {
        method: path === '/confirm' ? 'GET' : 'POST',
        headers: { Origin: 'https://ainooga.org' },
      });
      const response = await worker.fetch(request, inaccessible);
      expect(response.status).toBe(503);
      expect(response.headers.get('Retry-After')).toBe('60');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://ainooga.org',
      );
    },
  );

  it('keeps OPTIONS available and explicitly enables the migrated confirmation handler', async () => {
    expect(
      (
        await worker.fetch(
          new Request('https://example.com/api/subscribe', { method: 'OPTIONS' }),
          env(),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await worker.fetch(new Request('https://example.com/confirm'), {
          ...env(),
          CHAPTER_SCHEMA_READY: 'true',
        })
      ).status,
    ).toBe(400);
    expect(
      (await worker.fetch(new Request('https://example.com/unknown'), env())).status,
    ).toBe(404);
  });
});
