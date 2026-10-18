<script lang="ts" module>
  export type ImpactBit = {text:string; tone?:'gain'|'loss'|'';title?:string};
</script>
<script lang="ts">
  export let bits:ImpactBit[];
  export let title:string|undefined=undefined;
  export let modeled=false;
  const signed=(bit:ImpactBit)=>{
    if(!bit.tone||bit.text==='partial'||/^[+\-−]/.test(bit.text))return bit.text;
    return `${bit.tone==='gain'?'+':'−'}${bit.text}`;
  };
  const isTime=(bit:{text:string})=>/ s$/.test(bit.text);
  const quiet=(bit:{text:string})=>isTime(bit)||bit.text==='No gain'||bit.text==='partial';
  const help=(bit:ImpactBit)=>bit.title??`${title?`${title} · `:''}${/ m$/.test(bit.text)?`Distance ${bit.tone==='loss'?'lost':'gained'}`:isTime(bit)?`Travel time ${bit.tone==='loss'?'lost':'saved'}`:/ HP$/.test(bit.text)?`HP ${bit.tone==='loss'?'spent':'saved'}`:bit.text==='partial'?'Only part of the interval could be assessed.':'No measurable movement benefit.'}${/ (m|s|HP)$/.test(bit.text)?`: ${signed(bit)}`:''}`;
</script>
{#if bits.length}
  <p class="impact-line" class:modeled>{#each bits as bit,i}{#if i}<span class="dot" aria-hidden="true">·</span>{/if}<span title={help(bit)} class:gain={bit.tone==='gain'&&!quiet(bit)} class:loss={bit.tone==='loss'&&!quiet(bit)} class:quiet={quiet(bit)}>{signed(bit)}</span>{/each}</p>
{/if}
<style>
  .impact-line{display:flex;flex-wrap:nowrap;align-items:baseline;gap:2px 0;margin:3px 0 0;font-size:var(--font-11);font-weight:550;font-variant-numeric:tabular-nums;line-height:1.35;white-space:nowrap;color:var(--text)}
  .dot{margin:0 .4em;color:var(--muted);font-weight:400}
  .gain{color:#6dce86}.loss{color:#e28f7f}.quiet{color:var(--muted)}
  .modeled span:not(.dot){text-decoration:underline dotted var(--muted);text-underline-offset:3px;cursor:help}
</style>
