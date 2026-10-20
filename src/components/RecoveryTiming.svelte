<script lang="ts">
import type {RecoveryTiming} from '../data/effect-types';
export let recovery:RecoveryTiming|null|undefined;
export let starts:number[]=[];
$: lateOffset=recovery?.eventDistance!=null&&recovery.remainingDistance!=null?recovery.eventDistance-(recovery.eventDistance+recovery.remainingDistance)*2/3:null;
</script>
<dl class="recovery-timing"><dt>Timing</dt><dd>{starts.length?starts.map(t=>`${t.toFixed(2)} s`).join(', '):'Not recorded'}</dd>
<dt>Late-race boundary</dt><dd>{lateOffset===null?'Unavailable':Math.abs(lateOffset)<.05?'At late-race start':`${Math.abs(lateOffset).toFixed(1)} m ${lateOffset<0?'before':'after'}`}</dd></dl>
<style>.recovery-timing{display:grid;grid-template-columns:1fr auto;gap:8px 15px;font-size:var(--font-12);margin:0}.recovery-timing dt{color:var(--muted)}.recovery-timing dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}</style>
