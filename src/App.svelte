<script lang="ts">
  import './app.css';
  import SiteHeader from './components/SiteHeader.svelte';
  import SiteFooter from './components/SiteFooter.svelte';
  import Router from './Router.svelte';
  import { onMount } from 'svelte';

  let mounted = $state(false);

  onMount(() => {
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
