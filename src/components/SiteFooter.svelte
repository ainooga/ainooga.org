<script lang="ts">
  const year = new Date().getFullYear();
</script>

<footer class="site-footer">
  <div class="container site-footer__inner">
    <div class="site-footer__brand">
      <span class="site-footer__mark">AI</span>
      <span class="site-footer__name">AI Nooga</span>
    </div>
    <nav class="site-footer__nav" aria-label="Footer navigation">
      <a href="#/events">Events</a>
      <a href="#/posts">Posts</a>
      <a href="#/members">Members</a>
      <a href="#/sponsor">Sponsor</a>
      <a href="#/about">About</a>
    </nav>
    <p class="site-footer__copy">&copy; {year} AI Nooga. Chattanooga, Tennessee.</p>
  </div>
</footer>

<style>
  .site-footer {
    border-top: 1px solid var(--color-border-light);
    padding: var(--space-3xl) 0;
    margin-top: var(--space-4xl);
  }

  .site-footer__inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-lg);
    text-align: center;
  }

  .site-footer__brand {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .site-footer__mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: var(--color-primary);
    color: var(--color-surface);
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: 600;
    font-style: italic;
    border-radius: var(--radius-sm);
  }

  .site-footer__name {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    color: var(--color-text);
  }

  .site-footer__nav {
    display: flex;
    gap: var(--space-lg);
    flex-wrap: wrap;
    justify-content: center;
  }

  .site-footer__nav a {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .site-footer__nav a:hover {
    color: var(--color-accent);
  }

  .site-footer__copy {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>
