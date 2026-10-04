<script lang="ts">
  import IdentityDialog from './IdentityDialog.svelte';
  import { onDestroy, untrack } from 'svelte';
  import type { PollPage } from '$lib/polls/page.svelte';
  import { BallotForm } from '$lib/polls/ballot.svelte';
  import { getPollServices } from '$lib/polls/context';
  import { canEdit, dateLabel, selectionRule, votingState } from '$lib/polls/display';
  let { page, now }: { page: PollPage; now: number } = $props();
  const { runtime } = getPollServices();
  const form = untrack(() => new BallotForm(page, runtime));
  const poll = $derived(page.detail!);
  const state = $derived(votingState(poll, now));
  const editable = $derived(canEdit(poll, now));
  const choosing = $derived(
    !form.needsReload &&
      state === 'open' &&
      (poll.ballot === null || (form.editing && editable)),
  );
  const locked = $derived(form.busy || form.pending !== null || form.needsReload);
  const savedLabels = $derived(
    poll.options.filter((option) => poll.ballot?.optionIds.includes(option.id)),
  );
  const saveLabel = $derived(poll.ballot === null ? 'Submit vote' : 'Save changes');
  onDestroy(() => form.dispose());
</script>

<section class="poll-ballot" aria-label="Your ballot">
  {#if state === 'upcoming'}<p role="status">
      Voting opens {dateLabel(poll.startsAt)}.
    </p>{/if}
  {#if state === 'closed'}<p role="status">Voting is closed.</p>{/if}
  {#if poll.ballot !== null}
    <h2>Your saved vote</h2>
    {#if !form.needsReload}<ul>
        {#each savedLabels as option (option.id)}<li>{option.label}</li>{/each}
      </ul>{/if}
    {#if !editable}<p>Ballot edits are closed for this poll.</p>{/if}
    {#if editable && !form.editing && !form.needsReload}<button
        class="btn btn-outline"
        disabled={locked}
        onclick={() => form.startEdit()}>Edit vote</button
      >{/if}
  {/if}
  {#if choosing}
    <form
      onsubmit={(event) => {
        event.preventDefault();
        form.submit();
      }}
      aria-busy={form.busy}
    >
      <fieldset disabled={locked} class="poll-options">
        <legend>{selectionRule(poll)}</legend>
        {#each poll.options as option (option.id)}
          <label class="poll-option">
            <input
              type={poll.maxSelections === 1 ? 'radio' : 'checkbox'}
              name="poll-option"
              value={option.id}
              checked={form.selected.includes(option.id)}
              onchange={() => form.select(option.id, poll.maxSelections === 1)}
            />
            <span
              >{option.label}{#if option.origin === 'write_in'}<span class="poll-note"
                  >&nbsp;(write-in)</span
                >{/if}</span
            >
          </label>
        {/each}
        {#if poll.allowWriteIns}
          <label for="poll-write-in">Write in an option</label>
          <input
            id="poll-write-in"
            maxlength="200"
            bind:value={form.writeIn}
            oninput={(event) => {
              if (poll.maxSelections === 1 && event.currentTarget.value.trim() !== '')
                form.selected = [];
            }}
          />
          <p class="poll-note">
            You can add one new option per poll. Accepted write-ins become choices for
            everyone eligible to vote.
          </p>
        {/if}
      </fieldset>
      <div class="poll-actions">
        <button class="btn btn-primary" disabled={locked}
          >{form.busy ? 'Saving…' : saveLabel}</button
        >
        {#if form.editing}<button
            type="button"
            class="btn btn-outline"
            disabled={locked}
            onclick={() => form.cancel()}>Cancel edit</button
          >{/if}
      </div>
    </form>
  {/if}
  {#if form.message}<p role="status" class="poll-feedback">{form.message}</p>{/if}
  {#if form.identity.open}<IdentityDialog {form} />{/if}
  {#if form.needsReload}
    <button class="btn btn-outline" disabled={form.busy} onclick={() => form.refresh()}
      >Reload saved vote</button
    >
  {/if}
  {#if form.pending !== null && !form.identity.open}
    <button class="btn btn-primary" disabled={form.busy} onclick={() => form.submit()}
      >{form.busy ? 'Saving…' : 'Retry same vote'}</button
    >
  {/if}
  {#if !form.editing && form.pending === null && !form.needsReload}
    <button
      class="btn btn-outline poll-refresh"
      disabled={form.busy}
      onclick={() => form.refresh()}>Refresh poll</button
    >
    <p class="poll-note">
      Refreshing reloads your saved ballot and clears unsaved selections.
    </p>
  {/if}
</section>
