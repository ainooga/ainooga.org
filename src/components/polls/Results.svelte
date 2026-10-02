<script lang="ts">
  import type { PollPage } from '$lib/polls/page.svelte';
  import { canSeeResults } from '$lib/polls/display';
  let { page }: { page: PollPage } = $props();
</script>

<section class="poll-results" aria-labelledby="poll-results-title">
  <h2 id="poll-results-title">Results</h2>
  {#if page.results !== null}
    <p>
      {page.results.ballotCount} of {page.results.eligibleCount} eligible voters have voted.
    </p>
    <table>
      <caption
        >Votes by option. Multiple-choice totals may exceed the number of voters.</caption
      >
      <thead><tr><th scope="col">Option</th><th scope="col">Votes</th></tr></thead>
      <tbody
        >{#each page.results.options as option (option.id)}<tr
            ><th scope="row">{option.label}</th><td>{option.votes}</td></tr
          >{/each}</tbody
      >
    </table>
  {:else if page.resultsError}
    <p role="alert">{page.resultsError}</p>
    <button class="btn btn-outline" onclick={() => page.loadResults()}
      >Retry results</button
    >
  {:else if page.detail !== null && canSeeResults(page.detail)}
    <p role="status">Loading results…</p>
  {:else}
    <p>
      {page.detail?.resultsVisibility === 'after_vote'
        ? 'Results are available after you vote.'
        : 'Results are not shared with voters for this poll.'}
    </p>
  {/if}
</section>
