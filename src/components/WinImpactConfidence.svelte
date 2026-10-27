<script lang="ts">
  import type {WinImpact} from '../sandbox/insights';
  export let result:WinImpact;
  export let running=false;
  const pp=(v:number)=>`${v>0?'+':v<0?'−':''}${Math.abs(v*100).toFixed(1)}`;
  const width=(low:number,high:number)=>((high-low)*100).toFixed(1);
  $: uncertain=result.low<=0&&result.high>=0;
  $: min=Math.min(0,result.low);
  $: max=Math.max(0,result.high);
  $: position=(v:number)=>5+90*(v-min)/Math.max(.01,max-min);
</script>

<section class="confidence" aria-label="Win impact confidence interval">
  <div class="heading"><span>95% confidence interval</span><b>{pp(result.low)} to {pp(result.high)} <small>pp</small></b></div>
  <div class="interval" role="img" aria-label={`95% confidence interval: ${pp(result.low)} to ${pp(result.high)} percentage points; estimate ${pp(result.delta)}`}>
    <i class="zero" style:left={`${position(0)}%`}></i>
    <span class="range" style:left={`${position(result.low)}%`} style:width={`${position(result.high)-position(result.low)}%`}></span>
    <b class="estimate" style:left={`${position(result.delta)}%`}></b>
  </div>
  <div class="interpretation"><span>{uncertain?'Direction uncertain · includes zero':result.low>0?'Estimated gain · range above zero':'Estimated loss · range below zero'}{running?' · updating':''}</span><b>{width(result.low,result.high)} pp wide</b></div>
  <p class="note">Approximate 95% range. Small effects may need many more samples.</p>
</section>

<style>
  .confidence{margin:0;padding:15px;background:var(--bg);border:1px solid var(--border);border-radius:8px}.heading,.interpretation{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}.heading{font-size:12px}.heading>span{color:var(--muted)}.heading>b{font-size:16px;font-weight:550;color:#91b7ee}.heading small{font-weight:400;font-size:12px}.interval{height:29px;position:relative;margin:8px 0;background:linear-gradient(var(--border),var(--border)) center/100% 1px no-repeat}.zero{position:absolute;height:100%;top:0;border-left:1px dashed var(--muted);opacity:.65}.range{position:absolute;top:calc(50% - 3px);height:6px;min-width:1px;background:#91b7ee66;border-left:2px solid #91b7ee;border-right:2px solid #91b7ee}.estimate{position:absolute;top:50%;width:8px;height:8px;background:#bdd6fa;transform:translate(-50%,-50%) rotate(45deg)}.interpretation{font-size:11px;color:var(--muted);line-height:1.5}.interpretation>b{font-weight:500;white-space:nowrap;color:var(--text)}.note{font-size:11px;line-height:1.6;color:var(--muted);margin:12px 0 0}@media(max-width:500px){.confidence{padding:12px}}
</style>
