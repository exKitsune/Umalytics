<script lang="ts">
  import type { Runner } from '../data/types';
  import { portraitUrl } from '../data/portraits';
  export let runner:Runner;
  export let size=36;
  export let alt='';
  let failed=false,previousUrl:string|null=null;
  $: url=portraitUrl(runner);
  $: if(url!==previousUrl){previousUrl=url;failed=false;}
</script>
<span class="uma-portrait" style:width={`${size}px`} style:height={`${size}px`} aria-hidden={alt?undefined:'true'}>
  {#if url&&!failed}<img src={url} {alt} width={size} height={size} decoding="async" onerror={()=>failed=true}/>{:else}<span class="portrait-fallback" title={alt||'Portrait unavailable'}>{runner.name?.trim().charAt(0)||'?'}</span>{/if}
</span>
<style>
  .uma-portrait{display:inline-flex;flex:none;align-items:center;justify-content:center;overflow:hidden;border-radius:50%;background:var(--panel-raised);border:1px solid var(--border);vertical-align:middle}.uma-portrait img{display:block;width:100%;height:100%;object-fit:cover}.portrait-fallback{font-size:var(--font-14);font-weight:700;color:var(--muted)}
</style>
