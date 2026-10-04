import { expect, it } from 'vitest';
import { PollPage } from '../../src/lib/polls/page.svelte';
import { BallotForm } from '../../src/lib/polls/ballot.svelte';
import { FakePollService, FakePollRuntime } from '../helpers/poll-ui';
import { PollError } from '../../src/lib/polls/types';
import { deferred } from '../helpers/background';
async function setup() {
  const api = new FakePollService();
  api.authenticated = true;
  const page = new PollPage('topics', api);
  await page.load();
  const form = new BallotForm(page, new FakePollRuntime());
  form.writeIn = 'Keep my draft';
  return { api, page, form };
}
it('checks only on submission and confirms the preserved draft under the new session', async () => {
  const { api, form } = await setup();
  api.switchVoter('other@example.com');
  expect(form.identity.open).toBe(false);
  await form.submit();
  expect(api.poll.ballot).toBeNull();
  expect(form.identity.target?.voter.value).toBe('other@example.com');
  const original = api.submissions[0]!;
  await form.identity.confirm();
  expect(api.submissions[1]).toMatchObject({
    sessionContext: api.poll.sessionContext,
    writeIn: original.writeIn,
    expectedRevision: 0,
  });
  expect(api.submissions[1]!.requestId).not.toBe(original.requestId);
  expect(api.poll.ballot?.revision).toBe(1);
  expect(form.identity.open).toBe(false);
});
it('prompts again if the cookie changes while confirmation is open', async () => {
  const { api, form } = await setup();
  api.switchVoter('other@example.com');
  await form.submit();
  api.switchVoter('voter@example.com');
  await form.identity.confirm();
  expect(form.identity.open).toBe(true);
  expect(form.identity.target?.voter.value).toBe('voter@example.com');
  expect(api.poll.ballot).toBeNull();
});
it('keeps the draft on cancellation and failed replacement email entry', async () => {
  const { api, form } = await setup();
  api.switchVoter('other@example.com');
  await form.submit();
  form.identity.dismiss();
  expect(form.writeIn).toBe('Keep my draft');
  expect(form.pending).toBeNull();
  await form.submit();
  form.identity.stage = 'email';
  await form.identity.enterEmail('missing@example.com', 'proof');
  expect(form.identity.stage).toBe('email');
  expect(form.identity.message).toContain('Not eligible');
  expect(api.poll.ballot).toBeNull();
  await form.identity.enterEmail(' VOTER@EXAMPLE.COM ', 'fresh');
  expect(api.poll.voter.value).toBe('voter@example.com');
  expect(api.poll.ballot?.revision).toBe(1);
});
it('keeps a confirmed uncertain write identical on retry', async () => {
  const { api, form } = await setup();
  api.switchVoter('other@example.com');
  await form.submit();
  api.failSubmit = new PollError(0, 'network', 'Offline');
  await form.identity.confirm();
  expect(form.identity.stage).toBe('submitting');
  expect(form.identity.open).toBe(true);
  const attempt = api.submissions.at(-1);
  await form.submit();
  expect(api.submissions.at(-1)).toEqual(attempt);
});
it.each([429, 503])(
  'keeps the draft when replacement email returns %s',
  async (status) => {
    const { api, form } = await setup();
    api.switchVoter('other@example.com');
    await form.submit();
    form.identity.stage = 'email';
    api.failIdentify = new PollError(status, 'unavailable', 'Unavailable');
    await form.identity.enterEmail('voter@example.com', 'proof');
    expect(form.identity.stage).toBe('email');
    expect(form.writeIn).toBe('Keep my draft');
    expect(api.poll.ballot).toBeNull();
    expect(form.identity.message).not.toBe('');
  },
);
it('does not submit when a different identity appears between email entry and detail loading', async () => {
  class SwitchingApi extends FakePollService {
    override async identify(...args: Parameters<FakePollService['identify']>) {
      await super.identify(...args);
      this.switchVoter('other@example.com');
    }
  }
  const api = new SwitchingApi();
  api.authenticated = true;
  const page = new PollPage('topics', api);
  await page.load();
  const form = new BallotForm(page, new FakePollRuntime());
  form.select(1, true);
  api.switchVoter('other@example.com');
  await form.submit();
  await form.identity.enterEmail('voter@example.com', 'proof');
  expect(api.submissions).toHaveLength(1);
  expect(form.identity.stage).toBe('confirm');
  expect(form.identity.target?.voter.value).toBe('other@example.com');
});
it('ignores an identity detail response after the ballot is disposed', async () => {
  const { api, form } = await setup();
  const gate = deferred<Awaited<ReturnType<typeof api.detail>>>();
  api.detail = () => gate.promise;
  const pending = form.identity.load();
  form.dispose();
  gate.resolve(api.poll);
  await pending;
  expect(form.identity.target).toBeNull();
});

it.each([401, 404])(
  'clears private content if identity lookup returns %s',
  async (status) => {
    const { api, page, form } = await setup();
    api.switchVoter('other@example.com');
    api.failDetail = new PollError(status, 'unavailable', 'Unavailable');
    await form.submit();
    expect(page.detail).toBeNull();
    expect(page.results).toBeNull();
    expect(page.phase).toBe(status === 401 ? 'email' : 'missing');
  },
);
it('keeps a rejected draft when the current-identity lookup fails and allows retry', async () => {
  const { api, form } = await setup();
  api.switchVoter('other@example.com');
  api.failDetail = new PollError(0, 'network', 'Offline');
  await form.submit();
  expect(form.identity.message).toBe('Offline');
  expect(form.writeIn).toBe('Keep my draft');
  api.failDetail = null;
  await form.identity.load();
  await form.identity.confirm();
  expect(api.poll.ballot?.revision).toBe(1);
});

it('discards in-flight results from the previous identity after confirmation', async () => {
  const { api, page } = await setup();
  api.poll.resultsVisibility = 'before_vote';
  page.detail = { ...api.poll };
  const gate = deferred<Awaited<ReturnType<FakePollService['results']>>>();
  api.results = () => gate.promise;
  const pending = page.loadResults();
  api.switchVoter('other@example.com');
  page.useVoter({ ...api.poll });
  gate.resolve({ eligibleCount: 2, ballotCount: 1, options: [] });
  await pending;
  expect(page.results).toBeNull();
  expect(page.detail?.voter.value).toBe('other@example.com');
});
