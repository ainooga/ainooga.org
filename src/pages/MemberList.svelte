<script lang="ts">
  import { onMount } from 'svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { fetchData } from '$lib/fetch.ts';

  interface IndexItem {
    slug: string;
    title: string;
    tags: string[];
    path: string;
    listed?: boolean;
    rank?: string;
    organizer?: boolean;
  }

  interface ContentIndex {
    items: IndexItem[];
  }

  let members = $state<IndexItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    try {
      const data = await fetchData<ContentIndex>('/data/members/index.json');
      members = data.items;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<h1 class="page-title container">Members</h1>

<div class="container">
  {#if loading}
    <div class="grid-3" style="margin-top: var(--space-xl)">
      {#each [1, 2, 3, 4, 5, 6] as _, i (i)}
        <div class="card"><Skeleton height="6rem" /></div>
      {/each}
    </div>
  {:else if error}
    <p class="error-msg">
      Could not load members. <button onclick={load} class="link-btn">Retry</button>
    </p>
  {:else}
    <div
      class="grid-3"
      style="margin-top: var(--space-xl); padding-bottom: var(--space-4xl)"
    >
      {#each members as member (member.slug)}
        <a href="#/members/{member.slug}" class="member-card card">
          <div class="member-card__avatar">
            {member.title.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 class="member-card__name">{member.title}</h3>
            {#if member.listed && member.rank}
              <p class="member-card__rank">{member.rank}</p>
            {/if}
            {#if member.listed && member.organizer}
              <span class="member-card__organizer-tag">Organizer</span>
            {/if}
            {#if member.tags && member.tags.length > 0}
              <div class="cluster" style="margin-top: var(--space-xs)">
                {#each member.tags.slice(0, 3) as tag (tag)}
                  <span class="tag">{tag}</span>
                {/each}
              </div>
            {/if}
          </div>
        </a>
      {/each}
    </div>
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

  .member-card {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    text-decoration: none;
    color: inherit;
  }

  .member-card__avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--color-accent-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    color: var(--color-accent);
    flex-shrink: 0;
  }

  .member-card__name {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: 400;
  }

  .member-card__rank {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin-top: 2px;
  }

  .member-card__organizer-tag {
    display: inline-block;
    margin-top: var(--space-xs);
    padding: 2px var(--space-sm);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-accent);
    background: var(--color-accent-subtle);
    border-radius: var(--radius-full);
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
</style>
