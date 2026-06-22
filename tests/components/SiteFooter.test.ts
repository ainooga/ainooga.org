import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte/svelte5';
import SiteFooter from '../../src/components/SiteFooter.svelte';
import { createTurnstileContext } from '../../src/lib/context';
import { FakeTurnstile, type TurnstileService } from '../../src/lib/turnstile';

/* ------------------------------------------------------------------ */
/*  Helper: a TurnstileService that never loads (render → null)       */
/* ------------------------------------------------------------------ */
class NullTurnstile implements TurnstileService {
  callbacks = new Map<string, unknown>();
  render(): string | null {
    return null;
  }
  getResponse(): string {
    return '';
  }
  reset(): void {
    /* noop */
  }
  remove(): void {
    /* noop */
  }
}

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

function renderFooter(fake: TurnstileService) {
  return render(SiteFooter, { context: createTurnstileContext(fake) });
}

/**
 * Fill the email input and submit the form.
 * Returns after Svelte has flushed all pending reactivity.
 */
async function fillAndSubmit(email: string) {
  const input = document.querySelector('#subscribe-email') as HTMLInputElement;
  input!.value = email;
  await fireEvent.input(input!);

  const form = document.querySelector('.site-footer__subscribe') as HTMLFormElement;
  await fireEvent.submit(form);
}

/**
 * Get the stored Turnstile callbacks for the most recent widget.
 * Returns undefined if no widget was rendered.
 */
function getCallbacks(fake: FakeTurnstile) {
  const keys = Array.from(fake.callbacks.keys());
  const lastKey = keys[keys.length - 1];
  return lastKey ? fake.callbacks.get(lastKey) : undefined;
}

