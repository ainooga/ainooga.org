import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import Poll from '../../src/pages/Poll.svelte';
import { createTurnstileContext } from '../../src/lib/context';
import { FakeTurnstile } from '../../src/lib/turnstile';
import { POLL_SERVICES } from '../../src/lib/polls/context';
import { PollError } from '../../src/lib/polls/types';
import { FakePollRuntime, FakePollService } from '../helpers/poll-ui';

afterEach(cleanup);
function setup(authenticated = false, bot = new FakeTurnstile()) {
  const api = new FakePollService();
  api.authenticated = authenticated;
  const runtime = new FakePollRuntime();
  const context = new Map<symbol, unknown>(createTurnstileContext(bot));
  context.set(POLL_SERVICES, { api, runtime });
  return {
    api,
    runtime,
    bot,
    mount: () => render(Poll, { props: { slug: 'topics' }, context }),
  };
}
async function enter(bot: FakeTurnstile, label: string, value: string) {
  const input = await screen.findByLabelText(label);
  await fireEvent.input(input, { target: { value } });
  [...bot.callbacks.values()].at(-1)!.onToken!('fresh-proof');
  await tick();
  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}
describe('guest-list entry', () => {
  it('shows no poll content before entry and accepts an email', async () => {
    const f = setup();
    f.mount();
    await screen.findByLabelText('Email');
    expect(screen.queryByText('Choose a topic')).toBeNull();
    expect([...f.bot.actions.values()]).toEqual(['poll-auth']);
    await enter(f.bot, 'Email', 'voter@example.com');
    await screen.findByRole('heading', { name: 'Choose a topic' });
    expect(f.api.resultsCalls).toBe(0);
  });
  it('falls back to a username then shows the contact address on a miss', async () => {
    const f = setup();
    f.mount();
    await enter(f.bot, 'Email', 'unknown@example.com');
    await screen.findByText(
      "Didn't see you on the guest list. Try your Discord username?",
    );
    await enter(f.bot, 'Discord username', 'missing');
    await screen.findByRole('heading', { name: "Sorry, we couldn't find you" });
    expect(
      screen.getByRole('link', { name: 'contact@ainooga.org' }).getAttribute('href'),
    ).toBe('mailto:contact@ainooga.org');
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByLabelText('Email');
  });
  it('accepts the Discord fallback', async () => {
    const f = setup();
    f.mount();
    await enter(f.bot, 'Email', 'unknown@example.com');
    await enter(f.bot, 'Discord username', 'chapter.user');
    expect(await screen.findByRole('heading', { name: 'Choose a topic' })).toBeTruthy();
  });
  it('keeps network failures on the email form and requires a fresh bot token', async () => {
    const f = setup();
    f.api.failIdentify = new PollError(0, 'network', 'Connection lost');
    f.mount();
    await enter(f.bot, 'Email', 'voter@example.com');
    await screen.findByText('Connection lost');
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    f.api.failIdentify = null;
    await enter(f.bot, 'Email', 'voter@example.com');
    await screen.findByRole('heading', { name: 'Choose a topic' });
  });
  it('does not downgrade a verified poll', async () => {
    const f = setup();
    f.api.poll.identityMode = 'verified';
    f.mount();
    await screen.findByRole('heading', { name: 'This poll requires verified sign-in' });
    expect(screen.queryByLabelText('Email')).toBeNull();
  });
});
describe('ballots', () => {
  it('submits a write-in, displays it, and edits the saved vote', async () => {
    const f = setup(true);
    f.mount();
    await fireEvent.input(await screen.findByLabelText('Topic'), {
      target: { value: 'AI gardens' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Submit vote' }));
    await screen.findByText('Your vote is saved.');
    expect(screen.getAllByText('AI gardens').length).toBeGreaterThan(0);
    await fireEvent.click(await screen.findByRole('button', { name: 'Edit vote' }));
    await fireEvent.click(screen.getByRole('radio', { name: 'Robotics' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(f.api.submissions).toHaveLength(2));
    expect(f.api.submissions[1]!.expectedRevision).toBe(1);
  });
  it('retries an uncertain submission with the exact same request', async () => {
    const f = setup(true);
    f.api.failSubmit = new PollError(0, 'network', 'Lost response');
    f.mount();
    await fireEvent.click(await screen.findByRole('radio', { name: 'Robotics' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Submit vote' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Retry same vote' }));
    await screen.findByText('Your vote is saved.');
    expect(f.api.submissions[0]).toEqual(f.api.submissions[1]);
  });
  it('reloads a conflict without automatically sending another vote', async () => {
    const f = setup(true);
    f.api.failSubmit = new PollError(409, 'ballot_conflict', 'Ballot changed.');
    f.mount();
    await fireEvent.click(await screen.findByRole('radio', { name: 'Robotics' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Submit vote' }));
    await screen.findByText(/Review it before submitting again/);
    expect(f.api.submissions).toHaveLength(1);
    expect(
      (screen.getByRole('radio', { name: 'Robotics' }) as HTMLInputElement).checked,
    ).toBe(false);
  });
  it('enforces exact selections and respects hidden results', async () => {
    const f = setup(true);
    Object.assign(f.api.poll, {
      minSelections: 2,
      maxSelections: 2,
      resultsVisibility: 'never',
    });
    f.mount();
    await fireEvent.click(await screen.findByRole('checkbox', { name: 'Robotics' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Submit vote' }));
    await screen.findByText('Please follow the selection limits above.');
    expect(f.api.submissions).toHaveLength(0);
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Language models' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Submit vote' }));
    await screen.findByText('Your vote is saved.');
    expect(f.api.resultsCalls).toBe(0);
  });
  it('updates the closed state at the deadline', async () => {
    const f = setup(true);
    f.api.poll.endsAt = new Date(f.runtime.time + 1000).toISOString();
    f.mount();
    await screen.findByRole('button', { name: 'Submit vote' });
    f.runtime.advance(1000);
    await tick();
    expect(screen.queryByRole('button', { name: 'Submit vote' })).toBeNull();
    expect(screen.getByText('Voting is closed.')).toBeTruthy();
  });
  it('clears private content on expired access and logout', async () => {
    const f = setup(true);
    f.mount();
    await screen.findByRole('heading', { name: 'Choose a topic' });
    f.api.authenticated = false;
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh poll' }));
    await screen.findByLabelText('Email');
    expect(screen.queryByText('Choose a topic')).toBeNull();
    await enter(f.bot, 'Email', 'voter@example.com');
    await fireEvent.click(
      await screen.findByRole('button', { name: 'Use another email' }),
    );
    await screen.findByLabelText('Email');
    expect(f.api.authenticated).toBe(false);
  });
  it('sanitizes descriptions and renders options as literal text', async () => {
    const f = setup(true);
    f.api.poll.description =
      '<img src=x onerror="alert(1)"><script>alert(1)</script>**Safe** [bad](javascript:alert(1))';
    f.api.poll.options[0]!.label = '<img src=x onerror=alert(1)>';
    f.mount();
    await screen.findByText('Safe');
    expect(
      document.querySelector(
        '.poll-description img, .poll-description script, .poll-description a[href^="javascript:"]',
      ),
    ).toBeNull();
    expect(
      screen.getByRole('radio', { name: '<img src=x onerror=alert(1)>' }),
    ).toBeTruthy();
  });
});

it('shows upcoming polls and before-vote results without enabling a ballot', async () => {
  const f = setup(true);
  f.api.poll.startsAt = new Date(f.runtime.time + 1000).toISOString();
  f.api.poll.resultsVisibility = 'before_vote';
  f.mount();
  await screen.findByText(/Voting opens/);
  await screen.findByText('0 accepted ballots. 2 people are currently eligible.');
  expect(screen.queryByRole('button', { name: 'Submit vote' })).toBeNull();
  f.runtime.advance(1000);
  await tick();
  expect(screen.getByRole('button', { name: 'Submit vote' })).toBeTruthy();
});
it('stops editing at the cutoff while preserving the saved ballot', async () => {
  const f = setup(true);
  f.api.poll.editDeadline = new Date(f.runtime.time + 1000).toISOString();
  f.api.poll.ballot = {
    revision: 1,
    optionIds: [1],
    submittedAt: '2026-10-02T11:00:00Z',
    updatedAt: '2026-10-02T11:00:00Z',
  };
  f.mount();
  await fireEvent.click(await screen.findByRole('button', { name: 'Edit vote' }));
  f.runtime.advance(1000);
  await tick();
  expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  expect(screen.getByText('Ballot edits are closed for this poll.')).toBeTruthy();
});
it.each([429, 503, 404])(
  'handles HTTP %s without presenting a guest-list miss',
  async (status) => {
    const f = setup();
    f.api.failDetail = new PollError(status, 'unavailable', 'Unavailable');
    f.mount();
    await screen.findByRole('heading', {
      name: status === 404 ? 'Poll not found' : 'Could not open the poll',
    });
    expect(
      screen.queryByText("Didn't see you on the guest list. Try your Discord username?"),
    ).toBeNull();
  },
);
it('disables continuation when the bot token expires', async () => {
  const f = setup();
  f.mount();
  await screen.findByLabelText('Email');
  const callbacks = [...f.bot.callbacks.values()].at(-1)!;
  callbacks.onToken!('proof');
  await tick();
  expect(
    (screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  callbacks.onExpired!();
  await tick();
  expect(
    (screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it('replaces a single-choice selection when typing a write-in', async () => {
  const f = setup(true);
  f.mount();
  await fireEvent.click(await screen.findByRole('radio', { name: 'Robotics' }));
  await fireEvent.input(screen.getByLabelText('Topic'), {
    target: { value: 'X' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Submit vote' }));
  await screen.findByText('Your vote is saved.');
  expect(f.api.submissions[0]!.optionIds).toEqual([]);
});

it('recovers when the Turnstile script throws during widget creation', async () => {
  class UnavailableWidget extends FakeTurnstile {
    ready = false;
    override render(...args: Parameters<FakeTurnstile['render']>): string {
      if (!this.ready) throw new Error('Widget unavailable');
      return super.render(...args);
    }
  }
  const bot = new UnavailableWidget();
  const f = setup(false, bot);
  f.mount();
  await screen.findByText('Verification could not load. Please retry.');
  bot.ready = true;
  await fireEvent.click(screen.getByRole('button', { name: 'Retry verification' }));
  await enter(bot, 'Email', 'voter@example.com');
  expect(await screen.findByRole('heading', { name: 'Choose a topic' })).toBeTruthy();
});

it('renders option descriptions as plain text', async () => {
  const f = setup(true);
  const text = '<img src=x onerror=alert(1)> **plain text**';
  f.api.poll.options[0]!.description = text;
  f.mount();
  expect(await screen.findByText(text)).toBeTruthy();
  expect(document.querySelector('img[src="x"]')).toBeNull();
});
