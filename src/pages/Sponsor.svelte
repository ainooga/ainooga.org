<script lang="ts">
  import { onMount } from 'svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { fetchData } from '$lib/fetch';
  import { apiPost } from '$lib/api';
  import { getTurnstileService } from '$lib/context';
  import { TURNSTILE_WORKER_URL } from '$lib/turnstile.js';

  interface SponsorItem {
    slug: string;
    title: string;
    tier: string;
    description?: string;
    url?: string;
    featured?: boolean;
    path: string;
    tags: string[];
  }

  interface ContentIndex {
    items: SponsorItem[];
  }

  const tiers = ['platinum', 'gold', 'silver', 'bronze', 'community'] as const;

  type Tier = (typeof tiers)[number];

  const tierInfo: Record<Tier, { label: string; amount: string; color: string }> = {
    platinum: { label: 'Platinum', amount: '$10,000+', color: '#1B2A3C' },
    gold: { label: 'Gold', amount: '$5,000+', color: '#B87333' },
    silver: { label: 'Silver', amount: '$2,000+', color: '#6B6560' },
    bronze: { label: 'Bronze', amount: '$500+', color: '#9C9590' },
    community: { label: 'Community', amount: 'In-kind', color: '#9C9590' },
  };

  let sponsors = $state<SponsorItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Contact form state
  let showForm = $state(false);
  let formName = $state('');
  let formPhone = $state('');
  let formDate = $state('');
  let formTime = $state('');
  let formSubmitted = $state(false);
  let formError = $state<string | null>(null);
  let turnstileWidgetId = $state<string | null>(null);
  let turnstileContainer = $state<HTMLDivElement | null>(null);

  let turnstile = $state(getTurnstileService());

  function renderTurnstile() {
    if (turnstileContainer && turnstileWidgetId === null) {
      turnstileWidgetId = turnstile.render(turnstileContainer!);
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

    const turnstileToken = turnstileWidgetId
      ? turnstile.getResponse(turnstileWidgetId)
      : '';
    if (!turnstileToken) {
      formError = 'Please complete the verification.';
      return;
    }

    const verifyRes = await fetch(TURNSTILE_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: turnstileToken }),
    });
    const verifyData = await verifyRes.json();
    if (!verifyData.success) {
      formError = 'Verification failed. Try again.';
      return;
    }

    const result = await apiPost('contact-sponsor', {
      name: formName,
      phone: formPhone,
      preferredDate: formDate || undefined,
      preferredTime: formTime || undefined,
      turnstileToken,
    });

    if (result.ok) {
      formSubmitted = true;
    } else {
      formError = result.error ?? 'Something went wrong.';
    }
  }

  function resetForm() {
    showForm = false;
    formName = '';
    formPhone = '';
    formDate = '';
    formTime = '';
    formSubmitted = false;
    formError = null;
    if (turnstileWidgetId) {
      turnstile.reset(turnstileWidgetId);
    }
  }

  async function load() {
    try {
      const data = await fetchData<ContentIndex>('/data/sponsors/index.json');
      sponsors = data.items;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (showForm && turnstileContainer) {
      renderTurnstile();
    }
  });

  onMount(load);
</script>

<svelte:head>
  <script
    src="https://challenges.cloudflare.com/turnstile/v0/api.js"
    async
    defer
  ></script>
</svelte:head>

