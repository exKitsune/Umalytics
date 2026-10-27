<script lang="ts">
  import {dismissDialog} from '../ui/dismiss-dialog';
  import {statColors} from '../sandbox/stat-colors';
  import {STAT_PAIRS,STAT_STEP,STAT_RANGE,nextStatOffset,statTrend,statMeasurementBatch} from '../sandbox/stat-trend';
  import {statCurve,statRange,impactTarget,type StatKey,type ImpactExperiment} from '../sandbox/insights';
  import type {Job} from '../sandbox/model';
  import GameIcon from './GameIcon.svelte';
  export let jobs:Job[];
  export let participantId:string;
  export let runnerName:string;
  export let stat:StatKey;
  export let base:number;
  const count=STAT_PAIRS;
  export let disabled=false;
  export let starting=false;
  export let onRun:(target:ImpactExperiment)=>Promise<void>;
  export let onClose:()=>void;
  let selected:number|null=null;
  let showTrend=true;
  const label=stat==='wisdom'?'Wit':stat.charAt(0).toUpperCase()+stat.slice(1);
  const color=statColors[stat];
  const pct=(n:number)=>`${(n*100).toFixed(1)}%`;
  const signed=(n:number,d=0)=>`${n>0?'+':n<0?'−':''}${Math.abs(n).toFixed(d)}`;
  $: points=statCurve(jobs,participantId,stat);
  $: relevant=jobs.filter(j=>j.setup.variations?.participantId===participantId&&j.setup.variations.builds.some(b=>{
    const original=j.setup.participants.find(p=>p.id===participantId)?.uma;
    const t=original?impactTarget(original,b):null;return t?.kind==='stat'&&t.stat===stat;
  }));
  $: planned=relevant.flatMap(j=>j.setup.variations!.builds.flatMap(b=>{
    const original=j.setup.participants.find(p=>p.id===participantId)!.uma,t=impactTarget(original,b);
    return t?.kind==='stat'&&t.stat===stat?[t.delta]:[];
  }));
  $: low=Math.min(0,...statRange(base),...planned);
  $: high=Math.max(0,...statRange(base),...planned);
  // Retain older 25-point measurements on the graph without scheduling them
  // again as part of the new 50-point range.
  $: offsets=statRange(base,low,high);
  $: lowerExtension=nextStatOffset(low,-1);
  $: upperExtension=nextStatOffset(high,1);
  $: missing=offsets.filter(d=>!points.some(p=>p.offset===d));
  $: batch=statMeasurementBatch(missing.length?missing:offsets,points);
  $: active=relevant.find(j=>['queued','running'].includes(j.phase));
  $: latest=[...relevant].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);
  $: current=points.find(p=>p.offset===selected)??points.find(p=>p.offset===STAT_STEP)??points[0];
  $: trend=statTrend(points);
  $: yLow=Math.max(-100,Math.min(-5,...points.map(p=>Math.floor(p.low*100/5)*5),...(trend?.points.map(p=>Math.floor(p.delta*100/5)*5)??[])));
  $: yHigh=Math.min(100,Math.max(5,...points.map(p=>Math.ceil(p.high*100/5)*5),...(trend?.points.map(p=>Math.ceil(p.delta*100/5)*5)??[])));
  const coordinate=(low:number,high:number,start:number,end:number)=>(value:number)=>start+(end-start)*(value-low)/Math.max(1,high-low);
  $: x=coordinate(low,high,12,88);
  $: y=coordinate(yLow,yHigh,82,12);
  $: plot=[...points.map(p=>({offset:p.offset,delta:p.delta})),{offset:0,delta:0}].sort((a,b)=>a.offset-b.offset);
  $: path=plot.map(p=>`${x(p.offset)},${y(p.delta*100)}`).join(' ');
  $: trendPath=trend?.points.map(p=>`${x(p.offset)},${y(p.delta*100)}`).join(' ')??'';
  $: ticks=[low,...offsets.filter(d=>d!==low&&d!==high),0,high].filter((d,i,a)=>a.indexOf(d)===i&&(d%STAT_STEP===0||d===low||d===high)).sort((a,b)=>a-b);
  function show(node:HTMLDialogElement){node.showModal();return {destroy:()=>node.close()};}
  async function runRange(){if(!disabled&&batch.length)await onRun({kind:'stat-range',stat,deltas:batch});}
  async function extend(direction:number){
    const delta=direction<0?lowerExtension:upperExtension;
    if(!disabled&&base+delta>=1&&base+delta<=2000){selected=delta;await onRun({kind:'stat',stat,delta});}
  }
