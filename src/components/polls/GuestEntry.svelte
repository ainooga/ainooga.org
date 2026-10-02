<script lang="ts">
  import { onMount } from 'svelte';
  import { getTurnstileService } from '$lib/context';
  import { getPollServices } from '$lib/polls/context';
  import type { PollPage } from '$lib/polls/page.svelte';
  let { page }: { page: PollPage } = $props();
  const turnstile = getTurnstileService();
  const { runtime } = getPollServices();
  let value = $state('');
  let token = $state('');
  let problem = $state('');
  let container: HTMLDivElement;
  let widget: string | null = null;
  let disposed = false;
  const username = $derived(page.phase === 'discord');
  function mountWidget() {
    try {
      widget = turnstile.render(
        container,
        {
          onToken: (next) => {
            if (!disposed) {
              token = next;
              problem = '';
            }
          },
          onExpired: () => {
            token = '';
          },
          onError: () => {
            token = '';
            problem = 'Verification could not load. Please retry.';
          },
          onTimeout: () => {
            token = '';
            problem = 'Verification timed out. Please retry.';
          },
        },
        'poll-auth',
      );
    } catch {
      problem = 'Verification could not load. Please retry.';
    }
  }
  function reset() {
    token = '';
    problem = '';
    if (widget !== null) turnstile.reset(widget);
    else mountWidget();
  }
  const focus = (element: HTMLElement) => runtime.focus(element);
  onMount(() => {
    mountWidget();
    const started = runtime.now();
    const stop = runtime.everySecond(() => {
      if (widget !== null) return;
      if (runtime.now() - started >= 10000) {
        problem = 'Verification could not load. Please retry.';
        stop();
      } else mountWidget();
    });
    return () => {
      disposed = true;
      stop();
      if (widget !== null) turnstile.remove(widget);
    };
  });
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (token === '' || page.busy) return;
    const proof = token;
    token = '';
    await page.identify({ kind: username ? 'discord_username' : 'email', value }, proof);
    if (!disposed) reset();
  }
</script>

<div class="poll-entry">
  <h1 use:focus tabindex="-1">Enter the poll</h1>
  {#if username}
    <p>Didn't see you on the guest list. Try your Discord username?</p>
  {:else}
    <p>Enter the email you use with the chapter to find your place on the guest list.</p>
  {/if}
  <form onsubmit={submit} aria-busy={page.busy}>
    <label for="poll-identifier">{username ? 'Discord username' : 'Email'}</label>
    <input
      id="poll-identifier"
      type={username ? 'text' : 'email'}
      bind:value
      required
      maxlength={username ? 32 : 254}
      autocomplete={username ? 'username' : 'email'}
      disabled={page.busy}
    />
    {#if username}<p class="poll-note">
        Use your account username, not your display name or server nickname.
      </p>{/if}
    <div bind:this={container}></div>
    {#if problem}<p role="alert">{problem}</p>
      <button type="button" class="btn btn-outline" onclick={reset}
        >Retry verification</button
      >{/if}
    {#if page.message}<p role="alert">{page.message}</p>{/if}
    <div class="poll-actions">
      <button type="submit" class="btn btn-primary" disabled={page.busy || token === ''}
        >{page.busy ? 'Checking…' : 'Continue'}</button
      >
      {#if username}<button
          type="button"
          class="btn btn-outline"
          disabled={page.busy}
          onclick={() => page.retryEmail()}>Correct my email</button
        >{/if}
    </div>
  </form>
</div>
