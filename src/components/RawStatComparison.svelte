<script lang="ts">
  import {onMount} from 'svelte';
  import {dismissDialog} from '../ui/dismiss-dialog';
  import {portraitUrl} from '../data/portraits';
  import StrategyBadge from './StrategyBadge.svelte';
  import type {CourseReference} from '../data/reference';
  import {rawStatKeys,type RawStatProfile,type ComparisonKey,type compareRawStats} from '../data/raw-stat-comparison';
  import {statColors} from '../sandbox/stat-colors';
  import {moodNames} from '../sandbox/model';
  import GameIcon from './GameIcon.svelte';
  export let profiles:RawStatProfile[],course:CourseReference,ground:number,initialId='';
  export let onClose:()=>void;
  let from=profiles.find(p=>p.id===initialId)?.id??profiles[0]?.id,to=profiles.find(p=>p.id!==from)?.id??from;
  let worker:Worker|null=null,request=0,busy=true,error='';
  let result:ReturnType<typeof compareRawStats>|null=null;
  const labels:Record<ComparisonKey,string>={speed:'Speed',stamina:'Stamina',power:'Power',guts:'Guts',wisdom:'Wit',distance:'Distance aptitude',surface:'Surface aptitude',strategyAptitude:'Strategy aptitude'};
  const formulas:Record<ComparisonKey,string[]>={
    speed:['B = 20 − (distance − 2000) / 1000.',
      'Late target = B × style coefficient + 0.002 × √(500 × Speed) × distance aptitude.',
      'Maximum spurt = 1.05 × (late target + 0.01B) + the Speed term again + 0.0001 × (450 × Guts)^0.597.'],
    stamina:['Starting HP = race distance + 0.8 × style coefficient × Stamina.',
      'HP/s = 20 × (speed − B + 12)² / 144 × ground factor × late-race Guts factor.',
      'The remaining HP determines which spurt speeds and starting points are affordable.'],
    power:['Acceleration = 0.0006 × √(500 × Power) × style, surface and distance factors; uphill uses 0.0004.',
      'Uphill target loss = slope (%) × 200 / Power.',
      'Velocity continues across the hill boundary, including into late race.'],
    guts:['Late-race HP factor = 1 + 200 / √(600 × Guts).',
      'Spurt target adds 0.0001 × (450 × Guts)^0.597.',
      'Minimum speed = 0.85B + 0.001 × √(200 × Guts).',
      'The Early duel subline is the additional Guts advantage if an eligible partner stays nearby: a 2 s proximity warmup with a partner up to 3 m ahead, own entry to the final straight and at least 15% HP to start, ending below 5% HP.',
      'Target bonus = 0.0001 × (200 × Guts)^0.708; acceleration bonus = 0.0001 × (160 × Guts)^0.59.',
      'This conditional increment is excluded from Combined stat advantage.'],
    wisdom:['Mean section adjustment = B × (Wit / 5500 × log₁₀(0.1 × Wit) − 0.325) / 100.',
      'Downhill entry chance = min(1, Wit × 0.0004) per check; exit chance is 20% per second.',
      'Spurt candidate checks use 15 + 0.05 × Wit percent.',
      'Skill checks and rushed are excluded.'],
    distance:['Distance aptitude multiplies the Speed term: G→S = 0.1, 0.2, 0.4, 0.6, 0.8, 0.9, 1, 1.05.',
      'Acceleration factors are 0.4, 0.5, 0.6, 1, 1, 1, 1, 1.'],
    surface:['Surface aptitude multiplies acceleration: G→S = 0.1, 0.3, 0.5, 0.7, 0.8, 0.9, 1, 1.05.'],
    strategyAptitude:['Strategy aptitude multiplies Wit: G→S = 0.1, 0.2, 0.4, 0.6, 0.75, 0.85, 1, 1.1.',
      'This changes section pacing, downhill checks and spurt selection in this model.']
  };
  $: baseline=profiles.find(p=>p.id===from);
  $: comparison=profiles.find(p=>p.id===to);
  function calculate(w:Worker,a:RawStatProfile,b:RawStatProfile,g:number,c:CourseReference){busy=true;error='';w.postMessage({id:++request,reference:a,comparison:b,context:{course:c,ground:g}});}
  $: if(worker&&baseline&&comparison)calculate(worker,baseline,comparison,ground,course);
  onMount(()=>{const w=new Worker(new URL('../analysis/raw-stat-worker.ts',import.meta.url),{type:'module'});w.onmessage=e=>{if(e.data.id!==request)return;result=e.data.result??null;error=e.data.error??'';busy=false;};w.onerror=()=>{busy=false;error='The comparison could not be calculated.';};worker=w;return()=>w.terminate();});
  function open(node:HTMLDialogElement){node.showModal();return{destroy:()=>node.close()};}
  const signed=(v:number,d=2)=>`${Math.abs(v)<.5*10**-d?'':v>0?'+':'−'}${Math.abs(v).toFixed(d)}`;
  const raw=(p:RawStatProfile|undefined,key:ComparisonKey)=>rawStatKeys.includes(key as typeof rawStatKeys[number])?p?.stats[key as keyof typeof p.stats]??'—':p?.[key as 'distance']?'GFEDCBAS'[p[key as 'distance']!-1]:'—';
  const color=(key:ComparisonKey)=>statColors[key as keyof typeof statColors]??'#b6a7ed';
  $: sides=result&&baseline&&comparison?[{profile:baseline,other:comparison,data:result.left},{profile:comparison,other:baseline,data:result.right}]:[];
  $: scale=Math.max(.1,...sides.flatMap(s=>s.data.rows.map(r=>Math.abs(r.distance))));
  let expanded=new Set<string>();
  function toggle(key:string){expanded=new Set(expanded);if(expanded.has(key))expanded.delete(key);else expanded.add(key);}
  const portrait=(p:RawStatProfile)=>portraitUrl({charaId:p.charaId??null,cardId:p.cardId??null});