</script>
<dialog use:dismissDialog use:show onclose={onClose} aria-label={`${runnerName} ${label} win-rate curve`} style={`--stat:${color}`}>
  <header><div><span class="eyebrow">STAT SENSITIVITY · {runnerName}</span><h2><GameIcon name={`stat-${stat}`} size={28}/>{label} <small>{base} baseline</small></h2></div><button class="close" aria-label="Close stat curve" onclick={onClose}>×</button></header>
  <p class="intro">Change only {label.toLowerCase()}, keeping the field and other inputs fixed. Each point compares matched races against the original build.</p>
  <div class="controls"><span class="sample-count"><b>{count}</b> pairs / value</span><button class="primary" disabled={disabled||!batch.length} onclick={runRange} title={`Adjustments: ${batch.map(d=>signed(d)).join(', ')}${offsets.length>9?' · Prioritizes values with the fewest samples.':''}`}>{missing.length?'Measure range':`Add ${count} pairs / value`}{offsets.length>9?` · ${batch.length} values`:''} · {count*(batch.length+1)} races</button><small>Results accumulate automatically</small></div>
  {#if starting||active}<div class="progress" role="status"><span>{starting?'Starting stat comparison…':`${active!.completed} / ${active!.total} races · updating curve`}</span><progress max={active?.total??1} value={active?.completed??0}></progress></div>{/if}
  {#if latest&&!active&&['failed','cancelled','interrupted'].includes(latest.phase)}<p class="limit" role="status">Measurement {latest.phase}. Completed pairs are retained. {latest.error??'Add fresh samples to continue.'}</p>{/if}
  <div class="chart-heading"><strong>Win-rate change <small>percentage points</small></strong><label class="trend-toggle" title={`${trend?.kind??'Weighted'} fit weighted by paired sample count and anchored at the unchanged build. Descriptive only.`}><input type="checkbox" bind:checked={showTrend}/>Fitted trend</label><span><i></i>Approx. 95% range per point</span></div>
  <div class="chart" role="group" aria-label={`${label} sensitivity graph`}>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {#each [yLow,0,yHigh] as v}<line class="grid" class:zero={v===0} x1="12" x2="88" y1={y(v)} y2={y(v)}/>{/each}
      <line class="baseline" x1={x(0)} x2={x(0)} y1="10" y2="84"/>
      {#if points.length}<polyline class="curve" points={path}/>{/if}
      {#if showTrend&&trend}<polyline class="trend" points={trendPath}/>{/if}
      {#each points as point}<line class="interval" x1={x(point.offset)} x2={x(point.offset)} y1={y(point.low*100)} y2={y(point.high*100)}/><line class="cap" x1={x(point.offset)-.7} x2={x(point.offset)+.7} y1={y(point.low*100)} y2={y(point.low*100)}/><line class="cap" x1={x(point.offset)-.7} x2={x(point.offset)+.7} y1={y(point.high*100)} y2={y(point.high*100)}/>{/each}
    </svg>
    {#each [yLow,0,yHigh] as v}<span class="y-label" style:top={`${y(v)}%`}>{signed(v)} pp</span>{/each}
    {#each ticks as d}{#if ticks.length<14||d===0||d===low||d===high||d%50===0}<span class="x-label" style:left={`${x(d)}%`}><b>{signed(d)}</b><small>{base+d}</small></span>{/if}{/each}
    <span class="original" style:left={`${x(0)}%`} style:top={`${y(0)}%`} title="Original build: zero change in win rate"></span>
    {#each points as point}<button class="point" class:selected={current?.offset===point.offset} style:left={`${x(point.offset)}%`} style:top={`${y(point.delta*100)}%`} aria-label={`${signed(point.offset)} ${label}: ${signed(point.delta*100,1)} percentage points, ${point.n} pairs`} title={`${label} ${base+point.offset} · ${pct(point.changedRate)} wins vs ${pct(point.baseRate)} baseline · ${point.n} pairs`} onclick={()=>selected=point.offset}></button>{/each}
    {#if !points.length}<div class="empty">Run the range to reveal the curve.<small>−{STAT_RANGE} to +{STAT_RANGE}, in steps of {STAT_STEP}</small></div>{/if}
  </div>
  <div class="extensions"><button disabled={disabled||!points.length||base+lowerExtension<1} onclick={()=>extend(-1)}>← Extend to {signed(lowerExtension)}<small>{count*2} new races</small></button><span>Stat adjustment<small>Absolute stat shown below each tick</small></span><button disabled={disabled||!points.length||base+upperExtension>2000} onclick={()=>extend(1)}>Extend to {signed(upperExtension)} →<small>{count*2} new races</small></button></div>
  {#if current}<div class="point-detail"><div><span>{label} {base+current.offset} <small>({signed(current.offset)})</small></span><strong>{signed(current.delta*100,1)} pp</strong><small>{current.n} unique pairs</small></div><div><span>Win rate</span><strong>{pct(current.changedRate)}</strong><small>Original: {pct(current.baseRate)}</small></div><div><span>Uncertainty range</span><strong class="range">{signed(current.low*100,1)} to {signed(current.high*100,1)} pp</strong><small>{current.low<=0&&current.high>=0?'Gain or loss not established':'Estimated change excludes zero'}</small></div><button disabled={disabled} onclick={()=>onRun({kind:'stat',stat,delta:current.offset})}>Add {count} pairs here<small>{count*2} new races</small></button></div>{/if}
  <p class="note">The dashed trend summarizes measured points; it is not a prediction or confidence bound. Error bars show approximate 95% ranges per point.</p>
  <footer><span>{points.length} measured {points.length===1?'value':'values'} · saved automatically</span><button onclick={onClose}>Done</button></footer>
</dialog>
<style>
  .sample-count{font-size:12px;color:var(--muted)}.sample-count b{color:var(--stat);font-size:18px;margin-right:4px}.trend-toggle{display:flex;align-items:center;gap:6px;margin-left:auto;color:var(--text);font-size:11px;cursor:pointer}.trend-toggle input{accent-color:var(--stat)}.trend{fill:none;stroke:var(--text);stroke-width:2;stroke-dasharray:6 4}.curve{opacity:.4}
  dialog{width:min(1000px,calc(100vw - 32px));max-height:calc(100vh - 40px);padding:26px;overflow:auto;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 90px #0007}dialog::backdrop{background:#091018a8}header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.eyebrow{font-size:11px;color:var(--stat);letter-spacing:.08em}h2{display:flex;align-items:center;gap:10px;margin:10px 0 0;font-size:24px}h2 small{font-size:14px;color:var(--muted);font-weight:400}.close{background:transparent;border:0;font-size:25px;padding:0 4px}.intro{font-size:13px;line-height:1.6;color:var(--muted);margin:16px 0}.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.controls button{padding:10px 14px;font-size:12px}.controls>small{font-size:11px;color:var(--muted)}.limit{font-size:12px;color:#f0bb72}.progress{display:flex;align-items:center;gap:14px;margin:16px 0;font-size:12px}.progress progress{flex:1;accent-color:var(--stat)}.chart-heading{display:flex;justify-content:space-between;gap:12px;margin-top:24px;font-size:12px}.chart-heading strong small{font-weight:400;color:var(--muted);margin-left:6px}.chart-heading>span{font-size:11px;color:var(--muted);display:flex;gap:7px;align-items:center}.chart-heading i{width:1px;height:15px;background:var(--stat)}.chart{position:relative;height:300px;margin-top:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg)}svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}line,polyline{vector-effect:non-scaling-stroke}.grid{stroke:var(--border);stroke-width:1}.grid.zero{stroke:var(--muted);stroke-dasharray:4 4}.baseline{stroke:var(--border);stroke-width:1;stroke-dasharray:3 4}.curve{fill:none;stroke:var(--stat);stroke-width:2}.interval,.cap{stroke:var(--stat);stroke-opacity:.45;stroke-width:1.5}.y-label{position:absolute;left:0;width:10%;transform:translateY(-50%);text-align:right;font-size:11px;color:var(--muted)}.x-label{position:absolute;top:87%;transform:translateX(-50%);font-size:11px;text-align:center;display:grid;gap:3px}.x-label b{font-weight:500}.x-label small{color:var(--muted);font-size:10px}.point{position:absolute;width:26px;height:26px;padding:0;transform:translate(-50%,-50%);border:0;border-radius:50%;background:transparent}.point::after{content:'';position:absolute;inset:7px;border:2px solid var(--stat);background:var(--panel);border-radius:50%}.point.selected::after,.point:hover::after{background:var(--stat);box-shadow:0 0 0 4px color-mix(in srgb,var(--stat) 16%,transparent)}.original{position:absolute;width:7px;height:7px;background:var(--muted);transform:translate(-50%,-50%) rotate(45deg)}.empty{position:absolute;inset:25% 18%;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:10px;font-size:14px;color:var(--muted);background:var(--bg)}.empty small{font-size:12px}.extensions{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:12px 0 18px}.extensions button{font-size:12px;text-align:left;padding:8px 12px}.extensions button:last-child{text-align:right}.extensions small,.extensions>span{display:block;font-size:11px;color:var(--muted);margin-top:5px}.extensions>span{text-align:center}.point-detail{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:16px;background:var(--panel-raised);border:1px solid var(--border);border-radius:8px}.point-detail>div{display:grid;gap:7px}.point-detail span{font-size:12px;color:var(--muted)}.point-detail strong{font-size:21px;color:var(--stat);font-weight:500}.point-detail strong.range{font-size:16px;color:var(--text)}.point-detail small{font-size:11px;color:var(--muted)}.point-detail button{font-size:12px;padding:10px}.point-detail button small{display:block;margin-top:5px}.note{font-size:11px;line-height:1.6;color:var(--muted);margin:16px 0}footer{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border);padding-top:14px;font-size:12px;color:var(--muted)}@media(max-width:650px){dialog{padding:16px}.chart{height:250px}.chart-heading{flex-wrap:wrap}.point-detail{gap:14px}.extensions>span{display:none}h2 small{font-size:12px}.chart-heading strong small{display:block;margin:5px 0 0}}
</style>
