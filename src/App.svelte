<script lang="ts">
  import './app.css';
  import SiteHeader from './components/SiteHeader.svelte';
  import SiteFooter from './components/SiteFooter.svelte';
  import Router from './Router.svelte';
  import { onMount } from 'svelte';
  import { BrowserTurnstile, type TurnstileService } from '$lib/turnstile.js';
  import { setTurnstileService } from '$lib/context.js';

  let mounted = $state(false);

  onMount(() => {
    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';
    const turnstile: TurnstileService = new BrowserTurnstile(siteKey);
    setTurnstileService(turnstile);
    mounted = true;
  });
</script>

{#if mounted}
  <a href="#main" class="skip-link">Skip to main content</a>
  <SiteHeader />
  <main id="main">
    <Router />
  </main>
  <SiteFooter />
{/if}
