<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { spurtDisplayGroups, spurtDistribution, spurtLuck, NORMAL_SPURT_START_DELAY, type SpurtComparison } from '../data/spurt-comparison';
  import type { MotionBand } from '../data/race-motion';
  export let value:SpurtComparison|undefined;
  export let name:string;
  let button:HTMLButtonElement,popup:HTMLDivElement,left=0,top=0;
  let selectedDecision=-1,hideTimer:ReturnType<typeof setTimeout>|undefined;
  let distributionAxis:'speed'|'delay'='speed';
  const format=(v:MotionBand|null|undefined)=>!v?'—':v.max-v.min<.01?v.mid.toFixed(2):`${v.min.toFixed(2)}–${v.max.toFixed(2)}`;
  const pct=(n:number)=>`${(100*n).toFixed(1)}%`;
  function keep(){clearTimeout(hideTimer);}
  async function show(){keep();if(!value)return;const rect=button.getBoundingClientRect();popup.showPopover();await tick();const bounds=popup.getBoundingClientRect();left=Math.max(8,Math.min(innerWidth-bounds.width-8,rect.left));top=Math.max(8,Math.min(innerHeight-bounds.height-8,rect.bottom+8));}
  function hide(){hideTimer=setTimeout(()=>popup?.hidePopover(),160);}
  onDestroy(keep);
  function dismiss(event:KeyboardEvent){if(event.key!=='Escape')return;button.focus();keep();popup.hidePopover();event.stopPropagation();}
  $: if(value)selectedDecision=-1;
  $: choice=value?.decisions?.[selectedDecision<0?(value.decisions.length-1):selectedDecision]??value;
  $: groups=value?spurtDisplayGroups(value):[];
  $: selectedIndex=selectedDecision<0?(value?.decisions.length??0)-1:selectedDecision;
  $: group=groups.find(g=>g.indices.includes(selectedIndex));
  $: target=group?.target??null;
  $: normalDelay=value?.delaySeconds!=null&&value.delaySeconds<=NORMAL_SPURT_START_DELAY;
  function label(index:number){return index===0?'Late entry':`Recovery ${index}`;}
  function select(index:number){selectedDecision=index;}
  $: points=choice?.candidates??[];
  $: distribution=choice?spurtDistribution(choice,distributionAxis):[];
  $: luck=choice?spurtLuck(choice):null;
  $: minValue=distribution[0]?.value??0;
  $: maxValue=distribution.at(-1)?.value??1;
  $: maxProbability=Math.max(.01,...distribution.map(p=>p.probability));
  $: plotX=(v:number)=>48+(v-minValue)/Math.max(.1,maxValue-minValue)*280;
  $: plotY=(p:number)=>132-p/maxProbability*104;
  $: distributionPath=distribution.map((p,i)=>`${i?'L':'M'}${plotX(p.value)},${plotY(p.probability)}`).join(' ');
  $: matchedPoint=choice?.matched==null?null:distribution.find(p=>p.indices.includes(choice!.matched!));
  $: startInWindow=value?.startTime!=null&&choice&&'time' in choice&&value.startTime>=choice.time&&value.startTime<choice.end?{time:value.startTime,wait:value.startTime-choice.time,metres:choice.observedDelay}:null;
