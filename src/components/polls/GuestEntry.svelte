<script lang="ts">
  import Verification from './Verification.svelte';
  import { getPollServices } from '$lib/polls/context';
  import type { PollPage } from '$lib/polls/page.svelte';
  let { page }: { page: PollPage } = $props();
  const { runtime } = getPollServices();
  let value = $state('');
  let token = $state('');
  let verification = $state<{ reset(): void }>();
  const username = $derived(page.phase === 'discord');
  const focus = (element: HTMLElement) => runtime.focus(element);
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (token === '' || page.busy) return;
    const proof = token;
    token = '';
    await page.identify({ kind: username ? 'discord_username' : 'email', value }, proof);
    verification?.reset();
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
    <Verification bind:this={verification} bind:token />
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
