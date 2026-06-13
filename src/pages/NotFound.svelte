<script lang="ts">
</script>

<div class="not-found container">
  <div class="not-found__content">
    <span class="not-found__code">404</span>
    <h1 class="not-found__title">Page not found</h1>
    <p class="not-found__text">The page you're looking for doesn't exist or has been moved.</p>
    <a href="#/" class="btn btn-primary">Go home</a>
  </div>
</div>

<style>
  .not-found {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    text-align: center;
  }

  .not-found__content {
    max-width: 400px;
  }

  .not-found__code {
    font-family: var(--font-heading);
    font-size: 6rem;
    font-weight: 400;
    color: var(--color-border);
    display: block;
    line-height: 1;
    margin-bottom: var(--space-md);
  }

  .not-found__title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: 400;
    margin-bottom: var(--space-sm);
  }

  .not-found__text {
    color: var(--color-text-secondary);
    margin-bottom: var(--space-xl);
  }
</style>