</script>
<dialog use:open use:dismissDialog onclose={onClose} aria-label="Compare raw stats">
  <header><div><span class="eyebrow">RAW STAT ADVANTAGE · ESTIMATE</span><h2>Compare raw stats</h2><small>{course.trackName} · {course.distance} m</small></div><button class="close" aria-label="Close raw stat comparison" onclick={onClose}>×</button></header>
  <div class="choices"><label>Uma A<select aria-label="Reference runner" bind:value={from}>{#each profiles as p}<option value={p.id}>{p.name}</option>{/each}</select></label><label>Uma B<select aria-label="Comparison runner" bind:value={to}>{#each profiles as p}<option value={p.id}>{p.name}</option>{/each}</select></label></div>
  {#if error}<p role="alert">{error}</p>{:else if busy}<div class="working" role="status">Calculating stat contributions…</div>{:else if result}
    <div class="columns">{#each sides as side,i}<section class="runner-column" style={`--runner:${i?'#f0b46e':'#83b6ef'}`}>
      <div class="identity">{#if portrait(side.profile)}<img src={portrait(side.profile)!} alt=""/>{/if}<div><h3>{side.profile.name}</h3><div class="context"><StrategyBadge runner={{strategy:null,strategyCode:side.profile.strategy}} compact/>{#if side.profile.moods?.length}<span title="Weighted over the moods recorded in this batch">Batch moods</span>{:else}<GameIcon name={`mood-${side.profile.mood}`} label={moodNames[side.profile.mood??0]} size={20}/>{/if}</div></div></div>
      <div class="overall"><span>Combined stat advantage</span><strong class:loss={side.data.total.distance<0}>{signed(side.data.total.distance)} m</strong><small>{signed(side.data.total.time,3)} s</small></div>
      <table aria-label={`${side.profile.name} stat advantages`}><thead><tr><th>Stat</th><th>Own / other</th><th>Distance</th><th>Time</th><th aria-label="Explanation"></th></tr></thead><tbody>{#each side.data.rows as row}{@const key=`${i}:${row.key}`}<tr class:has-duel={!!row.dueling} style={`--stat:${color(row.key)}`}>
        <th><div class="stat-label">{#if rawStatKeys.includes(row.key as typeof rawStatKeys[number])}<GameIcon name={`stat-${row.key}`} size={20}/>{/if}<span>{labels[row.key]}</span></div></th>
        <td>{raw(side.profile,row.key)} <small>/ {raw(side.other,row.key)}</small></td>
        <td><strong>{signed(row.distance)} m</strong><span class="impact-track"><i></i><b style:left={`${row.distance>=0?50:50+48*row.distance/scale}%`} style:width={`${48*Math.abs(row.distance)/scale}%`}></b></span></td><td>{signed(row.time,3)} s</td><td class="details-cell"><button class="details-toggle" aria-label={`${expanded.has(key)?"Hide":"Explain"} ${labels[row.key]} for ${side.profile.name}`} aria-expanded={expanded.has(key)} aria-controls={`stat-explanation-${i}-${row.key}`} onclick={()=>toggle(key)}><span>{expanded.has(key)?"Hide":"Details"}</span><svg class:open={expanded.has(key)} viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button></td>
      </tr>{#if row.dueling}<tr class="dueling"><th><span title="Additional Guts advantage assuming the earliest eligible duel; excluded from the combined total.">Early duel</span></th><td></td><td><b>{signed(row.dueling.distance)} m</b></td><td><b>{signed(row.dueling.time,3)} s</b></td><td></td></tr>{/if}{#if expanded.has(key)}<tr class="formula" id={`stat-explanation-${i}-${row.key}`}><td colspan="5"><div class="speed-comparison"><span>Spurt target: own <b>{side.data.base.maxSpurt.toFixed(3)}</b> − with other {labels[row.key].toLowerCase()} <b>{row.substitutedSpurt.toFixed(3)}</b> = <b>{signed(row.spurtSpeed,3)} m/s</b></span></div><ul>{#each formulas[row.key] as formula}<li>{formula}</li>{/each}{#if row.dueling}<li><b>Assumed duel:</b> {row.dueling.duration.toFixed(2)} s with own Guts · {row.dueling.otherDuration.toFixed(2)} s with other Guts.</li><li><b>Duel target bonus:</b> +{row.dueling.targetSpeed.toFixed(3)} / +{row.dueling.otherTargetSpeed.toFixed(3)} m/s.</li>{/if}</ul></td></tr>{/if}{/each}</tbody><tfoot><tr><th colspan="2" title="Combined advantage minus the isolated contributions; HP and course thresholds make these non-additive.">Interactions</th><td>{signed(side.data.interaction.distance)} m</td><td>{signed(side.data.interaction.time,3)} s</td><td></td></tr></tfoot></table>
    </section>{/each}</div>
    <p class="scope">Each column keeps that Uma’s strategy and mood. Gains compare its own stat with the other Uma’s stat substituted into the same build.</p>
    <details class="method"><summary>Model and limits</summary><p>For Uma A, the Speed row compares A with its own Speed against A with B’s Speed. A’s strategy, mood, other stats and aptitudes stay fixed. The other rows work the same way, including separate aptitude substitutions. B’s column uses B’s own context. Positive values are an advantage from the Uma’s own input; the two columns need not be opposites.</p><p>Raw stats above 1200 are halved beyond 1200, then mood, course thresholds, ground and aptitude apply. Acceleration, HP and spurt choices are integrated through the course’s hills, retaining speed across hill boundaries. Randomized moods use the batch’s observed mood frequencies. Distance equivalent is time saved multiplied by that Uma’s modeled finish speed.</p><p>This mathematical estimate averages section pacing, downhill occupancy and spurt choices. Downhill branches keep separate speeds but share mean position and HP, so the exact chance of leaving a hill before the next check is approximated. Checks use a one-second approximation rather than the engine’s frame timing. Skills, traffic, lane movement, position keep, rushed, conserve/release power and scenario bonuses are excluded. Dueling is shown separately as a conditional increment. It estimates stat contribution, not finishing order.</p></details>
  {/if}
</dialog>
<style>
  dialog{width:min(1200px,calc(100vw - 32px));max-height:92dvh;overflow:auto;padding:24px;border:1px solid var(--border);border-radius:14px;background:var(--panel);color:var(--text);box-shadow:var(--shadow)}dialog::backdrop{background:#070c14b0}header{display:flex;justify-content:space-between;gap:12px}.eyebrow{font-size:10px;letter-spacing:.1em;color:#aebbd0}h2{font-size:24px;margin:5px 0}header small{font-size:12px;color:var(--muted)}.close{border:0;background:none;font-size:25px;align-self:flex-start}.choices{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin:20px 0}.choices label{display:grid;gap:6px;font-size:11px}.choices select{width:100%;min-width:0;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:9px;font-size:12px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:22px}.runner-column{min-width:0;border:1px solid var(--border);border-top:2px solid var(--runner);border-radius:9px;background:var(--bg);padding:16px}.identity{display:flex;align-items:center;gap:12px}.identity>img{height:48px;width:48px;object-fit:contain}.identity h3{font-size:16px;margin:0 0 7px;color:var(--runner)}.context{display:flex;gap:14px;align-items:center;font-size:11px;color:var(--muted)}.overall{display:flex;align-items:baseline;gap:12px;padding:17px 0;border-bottom:1px solid var(--border);margin-bottom:10px;flex-wrap:wrap}.overall>span{font-size:11px;color:var(--muted);margin-right:auto}.overall strong{font-size:22px;font-weight:550;color:#8bd2b1}.overall strong.loss{color:#efa1a8}.overall small{font-size:12px;color:var(--muted)}table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}th,td{padding:11px 5px;text-align:right;border-bottom:1px solid var(--border)}th:first-child{text-align:left;font-weight:400;color:var(--text);background:transparent;text-transform:none;letter-spacing:normal}thead th{font-size:10px;color:var(--muted)!important;font-weight:500}tbody th{width:29%}td{white-space:nowrap}td strong{font-weight:550;color:var(--stat)}td small{font-size:10px;color:var(--muted)}.stat-label{display:flex;align-items:center;gap:6px;font-size:12px;line-height:1.4}.details-cell{padding-left:8px;padding-right:0}.details-toggle{display:flex;align-items:center;justify-content:center;gap:5px;border:1px solid color-mix(in srgb,var(--runner) 35%,var(--border));border-radius:5px;background:color-mix(in srgb,var(--runner) 7%,var(--bg));color:var(--runner);font-size:10px;padding:5px 7px;cursor:pointer;min-width:62px}.details-toggle:hover,.details-toggle[aria-expanded=true]{background:color-mix(in srgb,var(--runner) 16%,var(--bg));border-color:var(--runner)}.details-toggle:focus-visible{outline:2px solid var(--runner);outline-offset:2px}.details-toggle svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;transition:transform .15s;flex-shrink:0}.details-toggle svg.open{transform:rotate(180deg)}.has-duel th,.has-duel td{border-bottom:0;padding-bottom:3px}.dueling th,.dueling td{padding-top:9px;padding-bottom:9px;font-size:12px;color:#f0a8cc;background:color-mix(in srgb,#e681b7 8%,var(--bg))}.dueling th{box-shadow:inset 3px 0 #e681b7}.dueling th span{padding-left:10px;font-weight:600}.dueling b{font-weight:600}.impact-track{display:block;position:relative;height:12px;margin-top:4px;min-width:55px;background:linear-gradient(var(--border),var(--border)) center/100% 1px no-repeat}.impact-track i{position:absolute;left:50%;height:100%;width:1px;background:var(--border)}.impact-track b{position:absolute;top:4px;height:4px;background:var(--stat);border-radius:2px}.formula td{text-align:left;white-space:normal;padding:12px;background:var(--panel);font-size:11px;color:var(--muted);line-height:1.6}.formula ul{margin:10px 0 0;padding-left:17px;display:grid;gap:8px}.formula li{padding-left:3px}.formula li::marker{color:var(--runner)}.formula li b{color:var(--text);font-weight:550}.speed-comparison{color:var(--text)}tfoot th,tfoot td{font-size:11px;border-bottom:0;color:var(--muted)!important}tfoot th{font-weight:400}.scope{font-size:12px;line-height:1.6;color:var(--muted);margin:14px 0}.method{border-top:1px solid var(--border);padding-top:14px}.method summary{font-size:12px;cursor:pointer}.method p{font-size:12px;line-height:1.6;color:var(--muted)}.working{padding:60px;text-align:center;color:var(--muted)}[role=alert]{color:#efa1a8}@media(max-width:980px){.columns{grid-template-columns:1fr}.choices{gap:12px}}
</style>
