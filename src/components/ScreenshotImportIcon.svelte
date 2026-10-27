<script lang="ts">
  export let kind:'collage'|'uma'='collage';
  export let size=24;
</script>
<svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
  {#if kind==='collage'}
    <rect x="3" y="6" width="27" height="28" rx="3" transform="rotate(-9 3 6)" fill="currentColor" opacity=".22"/>
    <rect x="9" y="5" width="27" height="29" rx="3" fill="var(--panel)" stroke="currentColor" stroke-width="2"/>
    <circle cx="28" cy="13" r="3" fill="currentColor"/>
    <path d="m13 28 7-10 5 6 3-4 5 8H13Z" fill="currentColor"/>
    <path d="M13 32h19" stroke="currentColor" stroke-width="1.5" opacity=".5"/>
  {:else}
    <path d="M11 13C7 9 7 3 9 1c4 2 6 6 7 10h8c1-4 3-8 7-10 2 4 0 9-3 13 4 4 6 9 4 14l-4 4-1 6H13l-1-6c-5-2-7-6-6-10 0-4 2-7 5-9Z" fill="currentColor"/>
    <path d="M12 18c3-5 10-6 16-1l-5 1-3-3-2 5-3-2-3 3v-3Z" fill="var(--panel)"/>
    <path d="M14 23c0 6 3 9 6 9s6-3 6-9v-2l-5-2-3 2-4-1v3Z" fill="var(--panel)"/>
  {/if}
</svg>
