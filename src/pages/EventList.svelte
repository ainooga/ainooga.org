<script lang="ts">
  import { onMount } from 'svelte';
  import EventSchedule from '../components/EventSchedule.svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { fetchData } from '$lib/fetch.ts';
  import type { EventIndexItem } from '$lib/events';

  let events = $state<EventIndexItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    try {
      const data = await fetchData<{ items: EventIndexItem[] }>(
        '/data/events/index.json',
      );
      events = data.items;
      error = null;
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
    <EventSchedule {events} layout="grid" />
  {/if}
</div>
