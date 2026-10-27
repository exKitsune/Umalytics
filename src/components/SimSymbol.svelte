<script lang="ts">
  export let name='race';
  export let size=24;
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name==='batch'}<path d="M4 20V13h4v7m2 0V7h4v13m2 0V3h4v17M2 21h20"/>
  {:else if name==='shuffle'}<path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 3-2 4-4m4-4c1-2 2-4 4-4h3m-4-4 4 4-4 4"/>
  {:else if name==='track'}<rect x="2" y="5" width="20" height="14" rx="7"/><rect x="6" y="9" width="12" height="6" rx="3"/><path d="M17 5v4"/>
  {:else if name==='ground'}<path d="M3 18h18M5 15l-2-3m4 3 1-6m3 6-1-4m5 4 2-7m2 7 2-3M4 21h16"/>
  {:else if name==='blossom'}{#each [0,72,144,216,288] as angle}<path transform={`rotate(${angle} 12 12)`} d="M12 11C9 9 8 4 11 3L12 4 13 3C16 4 15 9 12 11Z"/>{/each}<circle cx="12" cy="12" r="1.5"/>
  {:else if name==='night'}<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/><path d="M17 3v4m-2-2h4"/>
  {:else if name==='sun'}<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>
  {:else if name==='dawn'||name==='dusk'}<path d="M2 18h20M6 15a6 6 0 0 1 12 0M12 2v3M3 7l2 2m14 0 2-2M4 21h16"/>
  {:else if name==='trophy'}<path d="M7 3h10v5c0 7-10 7-10 0V3Zm0 2H3v3c0 3 3 4 5 4m9-7h4v3c0 3-3 4-5 4m-4 2v6m-5 0h10"/>
  {:else if name==='heart'}<path d="M12 21 3.5 12.5C-2 6 6 1 12 7c6-6 14-1 8.5 5.5L12 21Z"/>
  {:else if name==='clock'}<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>
  {:else if name==='race'}<path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0"/><path d="m10 3 0 5m4 1v5m5-5c-5 4-9-4-14 0"/>
  {:else}<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>{/if}
</svg>
