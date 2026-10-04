<script lang="ts">
  import { onMount } from 'svelte';
  import { getTurnstileService } from '$lib/context';
  import { getPollServices } from '$lib/polls/context';
  let { token = $bindable('') }: { token?: string } = $props();
  const turnstile = getTurnstileService();
  const { runtime } = getPollServices();

  let problem = $state('');
  let container: HTMLDivElement;
  let widget: string | null = null;
  let disposed = false;
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
  export function reset() {
    if (disposed) return;
    token = '';
    problem = '';
    if (widget !== null) turnstile.reset(widget);
    else mountWidget();
  }
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
</script>

<div bind:this={container}></div>
{#if problem}<p role="alert">{problem}</p>
  <button type="button" class="btn btn-outline" onclick={reset}>Retry verification</button
  >
{/if}
