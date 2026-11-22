<script lang="ts">
  import { tick } from 'svelte';
  import EventCard from './EventCard.svelte';
  import { groupEvents, type EventIndexItem } from '$lib/events';

  let { events, layout }: { events: EventIndexItem[]; layout: 'list' | 'grid' } =
    $props();
  let cardLayout = $derived(layout === 'grid' ? 'grid-2' : undefined);
  let { upcoming, past } = $derived(groupEvents(events));
  let pastLimit = $state(1);
  let nextBatch = $derived(Math.min(5, past.length - pastLimit));
  let pastList = $state<HTMLDivElement>();

  async function showMore() {
    const firstNew = pastLimit;
    pastLimit += nextBatch;
    await tick();
    pastList?.querySelectorAll('a')[firstNew]?.focus();
  }
</script>

{#if upcoming.length}
  <section class="events-section">
    <h2 class="section__title">Upcoming events</h2>
    <div class={cardLayout}>
      {#each upcoming as event (event.slug)}
        <EventCard {...event} />
      {/each}
    </div>
  </section>
{/if}

{#if past.length}
  <section class="events-section">
    <h2 class="section__title">Past events</h2>
    <div class={cardLayout} bind:this={pastList}>
      {#each past.slice(0, pastLimit) as event (event.slug)}
        <EventCard {...event} />
      {/each}
    </div>
    {#if nextBatch > 0}
      <button type="button" class="btn btn-outline show-more" onclick={showMore}>
        Show {nextBatch} more past {nextBatch === 1 ? 'event' : 'events'}
      </button>
    {/if}
  </section>
{/if}

{#if !upcoming.length && !past.length}
  <p class="empty-msg">No events yet. Check back soon.</p>
{/if}

<style>
  .events-section + .events-section {
    margin-top: var(--space-2xl);
  }

  .show-more {
    margin-top: var(--space-lg);
  }

  .empty-msg {
    color: var(--color-text-muted);
    text-align: center;
  }
</style>
