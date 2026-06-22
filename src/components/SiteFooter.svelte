<script lang="ts">
  import { apiPost } from '$lib/api';
  import { getTurnstileService } from '$lib/context';
  import { whenTurnstileReady } from '$lib/turnstile.js';
  import type { TurnstileWidgetCallbacks } from '$lib/turnstile.js';

  const year = new Date().getFullYear();
  const INACTIVITY_TIMEOUT_MS = 60_000;
  const SCRIPT_LOAD_TIMEOUT_MS = 10_000;

  type SubscribeState =
    | 'idle'
    | 'revealing'
    | 'submitting'
    | 'success'
    | 'error_load'
    | 'error_turnstile'
    | 'error_timeout'
    | 'error_validation'
    | 'error_verification'
    | 'error_server'
    | 'error_network';

  let subscribeState = $state<SubscribeState>('idle');
  let subscribeEmail = $state('');
  let subscribeMessage = $state('');
  let turnstileWidgetId = $state<string | null>(null);
  let turnstileContainer = $state<HTMLDivElement | null>(null);
  let turnstileRenderKey = $state(0);

  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  let scriptLoadTimer: ReturnType<typeof setTimeout> | null = null;

  const turnstile = getTurnstileService();

  /* ---- Turnstile callbacks (stable references) ---- */

  const callbacks: TurnstileWidgetCallbacks = {
    onToken(token: string) {
      if (subscribeState !== 'revealing') return;
      clearInactivityTimer();
      subscribeState = 'submitting';
      submitToBackend(token);
    },
    onError() {
      if (subscribeState !== 'revealing') return;
      clearInactivityTimer();
      subscribeState = 'error_turnstile';
    },
    onTimeout() {
      if (subscribeState !== 'revealing') return;
      clearInactivityTimer();
      subscribeState = 'error_timeout';
    },
    onExpired() {
      // No state change — 'refresh-expired' is 'auto' so Turnstile
      // will self-replace the token and fire callback() when ready.
    },
  };

  /* ---- Timer management ---- */

  function startInactivityTimer() {
    clearInactivityTimer();
    inactivityTimer = setTimeout(() => {
      if (subscribeState === 'revealing') {
        destroyWidget();
        subscribeState = 'idle';
      }
    }, INACTIVITY_TIMEOUT_MS);
  }

  function clearInactivityTimer() {
    if (inactivityTimer !== null) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  }

  function startScriptLoadTimer() {
    clearScriptLoadTimer();
    scriptLoadTimer = setTimeout(() => {
      if (subscribeState === 'revealing') {
        subscribeState = 'error_load';
      }
    }, SCRIPT_LOAD_TIMEOUT_MS);
  }

  function clearScriptLoadTimer() {
    if (scriptLoadTimer !== null) {
      clearTimeout(scriptLoadTimer);
      scriptLoadTimer = null;
    }
  }

  /* ---- Widget lifecycle ---- */

  function renderTurnstile() {
    if (!turnstileContainer) return;
    const id = turnstile.render(turnstileContainer, callbacks);
    if (id) {
      turnstileWidgetId = id;
      clearScriptLoadTimer();
    } else {
      // Turnstile script hasn't loaded yet
      startScriptLoadTimer();
      whenTurnstileReady().then(() => {
        if (subscribeState === 'revealing' && !turnstileWidgetId && turnstileContainer) {
          const retryId = turnstile.render(turnstileContainer, callbacks);
          if (retryId) {
            turnstileWidgetId = retryId;
            clearScriptLoadTimer();
          }
        }
      });
    }
  }

  function destroyWidget() {
    if (turnstileWidgetId) {
      turnstile.remove(turnstileWidgetId);
      turnstileWidgetId = null;
    }
    turnstileRenderKey++;
  }

  function resetWidget() {
    if (turnstileWidgetId) {
      turnstile.reset(turnstileWidgetId);
    }
  }

  /* ---- Form actions ---- */

  async function submitToBackend(token: string) {
    const result = await apiPost('subscribe', {
      email: subscribeEmail,
      turnstileToken: token,
    });

    if (result.ok) {
      subscribeState = 'success';
      subscribeMessage =
        (result.data as Record<string, string> | undefined)?.message ??
        'Check your email to confirm.';
    } else if (result.networkError) {
      // Token was never sent — preserve widget for retry
      subscribeState = 'error_network';
      subscribeMessage = 'Network error. Check your connection.';
    } else {
      onBackendError(result.error ?? '');
    }
  }

  function onBackendError(error: string) {
    if (error === 'Verification failed. Try again.') {
      subscribeState = 'error_verification';
      subscribeMessage = error;
      resetWidget();
    } else if (error === 'Valid email required') {
      subscribeState = 'error_validation';
      subscribeMessage = error;
    } else {
      // Unhandled server error — token is spent, destroy + re-render on retry
      subscribeState = 'error_server';
      subscribeMessage = error;
      destroyWidget();
    }
  }

  function handleSubscribe(e: Event) {
    e.preventDefault();
    subscribeMessage = '';

    // If we're in an error_validation state and the email changed,
    // re-enter revealing (reuse existing widget if it's still valid)
    if (subscribeState === 'error_validation') {
      subscribeState = 'revealing';
      startInactivityTimer();
      if (!turnstileWidgetId && turnstileContainer) {
        renderTurnstile();
      }
      return;
    }

    // From idle, or from error states that require fresh reveal
    if (turnstileWidgetId) {
      destroyWidget();
    }
    subscribeState = 'revealing';
    startInactivityTimer();
  }

  /* ---- Retry actions ---- */

  function retryTurnstile() {
    // Destroy and re-render widget for a clean slate
    destroyWidget();
    subscribeState = 'revealing';
    startInactivityTimer();
  }

  function retryNetwork() {
    // Token was never sent to backend — widget and container are intact.
    // Read the existing token and retry the submission directly.
    const token = turnstileWidgetId ? turnstile.getResponse(turnstileWidgetId) : '';
    if (token) {
      subscribeState = 'submitting';
      submitToBackend(token);
    } else {
      // No token available (shouldn't happen in error_network, but handle gracefully)
      subscribeState = 'revealing';
      startInactivityTimer();
    }
  }

  // retryTurnstile is reused for error_load, error_turnstile, error_timeout,
  // and error_server — all need a fresh widget with a clean slate.

  function retryVerification() {
    // Widget was already reset in onBackendError. Container is intact.
    // Return to REVEALING and wait for the user to complete the new challenge.
    subscribeState = 'revealing';
    startInactivityTimer();
  }

  /* ---- Success: reset back to idle ---- */

  function resetToIdle() {
    destroyWidget();
    subscribeEmail = '';
    subscribeMessage = '';
    subscribeState = 'idle';
  }

  /* ---- Reactivity: auto-render Turnstile when container appears in REVEALING ---- */

  $effect(() => {
    if (subscribeState === 'revealing' && turnstileContainer && !turnstileWidgetId) {
      renderTurnstile();
    }
  });

  /* ---- Cleanup on unmount ---- */

  $effect(() => {
    return () => {
      clearInactivityTimer();
      clearScriptLoadTimer();
      if (turnstileWidgetId) {
        turnstile.remove(turnstileWidgetId);
        turnstileWidgetId = null;
      }
    };
  });
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

    {#if subscribeState === 'success'}
      <div class="site-footer__success">
        <p class="site-footer__subscribe-msg success">
          {subscribeMessage}
        </p>
        <button class="btn btn-outline btn-sm" onclick={resetToIdle}>
          Subscribe another
        </button>
      </div>
    {:else}
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
            disabled={subscribeState === 'submitting'}
          />
          <button
            type="submit"
            class="btn btn-primary"
            disabled={subscribeState === 'submitting' || subscribeState === 'revealing'}
          >
            {#if subscribeState === 'submitting'}
              Sending…
            {:else if subscribeState === 'revealing'}
              Verifying…
            {:else}
              Subscribe
            {/if}
          </button>
        </div>

        {#if subscribeState === 'revealing' || subscribeState === 'submitting' || subscribeState === 'error_verification' || subscribeState === 'error_network' || subscribeState === 'error_validation'}
          {#key turnstileRenderKey}
            <div bind:this={turnstileContainer} class="site-footer__turnstile"></div>
          {/key}
        {/if}

        <!-- Error states -->
        {#if subscribeState === 'error_load'}
          <div class="site-footer__error-state">
            <p class="site-footer__subscribe-msg error">Verification couldn't load.</p>
            <button type="button" class="btn btn-outline btn-sm" onclick={retryTurnstile}
              >Retry</button
            >
          </div>
        {/if}

        {#if subscribeState === 'error_turnstile'}
          <div class="site-footer__error-state">
            <p class="site-footer__subscribe-msg error">Verification failed.</p>
            <button type="button" class="btn btn-outline btn-sm" onclick={retryTurnstile}
              >Retry</button
            >
          </div>
        {/if}

        {#if subscribeState === 'error_timeout'}
          <div class="site-footer__error-state">
            <p class="site-footer__subscribe-msg error">Verification timed out.</p>
            <button type="button" class="btn btn-outline btn-sm" onclick={retryTurnstile}
              >Retry</button
            >
          </div>
        {/if}

        {#if subscribeState === 'error_validation'}
          <p class="site-footer__subscribe-msg error">{subscribeMessage}</p>
        {/if}

        {#if subscribeState === 'error_verification'}
          <div class="site-footer__error-state">
            <p class="site-footer__subscribe-msg error">{subscribeMessage}</p>
            <button
              type="button"
              class="btn btn-outline btn-sm"
              onclick={retryVerification}
            >
              Try again
            </button>
          </div>
        {/if}

        {#if subscribeState === 'error_server'}
          <div class="site-footer__error-state">
            <p class="site-footer__subscribe-msg error">
              Something went wrong. Try again.
            </p>
            <button type="button" class="btn btn-outline btn-sm" onclick={retryTurnstile}
              >Retry</button
            >
          </div>
        {/if}

        {#if subscribeState === 'error_network'}
          <div class="site-footer__error-state">
            <p class="site-footer__subscribe-msg error">
              Network error. Check your connection.
            </p>
            <button type="button" class="btn btn-outline btn-sm" onclick={retryNetwork}
              >Retry</button
            >
          </div>
        {/if}
      </form>
    {/if}

    <p class="site-footer__copy">&copy; {year} AI Nooga. Chattanooga, Tennessee.</p>
  </div>
</footer>

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

  .site-footer__success {
    width: 100%;
    max-width: 400px;
    text-align: center;
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

  .site-footer__error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-sm);
    margin-top: var(--space-sm);
  }

  .site-footer__copy {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .btn-sm {
    font-size: var(--text-xs);
    padding: var(--space-xs) var(--space-md);
  }
</style>
