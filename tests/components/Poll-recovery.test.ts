import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import Poll from '../../src/pages/Poll.svelte';
import { POLL_SERVICES } from '../../src/lib/polls/context';
import { createTurnstileContext } from '../../src/lib/context';
import { FakeTurnstile } from '../../src/lib/turnstile';
import { FakePollService, FakePollRuntime } from '../helpers/poll-ui';
import { PollError } from '../../src/lib/polls/types';
afterEach(cleanup);
it('blocks editing an accepted write-in until its labels reload successfully', async () => {
  const api = new FakePollService();
  api.authenticated = true;
  const context = new Map<symbol, unknown>(createTurnstileContext(new FakeTurnstile()));
  context.set(POLL_SERVICES, { api, runtime: new FakePollRuntime() });
  render(Poll, { props: { slug: 'topics' }, context });
  await fireEvent.input(await screen.findByLabelText('Write in an option'), {
    target: { value: 'New choice' },
  });
  api.failDetail = new PollError(0, 'network', 'Offline');
  await fireEvent.click(screen.getByRole('button', { name: 'Submit vote' }));
  await screen.findByText('Your vote is saved, but its choices could not be loaded.');
  expect(screen.queryByRole('button', { name: 'Edit vote' })).toBeNull();
  expect(api.submissions).toHaveLength(1);
  api.failDetail = null;
  await fireEvent.click(screen.getByRole('button', { name: 'Reload saved vote' }));
  await screen.findByRole('button', { name: 'Edit vote' });
  expect(document.querySelector('.poll-ballot li')?.textContent).toBe('New choice');
  expect(api.submissions).toHaveLength(1);
});

it('shows Discord identity as text in the confirmation dialog', async () => {
  const api = new FakePollService();
  api.authenticated = true;
  const context = new Map<symbol, unknown>(createTurnstileContext(new FakeTurnstile()));
  context.set(POLL_SERVICES, { api, runtime: new FakePollRuntime() });
  render(Poll, { props: { slug: 'topics' }, context });
  await fireEvent.click(await screen.findByRole('radio', { name: 'Robotics' }));
  api.poll.sessionContext = 'b'.repeat(64);
  api.poll.voter = { kind: 'discord', value: '<img src=x onerror=alert(1)>' };
  await fireEvent.click(screen.getByRole('button', { name: 'Submit vote' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain(
    'You switched to Discord <img src=x onerror=alert(1)>',
  );
  expect(dialog.querySelector('img')).toBeNull();
});
it('allows editing after a detail reload even when only results fail', async () => {
  class UnavailableResults extends FakePollService {
    override async results(): ReturnType<FakePollService['results']> {
      throw new PollError(503, 'unavailable', 'Unavailable');
    }
  }
  const api = new UnavailableResults();
  api.authenticated = true;
  const context = new Map<symbol, unknown>(createTurnstileContext(new FakeTurnstile()));
  context.set(POLL_SERVICES, { api, runtime: new FakePollRuntime() });
  render(Poll, { props: { slug: 'topics' }, context });
  await fireEvent.input(await screen.findByLabelText('Write in an option'), {
    target: { value: 'Saved choice' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Submit vote' }));
  await screen.findByRole('button', { name: 'Edit vote' });
  expect(document.querySelector('.poll-ballot li')?.textContent).toBe('Saved choice');
  await screen.findByRole('button', { name: 'Retry results' });
});
