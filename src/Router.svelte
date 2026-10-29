<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    ROUTE_CHANGE_EVENT,
    isSpaNavigation,
    legacyHashPath,
    parseRoute,
    type Route,
  } from '$lib/routing';
  import Home from './pages/Home.svelte';
  import Poll from './pages/Poll.svelte';
  import EventList from './pages/EventList.svelte';
  import EventDetail from './pages/EventDetail.svelte';
  import PostList from './pages/PostList.svelte';
  import PostDetail from './pages/PostDetail.svelte';
  import MemberList from './pages/MemberList.svelte';
  import MemberDetail from './pages/MemberDetail.svelte';
  import Sponsor from './pages/Sponsor.svelte';
  import About from './pages/About.svelte';
  import NotFound from './pages/NotFound.svelte';

  let route = $state<Route>({ page: '', params: {} });

  async function onRouteChange() {
    route = parseRoute(window.location.pathname);
    window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
    await tick();
    // Focus management: move focus to main heading
    const h1 = document.querySelector('main h1');
    if (h1) (h1 as HTMLElement).focus();
  }

  function navigate(path: string) {
    window.history.pushState(null, '', path);
    window.scrollTo(0, 0);
    void onRouteChange();
  }

  function isPlainClick(event: MouseEvent): boolean {
    return (
      !event.defaultPrevented &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    );
  }

  function onClick(event: MouseEvent) {
    const anchor = (event.target as Element | null)?.closest('a');
    if (!anchor || !isPlainClick(event)) return;
    if (
      anchor.hasAttribute('download') ||
      (anchor.target !== '' && anchor.target !== '_self')
    ) {
      return;
    }
    const target = new URL(anchor.href, window.location.href);
    if (!isSpaNavigation(target, new URL(window.location.href))) return;
    event.preventDefault();
    navigate(target.pathname + target.search + target.hash);
  }

  function onHashChange() {
    const legacy = legacyHashPath(window.location.hash);
    if (legacy === null) return;
    window.history.replaceState(null, '', legacy);
    void onRouteChange();
  }

  function onPopState() {
    void onRouteChange();
  }

  onMount(() => {
    void onRouteChange();
    document.addEventListener('click', onClick);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onHashChange);
    };
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
  {:else if route.page === 'polls/:slug'}
    <Poll slug={route.params.slug ?? ''} />
  {:else if route.page === 'sponsor'}
    <Sponsor />
  {:else if route.page === 'about'}
    <About />
  {:else}
    <NotFound />
  {/if}
{/key}
