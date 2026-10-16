<script lang="ts">
  export let identity:string;
  export let label='Loading…';
  let visible=false,last='',element:HTMLDivElement,observer:IntersectionObserver|undefined;
  function observe(node:HTMLDivElement){
    observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){visible=true;observer?.disconnect();}},{rootMargin:'250px'});
    observer.observe(node);return {destroy(){observer?.disconnect();}};
  }
  $: if(identity!==last){last=identity;visible=false;if(element&&observer){observer.disconnect();observer.observe(element);}}
</script>
<div bind:this={element} use:observe class="deferred-panel">
  {#if visible}<slot/>{:else}<div class="panel placeholder" aria-busy="true">{label}</div>{/if}
</div>
<style>.deferred-panel{min-width:0}.placeholder{padding:24px;min-height:180px;color:var(--muted)}</style>
