<script lang="ts">
  import { onMount } from 'svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import NotFound from './NotFound.svelte';
  import { fetchData } from '$lib/fetch';
  import { formatEventRange } from '$lib/utils';

  let { slug }: { slug: string } = $props();

  interface EventDetail {
    title: string;
    date: string;
    endDate?: string;
    location: string;
    tags: string[];
    bodyHtml: string;
    excerpt?: string;
  }

  let event = $state<EventDetail | null>(null);
  let loading = $state(true);
  let error = $state<'notfound' | 'fetch' | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      event = await fetchData<EventDetail>(`/data/events/${slug}.json`);
    } catch (err) {
      if (err instanceof Error && err.message.includes('HTTP 404')) {
        error = 'notfound';
      } else {
        error = 'fetch';
      }
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<div class="container-narrow event-detail">
  {#if loading}
    <div class="stack-lg" style="padding-top: var(--space-3xl)">
      <Skeleton height="1rem" width="120px" />
      <Skeleton height="2.5rem" width="80%" />
      <Skeleton height="1rem" width="50%" />
      <Skeleton height="20rem" />
    </div>
  {:else if error === 'notfound'}
    <NotFound />
  {:else if error === 'fetch'}
    <div class="error-state container">
      <p class="error-msg">
        Could not load event. <button onclick={load} class="link-btn">Retry</button>
      </p>
    </div>
  {:else if event}
    <div class="event-detail__header">
      <p class="section__label">
        {formatEventRange(event.date, event.endDate)}
      </p>
      <h1 class="event-detail__title">{event.title}</h1>
      <p class="event-detail__location">{event.location}</p>
      {#if event.tags && event.tags.length > 0}
        <div class="cluster" style="margin-top: var(--space-md)">
          {#each event.tags as tag (tag)}
            <span class="tag">{tag}</span>
          {/each}
        </div>
      {/if}
    </div>
    <hr class="divider" />
    <div class="event-detail__body">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html event.bodyHtml}
    </div>
    <div style="margin-top: var(--space-2xl)">
      <a href="#/events" class="btn btn-outline">&larr; All events</a>
    </div>
  {/if}
</div>

<style>
  .event-detail {
    padding-top: var(--space-3xl);
    padding-bottom: var(--space-4xl);
  }

  .event-detail__header {
    margin-bottom: var(--space-lg);
  }

  .event-detail__title {
    font-family: var(--font-heading);
    font-size: var(--text-4xl);
    font-weight: 400;
    line-height: var(--leading-tight);
    margin: var(--space-sm) 0;
  }

  .event-detail__location {
    font-size: var(--text-lg);
    color: var(--color-text-secondary);
  }

  .event-detail__body {
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text);
  }

  .event-detail__body :global(h2) {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    margin-top: var(--space-2xl);
    margin-bottom: var(--space-md);
  }

  .event-detail__body :global(h3) {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    margin-top: var(--space-xl);
    margin-bottom: var(--space-sm);
  }

  .event-detail__body :global(p) {
    margin-bottom: var(--space-md);
  }

  .event-detail__body :global(ul),
  .event-detail__body :global(ol) {
    margin-bottom: var(--space-md);
    padding-left: var(--space-xl);
  }

  .event-detail__body :global(li) {
    margin-bottom: var(--space-sm);
  }

  .event-detail__body :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: var(--space-lg) 0;
  }

  .event-detail__body :global(th),
  .event-detail__body :global(td) {
    padding: var(--space-sm) var(--space-md);
    text-align: left;
    border-bottom: 1px solid var(--color-border-light);
    font-size: var(--text-sm);
  }

  .event-detail__body :global(th) {
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .event-detail__body :global(blockquote) {
    border-left: 3px solid var(--color-accent);
    padding-left: var(--space-lg);
    color: var(--color-text-secondary);
    font-style: italic;
    margin: var(--space-lg) 0;
  }

  .event-detail__body :global(code) {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    background: var(--color-surface-alt);
    padding: 2px var(--space-xs);
    border-radius: var(--radius-sm);
  }

  .event-detail__body :global(pre code) {
    display: block;
    padding: var(--space-md);
    overflow-x: auto;
  }

  .error-state {
    text-align: center;
    padding: var(--space-4xl) 0;
  }

  .error-msg {
    color: var(--color-error);
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
</style>
