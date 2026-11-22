import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import Poll from '../../src/pages/Poll.svelte';
import { POLL_SERVICES } from '../../src/lib/polls/context';
import { createTurnstileContext } from '../../src/lib/context';
import { FakeTurnstile } from '../../src/lib/turnstile';
import { FakePollService, FakePollRuntime } from '../helpers/poll-ui';
import { PollError, type Ballot } from '../../src/lib/polls/types';
import { tick } from 'svelte';

afterEach(cleanup);
async function staleDraft(existing: Ballot | null = null) {
  const api = new FakePollService();
  api.authenticated = true;
  const originalContext = api.poll.sessionContext;
  const bot = new FakeTurnstile();
  const context = new Map<symbol, unknown>(createTurnstileContext(bot));
  context.set(POLL_SERVICES, { api, runtime: new FakePollRuntime() });
  render(Poll, { props: { slug: 'topics' }, context });
  await fireEvent.click(await screen.findByRole('radio', { name: 'Robotics' }));
  api.switchVoter('other@example.com', existing);
  await fireEvent.click(screen.getByRole('button', { name: 'Submit vote' }));
  const dialog = within(await screen.findByRole('dialog'));
  return { api, originalContext, dialog, bot };
}

it('warns before replacing B’s editable ballot and submits the draft at B’s revision only on Yes', async () => {
  const existing = {
    revision: 1,
    optionIds: [2],
    submittedAt: 'before',
    updatedAt: 'before',
  };
  const { api, originalContext, dialog } = await staleDraft(existing);
  expect(dialog.getByText(/submit as other@example\.com\?/)).toBeTruthy();
  expect(dialog.getByText(/replace this voter’s existing vote/)).toBeTruthy();
  // Only the rejected A request; no request authorized for B, no changed ballot.
  expect(api.submissions).toMatchObject([
    { sessionContext: originalContext, expectedRevision: 0, optionIds: [1] },
  ]);
  expect(api.poll.ballot).toEqual({
    revision: 1,
    optionIds: [2],
    submittedAt: 'before',
    updatedAt: 'before',
  });
  await fireEvent.click(dialog.getByRole('button', { name: 'Yes' }));
  await screen.findByRole('button', { name: 'Edit vote' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.submissions).toHaveLength(2);
  expect(api.submissions[1]).toMatchObject({
    sessionContext: api.poll.sessionContext,
    expectedRevision: 1,
    optionIds: [1],
  });
  expect(api.submissions[1]!.requestId).not.toBe(api.submissions[0]!.requestId);
  expect(api.poll.ballot).toMatchObject({ revision: 2, optionIds: [1] });
  expect(document.querySelector('.poll-ballot li')?.textContent).toBe('Robotics');
});

it('shows replacement email denial and submits the preserved draft only after a fresh proof', async () => {
  const { api, dialog, bot } = await staleDraft();
  await fireEvent.click(dialog.getByRole('button', { name: 'No' }));
  const input = dialog.getByLabelText('What email should this vote use?');
  const submit = dialog.getByRole('button', {
    name: 'Submit as this email',
  }) as HTMLButtonElement;
  const widget = [...bot.actions.keys()][0]!;
  api.failIdentify = new PollError(403, 'ineligible', 'Not eligible');
  await fireEvent.input(input, { target: { value: 'missing@example.com' } });
  bot.solve(widget, 'first-proof');
  await tick();
  await fireEvent.click(submit);
  expect((await dialog.findByRole('alert')).textContent).toBe('Not eligible');
  expect(api.submissions).toHaveLength(1); // Only the rejected stale draft.
  expect(api.poll.ballot).toBeNull();
  expect(bot.getResponse(widget)).toBe('');
  await fireEvent.input(input, { target: { value: 'fresh@example.com' } });
  expect(submit.disabled).toBe(true);
  api.failIdentify = null;
  api.identifiedEmail = 'fresh@example.com';
  bot.solve(widget, 'fresh-proof');
  await tick();
  expect(submit.disabled).toBe(false);
  await fireEvent.click(submit);
  await screen.findByText('Your vote is saved.');
  expect(api.identifyCalls).toEqual([
    { identifier: { kind: 'email', value: 'missing@example.com' }, token: 'first-proof' },
    { identifier: { kind: 'email', value: 'fresh@example.com' }, token: 'fresh-proof' },
  ]);
  expect(api.submissions).toHaveLength(2);
  expect(api.submissions[1]).toMatchObject({
    sessionContext: api.poll.sessionContext,
    optionIds: [1],
    expectedRevision: 0,
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('opens replacement email entry on No; Cancel keeps the draft and makes no new submission', async () => {
  const { api, dialog } = await staleDraft();
  await fireEvent.click(dialog.getByRole('button', { name: 'No' }));
  expect(dialog.getByLabelText('What email should this vote use?')).toBeTruthy();
  await fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(
    (screen.getByRole('radio', { name: 'Robotics' }) as HTMLInputElement).checked,
  ).toBe(true);
  expect(screen.getByRole('button', { name: 'Submit vote' })).toBeTruthy();
  expect(api.submissions).toHaveLength(1);
  expect(api.poll.ballot).toBeNull();
});
