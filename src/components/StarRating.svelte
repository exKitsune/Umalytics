<script lang="ts">
  export let count:number;
  export let max=5;
  export let size=13;
  $: filled=Math.max(0,Math.min(max,Math.round(count)));
</script>
<span class="star-rating" aria-label={`${filled} of ${max} stars`} title={`${filled} of ${max} stars`}>
  {#each {length:max} as _,index}
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" class:filled={index<filled}>
      <path d="M12 2.15 14.94 8.4l6.86.94-5 4.78 1.24 6.73L12 17.77l-6.04 3.08 1.24-6.73-5-4.78 6.86-.94L12 2.15z"/>
    </svg>
  {/each}
</span>
<style>
.star-rating{display:inline-flex;align-items:center;gap:1px;line-height:0;vertical-align:middle}
.star-rating svg{flex:none;fill:#e2c04a;opacity:.4}
.star-rating svg.filled{opacity:1}
</style>
