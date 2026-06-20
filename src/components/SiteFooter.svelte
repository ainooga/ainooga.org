<script lang="ts">
  import { apiPost } from '$lib/api';
  import { getTurnstileService } from '$lib/context';
  import { TURNSTILE_WORKER_URL } from '$lib/turnstile.js';

  const year = new Date().getFullYear();

  let subscribeEmail = $state('');
  let subscribeStatus = $state<'idle' | 'loading' | 'success' | 'error'>('idle');
  let subscribeMessage = $state('');
  let turnstileWidgetId = $state<string | null>(null);
  let turnstileContainer = $state<HTMLDivElement | null>(null);

  let turnstile = $state(getTurnstileService());

  function renderTurnstile() {
    if (turnstileContainer && turnstileWidgetId === null) {
      turnstileWidgetId = turnstile.render(turnstileContainer!);
    }
  }

  $effect(() => {
    if (turnstileContainer) {
      renderTurnstile();
    }
  });

  async function handleSubscribe(e: Event) {
    e.preventDefault();
    subscribeStatus = 'loading';
    subscribeMessage = '';

    const turnstileToken = turnstileWidgetId
      ? turnstile.getResponse(turnstileWidgetId)
      : '';

    const verifyRes = await fetch(TURNSTILE_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: turnstileToken }),
    });
    const verifyData = await verifyRes.json();
    if (!verifyData.success) {
      subscribeStatus = 'error';
      subscribeMessage = 'Verification failed. Try again.';
      return;
    }

    const result = await apiPost('subscribe', {
      email: subscribeEmail,
      turnstileToken,
    });

    if (result.ok) {
      subscribeStatus = 'success';
      subscribeMessage =
        (result.data as Record<string, string> | undefined)?.message ??
        'Check your email to confirm.';
      subscribeEmail = '';
      if (turnstileWidgetId) {
        turnstile.reset(turnstileWidgetId);
      }
    } else {
      subscribeStatus = 'error';
      subscribeMessage = result.error ?? 'Something went wrong.';
    }
  }
</script>

<footer class="site-footer">
  <div class="container site-footer__inner">
    <div class="site-footer__brand">
      <span class="site-footer__mark">AI</span>
      <span class="site-footer__name">AI Nooga</span>
    </div>
    <nav class="site-footer__nav" aria-label="Footer navigation">
      <a href="#/events">Events</a>
      <a href="#/posts">Posts</a>
      <a href="#/members">Members</a>
      <a href="#/sponsor">Sponsor</a>
      <a href="#/about">About</a>
    </nav>

    <form class="site-footer__subscribe" onsubmit={handleSubscribe}>
      <label for="subscribe-email" class="site-footer__subscribe-label">
        Join the mailing list
      </label>
      <div class="site-footer__subscribe-row">
        <input
          id="subscribe-email"
          type="email"
          class="form-input site-footer__subscribe-input"
          bind:value={subscribeEmail}
          placeholder="your@email.com"
          required
          disabled={subscribeStatus === 'loading'}
        />
        <button
          type="submit"
          class="btn btn-primary"
          disabled={subscribeStatus === 'loading'}
        >
          {subscribeStatus === 'loading' ? 'Sending…' : 'Subscribe'}
        </button>
      </div>
      <div bind:this={turnstileContainer} class="site-footer__turnstile"></div>
      {#if subscribeMessage}
        <p
          class="site-footer__subscribe-msg"
          class:success={subscribeStatus === 'success'}
          class:error={subscribeStatus === 'error'}
        >
          {subscribeMessage}
        </p>
      {/if}
    </form>

    <p class="site-footer__copy">&copy; {year} AI Nooga. Chattanooga, Tennessee.</p>
  </div>
</footer>

<svelte:head>
  <script
    src="https://challenges.cloudflare.com/turnstile/v0/api.js"
    async
    defer
  ></script>
</svelte:head>

<style>
  .site-footer {
    border-top: 1px solid var(--color-border-light);
    padding: var(--space-3xl) 0;
    margin-top: var(--space-4xl);
  }

  .site-footer__inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-lg);
    text-align: center;
  }

  .site-footer__brand {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .site-footer__mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: var(--color-primary);
    color: var(--color-surface);
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: 600;
    font-style: italic;
    border-radius: var(--radius-sm);
  }

  .site-footer__name {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    color: var(--color-text);
  }

  .site-footer__nav {
    display: flex;
    gap: var(--space-lg);
    flex-wrap: wrap;
    justify-content: center;
  }

  .site-footer__nav a {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .site-footer__nav a:hover {
    color: var(--color-accent);
  }

  .site-footer__subscribe {
    width: 100%;
    max-width: 400px;
  }

  .site-footer__subscribe-label {
    display: block;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-secondary);
    margin-bottom: var(--space-sm);
  }

  .site-footer__subscribe-row {
    display: flex;
    gap: var(--space-sm);
  }

  .site-footer__subscribe-input {
    flex: 1;
  }

  .site-footer__turnstile {
    margin-top: var(--space-sm);
    display: flex;
    justify-content: center;
  }

  .site-footer__subscribe-msg {
    font-size: var(--text-sm);
    margin-top: var(--space-sm);
  }

  .site-footer__subscribe-msg.success {
    color: var(--color-success);
  }

  .site-footer__subscribe-msg.error {
    color: var(--color-error);
  }

  .site-footer__copy {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>
