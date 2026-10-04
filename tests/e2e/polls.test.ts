import { test, expect, type Page } from '@playwright/test';

const fakeWidget = `const widgets = new Map(); let next = 0;
window.turnstile = {
  render(element, options) {
    const id = String(++next); widgets.set(id, options);
    setTimeout(() => options.callback('browser-test-proof'), 0); return id;
  },
  reset(id) { setTimeout(() => widgets.get(id)?.callback('browser-test-proof'), 0); },
  remove(id) { widgets.delete(id); },
  getResponse() { return 'browser-test-proof'; }
};`;
test.beforeEach(async ({ context }) => {
  await context.route('https://**/*', async (route) => {
    if (route.request().url().includes('challenges.cloudflare.com/turnstile/'))
      await route.fulfill({ contentType: 'application/javascript', body: fakeWidget });
    else await route.abort();
  });
});
async function enter(page: Page, slug: string, email = 'voter@example.com') {
  await page.goto(`/#/polls/${slug}`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}
test('email entry, write-in, editing, another voter and logout through real D1', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await enter(page, 'browser-vote');
  await page.getByLabel('Write in an option').fill('Browser write-in');
  await page.getByRole('button', { name: 'Submit vote', exact: true }).click();
  await expect(page.getByText('Your vote is saved.', { exact: true })).toBeVisible();
  await expect(page.getByText('1 of 2 eligible voters have voted.')).toBeVisible();
  await page.getByRole('button', { name: 'Edit vote', exact: true }).click();
  await page.getByRole('radio', { name: 'Robotics', exact: true }).check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit vote', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.poll-ballot li')).toHaveText('Robotics');
  await page.getByRole('button', { name: 'Use another email' }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  expect((await page.request.get('/api/polls/browser-vote')).status()).toBe(401);
  await page.getByLabel('Email', { exact: true }).fill('other@example.com');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('radio', { name: 'Browser write-in (write-in)', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('radio', { name: 'Browser write-in (write-in)', exact: true })
    .check();
  await page.getByRole('button', { name: 'Submit vote', exact: true }).click();
  await expect(page.getByText('2 of 2 eligible voters have voted.')).toBeVisible();
  expect(errors).toEqual([]);
});
test('Discord fallback, sorry page and keyboard entry', async ({ page }) => {
  await enter(page, 'browser-username', 'missing@example.com');
  await page.getByLabel('Discord username', { exact: true }).fill('unknown');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('link', { name: 'contact@ainooga.org' })).toHaveAttribute(
    'href',
    'mailto:contact@ainooga.org',
  );
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('missing@example.com');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Discord username', { exact: true }).fill(' CHAPTER.USER ');
  await page.getByRole('button', { name: 'Continue', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Next talk' })).toBeVisible();
});
test('a lost accepted response retries the same ballot without incrementing its revision', async ({
  page,
}) => {
  await enter(page, 'browser-retry');
  let dropped = false;
  const payloads: string[] = [];
  await page.route('**/api/polls/browser-retry/ballot', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    payloads.push(route.request().postData()!);
    if (!dropped) {
      dropped = true;
      expect((await route.fetch()).status()).toBe(200);
      await route.abort('connectionreset');
    } else await route.continue();
  });
  await page.getByRole('radio', { name: 'Robotics', exact: true }).check();
  await page.getByRole('button', { name: 'Submit vote', exact: true }).click();
  await page.getByRole('button', { name: 'Retry same vote', exact: true }).click();
  await expect(page.getByText('Your vote is saved.', { exact: true })).toBeVisible();
  expect(payloads).toHaveLength(2);
  expect(payloads[0]).toBe(payloads[1]);
  expect(
    await (await page.request.get('/api/polls/browser-retry/ballot')).json(),
  ).toMatchObject({ revision: 1 });
});
test('multiple choice and hidden results remain restricted', async ({ page }) => {
  await enter(page, 'browser-multi');
  await page.getByRole('checkbox', { name: 'Robotics', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Language models', exact: true }).check();
  await page.getByRole('button', { name: 'Submit vote', exact: true }).click();
  await expect(page.getByText('Your vote is saved.', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Results are not shared with voters for this poll.'),
  ).toBeVisible();
  expect((await page.request.get('/api/polls/browser-multi/results')).status()).toBe(403);
});

async function changeEmail(page: Page, email: string) {
  await page.getByRole('button', { name: 'Use another email' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Next talk' })).toBeVisible();
}
test('two tabs require confirmation, preserve a cancelled draft, and restore focus', async ({
  page,
  context,
}) => {
  await enter(page, 'browser-confirm');
  await page.getByLabel('Write in an option').fill('Preserved draft');
  const other = await context.newPage();
  await other.goto('/#/polls/browser-confirm');
  await changeEmail(other, 'other@example.com');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const submit = page.getByRole('button', { name: 'Submit vote', exact: true });
  await submit.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(
    'You switched to other@example.com after starting this. Do you want to submit as other@example.com?',
  );
  expect(
    await (await other.request.get('/api/polls/browser-confirm/ballot')).json(),
  ).toBeNull();
  await dialog.getByRole('button', { name: 'Yes', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(submit).toBeFocused();
  await expect(page.getByLabel('Write in an option')).toHaveValue('Preserved draft');
  await submit.click();
  await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page.locator('.poll-ballot li')).toHaveText('Preserved draft');
  expect(
    await (await other.request.get('/api/polls/browser-confirm/ballot')).json(),
  ).toMatchObject({ revision: 1 });
});
test('No accepts a replacement email in the same dialog and handles an ineligible email', async ({
  page,
  context,
}) => {
  await enter(page, 'browser-email');
  await page.getByRole('radio', { name: 'Robotics', exact: true }).check();
  const other = await context.newPage();
  await other.goto('/#/polls/browser-email');
  await changeEmail(other, 'other@example.com');
  await page.getByRole('button', { name: 'Submit vote', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'No', exact: true }).click();
  const email = dialog.getByLabel('What email should this vote use?');
  await email.fill('missing@example.com');
  await dialog.getByRole('button', { name: 'Submit as this email' }).click();
  await expect(dialog.getByRole('alert')).toContainText('cannot access');
  expect(
    await (await page.request.get('/api/polls/browser-email/ballot')).json(),
  ).toBeNull();
  await email.fill('voter@example.com');
  await dialog.getByRole('button', { name: 'Submit as this email' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.poll-ballot li')).toHaveText('Robotics');
  expect(
    await (await page.request.get('/api/polls/browser-email/session')).json(),
  ).toMatchObject({ personId: 2 });
});
test('an accepted lost response cannot be retried as another voter without confirmation', async ({
  page,
  context,
}) => {
  const slug = 'browser-context-retry';
  await enter(page, slug);
  let dropped = false;
  const payloads: string[] = [];
  await page.route(`**/api/polls/${slug}/ballot`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    payloads.push(route.request().postData()!);
    if (!dropped) {
      dropped = true;
      expect((await route.fetch()).status()).toBe(200);
      await route.abort('connectionreset');
    } else await route.continue();
  });
  await page.getByRole('radio', { name: 'Robotics', exact: true }).check();
  await page.getByRole('button', { name: 'Submit vote', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry same vote' })).toBeVisible();
  const other = await context.newPage();
  await other.goto(`/#/polls/${slug}`);
  await changeEmail(other, 'other@example.com');
  await page.getByRole('button', { name: 'Retry same vote' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(payloads[1]).toBe(payloads[0]);
  expect(await (await other.request.get(`/api/polls/${slug}/ballot`)).json()).toBeNull();
  await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page.getByText('2 of 2 eligible voters have voted.')).toBeVisible();
  expect(JSON.parse(payloads[2]!).requestId).not.toBe(JSON.parse(payloads[0]!).requestId);
});
test('a second identity change while the dialog is open requires another confirmation', async ({
  page,
  context,
}) => {
  await enter(page, 'browser-repeat-switch');
  await page.getByRole('radio', { name: 'Robotics', exact: true }).check();
  const other = await context.newPage();
  await other.goto('/#/polls/browser-repeat-switch');
  await changeEmail(other, 'other@example.com');
  await page.getByRole('button', { name: 'Submit vote', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('other@example.com');
  await changeEmail(other, 'voter@example.com');
  await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(dialog).toContainText('You switched to voter@example.com');
  expect(
    await (await other.request.get('/api/polls/browser-repeat-switch/ballot')).json(),
  ).toBeNull();
  await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page.locator('.poll-ballot li')).toHaveText('Robotics');
});
test('accepted write-ins cannot be invisibly edited after a failed detail reload', async ({
  page,
}) => {
  const slug = 'browser-write-in-reload';
  await enter(page, slug);
  await page.getByLabel('Write in an option').fill('Visible after reload');
  let fail = true;
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'PUT') writes++;
  });
  await page.route(`**/api/polls/${slug}`, async (route) => {
    if (fail) await route.abort('connectionreset');
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Submit vote', exact: true }).click();
  await expect(
    page.getByText('Your vote is saved, but its choices could not be loaded.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit vote', exact: true })).toHaveCount(
    0,
  );
  fail = false;
  await page.getByRole('button', { name: 'Reload saved vote' }).click();
  await expect(page.locator('.poll-ballot li')).toHaveText('Visible after reload');
  await expect(
    page.getByRole('button', { name: 'Edit vote', exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
});
test('confirmation warns before replacing the current voter’s existing editable ballot', async ({
  page,
  context,
}) => {
  await enter(page, 'browser-existing-vote');
  await page.getByRole('radio', { name: 'Robotics', exact: true }).check();
  const other = await context.newPage();
  await other.goto('/#/polls/browser-existing-vote');
  await changeEmail(other, 'other@example.com');
  await other.getByRole('radio', { name: 'Language models', exact: true }).check();
  await other.getByRole('button', { name: 'Submit vote', exact: true }).click();
  await expect(other.locator('.poll-ballot li')).toHaveText('Language models');
  await page.getByRole('button', { name: 'Submit vote', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('replace this voter’s existing vote');
  await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page.locator('.poll-ballot li')).toHaveText('Robotics');
  expect(
    await (await other.request.get('/api/polls/browser-existing-vote/ballot')).json(),
  ).toMatchObject({ revision: 2 });
});
