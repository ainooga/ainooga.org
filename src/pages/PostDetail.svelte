<script lang="ts">
  import { onMount } from 'svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import NotFound from './NotFound.svelte';

  let { slug }: { slug: string } = $props();

  interface PostDetail {
    title: string;
    date: string;
    author: string;
    tags: string[];
    bodyHtml: string;
    excerpt?: string;
  }

  let post = $state<PostDetail | null>(null);
  let loading = $state(true);
  let error = $state<'notfound' | 'fetch' | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetch(`/data/posts/${slug}.json`);
      if (res.status === 404) { error = 'notfound'; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      post = await res.json();
    } catch {
      error = 'fetch';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<div class="container-narrow post-detail">
  {#if loading}
    <div class="stack-lg" style="padding-top: var(--space-3xl)">
      <Skeleton height="1rem" width="120px" />
      <Skeleton height="2.5rem" width="80%" />
      <Skeleton height="20rem" />
    </div>
  {:else if error === 'notfound'}
    <NotFound />
  {:else if error === 'fetch'}
    <div class="error-state">
      <p class="error-msg">Could not load post. <button onclick={load} class="link-btn">Retry</button></p>
    </div>
  {:else if post}
    <div class="post-detail__header">
      <p class="section__label">{new Date(post.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
      <h1 class="post-detail__title">{post.title}</h1>
      {#if post.tags && post.tags.length > 0}
        <div class="cluster" style="margin-top: var(--space-md)">
          {#each post.tags as tag}
            <span class="tag">{tag}</span>
          {/each}
        </div>
      {/if}
    </div>
    <hr class="divider" />
    <div class="post-detail__body">
      {@html post.bodyHtml}
    </div>
    <div style="margin-top: var(--space-2xl)">
      <a href="#/posts" class="btn btn-outline">&larr; All posts</a>
    </div>
  {/if}
</div>

<style>
  .post-detail {
    padding-top: var(--space-3xl);
    padding-bottom: var(--space-4xl);
  }

  .post-detail__header {
    margin-bottom: var(--space-lg);
  }

  .post-detail__title {
    font-family: var(--font-heading);
    font-size: var(--text-4xl);
    font-weight: 400;
    line-height: var(--leading-tight);
    margin: var(--space-sm) 0;
  }

  .post-detail__body {
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text);
  }

  .post-detail__body :global(h2) {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    margin-top: var(--space-2xl);
    margin-bottom: var(--space-md);
  }

  .post-detail__body :global(h3) {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    margin-top: var(--space-xl);
    margin-bottom: var(--space-sm);
  }

  .post-detail__body :global(p) {
    margin-bottom: var(--space-md);
  }

  .post-detail__body :global(ul),
  .post-detail__body :global(ol) {
    margin-bottom: var(--space-md);
    padding-left: var(--space-xl);
  }

  .post-detail__body :global(li) {
    margin-bottom: var(--space-sm);
  }

  .post-detail__body :global(blockquote) {
    border-left: 3px solid var(--color-accent);
    padding-left: var(--space-lg);
    color: var(--color-text-secondary);
    font-style: italic;
    margin: var(--space-lg) 0;
  }

  .post-detail__body :global(code) {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    background: var(--color-surface-alt);
    padding: 2px var(--space-xs);
    border-radius: var(--radius-sm);
  }

  .post-detail__body :global(pre code) {
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