<div class="container sponsor-page">
  <p class="section__label" style="padding-top: var(--space-3xl)">Sponsorship</p>
  <h1 class="page-title">Support AI Nooga</h1>
  <p class="sponsor-page__intro">
    AI Nooga is a volunteer-run club. Sponsorships from local businesses and benevolent
    individuals make our events, workshops, and community programs possible.
  </p>

  <hr class="divider" />

  <section class="section" style="padding-top: 0;">
    <p class="section__label">Why sponsor</p>
    <h2 class="section__title">Invest in Chattanooga's AI future</h2>
    <div class="sponsor-page__reasons">
      <div class="reason">
        <h3>Invest in talent</h3>
        <p>
          Chattanooga's AI community is growing. Sponsors get early access to the people
          who will shape the city's technology workforce.
        </p>
      </div>
      <div class="reason">
        <h3>Shape policy</h3>
        <p>
          AI Nooga engages with local and state policy. Sponsors help ensure Chattanooga's
          voice is heard in AI governance conversations.
        </p>
      </div>
      <div class="reason">
        <h3>Build community</h3>
        <p>
          Your support makes free and low-cost events accessible to everyone. It's a
          direct investment in the city's intellectual fabric.
        </p>
      </div>
    </div>
  </section>

  <hr class="divider" />

  <section class="section" style="padding-top: 0;">
    <p class="section__label">Tiers</p>
    <h2 class="section__title">Sponsorship levels</h2>
    <div class="tier-list" style="margin-top: var(--space-lg)">
      {#each tiers as tier (tier)}
        <div class="tier-item" style="border-left-color: {tierInfo[tier].color}">
          <div class="tier-item__header">
            <h3 class="tier-item__name">{tierInfo[tier].label}</h3>
            <span class="tier-item__amount">{tierInfo[tier].amount}</span>
          </div>
          <ul class="tier-item__benefits">
            {#if tier === 'platinum'}
              <li>Hero logo on homepage + sponsor page</li>
              <li>Named in all event materials</li>
              <li>Dedicated event sponsorship option</li>
              <li>Mention in newsletter</li>
            {:else if tier === 'gold'}
              <li>Logo on sponsor page</li>
              <li>Named in event materials</li>
              <li>Newsletter mention</li>
            {:else if tier === 'silver'}
              <li>Logo on sponsor page</li>
              <li>Newsletter mention</li>
            {:else if tier === 'bronze'}
              <li>Name on sponsor page</li>
            {:else}
              <li>Acknowledged on sponsor page</li>
            {/if}
          </ul>
        </div>
      {/each}
    </div>
  </section>

  <hr class="divider" />

  <section class="section" style="padding-top: 0;">
    <p class="section__label">Current sponsors</p>
    <h2 class="section__title">Supported by</h2>
    {#if loading}
      <div class="stack" style="margin-top: var(--space-lg)">
        <Skeleton height="3rem" width="200px" />
      </div>
    {:else if error}
      <p class="error-msg">
        Could not load sponsors. <button onclick={load} class="link-btn">Retry</button>
      </p>
    {:else}
      <div class="current-sponsors" style="margin-top: var(--space-lg)">
        {#each sponsors as sponsor (sponsor.slug)}
          <a
            href={sponsor.url ?? '#'}
            class="sponsor-card card"
            target="_blank"
            rel="noopener"
          >
            <span
              class="sponsor-card__tier"
              style="color: {tierInfo[sponsor.tier as Tier]?.color ?? '#6B6560'}"
              >{sponsor.tier}</span
            >
            <h3 class="sponsor-card__name">{sponsor.title}</h3>
            {#if sponsor.description}
              <p class="sponsor-card__desc">{sponsor.description}</p>
            {/if}
          </a>
        {/each}
      </div>
    {/if}
  </section>

  <hr class="divider" />

  <section class="section" style="padding-top: 0; padding-bottom: var(--space-4xl);">
    {#if formSubmitted}
      <div class="form-success">
        <h2 class="section__title">Thank you</h2>
        <p>We'll call you back at {formPhone} to discuss sponsorship opportunities.</p>
        <button
          class="btn btn-outline"
          onclick={resetForm}
          style="margin-top: var(--space-lg)">Send another</button
        >
      </div>
    {:else if showForm}
      <p class="section__label">Contact us</p>
      <h2 class="section__title">Let's talk</h2>
      <p class="sponsor-page__intro" style="margin-bottom: var(--space-lg)">
        Leave your details and we'll call you back to discuss sponsorship options.
      </p>
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
          <button
            type="button"
            class="btn btn-outline"
            onclick={() => {
              showForm = false;
            }}>Cancel</button
          >
        </div>
      </form>
    {:else}
      <div class="sponsor-cta">
        <p class="section__label">Get involved</p>
        <h2 class="section__title">Interested in sponsoring?</h2>
        <p>
          Reach out and we'll call you back to discuss how your organization can support
          Chattanooga's AI community.
        </p>
        <button
          class="btn btn-primary"
          onclick={() => {
            showForm = true;
          }}>Contact us</button
        >
      </div>
    {/if}
  </section>
</div>

<style>
  .page-title {
    font-family: var(--font-heading);
    font-size: var(--text-5xl);
    font-weight: 400;
    margin: var(--space-sm) 0 var(--space-lg);
  }

  .sponsor-page {
    padding-bottom: var(--space-4xl);
  }

  .sponsor-page__intro {
    font-size: var(--text-lg);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    max-width: 600px;
  }

  .sponsor-page__reasons {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-xl);
    margin-top: var(--space-lg);
  }

  .reason h3 {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: 600;
    margin-bottom: var(--space-sm);
  }

  .reason p {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .tier-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .tier-item {
    border-left: 3px solid;
    padding-left: var(--space-lg);
  }

  .tier-item__header {
    display: flex;
    align-items: baseline;
    gap: var(--space-md);
  }

  .tier-item__name {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: 400;
  }

  .tier-item__amount {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .tier-item__benefits {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin-top: var(--space-sm);
    padding-left: var(--space-lg);
    line-height: var(--leading-relaxed);
  }

  .tier-item__benefits li {
    margin-bottom: var(--space-xs);
  }

  .current-sponsors {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .sponsor-card {
    text-decoration: none;
    color: inherit;
  }

  .sponsor-card__tier {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .sponsor-card__name {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: 400;
    margin: var(--space-xs) 0;
  }

  .sponsor-card__desc {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .sponsor-cta {
    text-align: center;
    padding: var(--space-2xl) 0;
  }

  .sponsor-cta p {
    color: var(--color-text-secondary);
    margin-bottom: var(--space-lg);
    max-width: 480px;
    margin-left: auto;
    margin-right: auto;
  }

  .contact-form {
    max-width: 480px;
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
  }

  .form-success {
    text-align: center;
    padding: var(--space-3xl) 0;
  }

  .form-success p {
    color: var(--color-text-secondary);
  }

  .error-msg {
    color: var(--color-error);
    font-size: var(--text-sm);
    margin-top: var(--space-sm);
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--color-accent);
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    text-decoration: underline;
  }

  @media (max-width: 768px) {
    .sponsor-page__reasons {
      grid-template-columns: 1fr;
    }
  }
</style>