</script>
<div class="spurt-summary">
{#if groups.length>1}<div class="stage-buttons" aria-label={`Spurt recalculations for ${name}`}>{#each groups as stage}<button class:chosen={stage===group} aria-pressed={stage===group} onclick={e=>{e.stopPropagation();select(stage.indices.at(-1)!);}}>{label(stage.indices[0])}{#if stage.indices.length>1}–{stage.indices.at(-1)}{/if}</button>{/each}</div>{/if}
<button bind:this={button} class="spurt-speed" aria-label={`Last spurt target for ${name}`} onmouseenter={show} onmouseleave={hide} onfocus={show} onblur={hide} onclick={e=>{e.stopPropagation();show();}} onkeydown={dismiss}>
  {#if group&&group.indices.length>1}<small title="HP supports the same maximum at these checks. The speed reading comes from the later clear window.">Full spurt · same target</small>{/if}
  <span class="target" title={group?.targetTime!=null?`Baseline target read at ${group.targetTime.toFixed(2)} s.`:'No clear target speed before the next recovery.'}>{target!=null?`${target.toFixed(2)} m/s`:'Target unresolved'}</span>
  <small>Max {format(value?.maximum)} m/s</small>
  {#if value?.delaySeconds!=null}<small title={`Recorded start ${value.delaySeconds.toFixed(3)} s after late entry. Offsets up to ${NORMAL_SPURT_START_DELAY.toFixed(2)} s count as normal timing here.`}>{normalDelay?'On time':`Start delay ${value.delaySeconds.toFixed(2)} s`}</small>{/if}
  {#if target!=null&&value?.maximum&&value.maximum.mid-target>=.025}<small class="shortfall">−{(value.maximum.mid-target).toFixed(2)} m/s target</small>{/if}
</button>
</div>
<div bind:this={popup} popover="manual" class="spurt-popup" role="dialog" tabindex="-1" aria-label={`Last spurt choices for ${name}`} style={`left:${left}px;top:${top}px`} onmouseenter={keep} onmouseleave={hide} onfocusin={keep} onfocusout={hide} onkeydown={dismiss}>
  <strong>Last spurt · {name}</strong>
  <p>Baseline target · temporary boosts and slopes excluded</p>
  {#if value?.startTime!=null}<p>{'Spurt starts '}<strong>{value.startTime.toFixed(2)} s</strong>{#if value.delaySeconds!=null}{normalDelay?' · on time':` · delay ${value.delaySeconds.toFixed(2)} s`}{/if}</p>{/if}
  {#if normalDelay}<p>{value?.delaySeconds?.toFixed(3)} s after late entry · within the 0.15 s timing allowance.</p>{/if}
  {#if value?.waitingPlateau}<p>Before spurt: <strong>{value.waitingPlateau.speed.toFixed(2)} m/s</strong> · {value.waitingPlateau.start.toFixed(2)}–{value.waitingPlateau.end.toFixed(2)} s</p>{/if}
  {#if value?.maximum&&choice&&'observedTarget' in choice&&choice.observedTarget!=null}<div class="target-compare"><span style={`width:${Math.min(100,choice.observedTarget/value.maximum.mid*100)}%`}></span></div><div class="compare-labels"><span>Target {choice.observedTarget.toFixed(2)}</span><span>Max {format(value.maximum)} m/s</span></div>{/if}
  {#if value?.decisions?.length}<div class="decisions" aria-label="Spurt decisions">{#each value.decisions as decision,index}<button class:chosen={choice===decision} aria-pressed={choice===decision} onclick={e=>{e.stopPropagation();select(index);void show();}}>{label(index)} · {decision.time.toFixed(2)} s</button>{/each}</div>{/if}
  {#if choice&&'time' in choice}<p>{choice.time.toFixed(2)}–{choice.end.toFixed(2)} s{#if choice.hp!=null}{` · ${Math.round(choice.hp)} HP`}{/if}</p>{/if}
  {#if startInWindow}<p>Recorded start <strong>{startInWindow.time.toFixed(2)} s</strong> · {startInWindow.wait<=NORMAL_SPURT_START_DELAY?'on time':`${startInWindow.wait.toFixed(2)} s after this check`}{#if startInWindow.metres!=null}{` (${startInWindow.metres.toFixed(1)} m)`}{/if}</p>{/if}
  {#if choice&&'observedTarget' in choice&&choice.observedTarget!=null}<p>{choice.targetEvidence==='maximum-reached'?'Reached maximum ':'Observed target '}<strong>{(choice.targetEvidence==='maximum-reached'?value?.maximum?.mid??choice.observedTarget:choice.observedTarget).toFixed(2)} m/s</strong>{#if choice.observedTargetTime!=null}{` at ${choice.observedTargetTime.toFixed(2)} s`}{/if}</p>{/if}
  {#if choice&&'observedTarget' in choice&&choice.observedTarget==null}<p>No clear speed reading in this window.</p>{/if}
  {#if points.length>1}
    <div class="distribution-controls" aria-label="Spurt probability distribution"><strong>Chance by</strong><button class:chosen={distributionAxis==='speed'} aria-pressed={distributionAxis==='speed'} onclick={e=>{e.stopPropagation();distributionAxis='speed';}}>Target speed</button><button class:chosen={distributionAxis==='delay'} aria-pressed={distributionAxis==='delay'} onclick={e=>{e.stopPropagation();distributionAxis='delay';}}>Start delay</button></div>
    <svg viewBox="0 0 364 172" role="img" aria-label={`Spurt ${distributionAxis==='speed'?'target speed':'start delay'} probability distribution`}>
      <path d="M48 20V132H338" fill="none" stroke="currentColor" opacity=".5"/>
      <text x="48" y="13">Chance</text><text x="43" y="32" text-anchor="end">{pct(maxProbability)}</text><text x="43" y="135" text-anchor="end">0%</text>
      <path d={`${distributionPath} L${plotX(maxValue)},132 L${plotX(minValue)},132 Z`} fill="var(--accent)" fill-opacity=".15"/>
      <path d={distributionPath} fill="none" stroke="var(--accent)" stroke-width="2"/>
      {#each distribution as point}<line x1={plotX(point.value)} x2={plotX(point.value)} y1={plotY(point.probability)} y2="132" stroke="var(--accent)" stroke-opacity=".2"/><circle cx={plotX(point.value)} cy={plotY(point.probability)} r="6" fill="transparent"><title>{distributionAxis==='speed'?`${point.value.toFixed(2)} m/s`:`${point.value.toFixed(1)} m delay`} · {pct(point.probability)} chance</title></circle>{/each}
      {#if matchedPoint}<line x1={plotX(matchedPoint.value)} x2={plotX(matchedPoint.value)} y1="20" y2="132" stroke="#78acd8" stroke-dasharray="4 3"/><text x={Math.max(90,Math.min(290,plotX(matchedPoint.value)))} y="22" text-anchor="middle" fill="#78acd8">Matched choice</text>{/if}
      <text x="48" y="151">{minValue.toFixed(distributionAxis==='speed'?2:1)}</text><text x="328" y="151" text-anchor="end">{maxValue.toFixed(distributionAxis==='speed'?2:1)}</text><text x="190" y="168" text-anchor="middle">{distributionAxis==='speed'?'Target speed (m/s)':'Start delay (m after check)'}</text>
    </svg>
    <p>Model probabilities · each tick is a possible choice.</p>
    {#if choice?.decisionDistance!=null}<p>Decision at {choice.decisionDistance.toFixed(0)} m</p>{/if}
    {#if luck}<div class="odds"><span>{pct(luck.probability)} chance of this choice</span><span>{pct(luck.betterChance)} chance of a better spurt</span><span title="Inferred from the matched choice's order. Checks happen within this decision, not once per elapsed second.">{luck.failedMin===luck.failedMax?luck.failedMin:`${luck.failedMin}–${luck.failedMax}`} failed wit checks · inferred</span></div>{/if}
  {:else if points.length===1}
    <p>No wit roll in this model.</p>
  {/if}
  <p>{choice?.reason??'Preparing spurt analysis…'}</p>
</div>
<style>
  .distribution-controls{display:flex;align-items:center;gap:6px;margin-top:12px}.distribution-controls strong{font-size:var(--font-10);margin-right:auto}.distribution-controls button{padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--panel);color:var(--text);font-size:var(--font-10)}.distribution-controls button.chosen{border-color:var(--accent);color:var(--accent)}
  .stage-buttons{display:flex;flex-wrap:wrap;gap:3px;max-width:220px;margin:3px 0 5px}.stage-buttons button{padding:3px 5px;font-size:var(--font-9);border:1px solid var(--border);border-radius:4px;background:var(--panel);color:var(--muted)}.stage-buttons button.chosen{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--panel))}
  .spurt-speed{display:block;text-align:left;background:none;border:0;padding:2px 0;color:inherit;font:inherit;cursor:help}.target{text-decoration:underline dotted var(--muted);text-underline-offset:3px}.spurt-speed small{display:block;font-size:var(--font-9);line-height:1.5;color:var(--muted)}.spurt-speed .shortfall{color:#e6a085}
  .spurt-popup{position:fixed;margin:0;width:min(384px,calc(100vw - 16px));max-height:80vh;overflow:auto;padding:14px;border:1px solid var(--border);border-radius:9px;color:var(--text);background:var(--panel);box-shadow:0 8px 32px #0008;white-space:normal;font-size:var(--font-11)}.spurt-popup strong{font-size:var(--font-12)}p{margin:7px 0 0;line-height:1.4;color:var(--muted)}svg{display:block;width:100%;margin-top:8px}svg text{fill:currentColor;font-size:11px}.odds{display:flex;flex-direction:column;gap:4px;margin-top:8px;color:var(--accent)}.target-compare{height:7px;background:var(--border);margin-top:12px}.target-compare span{display:block;height:100%;background:var(--accent)}.compare-labels{display:flex;justify-content:space-between;font-size:var(--font-10);margin-top:5px}.decisions{display:flex;flex-wrap:wrap;gap:5px;margin-top:12px}.decisions button{padding:5px 7px;font-size:var(--font-10);border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:4px}.decisions button.chosen{border-color:var(--accent);color:var(--accent)}
</style>
