<script lang="ts">
  import { onMount } from 'svelte';
  import EventCard from '../components/EventCard.svelte';
  import Skeleton from '../components/Skeleton.svelte';

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

  let upcoming = $state<IndexItem[]>([]);
  let past = $state<IndexItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    try {
      const res = await fetch('/data/events/index.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ContentIndex = await res.json();
      const now = new Date();
      upcoming = data.items.filter((e) => new Date(e.date) >= now)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      past = data.items.filter((e) => new Date(e.date) < now)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<h1 class="page-title container">Events</h1>

<div class="container">
  {#if loading}
    <div class="stack-lg">
      <Skeleton height="2rem" width="200px" />
      <Skeleton height="6rem" />
      <Skeleton height="6rem" />
    </div>
  {:else if error}
    <p class="error-msg">Could not load events. <button onclick={load} class="link-btn">Retry</button></p>
  {:else}
    {#if upcoming.length > 0}
      <section class="events-section">
        <p class="section__label">Upcoming</p>
        <div class="grid-2" style="margin-top: var(--space-md)">
          {#each upcoming as event (event.slug)}
            <EventCard {...event} />
          {/each}
        </div>
      </section>
    {/if}

    {#if past.length > 0}
      <section class="events-section">
        <p class="section__label">Past</p>
        <div class="grid-2" style="margin-top: var(--space-md)">
          {#each past as event (event.slug)}
            <EventCard {...event} />
          {/each}
        </div>
      </section>
    {/if}

    {#if upcoming.length === 0 && past.length === 0}
      <p class="empty-msg">No events yet. Check back soon.</p>
    {/if}
  {/if}
</div>

<style>
  .page-title {
    font-family: var(--font-heading);
    font-size: var(--text-5xl);
    font-weight: 400;
    padding-top: var(--space-3xl);
    margin-bottom: 0;
  }

  .events-section {
    padding: var(--space-2xl) 0;
  }

  .events-section:last-child {
    padding-bottom: var(--space-4xl);
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

  .empty-msg {
    color: var(--color-text-muted);
    text-align: center;
    padding: var(--space-4xl) 0;
  }
</style>