function widgetCount(fake: FakeTurnstile) {
  return fake.callbacks.size;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('SiteFooter newsletter state machine', () => {
  let fake: FakeTurnstile;

  beforeEach(() => {
    fake = new FakeTurnstile();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  /* ---------------------------------------------------------------- */
  /*  IDLE → REVEALING                                                 */
  /* ---------------------------------------------------------------- */
  describe('IDLE → REVEALING', () => {
    it('transitions when user clicks Subscribe with non-empty email', async () => {
      renderFooter(fake);

      await fillAndSubmit('user@example.com');

      // Turnstile container appears in DOM
      const container = document.querySelector('.site-footer__turnstile');
      expect(container).toBeTruthy();

      // Button shows waiting state
      const button = document.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(button.textContent).toBe('Verifying…');
      expect(button.disabled).toBe(true);

      // A widget was rendered (callbacks stored)
      expect(widgetCount(fake)).toBe(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  REVEALING → SUBMITTING                                           */
  /* ---------------------------------------------------------------- */
  describe('REVEALING → SUBMITTING', () => {
    it('calls fetch with email and token when onToken fires', async () => {
      renderFooter(fake);
      await fillAndSubmit('user@example.com');

      const cb = getCallbacks(fake);
      expect(cb).toBeDefined();

      // Stub fetch so apiPost resolves
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: 'Check your email to confirm.' }),
      } as Response);

      cb!.onToken?.('test-token');

      // Wait for fetch + Svelte reactivity
      await vi.waitFor(() => {
        expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
      });

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body).toEqual({
        email: 'user@example.com',
        turnstileToken: 'test-token',
      });
    });
  });

  /* ---------------------------------------------------------------- */
  /*  REVEALING → IDLE  (inactivity timer)                            */
  /* ---------------------------------------------------------------- */
  describe('REVEALING → IDLE (inactivity timer)', () => {
    it('returns to IDLE after 60s without any callback', async () => {
      renderFooter(fake);
      await fillAndSubmit('user@example.com');

      // Container and verifying button are visible
      expect(document.querySelector('.site-footer__turnstile')).toBeTruthy();
      expect(
        (document.querySelector('button[type="submit"]') as HTMLButtonElement)
          .textContent,
      ).toBe('Verifying…');

      // Advance past the inactivity timeout
      await vi.advanceTimersByTimeAsync(60_000);

      // Back to IDLE: container gone, button shows Subscribe
      expect(document.querySelector('.site-footer__turnstile')).toBeFalsy();
      expect(
        (document.querySelector('button[type="submit"]') as HTMLButtonElement)
          .textContent,
      ).toBe('Subscribe');

      // No error message
      expect(document.querySelector('.site-footer__subscribe-msg')).toBeFalsy();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  REVEALING → ERROR_TURNSTILE                                     */
  /* ---------------------------------------------------------------- */
  describe('REVEALING → ERROR_TURNSTILE', () => {
    it('shows error message when onError fires', async () => {
      renderFooter(fake);
      await fillAndSubmit('user@example.com');

      const cb = getCallbacks(fake);
      cb!.onError?.();

      await vi.waitFor(() => {
        expect(document.querySelector('.site-footer__subscribe-msg.error')).toBeTruthy();
      });

      const msg = document.querySelector('.site-footer__subscribe-msg')!;
      expect(msg.textContent).toBe('Verification failed.');

      // Retry button present
      const retry = document.querySelector('.site-footer__error-state button');
      expect(retry).toBeTruthy();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  REVEALING → ERROR_TIMEOUT                                       */
  /* ---------------------------------------------------------------- */
  describe('REVEALING → ERROR_TIMEOUT', () => {
    it('shows timeout message when onTimeout fires', async () => {
      renderFooter(fake);
      await fillAndSubmit('user@example.com');

      const cb = getCallbacks(fake);
      cb!.onTimeout?.();

      await vi.waitFor(() => {
        const msg = document.querySelector('.site-footer__subscribe-msg.error');
        expect(msg?.textContent).toBe('Verification timed out.');
      });

      // Retry button
      expect(document.querySelector('.site-footer__error-state button')).toBeTruthy();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  REVEALING → ERROR_LOAD (script never loads, 10s timeout)        */
  /* ---------------------------------------------------------------- */
  describe('REVEALING → ERROR_LOAD (script never loads)', () => {
    it('shows load error after 10s when turnstile.render returns null', async () => {
      const nullTurnstile = new NullTurnstile();
      renderFooter(nullTurnstile);
      await fillAndSubmit('user@example.com');

      // Advance to just before the script load timeout
      await vi.advanceTimersByTimeAsync(9_000);

      // Still revealing (no error yet)
      const buttonBefore = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      expect(buttonBefore.textContent).toBe('Verifying…');

      // Advance past the 10s timeout
      await vi.advanceTimersByTimeAsync(1_100);

      await vi.waitFor(() => {
        const msg = document.querySelector('.site-footer__subscribe-msg.error');
        expect(msg?.textContent).toBe("Verification couldn't load.");
      });
    });
  });

  /* ---------------------------------------------------------------- */
  /*  SUBMITTING → SUCCESS (201)                                      */
  /* ---------------------------------------------------------------- */
  describe('SUBMITTING → SUCCESS', () => {
    it('shows success message on 201 response', async () => {
      renderFooter(fake);
      await fillAndSubmit('new@example.com');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: 'Check your email to confirm.' }),
      } as Response);

      const cb = getCallbacks(fake);
      cb!.onToken?.('token');

      await vi.waitFor(() => {
        const msg = document.querySelector('.site-footer__subscribe-msg.success');
        expect(msg?.textContent).toBe('Check your email to confirm.');
      });

      // Email input should be gone (success block shows instead of form)
      expect(document.querySelector('#subscribe-email')).toBeFalsy();

      // "Subscribe another" button appears
      const resetBtn = document.querySelector('.site-footer__success button');
      expect(resetBtn?.textContent).toBe('Subscribe another');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  SUBMITTING → SUCCESS (200 — existing subscriber)                */
  /* ---------------------------------------------------------------- */
  describe('SUBMITTING → SUCCESS (existing subscriber)', () => {
    it('shows "Already subscribed!" on 200 response', async () => {
      renderFooter(fake);
      await fillAndSubmit('existing@example.com');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: 'Already subscribed!' }),
      } as Response);

      const cb = getCallbacks(fake);
      cb!.onToken?.('token');

      await vi.waitFor(() => {
        const msg = document.querySelector('.site-footer__subscribe-msg.success');
        expect(msg?.textContent).toBe('Already subscribed!');
      });
    });
  });

  /* ---------------------------------------------------------------- */
  /*  SUBMITTING → ERROR_VERIFICATION                                 */
  /* ---------------------------------------------------------------- */
  describe('SUBMITTING → ERROR_VERIFICATION', () => {
    it('shows verification error and resets widget', async () => {
      renderFooter(fake);
      await fillAndSubmit('user@example.com');

      const widgetIdBefore = Array.from(fake.callbacks.keys())[0];

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Verification failed. Try again.' }),
      } as Response);

      const cb = getCallbacks(fake);
      cb!.onToken?.('token');

      await vi.waitFor(() => {
        const msg = document.querySelector('.site-footer__subscribe-msg.error');
        expect(msg?.textContent).toBe('Verification failed. Try again.');
      });

      // Widget should still exist (reset was called, not remove)
      expect(fake.callbacks.has(widgetIdBefore)).toBe(true);

      // "Try again" button visible
      const retryBtn = document.querySelector('.site-footer__error-state button');
      expect(retryBtn?.textContent).toBe('Try again');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  SUBMITTING → ERROR_VALIDATION                                   */
  /* ---------------------------------------------------------------- */
  describe('SUBMITTING → ERROR_VALIDATION', () => {
    it('shows validation error message', async () => {
      renderFooter(fake);
      await fillAndSubmit('invalid-email');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Valid email required' }),
      } as Response);

      const cb = getCallbacks(fake);
      cb!.onToken?.('token');

      await vi.waitFor(() => {
        const msg = document.querySelector('.site-footer__subscribe-msg.error');
        expect(msg?.textContent).toBe('Valid email required');
      });

      // Email input remains editable
      const input = document.querySelector('#subscribe-email') as HTMLInputElement;
      expect(input.disabled).toBe(false);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  SUBMITTING → ERROR_SERVER                                       */
  /* ---------------------------------------------------------------- */
  describe('SUBMITTING → ERROR_SERVER', () => {
    it('shows server error and destroys widget', async () => {
      renderFooter(fake);
      await fillAndSubmit('user@example.com');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Internal server error' }),
        status: 500,
      } as Response);

      const cb = getCallbacks(fake);
      cb!.onToken?.('token');

      await vi.waitFor(() => {
        const msg = document.querySelector('.site-footer__subscribe-msg.error');
        expect(msg?.textContent).toBe('Something went wrong. Try again.');
      });

      // Retry button
      const retryBtn = document.querySelector('.site-footer__error-state button');
      expect(retryBtn?.textContent).toBe('Retry');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  SUBMITTING → ERROR_NETWORK                                      */
  /* ---------------------------------------------------------------- */
  describe('SUBMITTING → ERROR_NETWORK', () => {
    it('shows network error and preserves widget', async () => {
      renderFooter(fake);
      await fillAndSubmit('user@example.com');

      const widgetIdBefore = Array.from(fake.callbacks.keys())[0];

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network is down'));

      const cb = getCallbacks(fake);
      cb!.onToken?.('token');

      await vi.waitFor(() => {
        const msg = document.querySelector('.site-footer__subscribe-msg.error');
        expect(msg?.textContent).toBe('Network error. Check your connection.');
      });

      // Widget preserved (not destroyed)
      expect(fake.callbacks.has(widgetIdBefore)).toBe(true);

      // Retry button
      const retryBtn = document.querySelector('.site-footer__error-state button');
      expect(retryBtn?.textContent).toBe('Retry');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Token expiry mid-flow                                           */
  /* ---------------------------------------------------------------- */
  describe('Token expiry', () => {
    it('does not change state on expired-callback, then transitions on callback', async () => {
      renderFooter(fake);
      await fillAndSubmit('user@example.com');

      const cb = getCallbacks(fake);

      // Fire expired — no visible change
      cb!.onExpired?.();

      // Still in revealing state
      const buttonAfter = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      expect(buttonAfter.textContent).toBe('Verifying…');

      // Now the fresh callback fires
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: 'Check your email to confirm.' }),
      } as Response);

      cb!.onToken?.('fresh-token');

      await vi.waitFor(() => {
        const msg = document.querySelector('.site-footer__subscribe-msg.success');
        expect(msg?.textContent).toBe('Check your email to confirm.');
      });
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Timer cancels on callback (onToken fires before timer)          */
  /* ---------------------------------------------------------------- */
  describe('Timer cancels on callback', () => {
    it('does not reset to IDLE when onToken fires before inactivity timer', async () => {
      renderFooter(fake);
      await fillAndSubmit('user@example.com');

      // Fire onToken immediately
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: 'Check your email to confirm.' }),
      } as Response);

      const cb = getCallbacks(fake);
      cb!.onToken?.('token');

      // Wait for success
      await vi.waitFor(() => {
        expect(
          document.querySelector('.site-footer__subscribe-msg.success'),
        ).toBeTruthy();
      });

      // Advance past the inactivity timeout — should not revert to IDLE
      await vi.advanceTimersByTimeAsync(60_000);
      expect(document.querySelector('.site-footer__subscribe-msg.success')).toBeTruthy();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Timer cancels on error callback                                 */
  /* ---------------------------------------------------------------- */
  describe('Timer cancels on error callback', () => {
    it('does not reset to IDLE when onError fires before inactivity timer', async () => {
      renderFooter(fake);
      await fillAndSubmit('user@example.com');

      const cb = getCallbacks(fake);
      cb!.onError?.();

      await vi.waitFor(() => {
        expect(document.querySelector('.site-footer__subscribe-msg.error')).toBeTruthy();
      });

      // Advance past the inactivity timeout — should stay in error state
      await vi.advanceTimersByTimeAsync(60_000);
      expect(document.querySelector('.site-footer__subscribe-msg.error')).toBeTruthy();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Timer cancels on unmount                                        */
  /* ---------------------------------------------------------------- */
  describe('Timer cancels on unmount', () => {
    it('cleans up timers when component unmounts while in REVEALING', async () => {
      const { unmount } = renderFooter(fake);
      await fillAndSubmit('user@example.com');

      // Unmount while in revealing
      unmount();

      // Advance past the inactivity timeout — no crash
      await vi.advanceTimersByTimeAsync(60_000);

      // No assertion needed beyond "no crash" — the timer was cleaned up
      // by the $effect teardown
      expect(true).toBe(true);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Error → Error — retry tests                                     */
  /* ---------------------------------------------------------------- */
  describe('Error state retry buttons', () => {
    it('retries from ERROR_TURNSTILE by destroying and re-rendering widget', async () => {
      renderFooter(fake);
      await fillAndSubmit('user@example.com');

      const cb = getCallbacks(fake);
      cb!.onError?.();

      await vi.waitFor(() => {
        expect(document.querySelector('.site-footer__subscribe-msg.error')).toBeTruthy();
      });

      // Click Retry
      const retryBtn = document.querySelector(
        '.site-footer__error-state button',
      ) as HTMLButtonElement;
      await fireEvent.click(retryBtn);

      // Should be back in REVEALING with a fresh widget
      expect(widgetCount(fake)).toBe(2); // old destroyed, new rendered
      expect(
        (document.querySelector('button[type="submit"]') as HTMLButtonElement)
          .textContent,
      ).toBe('Verifying…');
    });

    it('retries from ERROR_NETWORK by re-sending the same token', async () => {
      renderFooter(fake);
      await fillAndSubmit('user@example.com');

      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Network is down'));

      const cb = getCallbacks(fake);
      cb!.onToken?.('same-token');

      await vi.waitFor(() => {
        expect(document.querySelector('.site-footer__subscribe-msg.error')).toBeTruthy();
      });

      // Second fetch attempt succeeds
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: 'Check your email to confirm.' }),
      } as Response);

      // Click Retry
      const retryBtn = document.querySelector(
        '.site-footer__error-state button',
      ) as HTMLButtonElement;
      await fireEvent.click(retryBtn);

      // Should go to SUBMITTING and call fetch again with same token
      await vi.waitFor(() => {
        const msg = document.querySelector('.site-footer__subscribe-msg.success');
        expect(msg?.textContent).toBe('Check your email to confirm.');
      });

      // Widget count unchanged (no re-render)
      expect(widgetCount(fake)).toBe(1);
    });

    it('retries from ERROR_SERVER by destroying and re-rendering widget', async () => {
      renderFooter(fake);
      await fillAndSubmit('user@example.com');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Server error' }),
        status: 500,
      } as Response);

      const cb = getCallbacks(fake);
      cb!.onToken?.('token');

      await vi.waitFor(() => {
        expect(document.querySelector('.site-footer__subscribe-msg.error')).toBeTruthy();
      });

      // Click Retry
      const retryBtn = document.querySelector(
        '.site-footer__error-state button',
      ) as HTMLButtonElement;
      await fireEvent.click(retryBtn);

      // Fresh widget (old was destroyed)
      expect(widgetCount(fake)).toBe(2);
      expect(
        (document.querySelector('button[type="submit"]') as HTMLButtonElement)
          .textContent,
      ).toBe('Verifying…');
    });

    it('retries from ERROR_LOAD by destroying and re-rendering widget', async () => {
      const nullTurnstile = new NullTurnstile();
      renderFooter(nullTurnstile);
      await fillAndSubmit('user@example.com');

      // Wait for script load timeout
      await vi.advanceTimersByTimeAsync(10_100);

      await vi.waitFor(() => {
        const msg = document.querySelector('.site-footer__subscribe-msg.error');
        expect(msg?.textContent).toBe("Verification couldn't load.");
      });

      // Click Retry
      const retryBtn = document.querySelector(
        '.site-footer__error-state button',
      ) as HTMLButtonElement;
      await fireEvent.click(retryBtn);

      // Back to revealing (render returns null again, timer restarts)
      await vi.waitFor(() => {
        expect(
          (document.querySelector('button[type="submit"]') as HTMLButtonElement)
            .textContent,
        ).toBe('Verifying…');
      });
    });

    it('"Subscribe another" resets from SUCCESS back to IDLE', async () => {
      renderFooter(fake);
      await fillAndSubmit('user@example.com');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: 'Check your email to confirm.' }),
      } as Response);

      const cb = getCallbacks(fake);
      cb!.onToken?.('token');

      await vi.waitFor(() => {
        expect(
          document.querySelector('.site-footer__subscribe-msg.success'),
        ).toBeTruthy();
      });

      // Click "Subscribe another"
      const resetBtn = document.querySelector(
        '.site-footer__success button',
      ) as HTMLButtonElement;
      await fireEvent.click(resetBtn);

      // Back to IDLE: form visible, no turnstile, button says Subscribe
      expect(document.querySelector('.site-footer__turnstile')).toBeFalsy();
      expect(document.querySelector('#subscribe-email')).toBeTruthy();
      expect(
        (document.querySelector('button[type="submit"]') as HTMLButtonElement)
          .textContent,
      ).toBe('Subscribe');
    });
  });
});
