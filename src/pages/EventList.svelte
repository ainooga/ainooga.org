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

  let upcoming = $state<IndexItem[]>([]);
  let past = $state<IndexItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    try {
      const data = await fetchData<ContentIndex>('/data/events/index.json');
      const now = new Date();
      upcoming = data.items
        .filter((e) => new Date(e.date) >= now)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      past = data.items
        .filter((e) => new Date(e.date) < now)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<div class="container page">
  <h1 class="page-title">Events</h1>
  {#if loading}
    <div class="stack-lg">
      <Skeleton height="2rem" width="200px" />
      <Skeleton height="6rem" />
      <Skeleton height="6rem" />
    </div>
  {:else if error}
    <p class="error-msg">
      Could not load events. <button onclick={load} class="link-btn">Retry</button>
    </p>
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
  .events-section + .events-section {
    margin-top: var(--space-2xl);
  }

  .empty-msg {
    color: var(--color-text-muted);
    text-align: center;
  }
</style>
