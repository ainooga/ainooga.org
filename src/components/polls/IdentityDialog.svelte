<script lang="ts">
  import { onMount } from 'svelte';
  import type { BallotForm } from '$lib/polls/ballot.svelte';
  import { getPollServices } from '$lib/polls/context';
  import Verification from './Verification.svelte';
  let { form }: { form: BallotForm } = $props();
  const { runtime } = getPollServices();
  const identity = $derived(form.identity);
  const busy = $derived(identity.busy || form.busy);
  const label = $derived(
    identity.target?.voter.kind === 'discord'
      ? `Discord ${identity.target.voter.value}`
      : identity.target?.voter.value,
  );
  let dialog: HTMLDialogElement;
  let email = $state('');
  let token = $state('');
  let verification = $state<{ reset(): void }>();
  onMount(() => runtime.openDialog(dialog));
  async function submitEmail(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !token) return;
    const proof = token;
    token = '';
    await identity.enterEmail(email, proof);
    verification?.reset();
  }
</script>

<dialog
  bind:this={dialog}
  class="poll-identity-dialog"
  aria-labelledby="identity-title"
  oncancel={(event) => {
    event.preventDefault();
    identity.dismiss();
  }}
>
  <h2 id="identity-title">Confirm your voter identity</h2>
  {#if identity.stage === 'email'}
    <form onsubmit={submitEmail} aria-busy={busy}>
      <label for="vote-email">What email should this vote use?</label>
      <input
        id="vote-email"
        type="email"
        bind:value={email}
        required
        maxlength="254"
        autocomplete="email"
        disabled={busy}
      />
      <p>
        If this email already has a vote, submitting will replace it if edits are still
        allowed.
      </p>
      <Verification bind:this={verification} bind:token />
      <button class="btn btn-primary" disabled={busy || !token}
        >Submit as this email</button
      >
    </form>
  {:else if identity.stage === 'submitting'}
    {#if form.message}<p role="status">{form.message}</p>{/if}
    <button class="btn btn-primary" disabled={busy} onclick={() => form.submit()}>
      {busy ? 'Saving…' : 'Retry same vote'}
    </button>
  {:else if identity.target !== null}
    <p>You switched to {label} after starting this. Do you want to submit as {label}?</p>
    {#if identity.target.ballot !== null}<p>
        This will replace this voter’s existing vote, if edits are still allowed.
      </p>{/if}
    <div class="poll-actions">
      <button class="btn btn-primary" disabled={busy} onclick={() => identity.confirm()}
        >Yes</button
      >
      <button
        class="btn btn-outline"
        disabled={busy}
        onclick={() => {
          identity.stage = 'email';
          identity.message = '';
        }}>No</button
      >
    </div>
  {:else}
    <p role="status">
      {busy ? 'Checking the current voter…' : 'Could not load the current voter.'}
    </p>
    <button class="btn btn-outline" disabled={busy} onclick={() => identity.load()}
      >Retry voter check</button
    >
  {/if}
  {#if identity.message}<p role="alert">{identity.message}</p>{/if}
  <button class="btn btn-outline" disabled={busy} onclick={() => identity.dismiss()}
    >Cancel</button
  >
</dialog>
