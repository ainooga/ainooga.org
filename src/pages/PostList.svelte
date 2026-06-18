<script lang="ts">
  import { onMount } from 'svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import { fetchData } from '$lib/fetch.ts';

  interface IndexItem {
    slug: string;
    title: string;
    date: string;
    excerpt?: string;
    tags: string[];
    path: string;
  }

  interface ContentIndex {
    items: IndexItem[];
  }

  let posts = $state<IndexItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    try {
      const data = await fetchData<ContentIndex>('/data/posts/index.json');
      posts = data.items.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<h1 class="page-title container">Posts</h1>

<div class="container">
  {#if loading}
    <div class="stack-lg">
      <Skeleton height="2rem" width="200px" />
      {#each [1, 2, 3] as _, i (i)}
        <div class="card"><Skeleton height="6rem" /></div>
      {/each}
    </div>
  {:else if error}
    <p class="error-msg">
      Could not load posts. <button onclick={load} class="link-btn">Retry</button>
    </p>
  {:else}
    <div class="post-list" style="margin-top: var(--space-xl)">
      {#each posts as post (post.slug)}
        <a href="#/posts/{post.slug}" class="post-list__item card">
          <time class="post-list__date"
            >{new Date(post.date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}</time
          >
          <h2 class="post-list__title">{post.title}</h2>
          {#if post.excerpt}
            <p class="post-list__excerpt">{post.excerpt}</p>
          {/if}
          {#if post.tags && post.tags.length > 0}
            <div class="cluster" style="margin-top: var(--space-sm)">
              {#each post.tags as tag (tag)}
                <span class="tag">{tag}</span>
              {/each}
            </div>
          {/if}
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

  .post-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding-bottom: var(--space-4xl);
  }

  .post-list__item {
    text-decoration: none;
    color: inherit;
  }

  .post-list__date {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .post-list__title {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: 400;
    margin: var(--space-xs) 0;
  }

  .post-list__excerpt {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
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
