<script lang="ts">
  import { onMount } from 'svelte';
  import { apiPost } from '$lib/api';
  import { getTurnstileService } from '$lib/context';
  import { whenTurnstileReady } from '$lib/turnstile.js';

  let {
    endpoint = 'contact-sponsor',
    intro = "Leave your details and we'll reach out to talk through options.",
    confirmFootnote = "We'll call you back to discuss options.",
  }: {
    endpoint?: string;
    intro?: string;
    confirmFootnote?: string;
  } = $props();

  let formName = $state('');
  let formPhone = $state('');
  let formDate = $state('');
  let formTime = $state('');
  let formSubmitted = $state(false);
  let formVisible = $state(false);
  let formError = $state<string | null>(null);
  let turnstileWidgetId = $state<string | null>(null);
  let turnstileContainer = $state<HTMLDivElement | null>(null);

  const turnstile = getTurnstileService();
  let didRenderTurnstile = $state(false);

  function reset() {
    if (turnstileWidgetId) turnstile.reset(turnstileWidgetId);
    formName = '';
    formPhone = '';
    formDate = '';
    formTime = '';
    formSubmitted = false;
    formError = null;
  }

  function open() {
    formVisible = true;
    formError = null;
  }

  function close() {
    formVisible = false;
    formError = null;
    didRenderTurnstile = false;
    if (turnstileWidgetId) {
      turnstile.remove(turnstileWidgetId);
      turnstileWidgetId = null;
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    formError = null;

    if (!formName.trim() || !formPhone.trim()) {
      formError = 'Name and phone number required.';
      return;
    }
    const phoneClean = formPhone.replace(/[\s()-]/g, '');
    if (phoneClean.length < 7) {
      formError = 'Enter a valid phone number.';
      return;
    }

    const token = turnstileWidgetId ? turnstile.getResponse(turnstileWidgetId) : '';
    if (!token) {
      formError = 'Please complete the verification.';
      return;
    }

    const result = await apiPost(endpoint, {
      name: formName,
      phone: formPhone,
      preferredDate: formDate || undefined,
      preferredTime: formTime || undefined,
      turnstileToken: token,
    });

    if (result.ok) {
      formSubmitted = true;
    } else {
      formError = result.error ?? 'Something went wrong.';
    }
  }

  $effect(() => {
    if (formVisible && turnstileContainer && !didRenderTurnstile) {
      didRenderTurnstile = true;
      const id = turnstile.render(turnstileContainer);
      if (id) {
        turnstileWidgetId = id;
      } else {
        whenTurnstileReady().then(() => {
          if (turnstileContainer && !turnstileWidgetId) {
            turnstileWidgetId = turnstile.render(turnstileContainer);
          }
        });
      }
    }
  });

  onMount(() => {
    return () => {
      if (turnstileWidgetId) turnstile.remove(turnstileWidgetId);
    };
  });
</script>

{#if formSubmitted}
  <div class="form-success">
    <h3 class="tier-heading">Thank you</h3>
    <p class="form-success__text">{confirmFootnote}</p>
    <button class="btn btn-outline" onclick={reset} style="margin-top: var(--space-lg)"
      >Send another</button
    >
  </div>
{:else if formVisible}
  <p class="section__label">Contact us</p>
  <h3 class="tier-heading">Let's talk</h3>
  <p class="form-intro">{intro}</p>
  <form class="contact-form" onsubmit={handleSubmit}>
    <label class="form-field">
      <span class="form-label">Name</span>
      <input
        type="text"
        class="form-input"
        bind:value={formName}
        placeholder="Your name"
        required
      />
    </label>
    <label class="form-field">
      <span class="form-label">Phone number</span>
      <input
        type="tel"
        class="form-input"
        bind:value={formPhone}
        placeholder="(423) 555-0123"
        required
      />
    </label>
    <label class="form-field">
      <span class="form-label">Best date to call</span>
      <input type="date" class="form-input" bind:value={formDate} />
    </label>
    <label class="form-field">
      <span class="form-label">Best time to call</span>
      <input type="time" class="form-input" bind:value={formTime} />
    </label>
    <div bind:this={turnstileContainer}></div>
    {#if formError}
      <p class="error-msg">{formError}</p>
    {/if}
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Send request</button>
      <button type="button" class="btn btn-outline" onclick={close}>Cancel</button>
    </div>
  </form>
{:else}
  <div class="cta">
    <p class="section__label">Get in touch</p>
    <h3 class="tier-heading">Not sure where to start?</h3>
    <p class="cta__text">
      Reach out and we'll call you back to talk through the right option for your
      situation.
    </p>
    <button class="btn btn-primary" onclick={open}>Contact us</button>
  </div>
{/if}

<style>
  .form-success {
    text-align: center;
    padding: var(--space-xl) 0;
  }

  .form-success__text,
  .cta__text,
  .form-intro {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .form-success__text {
    margin-top: var(--space-sm);
  }

  .cta {
    text-align: center;
    padding: var(--space-xl) 0;
  }

  .cta__text {
    max-width: 480px;
    margin: 0 auto var(--space-lg);
  }

  .form-intro {
    margin-bottom: var(--space-lg);
  }

  .contact-form {
    max-width: 480px;
  }

  .tier-heading {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: 400;
    margin-bottom: var(--space-md);
  }

  .form-field {
    display: block;
    margin-bottom: var(--space-md);
  }

  .form-label {
    display: block;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-secondary);
    margin-bottom: var(--space-xs);
  }

  .form-input {
    width: 100%;
    padding: var(--space-sm) var(--space-md);
    font-family: var(--font-body);
    font-size: var(--text-base);
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    transition: border-color 0.15s ease;
  }

  .form-input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px var(--color-accent-subtle);
  }

  .form-actions {
    display: flex;
    gap: var(--space-md);
    margin-top: var(--space-lg);
    flex-wrap: wrap;
  }

  .error-msg {
    color: var(--color-error);
    font-size: var(--text-sm);
    margin-top: var(--space-sm);
  }
</style>
