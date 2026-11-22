import { describe, it, expect, beforeEach } from 'vitest';
import { handleSubscribe } from '../../worker/src/subscribe';
import type { EmailSender, TurnstileVerifier } from '../../worker/src/types';

import { NewsletterClaims } from '../helpers/newsletter-claims';

class FakeEmailSender implements EmailSender {
  public sent: Array<{
    to: string;
    name: string | null;
    token: string;
    siteUrl: string;
  }> = [];

  async sendConfirmation(
    to: string,
    name: string | null,
    confirmToken: string,
    siteUrl: string,
  ): Promise<void> {
    this.sent.push({ to, name, token: confirmToken, siteUrl });
  }
}

class FakeTurnstileVerifier implements TurnstileVerifier {
  constructor(private shouldPass: boolean) {}

  async verify(_token: string): Promise<boolean> {
    return this.shouldPass;
  }
}

describe('handleSubscribe', () => {
  let db: NewsletterClaims;
  let email: FakeEmailSender;

  beforeEach(() => {
    db = new NewsletterClaims();
    email = new FakeEmailSender();
  });

  it('returns 400 for missing email', async () => {
    const turnstile = new FakeTurnstileVerifier(true);
    const res = await handleSubscribe(
      { email: '', turnstileToken: 'token' },
      { db, email, turnstile, siteUrl: 'https://example.com' },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Valid email required');
  });

  it('returns 400 for invalid email', async () => {
    const turnstile = new FakeTurnstileVerifier(true);
    const res = await handleSubscribe(
      { email: 'not-an-email', turnstileToken: 'token' },
      { db, email, turnstile, siteUrl: 'https://example.com' },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Valid email required');
  });

  it('returns 400 when Turnstile verification fails', async () => {
    const turnstile = new FakeTurnstileVerifier(false);
    const res = await handleSubscribe(
      { email: 'user@example.com', turnstileToken: 'bad-token' },
      { db, email, turnstile, siteUrl: 'https://example.com' },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Verification failed. Try again.');
  });

  it('returns 200 with message when email already exists', async () => {
    const turnstile = new FakeTurnstileVerifier(true);
    // Insert the subscriber first
    await db.insertSubscriber('user@example.com', 'User', 'existing-token');

    const res = await handleSubscribe(
      { email: 'user@example.com', turnstileToken: 'token' },
      { db, email, turnstile, siteUrl: 'https://example.com' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('A subscription request already exists for this address.');
    expect(email.sent).toHaveLength(0);
  });

  it('returns 201 and sends confirmation for new subscriber', async () => {
    const turnstile = new FakeTurnstileVerifier(true);
    const res = await handleSubscribe(
      { email: 'new@example.com', name: 'New User', turnstileToken: 'token' },
      { db, email, turnstile, siteUrl: 'https://ainooga.org' },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message).toBe('Check your email to confirm.');

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].to).toBe('new@example.com');
    expect(email.sent[0].name).toBe('New User');
    expect(email.sent[0].siteUrl).toBe('https://ainooga.org');
    expect(email.sent[0].token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(email.sent[0].token).toBe(db.pending.get('new@example.com'));
  });

  it('invalidates exactly the claimed token on mail failure before allowing retry', async () => {
    const input = { email: 'retry@example.com', turnstileToken: 'proof' };
    const deps = {
      db,
      email,
      turnstile: new FakeTurnstileVerifier(true),
      siteUrl: 'https://example.com',
    };
    const attempted: string[] = [];
    const failingMail: EmailSender = {
      async sendConfirmation(_to, _name, token) {
        attempted.push(token);
        throw new Error('delivery unavailable');
      },
    };
    await expect(
      handleSubscribe(input, { ...deps, email: failingMail }),
    ).rejects.toMatchObject({ status: 503 });
    expect(attempted).toHaveLength(1);
    expect(db.invalidated).toEqual(attempted);
    expect((await handleSubscribe(input, deps)).status).toBe(201);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].token).not.toBe(attempted[0]);
  });

  it('accepts subscriber without name', async () => {
    const turnstile = new FakeTurnstileVerifier(true);
    const res = await handleSubscribe(
      { email: 'anon@example.com', turnstileToken: 'token' },
      { db, email, turnstile, siteUrl: 'https://example.com' },
    );
    expect(res.status).toBe(201);
    expect(email.sent[0].name).toBeNull();
  });

  it('propagates DB insert errors to the caller without sending email', async () => {
    const dbError = new Error('db down');
    const failingDb = {
      async insertSubscriber() {
        throw dbError;
      },
      invalidateConfirmation: db.invalidateConfirmation.bind(db),
    };
    const turnstile = new FakeTurnstileVerifier(true);
    await expect(
      handleSubscribe(
        { email: 'test@example.com', turnstileToken: 'token' },
        { db: failingDb, email, turnstile, siteUrl: 'https://example.com' },
      ),
    ).rejects.toBe(dbError);
    expect(email.sent).toEqual([]);
  });
});
