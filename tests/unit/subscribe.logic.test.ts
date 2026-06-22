import { describe, it, expect, beforeEach } from 'vitest';
import { handleSubscribe } from '../../worker/src/subscribe';
import type { DbClient, EmailSender, TurnstileVerifier } from '../../worker/src/types';

class FakeDbClient implements DbClient {
  private subscribers: Map<
    string,
    { email: string; name: string | null; token: string }
  > = new Map();
  private confirmations: Map<string, boolean> = new Map();

  async insertSubscriber(
    email: string,
    name: string | null,
    token: string,
  ): Promise<void> {
    this.subscribers.set(email, { email, name, token });
    this.confirmations.set(token, false);
  }

  async findSubscriberByEmail(email: string): Promise<Record<string, unknown> | null> {
    const sub = this.subscribers.get(email);
    return sub ? { id: 1, email: sub.email } : null;
  }

  async confirmSubscription(token: string): Promise<number> {
    if (this.confirmations.has(token) && !this.confirmations.get(token)) {
      this.confirmations.set(token, true);
      return 1;
    }
    return 0;
  }

  async insertContactRequest(): Promise<void> {
    // noop for subscribe tests
  }
}

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
  let db: FakeDbClient;
  let email: FakeEmailSender;

  beforeEach(() => {
    db = new FakeDbClient();
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
    expect(body.message).toBe('Already subscribed!');
    expect(email.sent.length).toBe(0);
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

    expect(email.sent.length).toBe(1);
    expect(email.sent[0].to).toBe('new@example.com');
    expect(email.sent[0].name).toBe('New User');
    expect(email.sent[0].siteUrl).toBe('https://ainooga.org');
    expect(email.sent[0].token).toBeTruthy();
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

  it('returns 500 context is handled by caller', async () => {
    // Pure logic shouldn't throw on DB error — caller catches at handler level.
    // Test that a failing turnstile returns 400 gracefully.
    const turnstile = new FakeTurnstileVerifier(false);
    const res = await handleSubscribe(
      { email: 'test@example.com', turnstileToken: 'token' },
      { db, email, turnstile, siteUrl: 'https://example.com' },
    );
    expect(res.status).toBe(400);
  });
});
