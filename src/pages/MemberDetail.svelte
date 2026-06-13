<script lang="ts">
  import { onMount } from 'svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import NotFound from './NotFound.svelte';

  let { slug }: { slug: string } = $props();

  interface MemberDetail {
    title: string;
    role?: string;
    bio?: string;
    tags?: string[];
    links?: Record<string, string>;
  }

  let member = $state<MemberDetail | null>(null);
  let loading = $state(true);
  let error = $state<'notfound' | 'fetch' | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetch(`/data/members/${slug}.json`);
      if (res.status === 404) { error = 'notfound'; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      member = await res.json();
    } catch {
      error = 'fetch';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<div class="container-narrow member-detail">
  {#if loading}
    <div class="stack-lg" style="padding-top: var(--space-3xl)">
      <Skeleton height="4rem" width="4rem" />
      <Skeleton height="2rem" width="40%" />
      <Skeleton height="10rem" />
    </div>
  {:else if error === 'notfound'}
    <NotFound />
  {:else if error === 'fetch'}
    <div class="error-state">
      <p class="error-msg">Could not load member. <button onclick={load} class="link-btn">Retry</button></p>
    </div>
  {:else if member}
    <div class="member-detail__header">
      <div class="member-detail__avatar">
        {member.title.charAt(0).toUpperCase()}
      </div>
      <h1 class="member-detail__name">{member.title}</h1>
      {#if member.role}
        <p class="member-detail__role">{member.role}</p>
      {/if}
      {#if member.tags && member.tags.length > 0}
        <div class="cluster" style="margin-top: var(--space-sm)">
          {#each member.tags as tag}
            <span class="tag">{tag}</span>
          {/each}
        </div>
      {/if}
    </div>
    {#if member.links}
      <div class="member-detail__links" style="margin-top: var(--space-lg)">
        {#each Object.entries(member.links) as [label, url]}
          <a href={url} class="member-detail__link" target="_blank" rel="noopener">{label}</a>
        {/each}
      </div>
    {/if}
    {#if member.bio}
      <hr class="divider" />
      <div class="member-detail__bio">{member.bio}</div>
    {/if}
    <div style="margin-top: var(--space-2xl)">
      <a href="#/members" class="btn btn-outline">&larr; All members</a>
    </div>
  {/if}
</div>

<style>
  .member-detail {
    padding-top: var(--space-3xl);
    padding-bottom: var(--space-4xl);
  }

  .member-detail__avatar {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: var(--color-accent-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    color: var(--color-accent);
    margin-bottom: var(--space-lg);
  }

  .member-detail__name {
    font-family: var(--font-heading);
    font-size: var(--text-4xl);
    font-weight: 400;
  }

  .member-detail__role {
    font-size: var(--text-lg);
    color: var(--color-text-secondary);
    margin-top: var(--space-xs);
  }

  .member-detail__links {
    display: flex;
    gap: var(--space-md);
    flex-wrap: wrap;
  }

  .member-detail__link {
    font-size: var(--text-sm);
    color: var(--color-accent);
  }

  .member-detail__bio {
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text);
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
