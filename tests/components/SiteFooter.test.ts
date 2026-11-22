import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import App from '../../src/App.svelte';
import SiteFooter from '../../src/components/SiteFooter.svelte';
import { createTurnstileContext } from '../../src/lib/context';
import { BrowserTurnstile, FakeTurnstile } from '../../src/lib/turnstile';
import { deferred } from '../helpers/background';
import { NewsletterWidget } from '../helpers/newsletter-widget';

function mount() {
  const bot = new FakeTurnstile();
  render(SiteFooter, { context: createTurnstileContext(bot) });
  return bot;
}
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
async function submit() {
  const input = within(screen.getByRole('contentinfo')).getByLabelText<HTMLInputElement>(
    'Join the mailing list',
  );
  await fireEvent.input(input, { target: { value: 'user@example.com' } });
  await fireEvent.click(button('Subscribe'));
  return input;
}
function widgetId(bot: FakeTurnstile) {
  expect(bot.callbacks.size).toBe(1);
  return [...bot.callbacks.keys()][0]!;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  delete window.turnstile;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('newsletter footer', () => {
  it('submits through the app shell, waits for the script, then holds verification and POST independently', async () => {
    const reply = deferred<Response>();
    const post = vi.fn(() => reply.promise);
    vi.stubGlobal('fetch', post);
    const originalPath = location.href;
    history.replaceState(null, '', '/no-such-route');
    try {
      render(App);
    } finally {
      history.replaceState(null, '', originalPath);
    }
    const input = await submit();
    expect(button('Verifying…').disabled).toBe(true);
    const script = new NewsletterWidget();
    window.turnstile = script;
    await vi.advanceTimersByTimeAsync(100);
    expect(script.widgets.size).toBe(1);
    const [id, widget] = [...script.widgets][0]!;
    expect(input.form!.contains(widget.element as HTMLElement)).toBe(true);
    expect(widget.options.action).toBe('turnstile-spin-v1');
    script.expire(id);
    expect(post).not.toHaveBeenCalled();
    script.solve(id, 'proof');
    script.solve(id, 'duplicate callback');
    await tick();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', turnstileToken: 'proof' }),
    });
    expect(button('Sending…').disabled).toBe(true);
    expect(input.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(button('Sending…').disabled).toBe(true);
    reply.resolve(Response.json({ error: 'Valid email required' }, { status: 400 }));
    await vi.waitFor(() => expect(screen.getByText('Valid email required')).toBeTruthy());
    expect(input.disabled).toBe(false);
    expect(button('Subscribe').disabled).toBe(false);
    await fireEvent.input(input, { target: { value: 'fixed@example.com' } });
    await fireEvent.click(button('Subscribe'));
    expect(script.widgets.has(id)).toBe(false);
    expect(script.widgets.size).toBe(1);
  });

  it.each([
    ['onError', 'Verification failed.'],
    ['onTimeout', 'Verification timed out.'],
  ] as const)(
    'replaces the errored widget after %s; queued callbacks cannot post',
    async (callback, message) => {
      const post = vi.fn();
      vi.stubGlobal('fetch', post);
      const bot = mount();
      await submit();
      const oldId = widgetId(bot);
      const old = bot.callbacks.get(oldId)!;
      old[callback]!();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(screen.getByText(message)).toBeTruthy();
      await fireEvent.click(button('Retry'));
      expect(widgetId(bot)).not.toBe(oldId);
      old.onToken!('queued');
      expect(button('Verifying…').disabled).toBe(true);
      expect(post).not.toHaveBeenCalled();
    },
  );

  it('removes an abandoned challenge after inactivity and on unmount', async () => {
    const bot = mount();
    await submit();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(bot.callbacks.size).toBe(0);
    await fireEvent.click(button('Subscribe'));
    expect(widgetId(bot)).toBeTruthy();
    cleanup();
    expect(bot.callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops waiting for absent script and renders on retry after load', async () => {
    render(SiteFooter, { context: createTurnstileContext(new BrowserTurnstile('key')) });
    await submit();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(screen.getByText("Verification couldn't load.")).toBeTruthy();
    const script = new NewsletterWidget();
    window.turnstile = script;
    await vi.advanceTimersByTimeAsync(100);
    expect(script.widgets.size).toBe(0);
    await fireEvent.click(button('Retry'));
    expect(script.widgets.size).toBe(1);
  });

  it('can retry when a refreshed proof arrives before the user clicks Try again', async () => {
    const bot = mount();
    const post = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: 'Verification failed. Try again.' }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: 'Valid email required' }, { status: 400 }),
      );
    vi.stubGlobal('fetch', post);
    await submit();
    const id = widgetId(bot);
    bot.solve(id, 'spent');
    await vi.waitFor(() => expect(button('Try again')).toBeTruthy());
    bot.solve(id, 'auto-refreshed');
    expect(post).toHaveBeenCalledTimes(1);
    await fireEvent.click(button('Try again'));
    await vi.waitFor(() => expect(screen.getByText('Valid email required')).toBeTruthy());
    expect(post).toHaveBeenCalledTimes(2);
    expect(JSON.parse(post.mock.calls[1]![1].body).turnstileToken).toBe('auto-refreshed');
  });

  it('retries a server error with a fresh widget', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'Server error' }, { status: 500 }),
    );
    const bot = mount();
    await submit();
    const old = widgetId(bot);
    bot.solve(old, 'spent');
    await vi.waitFor(() =>
      expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy(),
    );
    expect(bot.callbacks.size).toBe(0);
    await fireEvent.click(button('Retry'));
    expect(widgetId(bot)).not.toBe(old);
  });
});
