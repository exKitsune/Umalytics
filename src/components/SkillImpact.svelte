<script lang="ts">
  import type { SkillImpactSummary } from '../data/effect-types';
  import EffectUtilization from './EffectUtilization.svelte';
  import MotionSkillImpactView from './MotionSkillImpact.svelte';
  import type { MotionSkillImpact } from '../data/motion-skill-impact';
  export let motion:MotionSkillImpact|null=null;
  export let impact:SkillImpactSummary|null|undefined;
  export let expanded=false;
  const signed=(v:number,unit:string)=>`${v>0?'+':''}${v.toFixed(2)} ${unit}`;
  const distanceRange=(low:number,high:number)=>`${low>=0?'+':''}${low.toFixed(2)} – ${high>=0?'+':''}${high.toFixed(2)} m`;
  const timeRange=(low:number,high:number)=>high<=0?`${Math.abs(high).toFixed(3)} – ${Math.abs(low).toFixed(3)} s saved`:low>=0?`${low.toFixed(3)} – ${high.toFixed(3)} s lost`:`${low.toFixed(3)} – +${high.toFixed(3)} s`;
  $: useMotion=motion!==null&&motion.assessedDuration>0;
  $: rate=impact?.utilization??impact?.usefulRate??null;
  $: partialRate=rate===null?impact?.usefulAmongAssessed??null:null;
  $: shownRate=rate??partialRate;
  $: percent=shownRate===null?null:Math.round(Math.max(0,Math.min(1,shownRate))*100);
  $: coverage=impact?.coverageRate==null?null:Math.round(impact.coverageRate*100);
  $: distance=useMotion||lane?null:impact?.modeledDistanceDelta??impact?.assessedModeledDistanceDelta??null;
  $: time=useMotion||lane?null:impact?.modeledTimeDelta??impact?.assessedModeledTimeDelta??null;
  $: hp=impact?.modeledHpDelta??impact?.assessedModeledHpDelta??null;
  $: carryover=useMotion?null:impact?.carryover;
  $: recovery=impact?.recovery;
  $: lane=impact?.utilizationKind==='lane';
  $: meterLabel=impact?.utilizationKind==='hp-capacity'?'HP efficiency':lane?'Lane change':'Utilization';
  $: blockedLoss=useMotion?null:impact?.blockingDistanceLoss??impact?.assessedBlockingDistanceLoss??null;
  $: components=impact?.effectUtilization??[];
  $: hasData=lane||percent!==null||distance!==null||time!==null||hp!==null||carryover?.distanceDeltaMin!=null||components.some(e=>e.assessedDuration>0);
