<script lang="ts">
  import {conditionLabel,conditionEnums as enums} from '../data/condition-label';
  import type { ReferenceData } from '../data/reference';
  import type { PredicateExplanation } from '../data/skill-conditions';
  export let expression:string;
  export let reference:ReferenceData|null=null;
  export let showCode=false;
  export let fieldSize:number|undefined=undefined;
  export let predicates:PredicateExplanation[]=[];
  export let role:'condition'|'precondition'='condition';
  export let onSeek:((time:number)=>void)|undefined=undefined;
  const evidence=(atom:string)=>predicates.find(p=>p.expression===atom.trim()&&(!p.role||p.role==='both'||p.role===role));
  function recordedAs(atom:string,item?:PredicateExplanation){
    const value=item?.state==='unmet'?item.observed?.match(/^Value (\d+)\.$/):null;
    const key=atom.trim().match(/^(\w+)/)?.[1]??'';
    return value?enums[key]?.[Number(value[1])]??null:null;
  }
  function observedTime(item:PredicateExplanation){
    if(item.time==null)return '';
    return item.time.toFixed(2)+' s';
  }
</script>
<div class="condition-rules">
  {#each expression.split('@') as alternative,i}
    {#if i}<span class="condition-or">or</span>{/if}
    <div class="condition-group">{#each alternative.split('&').filter(Boolean) as atom}{@const item=evidence(atom)}<div class="rule">{#if item?.state}<span class="predicate-state" class:met={item.state==='met'} class:unmet={item.state==='unmet'} title={`${item.observed??''}${item.time!=null?` At ${item.time.toFixed(2)} s.`:''}`} aria-label={item.state==='met'?'Condition met':item.state==='unmet'?'Condition not met':'Condition uncertain'}>{item.state==='met'?'✓':item.state==='unmet'?'×':'?'}</span>{/if}<div>{conditionLabel(atom,reference,fieldSize)}{#if item?.state==='met'}{:else if recordedAs(atom,item)}<small class="observed">Recorded as {recordedAs(atom,item)}.</small>{:else if item?.observed}<small class="observed">{item.observed}{#if item.time!=null}{#if onSeek} · <button type="button" class="seek-pred" onclick={()=>onSeek(item.time!)}>{observedTime(item)}</button>{:else} · {observedTime(item)}{/if}{/if}</small>{/if}{#if showCode}<code>{atom}</code>{/if}</div></div>{:else}<div>No additional condition.</div>{/each}</div>
  {/each}
</div>
<style>
  .condition-rules{background:var(--bg);border-radius:5px;padding:10px 12px}.condition-group{display:grid;gap:6px;font-size:var(--font-11);line-height:1.5;color:var(--muted)}.condition-or{display:block;margin:8px 0;color:var(--accent-text,var(--accent));font-size:var(--font-11)}
  code{display:block;margin-top:3px;color:var(--text);font-size:var(--font-11);overflow-wrap:anywhere}
  .rule{display:flex;gap:8px;align-items:flex-start}.predicate-state{width:13px;flex-shrink:0;font-weight:700;color:var(--muted)}.predicate-state.met{color:var(--accent-text,var(--accent))}.predicate-state.unmet{color:#e48087}
  .observed{display:block;margin-top:2px;font-size:var(--font-10);color:var(--text)}
  .seek-pred{padding:0;border:0;background:transparent;color:var(--accent-text,var(--accent));font:inherit;cursor:pointer}
</style>
