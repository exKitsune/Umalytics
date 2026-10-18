import type {StatusInterval} from '../data/analytics';
import type {JsonObject} from './contracts';
import type {DecisionEvent} from './trace';

export interface PowerRelease {start:number;end:number;acceleration:number|null;gauge:number|null;distance:number|null}
export interface PowerSummary {status:string;gauge:number|null;accumulationSeconds:number|null;releases:PowerRelease[];intervals:StatusInterval[]}
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
/** The clean accumulation ledger is distinct from the engine's legacy cp_acc.
 * Never interpret a nonzero gauge as an active release. */
export function powerSummary(events:DecisionEvent[],diagnostic:JsonObject|undefined,stop:number):PowerSummary{
  const timeline=(Array.isArray(diagnostic?.timeline)?diagnostic.timeline:[]) as JsonObject[];
  const intervals:StatusInterval[]=[];let start:number|null=null;
  const close=(end:number)=>{if(start!==null&&end>start)intervals.push({kind:'conserve-power',label:'Conserve power',start,end,evidence:'simulated',detail:'Actual accumulation-clock window; excludes interruptions and the 1.5 s restart cooldown.'});start=null;};
  for(const row of timeline){const t=number(row.t);if(t===null)continue;
    if(row.kind==='clockStarted')start=t;
    if(row.kind==='cooldownStarted'){close(t);start=(number(row.nextGainAt)??t+2.5)-1;}
    if(['gainBlocked','accumulationCutoff','unsupported','release'].includes(String(row.kind)))close(Math.min(stop,t));
  }
  close(stop);
  const releases=events.filter(e=>e.skillId==='asitame'&&e.kind==='skill-activated').map(e=>{
    const effect=events.find(x=>x.sequence>e.sequence&&x.tick===e.tick&&x.skillId==='asitame'&&x.kind==='effect-applied'&&x.data.type===31);
    const expiry=events.find(x=>x.sequence>e.sequence&&x.skillId==='asitame'&&x.kind==='effect-ended');
    const row=timeline.find(x=>x.kind==='release'&&Math.abs(Number(x.t)-e.time)<.001);
    const end=Math.min(stop,expiry?.time??e.time+Number(effect?.data.duration??0));
    return {start:e.time,end,acceleration:number(effect?.data.modifier),gauge:row?.usedLegacyFallback===false?number(row.gauge):null,distance:number(row?.distance)};
  });
  for(const release of releases)intervals.push({kind:'release-conserve-power',label:'Release power',start:release.start,end:release.end,evidence:'simulated',detail:`Actual power release: ${release.acceleration===null?'acceleration unavailable':`+${release.acceleration.toFixed(4)} m/s²`} for ${(release.end-release.start).toFixed(3)} s${release.gauge===null?'':`; gauge ${release.gauge.toFixed(2)}`}.`});
  const status=String(diagnostic?.finalStatus??'unavailable');
  return {status,gauge:status==='supported'?number(diagnostic?.finalGauge):null,accumulationSeconds:diagnostic?intervals.filter(i=>i.kind==='conserve-power').reduce((n,i)=>n+i.end!-i.start,0):null,releases,intervals};
}
