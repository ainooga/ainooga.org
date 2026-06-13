<script lang="ts">
  import { onMount } from 'svelte';
  import Home from './pages/Home.svelte';
  import EventList from './pages/EventList.svelte';
  import EventDetail from './pages/EventDetail.svelte';
  import PostList from './pages/PostList.svelte';
  import PostDetail from './pages/PostDetail.svelte';
  import MemberList from './pages/MemberList.svelte';
  import MemberDetail from './pages/MemberDetail.svelte';
  import Sponsor from './pages/Sponsor.svelte';
  import About from './pages/About.svelte';
  import NotFound from './pages/NotFound.svelte';

  type Route = {
    page: string;
    params: Record<string, string>;
  };

  let route = $state<Route>({ page: '', params: {} });

  function parseHash(): Route {
    const hash = window.location.hash.replace(/^#/, '') || '/';
    const parts = hash.split('/').filter(Boolean);

    // /events/train-llm-from-scratch → { page: 'events/:slug', params: { slug: 'train-llm-from-scratch' } }
    if (parts[0] === 'events' && parts[1]) {
      return { page: 'events/:slug', params: { slug: parts[1] } };
    }
    if (parts[0] === 'posts' && parts[1]) {
      return { page: 'posts/:slug', params: { slug: parts[1] } };
    }
    if (parts[0] === 'members' && parts[1]) {
      return { page: 'members/:slug', params: { slug: parts[1] } };
    }

    const page = parts[0] || 'home';
    return { page, params: {} };
  }

  function onHashChange() {
    route = parseHash();
    // Focus management: move focus to main heading
    const h1 = document.querySelector('main h1');
    if (h1) (h1 as HTMLElement).focus();
  }

  onMount(() => {
    onHashChange();
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  });
</script>

{#key route.page + JSON.stringify(route.params)}
  {#if route.page === 'home'}
    <Home />
  {:else if route.page === 'events'}
    <EventList />
  {:else if route.page === 'events/:slug'}
    <EventDetail slug={route.params.slug ?? ''} />
  {:else if route.page === 'posts'}
    <PostList />
  {:else if route.page === 'posts/:slug'}
    <PostDetail slug={route.params.slug ?? ''} />
  {:else if route.page === 'members'}
    <MemberList />
  {:else if route.page === 'members/:slug'}
    <MemberDetail slug={route.params.slug ?? ''} />
  {:else if route.page === 'sponsor'}
    <Sponsor />
  {:else if route.page === 'about'}
    <About />
  {:else}
    <NotFound />
  {/if}
{/key}
