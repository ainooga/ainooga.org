// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
import { createEmailSender, createTurnstileVerifier } from '../../worker/src/adapters';

describe('public form provider boundaries', () => {
  it('renders names as text in HTML email', async () => {
    const sent: { html?: string; text?: string }[] = [];
    const email = {
      send: async (message: { html?: string; text?: string }) => {
        sent.push(message);
      },
    } as unknown as SendEmail;
    const name = '<a href="https://evil.test">Click me</a> & friends';
    await createEmailSender(email).sendConfirmation(
      'person@example.com',
      name,
      'token',
      'https://ainooga.org',
    );
    expect(sent[0]?.html).not.toContain(name);
    expect(sent[0]?.html).toContain('&lt;a');
    expect(sent[0]?.text).toContain(name);
    expect(sent[0]?.html).toContain('https://ainooga.org/confirm?token=token');
  });
  it('reports missing and rejected email delivery', async () => {
    const email = {
      send: async () => {
        throw new Error('private provider data');
      },
    } as unknown as SendEmail;
    for (const binding of [undefined, email]) {
      await expect(
        createEmailSender(binding).sendConfirmation(
          'person@example.com',
          null,
          'token',
          'https://ainooga.org',
        ),
      ).rejects.toMatchObject({ status: 503 });
    }
  });
  it.each([
    [{ success: true, hostname: 'ainooga.org', action: 'turnstile-spin-v1' }, true],
    [{ success: true, hostname: 'evil.test', action: 'turnstile-spin-v1' }, false],
    [{ success: true, hostname: 'ainooga.org', action: 'poll-auth' }, false],
    [{ success: 'true', hostname: 'ainooga.org', action: 'turnstile-spin-v1' }, false],
    [{ success: true }, false],
    [{ success: false }, false],
  ])('checks the complete verification response %j', async (body, expected) => {
    const fetcher: typeof fetch = async () => Response.json(body);
    vi.stubGlobal('fetch', fetcher);
    const verifier = createTurnstileVerifier('secret', 'ainooga.org', fetcher);
    expect(await verifier.verify('token')).toBe(expected);
  });
  it('fails closed on provider failure without exposing details', async () => {
    const fetcher: typeof fetch = async () =>
      new Response('private failure', { status: 503 });
    vi.stubGlobal('fetch', fetcher);
    await expect(
      createTurnstileVerifier('secret', 'ainooga.org', fetcher).verify('token'),
    ).rejects.toMatchObject({ status: 503, code: 'provider_unavailable' });
  });
});

it('bounds email delivery and handles late completion', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const email = {
    send: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  } as unknown as SendEmail;
  try {
    const delivery = createEmailSender(email).sendConfirmation(
      'person@example.com',
      null,
      'token',
      'https://ainooga.org',
    );
    const assertion = expect(delivery).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    finish();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
