<script lang="ts">
  import type {SkillReference} from '../data/reference';
  import type {SkillActivation} from '../data/analytics';
  import type {Runner} from '../data/types';
  import {postProcDefinition,postProcCondition} from '../data/post-proc';
  import {effectText} from '../data/skill-details';
  export let branch:SkillReference['branches'][number];
  export let runner:Runner|null;
  export let skillId:number;
  export let distance:number|null;
  export let activations:SkillActivation[]=[];
  export let onSeek:(time:number)=>void;
  $: definition=postProcDefinition(branch,runner,skillId,distance);
  $: maximumEffects=definition?[...new Set([...definition.base,...definition.bonuses].map(e=>e.effect.type))].map(type=>{
    const base=definition!.base.filter(e=>e.effect.type===type),bonuses=definition!.bonuses.filter(e=>e.effect.type===type);
    if(base.some(e=>e.value===null)||bonuses.some(e=>e.value===null||e.limit===null))return 'Unavailable';
    const value=base.reduce((n,e)=>n+e.value!,0)+bonuses.reduce((n,e)=>n+e.value!*e.limit!,0);
    return effectText({type,rawValue:value*10000,valueUsage:1,levelUsage:0,evaluatedValue:value});
  }):[];
  $: changes=activations.flatMap(activation=>{
    const times=[...new Set(activation.effects.filter(e=>e.followUp).map(e=>e.appliedStart).filter((t):t is number=>t!=null))];
    return times.map(time=>({time,effects:activation.effects.filter(e=>e.followUp&&e.appliedStart===time),activation}));
  }).sort((a,b)=>a.time-b.time);
  const seconds=(n:number)=>`${Number(n.toFixed(3))} s`;
  const metric=(text:string)=>{const match=text.match(/^(.*?) ([+−-]?\d.*)$/);return match?{label:match[1],value:match[2]}:{label:text,value:null};};
</script>
{#if definition}
  <div class="post-proc">
    <div class="effect-comparison">
      <div class="effect-card base-card">
        <span class="card-label">Base</span>
        {#each definition.base as entry}{@const value=metric(effectText(entry.effect,runner,skillId))}<div class="metric"><span>{value.label}</span>{#if value.value}<strong>{value.value}</strong>{/if}</div>{:else}<span class="empty-effect">No immediate effect</span>{/each}
        <span class="duration-chip">{definition.baseDuration===null?'Duration unavailable':seconds(definition.baseDuration)}</span>
      </div>
      <div class="effect-card maximum-card">
        <span class="card-label">Maximum</span>
        {#each maximumEffects as text}{@const value=metric(text)}<div class="metric"><span>{value.label}</span>{#if value.value}<strong>{value.value}</strong>{/if}</div>{/each}
        {#if definition.maximumDuration!==null}<span class="duration-chip" title="Maximum definition duration before simulation tick boundaries.">{seconds(definition.maximumDuration)}</span>{/if}
      </div>
    </div>
    {#each definition.bonuses as bonus}
      <div class="bonus-rule"><span class="bonus-mark" aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span><div class="bonus-content"><div class="bonus-heading"><strong>{postProcCondition(bonus.kind)}</strong>{#if bonus.limit!==null}<span class="limit">×{bonus.limit} max</span>{/if}</div><div class="bonus-values"><span>{effectText({...bonus.effect,additionalActivateType:0},runner,skillId)}</span>{#if definition.extension>0}<span>+{seconds(definition.extension)}</span>{/if}</div></div></div>
    {/each}
    <h4>Conditional bonuses</h4>
    {#if changes.length}
      <ol>{#each changes as change,i}<li><button onclick={()=>onSeek(change.time)}>▶ {change.time.toFixed(2)} s</button><div><strong>{definition.bonuses.length===1?postProcCondition(definition.bonuses[0].kind):'Condition fulfilled'}</strong><span>{change.effects.map(e=>effectText(e,runner,skillId)).join(' · ')}{#if definition.extension>0} · Duration +{seconds(definition.extension)}{/if}</span></div></li>{/each}</ol>
    {:else}<p>{activations.some(a=>a.activationEvidence==='simulated')?'No conditional bonuses triggered.':'Conditional bonus timing unavailable.'}</p>{/if}
  </div>
{/if}
<style>
  .post-proc{font-variant-numeric:tabular-nums}.effect-comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.effect-card{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:14px;border:1px solid var(--border);border-radius:8px;background:color-mix(in srgb,var(--text) 3%,var(--panel))}.card-label{font-size:var(--font-10);font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}.metric{display:grid;gap:2px;min-width:0}.metric>span{font-size:var(--font-11);color:var(--muted)}.metric>strong{font-size:var(--font-18);font-weight:650;line-height:1.25;overflow-wrap:anywhere}.duration-chip{margin-top:auto;padding:2px 7px;border-radius:4px;background:color-mix(in srgb,var(--text) 6%,transparent);font-size:var(--font-11);color:var(--muted)}.maximum-card{background:color-mix(in srgb,var(--accent) 7%,var(--panel));border-color:color-mix(in srgb,var(--accent) 30%,var(--border))}.maximum-card .card-label,.maximum-card .metric>strong{color:var(--accent-text,var(--accent))}.maximum-card .duration-chip{color:var(--accent-text,var(--accent));background:color-mix(in srgb,var(--accent) 12%,transparent)}.bonus-rule{display:flex;align-items:center;gap:10px;margin-top:10px;padding:11px 12px;border:1px solid color-mix(in srgb,#69b9e8 24%,var(--border));border-radius:7px;background:color-mix(in srgb,#69b9e8 6%,var(--panel))}.bonus-mark{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:50%;font-size:var(--font-18);color:#69b9e8;background:color-mix(in srgb,#69b9e8 12%,transparent)}.bonus-mark svg{display:block}.bonus-content{flex:1;min-width:0}.bonus-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.bonus-heading strong{font-size:var(--font-12);font-weight:550}.limit{color:#69b9e8;font-size:var(--font-10);white-space:nowrap}.bonus-values{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:3px;color:#69b9e8;font-size:var(--font-11)}.empty-effect{color:var(--muted);font-size:var(--font-11)}h4{font-size:var(--font-12);margin:15px 0 6px}ol{list-style:none;margin:0;padding:0;display:grid;gap:8px}li{display:flex;align-items:start;gap:12px}li button{background:transparent;border:0;padding:0;color:var(--accent-text,var(--accent));font-size:var(--font-11);white-space:nowrap}li div{display:grid;border-left:2px solid #69b9e8;padding-left:10px}li strong{text-align:left;font-size:var(--font-11);color:#69b9e8}li span,p{color:var(--muted);font-size:var(--font-11);margin:0}@media(max-width:420px){.effect-card{padding:10px}.metric>strong{font-size:var(--font-15)}}
</style>
