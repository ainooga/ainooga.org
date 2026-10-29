<script lang="ts">
  import { onMount } from 'svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { fetchData } from '$lib/fetch.ts';

  interface IndexItem {
    slug: string;
    title: string;
    tags: string[];
    path: string;
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

<div class="container page">
  <h1 class="page-title">Members</h1>
  {#if loading}
    <div class="grid-3">
      {#each [1, 2, 3, 4, 5, 6] as _, i (i)}
        <div class="card"><Skeleton height="6rem" /></div>
      {/each}
    </div>
  {:else if error}
    <p class="error-msg">
      Could not load members. <button onclick={load} class="link-btn">Retry</button>
    </p>
  {:else}
    <div class="grid-3">
      {#each members as member (member.slug)}
        <a href="/members/{member.slug}" class="member-card card">
          <div class="member-card__avatar">
            {member.title.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 class="member-card__name">{member.title}</h3>
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
</style>
