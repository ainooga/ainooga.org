<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Skeleton from '../components/Skeleton.svelte';
  import GuestEntry from '../components/polls/GuestEntry.svelte';
  import Ballot from '../components/polls/Ballot.svelte';
  import Results from '../components/polls/Results.svelte';
  import { getPollServices } from '$lib/polls/context';
  import { PollPage } from '$lib/polls/page.svelte';
  import { dateLabel, descriptionHtml } from '$lib/polls/display';
  import '../components/polls/polls.css';
  let { slug }: { slug: string } = $props();
  const { api, runtime } = getPollServices();
  const page = untrack(() => new PollPage(slug, api));
  let now = $state(runtime.now());
  const description = $derived(descriptionHtml(page.detail?.description ?? ''));
  const focus = (element: HTMLElement) => runtime.focus(element);
  onMount(() => {
    page.load();
    const stop = runtime.everySecond(() => {
      now = runtime.now();
    });
    return () => {
      stop();
      page.dispose();
    };
  });
</script>

<div class="poll-page">
  {#if page.phase === 'loading'}
    <h1 use:focus tabindex="-1">Loading poll…</h1>
    <Skeleton />
    <p role="status">Checking access.</p>
  {:else if page.phase === 'email' || page.phase === 'discord'}
    {#key page.phase}<GuestEntry {page} />{/key}
  {:else if page.phase === 'sorry'}
    <h1 use:focus tabindex="-1">Sorry, we couldn't find you</h1>
    <p>
      We couldn't match your details to this poll's guest list. Email <a
        href="mailto:contact@ainooga.org">contact@ainooga.org</a
      > for help.
    </p>
    <button class="btn btn-outline" onclick={() => page.retryEmail()}>Try again</button>
  {:else if page.phase === 'missing'}
    <h1 use:focus tabindex="-1">Poll not found</h1>
    <p>This poll is unavailable. Please check the link with its organizer.</p>
  {:else if page.phase === 'unsupported'}
    <h1 use:focus tabindex="-1">This poll requires verified sign-in</h1>
    <p>
      This page currently supports guest-list entry without verification. Contact <a
        href="mailto:contact@ainooga.org">contact@ainooga.org</a
      > for help.
    </p>
  {:else if page.phase === 'error'}
    <h1 use:focus tabindex="-1">Could not open the poll</h1>
    <p role="alert">{page.message}</p>
    <div class="poll-actions">
      <button class="btn btn-primary" onclick={() => page.load()}>Retry</button><button
        class="btn btn-outline"
        onclick={() => page.logout()}>Use another email</button
      >
    </div>
  {:else if page.detail !== null}
    <h1 use:focus tabindex="-1">{page.detail.title}</h1>
    <div class="poll-description">
      <!-- Only the output of the restricted Markdown sanitizer reaches this sink. -->
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html description}
    </div>
    <p>Voting: {dateLabel(page.detail.startsAt)} – {dateLabel(page.detail.endsAt)}</p>
    {#if page.detail.allowEdits}<p>
        You may edit your vote before {dateLabel(
          page.detail.editDeadline ?? page.detail.endsAt,
        )}.
      </p>{/if}
    {#if page.message}<p role="alert">{page.message}</p>{/if}
    <Ballot {page} {now} />
    <Results {page} />
    <button class="btn btn-outline" disabled={page.busy} onclick={() => page.logout()}
      >Use another email</button
    >
  {/if}
</div>
