<script lang="ts">
  import { onMount } from 'svelte';
  import EventCard from '../components/EventCard.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { fetchData } from '$lib/fetch.ts';

  interface IndexItem {
    slug: string;
    title: string;
    date: string;
    excerpt?: string;
    tags: string[];
    path: string;
    location?: string;
    endDate?: string;
  }

  interface ContentIndex {
    items: IndexItem[];
  }

  let events = $state<IndexItem[]>([]);
  let posts = $state<IndexItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    try {
      const [eventsData, postsData] = await Promise.all([
        fetchData<ContentIndex>('/data/events/index.json'),
        fetchData<ContentIndex>('/data/posts/index.json'),
      ]);

      // Upcoming events first, then past
      events = [...eventsData.items].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );

      // Most recent posts first
      posts = [...postsData.items]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 3);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<!-- Hero -->
<section class="hero section">
  <div class="container">
    <div class="hero__content">
      <p class="section__label">Chattanooga's AI Club</p>
      <h1 class="hero__title">
        Learn.<br />
        Build.<br />
        Connect.
      </h1>
      <p class="hero__subtitle">
        AI Nooga is a club for education, policy, research, and networking around
        artificial intelligence. We meet in person, in Chattanooga.
      </p>
      <div class="hero__actions">
        <a href="#/events" class="btn btn-primary">View events</a>
        <a href="#/about" class="btn btn-outline">About us</a>
      </div>
    </div>
  </div>
</section>

<!-- Featured event -->
<section class="section">
  <div class="container">
    <p class="section__label">Upcoming</p>
    <h2 class="section__title">Next event</h2>
    {#if loading}
      <div class="stack" style="gap: var(--space-md)">
        <Skeleton height="1.5rem" width="60%" />
        <Skeleton height="1rem" width="40%" />
        <Skeleton height="4rem" />
      </div>
    {:else if error}
      <p class="error-msg">
        Could not load events. <button onclick={load} class="link-btn">Retry</button>
      </p>
    {:else}
      {#each events as event (event.slug)}
        <EventCard {...event} />
      {/each}
    {/if}
  </div>
</section>

<!-- All events -->
<section class="section section-alt">
  <div class="container">
    <p class="section__label">Events</p>
    <h2 class="section__title">All events</h2>
    <div class="grid-2" style="margin-top: var(--space-xl)">
      {#if loading}
        {#each [1, 2, 3] as _, i (i)}
          <div class="card"><Skeleton height="6rem" /></div>
        {/each}
      {:else if error}
        <p class="error-msg">Could not load events.</p>
      {:else}
        {#each events as event (event.slug)}
          <EventCard {...event} />
        {/each}
      {/if}
    </div>
  </div>
</section>

<!-- Recent posts -->
<section class="section">
  <div class="container">
    <p class="section__label">Writing</p>
    <h2 class="section__title">Recent posts</h2>
    <div class="grid-3" style="margin-top: var(--space-xl)">
      {#if loading}
        {#each [1, 2, 3] as _, i (i)}
          <div class="card"><Skeleton height="8rem" /></div>
        {/each}
      {:else if error}
        <p class="error-msg">Could not load posts.</p>
      {:else}
        {#each posts as post (post.slug)}
          <a href="#/posts/{post.slug}" class="post-card card">
            <time class="post-card__date"
              >{new Date(post.date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}</time
            >
            <h3 class="post-card__title">{post.title}</h3>
            {#if post.excerpt}
              <p class="post-card__excerpt">{post.excerpt}</p>
            {/if}
          </a>
        {/each}
      {/if}
    </div>
    <div style="text-align: center; margin-top: var(--space-xl)">
      <a href="#/posts" class="btn btn-outline">All posts</a>
    </div>
  </div>
</section>

<!-- Sponsor bar -->
<section class="section section-alt">
  <div class="container">
    <p class="section__label">Sponsors</p>
    <h2 class="section__title">Supported by</h2>
    <p class="section__subtitle" style="margin-bottom: var(--space-xl)">
      AI Nooga is made possible by organizations and individuals who believe in
      Chattanooga's AI future.
    </p>
    <div class="sponsor-bar">
      <a
        href="https://enterprisecenter.org"
        class="sponsor-item"
        target="_blank"
        rel="noopener"
      >
        <span class="sponsor-item__name">Enterprise Center</span>
        <span class="sponsor-item__tier">Platinum</span>
      </a>
      <a href="#/sponsor" class="sponsor-item sponsor-item--cta">
        <span class="sponsor-item__name">Your name here</span>
        <span class="sponsor-item__tier">Become a sponsor &rarr;</span>
      </a>
    </div>
  </div>
</section>

<style>
  .hero {
    padding: var(--space-5xl) 0 var(--space-4xl);
  }

  .hero__content {
    max-width: 720px;
  }

  .hero__title {
    font-family: var(--font-heading);
    font-size: var(--text-6xl);
    font-weight: 400;
    line-height: var(--leading-tight);
    letter-spacing: -0.02em;
    margin-bottom: var(--space-lg);
    color: var(--color-text);
  }

  .hero__subtitle {
    font-size: var(--text-xl);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
    margin-bottom: var(--space-2xl);
    max-width: 540px;
  }

  .hero__actions {
    display: flex;
    gap: var(--space-md);
  }

  .post-card {
    text-decoration: none;
    color: inherit;
  }

  .post-card__date {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .post-card__title {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: 400;
    margin: var(--space-sm) 0;
  }

  .post-card__excerpt {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .sponsor-bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-md);
  }

  .sponsor-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    background: var(--color-surface);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-md);
    padding: var(--space-lg) var(--space-xl);
    text-decoration: none;
    transition: border-color 0.2s ease;
    min-width: 200px;
  }

  .sponsor-item:hover {
    border-color: var(--color-accent-subtle);
  }

  .sponsor-item--cta {
    border-style: dashed;
    border-color: var(--color-border);
  }

  .sponsor-item__name {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    color: var(--color-text);
  }

  .sponsor-item__tier {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--color-accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
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
    .hero__title {
      font-size: var(--text-4xl);
    }
    .hero__subtitle {
      font-size: var(--text-lg);
    }
  }
</style>
