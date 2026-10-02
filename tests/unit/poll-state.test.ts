import { expect, it } from 'vitest';
import { PollPage } from '../../src/lib/polls/page.svelte';
import { BallotForm } from '../../src/lib/polls/ballot.svelte';
import {
  selectedCount,
  selectionRule,
  descriptionHtml,
} from '../../src/lib/polls/display';
import { PollError } from '../../src/lib/polls/types';
import { FakePollService, FakePollRuntime, uiPoll } from '../helpers/poll-ui';
import { deferred } from '../helpers/background';

it('ignores an old detail response after logging out', async () => {
  const gate = deferred<ReturnType<typeof uiPoll>>();
  class DelayedService extends FakePollService {
    override detail() {
      return gate.promise;
    }
  }
  const page = new PollPage('topics', new DelayedService());
  const loading = page.load();
  await Promise.resolve();
  await page.logout();
  gate.resolve(uiPoll());
  await loading;
  expect(page.phase).toBe('email');
  expect(page.detail).toBeNull();
  expect(page.results).toBeNull();
});
it('ignores old results after the page is disposed', async () => {
  const gate = deferred<Awaited<ReturnType<FakePollService['results']>>>();
  class DelayedResults extends FakePollService {
    override results() {
      return gate.promise;
    }
  }
  const api = new DelayedResults();
  api.authenticated = true;
  api.poll.resultsVisibility = 'before_vote';
  const page = new PollPage('topics', api);
  const loading = page.load();
  await Promise.resolve();
  await Promise.resolve();
  page.dispose();
  gate.resolve({ eligibleCount: 1, ballotCount: 0, options: [] });
  await loading;
  expect(page.results).toBeNull();
});
it('keeps an uncertain retry possible after the deadline', async () => {
  const api = new FakePollService();
  api.authenticated = true;
  const page = new PollPage('topics', api);
  await page.load();
  const runtime = new FakePollRuntime();
  const form = new BallotForm(page, runtime);
  form.select(1, true);
  api.failSubmit = new PollError(0, 'network', 'Lost response');
  await form.submit();
  runtime.advance(3 * 86400000);
  await form.submit();
  expect(api.submissions).toHaveLength(2);
  expect(api.submissions[0]).toEqual(api.submissions[1]);
});
it('does not create a fresh vote if reloading after conflict fails', async () => {
  const api = new FakePollService();
  api.authenticated = true;
  const page = new PollPage('topics', api);
  await page.load();
  const form = new BallotForm(page, new FakePollRuntime());
  form.select(1, true);
  api.failSubmit = new PollError(409, 'ballot_conflict', 'Changed');
  api.failDetail = new PollError(0, 'network', 'Offline');
  await form.submit();
  expect(form.pending).not.toBeNull();
  expect(form.message).toContain('Could not reload');
});
it('counts equivalent selected write-ins once and describes unlimited selections', () => {
  const poll = uiPoll({ maxSelections: null });
  expect(selectedCount(poll, [1], ' ROBOTICS ')).toBe(1);
  expect(selectedCount(poll, [1], 'New topic')).toBe(2);
  expect(selectionRule(poll)).toBe('Choose at least 1; there is no maximum.');
});
it('strips active content, tracking images and unsafe links from Markdown', () => {
  const safe = descriptionHtml(
    '<iframe src="https://evil.test"></iframe><img src="https://evil.test/track">\n\n[bad](javascript:alert(1)) [safe](https://ainooga.org)',
  );
  expect(safe).not.toMatch(/<iframe|<img|href="javascript:/);
  expect(safe).toContain('href="https://ainooga.org"');
});
