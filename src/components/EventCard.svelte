<script lang="ts">
  let {
    title,
    slug,
    date,
    location,
    tags,
    excerpt,
    endDate,
    href,
  }: {
    title: string;
    slug?: string;
    date?: string;
    location?: string;
    tags?: string[];
    excerpt?: string;
    endDate?: string;
    href?: string;
  } = $props();

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function isPast(d: string): boolean {
    return new Date(d) < new Date();
  }
</script>

<a
  class="event-card"
  href={href ?? `#/events/${slug ?? ''}`}
  class:event-card--past={date && isPast(date)}
>
  <div class="event-card__meta">
    {#if date}
      <time class="event-card__date" datetime={date}>
        {formatDate(date)}
        {#if endDate}
          &ndash; {formatDate(endDate)}
        {/if}
      </time>
    {/if}
    {#if location}
      <span class="event-card__location">{location}</span>
    {/if}
  </div>
  <h3 class="event-card__title">{title}</h3>
  {#if excerpt}
    <p class="event-card__excerpt">{excerpt}</p>
  {/if}
  {#if tags && tags.length > 0}
    <div class="cluster event-card__tags">
      {#each tags as tag (tag)}
        <span class="tag">{tag}</span>
      {/each}
    </div>
  {/if}
</a>

<style>
  .event-card {
    display: block;
    background: var(--color-surface);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-md);
    padding: var(--space-xl);
    text-decoration: none;
    color: inherit;
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease;
  }

  .event-card:hover {
    border-color: var(--color-border);
    box-shadow: var(--shadow-md);
  }

  .event-card--past {
    opacity: 0.6;
  }

  .event-card--past:hover {
    opacity: 0.8;
  }

  .event-card__meta {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin-bottom: var(--space-sm);
  }

  .event-card__date {
    font-weight: 500;
    color: var(--color-accent);
  }

  .event-card__location::before {
    content: '';
    display: inline-block;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--color-border);
    margin-right: var(--space-sm);
    vertical-align: middle;
  }

  .event-card__title {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: 400;
    margin-bottom: var(--space-sm);
  }

  .event-card__excerpt {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
    margin-bottom: var(--space-md);
  }

  .event-card__tags {
    gap: var(--space-xs);
  }
</style>
