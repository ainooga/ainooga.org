<script lang="ts">
  import { onMount } from 'svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import ContactForm from '../components/ContactForm.svelte';
  import { fetchData } from '$lib/fetch.ts';

  interface ProductIndexItem {
    slug: string;
    title: string;
    family?: string;
    path: string;
  }

  interface ProductDetail {
    name: string;
    price?: string;
    frequency?: string;
    order?: number;
    tagline?: string;
    benefits?: string[];
    featured?: boolean;
    note?: string;
    bodyHtml?: string;
  }

  let items = $state<ProductIndexItem[]>([]);
  let tiers = $state<ProductDetail[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  function sortTiers(a: ProductDetail, b: ProductDetail): number {
    return (a.order ?? 0) - (b.order ?? 0);
  }

  async function load() {
    try {
      const index = await fetchData<{ items: ProductIndexItem[] }>(
        '/data/products/index.json',
      );
      items = index.items.filter((i) => i.family === 'membership');

      const detailFetch = items.map((item) =>
        fetchData<ProductDetail>(item.path).then((d) => ({ ...d, order: d.order ?? 0 })),
      );

      const loaded = await Promise.all(detailFetch);
      tiers = loaded.sort(sortTiers);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<div class="container membership-page">
  <p class="section__label" style="padding-top: var(--space-3xl)">Membership</p>
  <h1 class="page-title">Be part of the community</h1>
  <p class="membership-page__intro">
    AI Nooga runs because people show up, build together, and stay connected. A membership
    is how you commit to that — and how the people you meet here stay findable afterward.
    It's not a transaction; it's how a club stays a club.
  </p>

  <hr class="divider" />

  <section class="section" style="padding-top: 0;">
    <p class="section__label">For what matters</p>
    <h2 class="section__title">Why it's worth belonging</h2>
    <div class="membership-page__pitch">
      <div class="pitch">
        <h3 class="pitch__title">Belonging</h3>
        <p class="pitch__text">
          A regular seat at the table. Members get consistent event access and are part of
          the people who shape Chattanooga's AI community — not just spectators.
        </p>
      </div>
      <div class="pitch">
        <h3 class="pitch__title">Access</h3>
        <p class="pitch__text">
          Early-bird pricing on paid events and training, plus priority when seating is
          tight. Being a member means you're in.
        </p>
      </div>
      <div class="pitch">
        <h3 class="pitch__title">Credibility</h3>
        <p class="pitch__text">
          A member profile and, for Pro+, a directory listing. The people you network with
          here can find you, your services, and your rank afterward.
        </p>
      </div>
    </div>
  </section>

  <hr class="divider" />

  <section class="section" style="padding-top: 0;">
    <p class="section__label">Tiers</p>
    <h2 class="section__title">Find your level</h2>

    {#if loading}
      <div class="grid-2" style="margin-top: var(--space-lg)">
        {#each [1, 2, 3, 4] as _, i (i)}
          <div class="card"><Skeleton height="14rem" /></div>
        {/each}
      </div>
    {:else if error}
      <p class="error-msg">
        Could not load membership options. <button onclick={load} class="link-btn"
          >Retry</button
        >
      </p>
    {:else}
      <div class="tier-grid" style="margin-top: var(--space-lg)">
        {#each tiers as tier (tier.name)}
          <div class="card tier-card" class:tier-card--featured={tier.featured}>
            {#if tier.featured}
              <span class="tier-card__badge">Most popular</span>
            {/if}
            <h3 class="tier-card__name">{tier.name}</h3>
            <div class="tier-card__price">
              {tier.price ?? '—'}
              {#if tier.frequency}
                <span class="tier-card__frequency">({tier.frequency})</span>
              {/if}
            </div>
            {#if tier.tagline}
              <p class="tier-card__tagline">{tier.tagline}</p>
            {/if}
            {#if tier.benefits && tier.benefits.length > 0}
              <ul class="tier-card__benefits">
                {#each tier.benefits as benefit (benefit)}
                  <li>{benefit}</li>
                {/each}
              </ul>
            {/if}
            {#if tier.note}
              <p class="tier-card__note">{tier.note}</p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <hr class="divider" />

  <section class="section" style="padding-top: 0;">
    <p class="section__label">The fine print</p>
    <h2 class="section__title">How membership works</h2>
    <div class="membership-page__how">
      <ol class="how-list">
        <li>
          <strong>Annual pricing.</strong> All tiers are billed annually. We keep it simple
          — one rate, one renewal, no monthly guessing.
        </li>
        <li>
          <strong>Anchor tier.</strong> Pro is the most popular choice: it's where you get a
          real directory presence and your first ad-slot eligibility.
        </li>
        <li>
          <strong>Pro Plus is the top tier.</strong> For professionals and small companies who
          want recurring promotion and priority access to special events.
        </li>
        <li>
          <strong>Organizers belong free.</strong> If you help run the club, your membership
          is covered in exchange for making it happen.
        </li>
      </ol>
    </div>
  </section>

  <hr class="divider" />

  <section class="section" style="padding-top: 0; padding-bottom: var(--space-4xl)">
    <ContactForm
      endpoint="contact-sponsor"
      intro="Tell us who you are and we'll call you back to set up your membership — or answer any question about the tiers."
      confirmFootnote="We'll call you back to set up your membership."
    />
  </section>
</div>

<style>
  .page-title {
    font-family: var(--font-heading);
    font-size: var(--text-5xl);
    font-weight: 400;
    margin: var(--space-sm) 0 var(--space-lg);
  }

  .membership-page {
    padding-bottom: var(--space-4xl);
  }

  .membership-page__intro {
    font-size: var(--text-lg);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    max-width: 620px;
  }

  .membership-page__pitch {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-xl);
    margin-top: var(--space-lg);
  }

  .pitch h3 {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: 600;
    margin-bottom: var(--space-sm);
  }

  .pitch p {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .tier-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-xl);
  }

  .tier-card {
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .tier-card--featured {
    border-color: var(--color-accent);
    box-shadow: var(--shadow-md);
  }

  .tier-card__badge {
    align-self: flex-start;
    margin-bottom: var(--space-sm);
    padding: 2px var(--space-sm);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-surface);
    background: var(--color-accent);
    border-radius: var(--radius-full);
  }

  .tier-card__name {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: 400;
  }

  .tier-card__price {
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    margin-top: var(--space-sm);
    color: var(--color-primary);
  }

  .tier-card__frequency {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .tier-card__tagline {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    margin-top: var(--space-sm);
  }

  .tier-card__benefits {
    margin: var(--space-md) 0 0;
    padding-left: var(--space-md);
    font-size: var(--text-sm);
    color: var(--color-text);
    line-height: var(--leading-relaxed);
  }

  .tier-card__benefits li {
    margin-bottom: var(--space-xs);
  }

  .tier-card__note {
    margin-top: auto;
    padding-top: var(--space-md);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-relaxed);
  }

  .membership-page__how {
    max-width: 640px;
  }

  .how-list {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    padding-left: var(--space-lg);
  }

  .how-list li {
    margin-bottom: var(--space-md);
  }

  .how-list strong {
    color: var(--color-text);
  }

  .error-msg {
    color: var(--color-error);
    font-size: var(--text-sm);
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
    .membership-page__pitch,
    .tier-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
