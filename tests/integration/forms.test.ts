// @vitest-environment node
import { BackgroundTasks } from '../helpers/background';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chapterDatabase, migration } from '../helpers/d1';
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
  beforeEach(async () => {
    context = await chapterDatabase();
    for (const name of [
      '0003_voter_auth.sql',
      '0004_poll_api.sql',
      '0005_simplify_chapter.sql',
    ])
      await migration(context.store, name);
  });
  afterEach(async () => {
    await context.dispose();
  });
  it('claims concurrent normalized signups once through the forms route', async () => {
    const send = vi.fn(async (_message: EmailMessage | EmailMessageBuilder) => ({
      messageId: 'sent',
    }));
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({
        success: true,
        hostname: 'example.com',
        action: 'turnstile-spin-v1',
      }),
    );
    const endpoint = 'https://example.com/api/subscribe';
    const enabled = {
      ...env(),
      CHAPTER_SCHEMA_READY: 'true',
      EMAIL: { send },
    };
    try {
      const responses = await Promise.all(
        [' USER@Example.com ', 'user@example.com'].map((email, i) =>
          worker.fetch(
            new Request(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, turnstileToken: `proof-${i}` }),
            }),
            enabled,
            new BackgroundTasks(),
          ),
        ),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com' }),
      );
    } finally {
      provider.mockRestore();
    }
    expect(
      await context.store.query('SELECT normalized_value FROM person_identifiers'),
    ).toEqual([{ normalized_value: 'user@example.com' }]);
    expect(await context.store.query('SELECT COUNT(*) AS n FROM people')).toEqual([
      { n: 1 },
    ]);
    expect(await context.store.query('SELECT COUNT(*) AS n FROM subscriptions')).toEqual([
      { n: 1 },
    ]);
    expect(
      await context.store.query(
        'SELECT subscribed,confirmation_pending,confirmed_at FROM subscriptions',
      ),
    ).toEqual([{ subscribed: 1, confirmation_pending: 1, confirmed_at: null }]);
    // Redeem the token actually sent, not a separately seeded claim.
    const mail = send.mock.calls[0]![0];
    const link =
      'text' in mail && typeof mail.text === 'string'
        ? mail.text.match(/https:\/\/example\.com\/confirm\?token=\S+/)?.[0]
        : undefined;
    expect(link).toBeDefined();
    const token = new URL(link!).searchParams.get('token');
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
    expect(
      await context.store.query(
        'SELECT subscribed,confirmation_pending,confirmed_at FROM subscriptions',
      ),
    ).toEqual([
      { subscribed: 1, confirmation_pending: 0, confirmed_at: expect.any(String) },
    ]);
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
    expect(
      await context.store.query(
        "SELECT COUNT(*) AS n FROM person_tags WHERE tag='member'",
      ),
    ).toEqual([{ n: 0 }]);
    expect(
      await context.store.query(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE name='organizer_permissions'",
      ),
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
    await context.store.execute([
      'UPDATE subscriptions SET subscribed=0,confirmation_pending=0',
    ]);
    expect(
      (await handleSubscribe({ email: 'user@example.com', turnstileToken: 'test' }, deps))
        .status,
    ).toBe(200);
    expect(await deps.db.confirmSubscription('token')).toBe(0);
    expect(deps.email.sent).toHaveLength(0);
  });

  it('rejects expired and invalid tokens', async () => {
    const db = createDb(context.db);
    await db.insertSubscriber('user@example.com', null, 'expired');
    await context.store.execute([
      "UPDATE subscriptions SET confirmation_expires_at='2000-01-01T00:00:00.000Z'",
    ]);
    expect(await db.confirmSubscription('expired')).toBe(0);
    expect(await db.confirmSubscription('invalid')).toBe(0);
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
});
