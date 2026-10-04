<script lang="ts">
  import './app.css';
  import SiteHeader from './components/SiteHeader.svelte';
  import SiteFooter from './components/SiteFooter.svelte';
  import Router from './Router.svelte';
  import { BrowserTurnstile, type TurnstileService } from '$lib/turnstile.js';
  import { setTurnstileService } from '$lib/context.js';

  import { BrowserPollService } from '$lib/polls/api';
  import { BrowserPollRuntime } from '$lib/polls/runtime';
  import { setPollServices } from '$lib/polls/context';

  const turnstile: TurnstileService = new BrowserTurnstile(
    import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '',
  );
  setTurnstileService(turnstile);
  setPollServices({ api: new BrowserPollService(), runtime: new BrowserPollRuntime() });
</script>

<a href="#main" class="skip-link">Skip to main content</a>
<SiteHeader />
<main id="main">
  <Router />
</main>
<SiteFooter />
