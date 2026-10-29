import { test, expect } from '@playwright/test';

const SITE_URL = 'https://ainooga.org/';

// Stand-in for the Cloudflare Turnstile script. The challenge is only solved
// when the test calls window.__solveTurnstile(), so the "Verifying…" state can
// be observed deterministically.
const fakeTurnstile = `const widgets = new Map(); let next = 0;
window.turnstile = {
  render(element, options) { const id = String(++next); widgets.set(id, options); return id; },
  reset() {},
  remove(id) { widgets.delete(id); },
  getResponse() { return 'e2e-turnstile-token'; }
};
window.__solveTurnstile = () => { for (const o of widgets.values()) o.callback('e2e-turnstile-token'); };`;

test.describe('Newsletter sign-up', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
      route.fulfill({ contentType: 'application/javascript', body: fakeTurnstile }),
    );
    await page.goto(SITE_URL, { timeout: 30_000 });
    // The form is rendered client-side by the SPA, so its presence means it is mounted.
    await expect(page.locator('footer .site-footer__subscribe')).toBeVisible();
  });

  test('footer contains the mailing list subscription form', async ({ page }) => {
    // The form should be inside the footer
    const footer = page.locator('footer');
    await expect(footer).toBeAttached();

    // Check for the form with the "Join the mailing list" label
    const form = footer.locator('.site-footer__subscribe');
    await expect(form).toBeVisible();

    // Label
    await expect(form.locator('.site-footer__subscribe-label')).toHaveText(
      'Join the mailing list',
    );

    // Email input
    const emailInput = form.locator('#subscribe-email');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(emailInput).toHaveAttribute('placeholder', 'your@email.com');
    await expect(emailInput).toHaveAttribute('required', '');

    // Subscribe button
    const subscribeBtn = form.locator('button[type="submit"]');
    await expect(subscribeBtn).toBeVisible();
    await expect(subscribeBtn).toHaveText('Subscribe');
  });

  test('email input accepts a typed email address', async ({ page }) => {
    const emailInput = page.locator('#subscribe-email');
    await expect(emailInput).toBeVisible();

    await emailInput.fill('test@example.com');
    await expect(emailInput).toHaveValue('test@example.com');
  });

  test('subscribe button is disabled while loading and re-enabled after', async ({
    page,
  }) => {
    const form = page.locator('footer .site-footer__subscribe');
    const emailInput = form.locator('#subscribe-email');
    const subscribeBtn = form.locator('button[type="submit"]');

    let releaseSubscribe!: () => void;
    const subscribeHeld = new Promise<void>((resolve) => {
      releaseSubscribe = resolve;
    });
    const requests: unknown[] = [];
    await page.route('**/api/subscribe', async (route) => {
      requests.push(route.request().postDataJSON());
      await subscribeHeld;
      await route.fulfill({ status: 400, json: { error: 'Valid email required' } });
    });

    await expect(subscribeBtn).toBeEnabled();
    await expect(subscribeBtn).toHaveText('Subscribe');

    await emailInput.fill('test@example.com');
    await emailInput.press('Enter');

    // Waiting on the Turnstile challenge
    await expect(subscribeBtn).toBeDisabled();
    await expect(subscribeBtn).toHaveText('Verifying…');
    await expect(form.locator('.site-footer__turnstile')).toBeAttached();

    // Challenge solved; backend request is in flight and held
    await page.evaluate('window.__solveTurnstile()');
    await expect(subscribeBtn).toBeDisabled();
    await expect(subscribeBtn).toHaveText('Sending…');
    await expect(emailInput).toBeDisabled();
    const payload = { email: 'test@example.com', turnstileToken: 'e2e-turnstile-token' };
    await expect.poll(() => requests).toEqual([payload]);

    // Backend responds; the form is usable again and shows the error
    releaseSubscribe();
    await expect(form.locator('.site-footer__subscribe-msg.error')).toHaveText(
      'Valid email required',
    );
    await expect(subscribeBtn).toBeEnabled();
    await expect(subscribeBtn).toHaveText('Subscribe');
    await expect(emailInput).toBeEnabled();
  });
});
