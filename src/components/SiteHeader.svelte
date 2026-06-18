<script lang="ts">
  import { onMount } from 'svelte';

  const navItems = [
    { label: 'Events', path: '/events' },
    { label: 'Posts', path: '/posts' },
    { label: 'Members', path: '/members' },
    { label: 'Sponsor', path: '/sponsor' },
    { label: 'About', path: '/about' },
  ];

  let scrolled = $state(false);

  function onScroll() {
    scrolled = window.scrollY > 20;
  }

  onMount(() => {
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });

  function isActive(path: string): boolean {
    return (
      window.location.hash === `#${path}` || window.location.hash.startsWith(`#${path}/`)
    );
  }
</script>

<header class="site-header" class:site-header--scrolled={scrolled}>
  <div class="container site-header__inner">
    <a href="#home" class="site-header__logo" aria-label="AI Nooga home">
      <span class="site-header__mark">AI</span>
      <span class="site-header__name">AI Nooga</span>
    </a>
    <nav class="site-header__nav" aria-label="Main navigation">
      {#each navItems as item (item.path)}
        <a
          href="#{item.path}"
          class="site-header__link"
          class:site-header__link--active={isActive(item.path)}
        >
          {item.label}
        </a>
      {/each}
    </nav>
  </div>
</header>

<style>
  .site-header {
    position: sticky;
    top: 0;
    z-index: 100;
    background: rgba(251, 249, 246, 0.92);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-bottom: 1px solid transparent;
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease;
  }

  .site-header--scrolled {
    border-bottom-color: var(--color-border-light);
    box-shadow: var(--shadow-sm);
  }

  .site-header__inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--header-h);
  }

  .site-header__logo {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    text-decoration: none;
    color: var(--color-text);
  }

  .site-header__mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: var(--color-primary);
    color: var(--color-surface);
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: 600;
    font-style: italic;
    border-radius: var(--radius-sm);
  }

  .site-header__name {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: 400;
    letter-spacing: -0.01em;
  }

  .site-header__nav {
    display: flex;
    align-items: center;
    gap: var(--space-lg);
  }

  .site-header__link {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-secondary);
    text-decoration: none;
    padding: var(--space-xs) 0;
    border-bottom: 2px solid transparent;
    transition:
      color 0.15s ease,
      border-color 0.15s ease;
  }

  .site-header__link:hover {
    color: var(--color-text);
  }

  .site-header__link--active {
    color: var(--color-text);
    border-bottom-color: var(--color-accent);
  }

  @media (max-width: 640px) {
    .site-header__name {
      display: none;
    }
    .site-header__nav {
      gap: var(--space-md);
    }
    .site-header__link {
      font-size: var(--text-xs);
    }
  }
</style>