</script>
{#if impact&&(expanded||hasData||useMotion)}
  <div class="skill-impact" class:expanded>
    {#if useMotion&&motion}<MotionSkillImpactView value={motion} {expanded}/>{:else if lane}<p class="unavailable">Forward gain needs matched lane-movement data.</p>{:else if components.length}<div class="effect-components">{#each components as effect (effect.kind)}<EffectUtilization {effect} {expanded}/>{/each}</div>
    {:else if percent!==null}<div class="utilization">
      <div class="meter-heading"><span>{meterLabel}{partialRate!==null?' · partial':''}</span><strong>{percent}% effective</strong></div>
      <div class="meter" role="meter" aria-label={partialRate!==null?`${meterLabel} in assessed portion`:meterLabel} aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}><i style:width={`${percent}%`}></i></div>
      {#if partialRate!==null&&coverage!==null}<small>{coverage}% of active time assessed</small>{/if}
    </div>{:else if expanded}<p class="unavailable">{meterLabel} unavailable</p>{/if}
    <div class="impact-stats">
      {#if distance!==null}<span title="Distance gained while the skill is active.">{signed(distance,'m')}{#if impact.modeledDistanceDelta===null}<small>partial</small>{/if}</span>{/if}
      {#if time!==null}<span title="Travel time saved during the skill’s active effect.">{Math.abs(time).toFixed(3)} s {time>0?'lost':'saved'}{#if impact.modeledTimeDelta===null}<small>partial</small>{/if}</span>{/if}
      {#if hp!==null}<span title="HP gained or spent by this effect.">{signed(-hp,'HP')}{#if impact.modeledHpDelta===null}<small>partial</small>{/if}</span>{/if}
      {#if recovery?.modeledOvercapHp!=null}<span title="Recovery wasted above maximum HP.">{recovery.modeledOvercapHp.toFixed(1)} HP overcap</span>{/if}
      {#if blockedLoss!==null&&blockedLoss>.005}<span title="Skill distance benefit lost while blocked.">{blockedLoss.toFixed(2)} m blocked{#if impact.blockingDistanceLoss===null}<small>partial</small>{/if}</span>{/if}
    </div>
    {#if expanded&&recovery}<div class="recovery-timing"><div class="carryover-heading">Recovery timing</div><dl>
      <dt>Timing</dt><dd>{({ 'before-late':'Before final leg','before-recorded-spurt':'Before spurt','during-recorded-spurt':'During spurt','no-recorded-spurt':'No spurt recorded','unknown':'Unknown' } as Record<string,string>)[recovery.spurtState]}</dd>
      {#if recovery.referenceBudgetBefore!=null&&recovery.referenceBudgetAfter!=null}<dt title="HP available for maximum spurt speed.">Max-spurt HP budget</dt><dd>{Math.round(recovery.referenceBudgetBefore*100)}% → {Math.round(recovery.referenceBudgetAfter*100)}%</dd>
        <dt>Budget result</dt><dd>{({unlocked:'Covered by recovery','already-covered':'Already covered','still-short':'Still short'} as Record<string,string>)[recovery.referenceBudgetOutcome]??'Unknown'}</dd>
      {/if}
      {#if recovery.remainingDistance!=null}<dt>Distance left</dt><dd>{recovery.remainingDistance.toFixed(0)} m</dd>{/if}
      {#if recovery.secondsBeforeRecordedSpurt!=null&&recovery.secondsBeforeRecordedSpurt>0}<dt>Before spurt</dt><dd>{recovery.secondsBeforeRecordedSpurt.toFixed(2)} s</dd>{/if}
      {#if recovery.recordedSpurtDelayDistance!=null&&recovery.recordedSpurtDelayDistance>0}<dt title="Distance before the final spurt starts.">Spurt delay</dt><dd>{recovery.recordedSpurtDelayDistance.toFixed(1)} m</dd>{/if}
      {#if recovery.recalculationOpportunity===true}<dt title="Recovery during the final leg.">Spurt change</dt><dd>Possible</dd>{/if}
      {#if recovery.observedSelfSpeedBefore!=null&&recovery.observedSelfSpeedAfter!=null}<dt title="Speed around the recovery, including other active effects.">Nearby speed</dt><dd>{recovery.observedSelfSpeedBefore.toFixed(2)} → {recovery.observedSelfSpeedAfter.toFixed(2)} m/s</dd>{/if}
      {#if recovery.observedAccelerationBefore!=null&&recovery.observedAccelerationAfter!=null}<dt title="Acceleration around the recovery, including other active effects.">Nearby acceleration</dt><dd>{recovery.observedAccelerationBefore.toFixed(2)} → {recovery.observedAccelerationAfter.toFixed(2)} m/s²</dd>{/if}
    </dl></div>{/if}
    {#if expanded&&!useMotion&&impact.unavailableReasons?.length}<div class="missing-reasons">{#each impact.unavailableReasons.slice(0,2) as reason}<p>{reason}</p>{/each}</div>{/if}
    {#if carryover&&(Math.abs(carryover.distanceDelta??0)>.0001||Math.abs(carryover.distanceDeltaMin??0)>.0001||Math.abs(carryover.distanceDeltaMax??0)>.0001)}<div class="carryover">
      <div class="carryover-heading">Carryover gain{carryover.distanceDelta==null&&carryover.distanceDeltaMin!=null?' · target scenarios':''}</div>
      <div class="impact-stats">
        {#if carryover.entrySpeedDelta!=null}<span title="Speed advantage at the start of the carryover period.">{signed(carryover.entrySpeedDelta,'m/s')}</span>{/if}
        {#if carryover.distanceDelta!=null}<span>{signed(carryover.distanceDelta,'m')}</span>{:else if carryover.distanceDeltaMin!=null&&carryover.distanceDeltaMax!=null}<span title="Estimated carryover benefit range.">{distanceRange(carryover.distanceDeltaMin,carryover.distanceDeltaMax)}</span>{/if}
        {#if carryover.timeDelta!=null}<span>{Math.abs(carryover.timeDelta).toFixed(3)} s {carryover.timeDelta>0?'lost':'saved'}</span>{:else if carryover.timeDeltaMin!=null&&carryover.timeDeltaMax!=null}<span title="Estimated carryover benefit range.">{timeRange(carryover.timeDeltaMin,carryover.timeDeltaMax)}</span>{/if}
      </div>
    </div>{/if}
  </div>
{/if}
<style>
.recovery-timing{margin-top:15px;padding-top:12px;border-top:1px solid var(--border)}.recovery-timing dl{display:grid;grid-template-columns:1fr auto;gap:7px 16px;margin:10px 0 0;font-size:var(--font-12)}.recovery-timing dt{color:var(--muted)}.recovery-timing dd{margin:0;font-variant-numeric:tabular-nums}
.skill-impact{font-size:var(--font-11);line-height:1.4;margin-top:6px;color:var(--text)}.utilization{min-width:100px}.meter-heading{display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;font-size:var(--font-11);color:var(--muted)}.meter-heading strong{color:var(--text);font-variant-numeric:tabular-nums;font-weight:550}.meter{height:4px;border-radius:3px;background:var(--border);overflow:hidden}.meter i{display:block;height:100%;border-radius:inherit;background:var(--accent)}.utilization>small{display:block;margin-top:3px;color:var(--muted);font-size:var(--font-11)}.impact-stats{display:flex;flex-wrap:wrap;gap:5px 12px;margin-top:6px;font-variant-numeric:tabular-nums}.impact-stats small{margin-left:4px;color:var(--muted);font-size:var(--font-11)}.impact-stats:empty{display:none}.carryover{margin-top:9px;padding-top:7px;border-top:1px solid var(--border)}.carryover-heading{font-size:var(--font-11);color:var(--muted)}.expanded{font-size:var(--font-13);margin-top:0}.expanded .meter-heading{font-size:var(--font-12)}.expanded .meter{height:8px}.expanded .impact-stats{gap:7px 18px;margin-top:10px}.expanded .carryover-heading{font-size:var(--font-12);font-weight:550;color:var(--text)}.expanded .carryover{margin-top:15px;padding-top:12px}.unavailable,.missing-reasons p{font-size:var(--font-11);color:var(--muted);margin:6px 0 0}
</style>
