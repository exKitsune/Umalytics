<script lang="ts">export let name='folder';export let size=18;</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name==='trash'}<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>
  {:else if name==='star'}<path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"/>
  {:else if name==='archive'}<path d="M4 8v12h16V8M3 3h18v5H3zM9 12h6"/>
  {:else if name==='grid'}<path d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z"/>
  {:else if name==='race'}<path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>
  {:else if name==='trophy'}<path d="M7 3h10v5c0 7-10 7-10 0V3Zm0 2H3v3c0 3 3 4 5 4m9-7h4v3c0 3-3 4-5 4m-4 2v6m-5 0h10"/>
  {:else if name==='flask'}<path d="M9 3h6M10 3v6L4 19q-1 2 2 2h12q3 0 2-2L14 9V3M7 15h10"/>
  {:else if name==='heart'}<path d="M20 5c-3-3-7-1-8 2-1-3-5-5-8-2-5 5 4 11 8 15 4-4 13-10 8-15Z"/>
  {:else if name==='edit'}<path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>
  {:else if name==='copy'}<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>
  {:else if name==='export'}<path d="M12 16V3m-5 5 5-5 5 5M4 13v8h16v-8"/>
  {:else if name==='refresh'}<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2l1 4M18 18a8 8 0 0 1-13-2l-1-4"/>
  {:else}<path d="M3 6V4h7l2 3h9v13H3Z"/>{/if}
</svg>
