<script lang="ts">
  import {statHelp} from '../data/analysis-copy';
  import type { RunnerStatBreakdown,StatKey } from '../data/effect-types';
  import GameIcon from './GameIcon.svelte';
  export let breakdown:RunnerStatBreakdown|null|undefined;
  const names:Record<StatKey,string>={speed:'Speed',stamina:'Stamina',power:'Power',guts:'Guts',wisdom:'Wit'};
  const f=(v:number|null|undefined)=>v==null?'—':Math.round(v).toLocaleString();
  const signed=(v:number)=>`${v>0?'+':''}${f(v)}`;
  $: wit=breakdown?.stats.wisdom.final??null;
  $: distance=breakdown?.startingHp.distanceContribution??null;
  $: stamina=breakdown?.stats.stamina.final??null;
  $: styleRate=breakdown?.startingHp.strategyCoefficient??null;
  $: baseSpeed=distance===null?null:20-(distance-2000)/1000;
  $: witMax=wit!==null&&wit>0&&baseSpeed!==null?baseSpeed*(wit/5500*Math.log10(.1*wit))/100:null;
  $: witMean=witMax!==null&&baseSpeed!==null?witMax-baseSpeed*.00325:null;
  const speed=(value:number)=>`${value>=0?'+':''}${value.toFixed(3)} m/s`;
</script>
{#if breakdown}
  <section class="stat-breakdown" aria-label="Race stat breakdown">
    <div class="breakdown-heading"><strong>Race stats</strong>{#if breakdown.evidence!=='simulated'}<small title={breakdown.detail}>Model</small>{/if}</div>
    {#each Object.entries(names) as [key,name]}{@const stat=breakdown.stats[key as StatKey]}
      <div class="stat-breakdown-row" title={stat.detail}>
        <div class="stat-heading"><GameIcon name={`stat-${key}`} size={16}/><strong>{name}</strong><span>{f(stat.raw)} <small>→</small> {f(stat.final)}</span></div>
        {#if stat.final===null}<p class="withheld">{stat.detail.match(/Final [^.]+\./)?.[0]??'Final stat withheld.'}</p>{/if}
        <div class="stat-changes">
          {#if stat.overcap!==null&&stat.raw!==null&&stat.overcap!==stat.raw}<span>Over 1200 {signed(stat.overcap-stat.raw)}</span>{/if}
          {#each [['Mood',stat.moodGain],['Base limit',stat.baseCapGain],['Course',stat.courseGain],['Style',stat.strategyGain],['Ground',stat.groundGain],['Career',stat.careerGain],['Skills',stat.passiveGain],['Limit',stat.capGain]] as [label,delta]}
            {#if typeof delta==='number'&&delta!==0}<span class:gain={delta>0} class:loss={delta<0}>{label} {signed(delta)}</span>{/if}
          {/each}
        </div>
        {#if key==='wisdom'&&witMean!==null&&witMax!==null&&baseSpeed!==null}<div class="wit-speed" title={`Expected target-speed adjustment before the selected final spurt. Each of the 24 sections draws between ${speed(witMax-baseSpeed*.0065)} and ${speed(witMax)}. This is the expected mean; the actual matched section values appear below.`}><span>Avg. section speed</span><strong>{speed(witMean)}</strong></div>{/if}
      </div>
    {/each}
    <div class="hp-breakdown"><strong>Starting HP <span>{f(breakdown.startingHp.observed)}</span></strong><p>Distance plus 0.8 × stamina × style.</p>{#if distance!==null&&stamina!==null&&styleRate!==null}<p class="formula">{f(distance)} + 0.8 × {f(stamina)} × {styleRate.toFixed(3)} = {f(breakdown.startingHp.modeled)}</p>{:else if breakdown.startingHp.modeled!==null}<p class="formula">Model {f(breakdown.startingHp.modeled)}</p>{/if}</div>
  </section>
{/if}
<style>
  .wit-speed{display:flex;justify-content:space-between;gap:8px;margin:8px 0 0 22px;font-size:var(--font-10);color:var(--muted);cursor:help}.wit-speed strong{color:var(--text);font-weight:500;font-variant-numeric:tabular-nums}
  .stat-breakdown{padding:14px 16px;border-bottom:1px solid var(--border)}.breakdown-heading{display:flex;justify-content:space-between;align-items:center;font-size:var(--font-12);margin-bottom:8px}.breakdown-heading small{font-size:var(--font-10);color:var(--muted);cursor:help}.stat-breakdown-row{padding:9px 0;border-bottom:1px solid var(--border)}.stat-heading{display:flex;align-items:center;gap:6px;font-size:var(--font-11)}.stat-heading strong{font-weight:500}.stat-heading>span{margin-left:auto;font-variant-numeric:tabular-nums}.stat-heading small{color:var(--muted);margin:0 3px}.withheld{margin:4px 0 0 22px;color:var(--muted);font-size:var(--font-10)}.stat-changes{display:flex;flex-wrap:wrap;gap:3px 10px;font-size:var(--font-9);margin:5px 0 0 22px;color:var(--muted)}.gain{color:var(--accent-text,var(--accent))}.loss{color:#e28f7f}.hp-breakdown{padding-top:12px;font-size:var(--font-12)}.hp-breakdown>strong{display:flex;justify-content:space-between}.hp-breakdown p{margin:6px 0 0;color:var(--muted);font-size:var(--font-12);line-height:1.45}.hp-breakdown .formula{color:var(--text);font-variant-numeric:tabular-nums}
</style>
