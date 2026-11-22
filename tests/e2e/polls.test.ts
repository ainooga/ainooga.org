import {
  test,
  expect,
  type Page,
  type BrowserContext,
  type Locator,
} from '@playwright/test';

import { withPollServer } from '../helpers/poll-browser-server';

const poll = '/api/polls/topics';
const path = '/polls/topics';
const ballot = `${poll}/ballot`;
const a = 'a@example.com';
const b = 'b@example.com';
const challenge = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const widget = `window.turnstile = {
  render(_, options) { queueMicrotask(() => options.callback('local-proof')); return 'local'; },
  getResponse() { return 'local-proof'; }, remove() {}, reset() {}
};`;

test.use({
  baseURL: async ({}, use) => {
    await withPollServer(use);
  },
});

async function observeBallots(context: BrowserContext, origin: string) {
  const bodies: Buffer[] = [];
  let acceptedStatus: number | undefined;
  await context.routeWebSocket('**/*', (socket) => socket.close());
  await context.route('**/*', async (route) => {
    const req = route.request();
    if (req.url() === challenge)
      return route.fulfill({ contentType: 'application/javascript', body: widget });
    if (new URL(req.url()).origin !== origin) return route.abort('blockedbyclient');
    if (req.method() === 'PUT') {
      expect(new URL(req.url()).pathname).toBe(ballot);
      bodies.push(req.postDataBuffer()!);
      if (bodies.length === 1) {
        const accepted = await route.fetch({ maxRedirects: 0 });
        acceptedStatus = accepted.status();
        await accepted.dispose();
        return route.abort('connectionreset');
      }
    }
    // Let Chromium send the actual shared cookie (including fetch credentials policy).
    return route.continue();
  });
  return { bodies, accepted: () => acceptedStatus };
}

async function identify(page: Page, email: string) {
  const field = page.getByLabel('Email', { exact: true });
  await field.pressSequentially(email);
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(next).toBeEnabled();
  await field.press('Tab');
  await expect(next).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Next talk' })).toBeVisible();
  const detail = await get(page, poll);
  expect(detail.voter).toEqual({ kind: 'email', value: email });
  expect(detail.sessionContext).toMatch(/^[a-f0-9]{64}$/);
  return detail.sessionContext as string;
}
async function get(page: Page, url: string) {
  const response = await page.request.get(url, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  return response.json();
}
async function put(page: Page, button: Locator, status: number) {
  await expect(button).toBeEnabled();
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === ballot && r.request().method() === 'PUT',
    ),
    button.press('Enter'),
  ]);
  expect(response.status()).toBe(status);
  if (status === 409)
    expect(await response.json()).toMatchObject({ code: 'session_changed' });
}
function submission(body: Buffer, sessionContext: string) {
  const parsed = JSON.parse(body.toString());
  expect(parsed).toEqual({
    sessionContext,
    expectedRevision: 0,
    optionIds: [1],
    writeIn: null,
    requestId: expect.any(String),
  });
  return parsed.requestId as string;
}

test('a lost accepted vote requires deliberate confirmation before writing as another voter', async ({
  page,
  context,
  baseURL,
}) => {
  const { bodies, accepted } = await observeBallots(context, baseURL!);
  await page.goto(path);
  const original = await identify(page, a);
  const robotics = page.getByRole('radio', { name: 'Robotics', exact: true });
  const submit = page.getByRole('button', { name: 'Submit vote', exact: true });
  const retry = page.getByRole('button', { name: 'Retry same vote', exact: true });
  await robotics.check();
  await expect(submit).toBeEnabled();
  await submit.press('Enter');
  await expect(retry).toBeVisible();
  expect(accepted()).toBe(200);
  const first = submission(bodies[0]!, original);
  expect(await get(page, ballot)).toMatchObject({ revision: 1, optionIds: [1] });

  const other = await context.newPage();
  await other.goto(path);
  await expect(
    other.getByText('1 accepted ballots. 2 people are currently eligible.', {
      exact: true,
    }),
  ).toBeVisible();
  await other.getByRole('button', { name: 'Use another email' }).click();
  const current = await identify(other, b);
  expect(current).not.toBe(original);
  await put(page, retry, 409);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(await get(other, ballot)).toBeNull();
  const dialog = page.getByRole('dialog');
  const modal = page.locator('dialog:modal');
  await expect(modal).toContainText(`Do you want to submit as ${b}?`);
  await page.locator('header a[href="/"]').focus();
  expect(await modal.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(submit).toBeEnabled();
  await expect(submit).toBeFocused();
  await expect(retry).toHaveCount(0);
  await expect(robotics).toBeChecked();
  expect(await get(other, ballot)).toBeNull();
  await put(page, submit, 409);
  const third = submission(bodies[2]!, original);
  expect(third).not.toBe(first);
  await expect(modal).toContainText(`Do you want to submit as ${b}?`);
  expect(await get(other, ballot)).toBeNull();

  await put(page, dialog.getByRole('button', { name: 'Yes', exact: true }), 200);
  const fourth = submission(bodies[3]!, current);
  expect(new Set([first, third, fourth]).size).toBe(3);
  await other.reload();
  await expect(
    other.getByRole('region', { name: 'Your ballot' }).getByRole('listitem'),
  ).toHaveText('Robotics');
  await expect(
    other.getByText('2 accepted ballots. 2 people are currently eligible.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(await get(other, ballot)).toMatchObject({ revision: 1, optionIds: [1] });
  expect(bodies).toHaveLength(4);
});
