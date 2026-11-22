import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import SiteFooter from '../../src/components/SiteFooter.svelte';
import { createTurnstileContext } from '../../src/lib/context';
import { FakeTurnstile } from '../../src/lib/turnstile';
import worker from '../../worker/src/index';
import { createDb } from '../../worker/src/adapters';
import type { DbClient, Env } from '../../worker/src/types';
import { BackgroundTasks } from '../helpers/background';
import { NewsletterClaims } from '../helpers/newsletter-claims';

// Leave routing, body validation, verification and email serialization in production code.
vi.mock('../../worker/src/adapters', { spy: true });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const address = 'User@Example.com';
const origin = 'https://ainooga.org';
function bridge(loss: 'before send' | 'after acceptance') {
  const claims = new NewsletterClaims();
  const unused = (): never => {
    throw new Error('Unexpected DB operation in subscribe');
  };
  const db: DbClient = {
    insertSubscriber: claims.insertSubscriber.bind(claims),
    invalidateConfirmation: claims.invalidateConfirmation.bind(claims),
    findSubscriberByEmail: unused,
    confirmSubscription: unused,
    insertContactRequest: unused,
  };
  vi.mocked(createDb).mockReturnValue(db);
  const send = vi.fn(async () => ({ messageId: 'sent' }));
  const env: Env = {
    DB: new Proxy({} as D1Database, { get: unused }),
    SITE_URL: origin,
    CHAPTER_SCHEMA_READY: 'true',
    TURNSTILE_SECRET_KEY: 'local',
    EMAIL: { send },
  };
  const requests: { path: string; method: string; json: unknown }[] = [];
  const statuses: number[] = [];
  const proofs = new Set<string>();
  const checked: string[] = [];
  const transport: typeof fetch = async (url, init) => {
    if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      const token = (init!.body as URLSearchParams).get('response')!;
      checked.push(token);
      return Response.json({
        success: proofs.delete(token),
        action: 'turnstile-spin-v1',
        hostname: 'ainooga.org',
      });
    }
    const request = new Request(new URL(String(url), origin), init);
    requests.push({
      path: new URL(request.url).pathname,
      method: request.method,
      json: await request.clone().json(),
    });
    if (requests.length === 1 && loss === 'before send') throw new Error('offline');
    const response = await worker.fetch(request, env, new BackgroundTasks());
    statuses.push(response.status);
    if (requests.length === 1 && loss === 'after acceptance')
      throw new Error('response lost');
    return response;
  };
  vi.stubGlobal('fetch', transport);
  return { claims, send, proofs, checked, requests, statuses };
}

const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
async function setup(loss: Parameters<typeof bridge>[0]) {
  const api = bridge(loss);
  const widget = new FakeTurnstile();
  render(SiteFooter, { context: createTurnstileContext(widget) });
  await fireEvent.input(screen.getByLabelText('Join the mailing list'), {
    target: { value: address },
  });
  await fireEvent.click(button('Subscribe'));
  const id = [...widget.callbacks.keys()][0]!;
  function solve(token: string) {
    api.proofs.add(token);
    widget.solve(id, token);
  }
  solve('first');
  await screen.findByText('Network error. Check your connection.');
  return { ...api, solve, widget, id };
}
const post = (token: string) => ({
  path: '/api/subscribe',
  method: 'POST',
  json: { email: address, turnstileToken: token },
});

it('loses a committed 201, rejects its spent proof, then accepts a fresh proof as duplicate', async () => {
  const api = await setup('after acceptance');
  expect(api.statuses).toEqual([201]);
  expect(api.claims.pending.size).toBe(1);
  expect(api.send).toHaveBeenCalledTimes(1);
  await fireEvent.click(button('Retry'));
  await screen.findByText('Verification failed. Try again.');
  expect(api.statuses).toEqual([201, 400]);
  expect(api.checked).toEqual(['first', 'first']);
  expect(api.claims.attempts).toEqual(['user@example.com']);
  expect(api.send).toHaveBeenCalledTimes(1);
  expect(api.widget.getResponse(api.id)).toBe('');
  await fireEvent.click(button('Try again'));
  expect(button('Verifying…').disabled).toBe(true);
  api.solve('fresh');
  await screen.findByText('A subscription request already exists for this address.');
  expect(api.requests).toEqual([post('first'), post('first'), post('fresh')]);
  expect(api.checked).toEqual(['first', 'first', 'fresh']);
  expect(api.statuses).toEqual([201, 400, 200]);
  expect([...api.claims.pending.keys()]).toEqual(['user@example.com']);
  expect(api.send).toHaveBeenCalledTimes(1);
  await fireEvent.click(button('Subscribe another'));
  expect(screen.getByLabelText<HTMLInputElement>('Join the mailing list').value).toBe('');
  expect(button('Subscribe').disabled).toBe(false);
});

it('loses the request before send; retry delivers the unspent proof once', async () => {
  const api = await setup('before send');
  expect(api.checked).toEqual([]);
  expect(api.statuses).toEqual([]);
  expect(api.claims.pending.size).toBe(0);
  expect(api.send).not.toHaveBeenCalled();
  await fireEvent.click(button('Retry'));
  await screen.findByText('Check your email to confirm.');
  expect(api.requests).toEqual([post('first'), post('first')]);
  expect(api.checked).toEqual(['first']);
  expect(api.statuses).toEqual([201]);
  expect(api.send).toHaveBeenCalledTimes(1);
});
