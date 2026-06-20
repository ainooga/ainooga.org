import { describe, it, expect, beforeEach } from 'vitest';
import { handleContactSponsor } from '../../functions/lib/contact-sponsor.logic';
import type { DbClient, TurnstileVerifier } from '../../functions/lib/types';

class FakeDbClient implements DbClient {
  public requests: Array<{
    name: string;
    phone: string;
    preferredDate?: string;
    preferredTime?: string;
  }> = [];

  async insertSubscriber(): Promise<void> {
    // noop for contact-sponsor tests
  }

  async findSubscriberByEmail(): Promise<Record<string, unknown> | null> {
    return null;
  }

  async confirmSubscription(): Promise<number> {
    return 0;
  }

  async insertContactRequest(data: {
    name: string;
    phone: string;
    preferredDate?: string;
    preferredTime?: string;
  }): Promise<void> {
    this.requests.push(data);
  }
}

class FakeTurnstileVerifier implements TurnstileVerifier {
  constructor(private shouldPass: boolean) {}

  async verify(_token: string): Promise<boolean> {
    return this.shouldPass;
  }
}

describe('handleContactSponsor', () => {
  let db: FakeDbClient;

  beforeEach(() => {
    db = new FakeDbClient();
  });

  it('returns 400 when name is missing', async () => {
    const turnstile = new FakeTurnstileVerifier(true);
    const res = await handleContactSponsor(
      { name: '', phone: '555-0123', turnstileToken: 'token' },
      { db, turnstile },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Name and phone required.');
    expect(db.requests.length).toBe(0);
  });

  it('returns 400 when phone is missing', async () => {
    const turnstile = new FakeTurnstileVerifier(true);
    const res = await handleContactSponsor(
      { name: 'Alice', phone: '', turnstileToken: 'token' },
      { db, turnstile },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Name and phone required.');
    expect(db.requests.length).toBe(0);
  });

  it('returns 400 when Turnstile verification fails', async () => {
    const turnstile = new FakeTurnstileVerifier(false);
    const res = await handleContactSponsor(
      { name: 'Alice', phone: '555-0123', turnstileToken: 'bad-token' },
      { db, turnstile },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Verification failed. Try again.');
    expect(db.requests.length).toBe(0);
  });

  it('returns 201 and inserts request on success', async () => {
    const turnstile = new FakeTurnstileVerifier(true);
    const res = await handleContactSponsor(
      { name: 'Alice', phone: '555-0123', turnstileToken: 'token' },
      { db, turnstile },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message).toBe("Thanks! We'll call you back.");

    expect(db.requests.length).toBe(1);
    expect(db.requests[0].name).toBe('Alice');
    expect(db.requests[0].phone).toBe('555-0123');
    expect(db.requests[0].preferredDate).toBeUndefined();
    expect(db.requests[0].preferredTime).toBeUndefined();
  });

  it('passes optional date and time to the database', async () => {
    const turnstile = new FakeTurnstileVerifier(true);
    const res = await handleContactSponsor(
      {
        name: 'Bob',
        phone: '555-0199',
        preferredDate: '2026-07-01',
        preferredTime: '14:00',
        turnstileToken: 'token',
      },
      { db, turnstile },
    );
    expect(res.status).toBe(201);
    expect(db.requests[0].preferredDate).toBe('2026-07-01');
    expect(db.requests[0].preferredTime).toBe('14:00');
  });

  it('trims whitespace from name and phone', async () => {
    const turnstile = new FakeTurnstileVerifier(true);
    const res = await handleContactSponsor(
      { name: '  Alice  ', phone: '  555-0123  ', turnstileToken: 'token' },
      { db, turnstile },
    );
    // Name with only whitespace should trigger 400
    // The implementation uses .trim() check — "  Alice  " is not empty after trim
    // so this should succeed
    expect(res.status).toBe(201);
  });
});
