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
    tagline?: string;
    benefits?: string[];
    featured?: boolean;
    note?: string;
    order?: number;
    bodyHtml?: string;
  }

  let products = $state<ProductDetail[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  function sortProducts(a: ProductDetail, b: ProductDetail): number {
    return (a.order ?? 0) - (b.order ?? 0);
  }

  async function load() {
    try {
      const index = await fetchData<{ items: ProductIndexItem[] }>(
        '/data/products/index.json',
      );
      const adItems = index.items.filter((i) => i.family === 'advertising');

      const detailFetch = adItems.map((item) =>
        fetchData<ProductDetail>(item.path).then((d) => ({ ...d, order: d.order ?? 0 })),
      );

      const loaded = await Promise.all(detailFetch);
      products = loaded.sort(sortProducts);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<div class="container advertise-page">
  <p class="section__label" style="padding-top: var(--space-3xl)">Advertising</p>
  <h1 class="page-title">Get your message in front of the right people</h1>
  <p class="advertise-page__intro">
    If you've got a product, an open role, or a new service, the hard part isn't building
    it — it's getting in front of the people who'd care. AI Nooga events gather exactly
    that audience: working professionals and technologists in Chattanooga. Our advertising
    products put you in the room with them.
  </p>

  <hr class="divider" />

  <section class="section" style="padding-top: 0;">
    <p class="section__label">The model — read this first</p>
    <h2 class="section__title">You buy a period, not an airing</h2>
    <div class="model">
      <div class="model__card">
        <h3 class="model__title">Sold by period earmark</h3>
        <p class="model__text">
          You buy availability for a named period — say, <strong>Winter 2026</strong> — not
          a specific dated event. From the moment the period is offered, your placement or slot
          is yours.
        </p>
      </div>
      <div class="model__card">
        <h3 class="model__title">Fulfilled the moment it's offered</h3>
        <p class="model__text">
          Making the availability available <strong>is</strong> the product. Whether you use
          every rotation or slot is up to you — the opportunity is already delivered.
        </p>
      </div>
      <div class="model__card">
        <h3 class="model__title">No banking, no rollover</h3>
        <p class="model__text">
          When the period ends, the availability ends. Unused placements don't carry over,
          extend, or credit. That's what keeps inventory honest — and why we actively help
          you use it.
        </p>
      </div>
    </div>
    <p class="model__footnote">
      We'll nudge you to use every slot and help you schedule — but that's good service,
      not a condition of delivery. You buy a period of guaranteed availability, plain and
      simple.
    </p>
  </section>

  <hr class="divider" />

  <section class="section" style="padding-top: 0;">
    <p class="section__label">Products</p>
    <h2 class="section__title">Ways to reach the room</h2>

    {#if loading}
      <div class="stack" style="margin-top: var(--space-lg)">
        {#each [1, 2, 3] as _, i (i)}
          <div class="card"><Skeleton height="8rem" /></div>
        {/each}
      </div>
    {:else if error}
      <p class="error-msg">
        Could not load advertising products. <button onclick={load} class="link-btn"
          >Retry</button
        >
      </p>
    {:else}
      <div class="ad-list" style="margin-top: var(--space-lg)">
        {#each products as product (product.name)}
          <div class="card ad-card" class:ad-card--featured={product.featured}>
            {#if product.featured}
              <span class="ad-card__badge">Flagship</span>
            {/if}
            <div class="ad-card__body">
              <h3 class="ad-card__name">{product.name}</h3>
              {#if product.tagline}
                <p class="ad-card__tagline">{product.tagline}</p>
              {/if}
              {#if product.price}
                <p class="ad-card__price">{product.price}</p>
              {/if}
              {#if product.benefits && product.benefits.length > 0}
                <ul class="ad-card__benefits">
                  {#each product.benefits as benefit (benefit)}
                    <li>{benefit}</li>
                  {/each}
                </ul>
              {/if}
            </div>
            {#if product.note}
              <p class="ad-card__note">{product.note}</p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <hr class="divider" />

  <section class="section section-alt advertise-special">
    <div class="container-narrow">
      <p class="section__label">Special events</p>
      <h2 class="section__title">The biggest rooms we run</h2>
      <p class="advertise-page__intro">
        Beyond monthly workshops, AI Nooga runs higher-attention special events — demo
        days, job fairs and recruiting mixers, product launches, hackathons, and hiring
        days. These carry the most engaged audiences, and the flagship advertising package
        bundles participation in them.
      </p>
      <p class="advertise-page__intro">
        That's the point of a flagship: not just recurring workshop presence, but a seat
        at the events where the city shows up.
      </p>
      <a href="#/advertise" class="btn btn-primary">Talk to us about the flagship</a>
    </div>
  </section>

  <hr class="divider" />

  <section class="section" style="padding-top: 0; padding-bottom: var(--space-4xl)">
    <ContactForm
      endpoint="contact-sponsor"
      intro="Tell us a bit about your message and we'll call you back with current period availability and pricing."
      confirmFootnote="We'll call you back to talk advertising options."
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

  .advertise-page {
    padding-bottom: var(--space-4xl);
  }

  .advertise-page__intro {
    font-size: var(--text-lg);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    max-width: 640px;
  }

  .model {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-xl);
    margin-top: var(--space-lg);
    margin-bottom: var(--space-lg);
  }

  .model__card {
    background: var(--color-surface);
    border-left: 3px solid var(--color-accent);
    padding: var(--space-lg);
  }

  .model__title {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: 600;
    margin-bottom: var(--space-sm);
  }

  .model__text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .model__text strong {
    color: var(--color-text);
  }

  .model__footnote {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    line-height: var(--leading-relaxed);
    max-width: 720px;
  }

  .ad-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }

  .ad-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .ad-card--featured {
    border-color: var(--color-accent);
    box-shadow: var(--shadow-md);
  }

  .ad-card__badge {
    align-self: flex-start;
    padding: 2px var(--space-sm);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-surface);
    background: var(--color-accent);
    border-radius: var(--radius-full);
  }

  .ad-card__body {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-lg);
    align-items: start;
  }

  .ad-card__name {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: 400;
    margin-bottom: var(--space-xs);
  }

  .ad-card__tagline {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    margin-bottom: var(--space-sm);
  }

  .ad-card__price {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    color: var(--color-primary);
    white-space: nowrap;
  }

  .ad-card__benefits {
    grid-column: 1 / -1;
    margin: 0;
    padding-left: var(--space-md);
    font-size: var(--text-sm);
    color: var(--color-text);
    line-height: var(--leading-relaxed);
  }

  .ad-card__benefits li {
    margin-bottom: var(--space-xs);
  }

  .ad-card__note {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-relaxed);
  }

  .advertise-special {
    margin-top: var(--space-2xl);
    padding: var(--space-3xl) 0;
    border-radius: var(--radius-lg);
  }

  .advertise-special .btn {
    margin-top: var(--space-lg);
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
    .model {
      grid-template-columns: 1fr;
    }
    .ad-card__body {
      grid-template-columns: 1fr;
    }
  }
</style>
