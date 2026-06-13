<script lang="ts">
  let { width, height }: { width?: string; height?: string } = $props();
</script>

<div class="skeleton" style="width: {width ?? '100%'}; height: {height ?? '1rem'};"></div>
