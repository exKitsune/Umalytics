import { trafficActive, trafficAt, trafficColor } from '../simulation/traffic';
import type { ReplayCard, ReplayOptions, ReplayScene } from './model';
import type { RunnerSample } from '../data/types';
import type { StatusInterval } from '../data/analytics';
import { combinedStatusIntervals, statusLabel } from '../data/status-presentation';
import { skillName, runnerName, getSkillReference, type SkillReference } from '../data/reference';
import { statusColor, statusDescription } from '../data/analysis-copy';
import { iconSource, skillIconKey } from '../data/game-icons';
import { placeReplayCards } from './layout';
import { receivedEffectWindow } from './received-effects';

export const CARD_DWELL=2.5;
export const STATUS_MIN_DISPLAY=.6;
export const TRAFFIC_MIN_DISPLAY=.75;
export const STATUS_CLEAR_DELAY=.35;
const hiddenReplayStatuses=new Set(['downhill-section','rushed-boost','force-in','conserve-power']);

interface StatusEpisode {kind:string;start:number;displayEnd:number;segments:StatusInterval[]}
const statusCache=new WeakMap<StatusInterval[],{length:number;episodes:StatusEpisode[]}>();
/** Display holds are separate from simulation intervals and traffic totals.
 * Calculate them from race time so seeking/rewinding never inherits UI state. */
function statusEpisodes(intervals:StatusInterval[]):StatusEpisode[]{
  const cached=statusCache.get(intervals);if(cached?.length===intervals.length)return cached.episodes;
  const segments=combinedStatusIntervals(intervals,{includeModels:true}).flatMap(status=>{
    if(hiddenReplayStatuses.has(status.kind))return [];
    return status.traffic?status.traffic.filter(tick=>trafficActive(status,tick.start)).map(tick=>({...status,start:tick.start,end:tick.end})):[status];
  }).sort((a,b)=>a.start-b.start);
  const episodes:StatusEpisode[]=[],last=new Map<string,StatusEpisode>();
  for(const status of segments){
    const stop=status.end??status.observedUntil??status.start+CARD_DWELL;
    const displayEnd=status.kind==='last-spurt'?Math.min(stop,status.start+CARD_DWELL):Math.max(status.start+(status.kind==='traffic'?TRAFFIC_MIN_DISPLAY:STATUS_MIN_DISPLAY),stop+STATUS_CLEAR_DELAY);
    const prior=last.get(status.kind);
    if(prior&&status.kind!=='last-spurt'&&status.start<=prior.displayEnd){prior.segments.push(status);prior.displayEnd=Math.max(prior.displayEnd,displayEnd);}
    else{const episode={kind:status.kind,start:status.start,displayEnd,segments:[status]};episodes.push(episode);last.set(status.kind,episode);}
  }
  statusCache.set(intervals,{length:intervals.length,episodes});return episodes;
}
type Effects=SkillReference['branches'][number]['effects'];
/** Keep mixed effects and unresolved skills; hide only known self-only vision. */
function selfVisionOnly(options:ReplayOptions,id:number,effects?:Effects):boolean{
  const onlyVision=(values:Effects)=>values.length>0&&values.every(e=>e.type===8&&(e.targetType??1)===1);
  if(effects?.length)return onlyVision(effects);
  const branches=getSkillReference(options.reference,id)?.branches;
  return !!branches?.length&&branches.every(branch=>onlyVision(branch.effects));
}
function passiveSkill(options:ReplayOptions,id:number,branchIndex?:number|null):boolean {
  const branches=getSkillReference(options.reference,id)?.branches.filter((branch,index)=>branchIndex==null||(branch.branchIndex??index)===branchIndex);
  return !!branches?.length&&branches.every(branch=>branch.rawDuration<0);
}
type CardInput=Omit<ReplayCard,'displayEnd'|'progress'|'alpha'>&{observedUntil?:number;displayUntil?:number;displayStart?:number};
function card(value:CardInput,time:number):ReplayCard|null {
  // Notification dwell never truncates the underlying passive or spurt effect.
  const statusKind=value.kind==='status'?value.id.split(':')[1].replace(/-model$/,''):null;
  const spurtProc=statusKind==='last-spurt',trafficProc=statusKind==='traffic';
  const proc=spurtProc||value.passive;
  const displayEnd=value.passive?value.start+CARD_DWELL:spurtProc?Math.min(value.end??Infinity,value.start+CARD_DWELL):trafficProc?Math.max(value.start+TRAFFIC_MIN_DISPLAY,value.displayUntil??value.end??value.observedUntil??value.start):value.displayUntil??(value.kind==='status'&&value.end!==null?value.end:Math.max(value.start+CARD_DWELL,value.end??value.observedUntil??value.start));
  if(time<value.start||time>=displayEnd)return null;
  // Traffic ticks refresh the color, not a countdown. Keep active vs recently
  // active evidence intact while its notification survives a brief clear gap.
  const progress=!proc&&!trafficProc&&value.end!==null&&value.end>value.start?Math.max(0,Math.min(1,(value.end-time)/(value.end-value.start))):null;
  return {...value,displayEnd,progress,visualOnly:!!proc||value.visualOnly||value.end!==null&&time>=value.end,
    alpha:Math.min(1,(time-(value.displayStart??value.start))/.4,(displayEnd-time)/.2)};
}
export function replayCards(options:ReplayOptions,runnerId:string,time:number,sample:RunnerSample):ReplayCard[] {
  const result:ReplayCard[]=[];
  const add=(value:CardInput)=>{const visible=card(value,time);if(visible)result.push(visible);};
  const runner=options.analysis?.runners[runnerId];
  if(runner){
    for(const episode of statusEpisodes(runner.intervals)){
      if(time<episode.start||time>=episode.displayEnd)continue;
      let lo=0,hi=episode.segments.length;
      while(lo<hi){const mid=(lo+hi)>>>1;if(episode.segments[mid].start<=time)lo=mid+1;else hi=mid;}
      const status=episode.segments[Math.max(0,lo-1)];
      const end=status.end;
      const colorTime=Math.min(time,(end??status.observedUntil??time)-1e-7);
      add({id:`status:${status.kind}:${episode.start}`,kind:'status',label:statusLabel(status.kind),iconKey:'',color:status.traffic?trafficColor(trafficAt(status,colorTime)):statusColor(status.kind),start:status.start,end,observedUntil:status.observedUntil,displayStart:episode.start,displayUntil:episode.displayEnd,
        visualOnly:end===null&&time>=(status.observedUntil??status.start),detail:`${status.evidence==='estimated'?'Modeled status. ':''}${status.detail}${end===null?' End unknown; 2.5s display dwell only.':''}`});
    }
    for(const skill of runner.skillActivations){
      if(selfVisionOnly(options,skill.referenceSkillId??skill.skillId,skill.effects))continue;
      const end=skill.effectiveEnd??skill.end,passive=skill.timingKind==='passive'||passiveSkill(options,skill.referenceSkillId??skill.skillId,skill.effectBranch);
      add({id:`skill:${skill.skillId}:${skill.start}`,kind:'skill',label:skillName(options.reference,skill.referenceSkillId??skill.skillId),
        iconKey:skillIconKey(options.reference,skill.referenceSkillId??skill.skillId),color:'#79ca0b',start:skill.start,end,passive,
        visualOnly:end===null||end<=skill.start,detail:`${skill.timingReason??skill.detail}${end===null||end<=skill.start?' 2.5s display dwell only; not an effect duration.':''}`});
    }
  }else{
    for(const interval of options.intervals?.(runnerId)??[]){
      const isSkill=interval.skillId!=null;
      if(isSkill?selfVisionOnly(options,interval.skillId!):hiddenReplayStatuses.has(interval.kind.replace(/-model$/,'')))continue;
      add({id:`interval:${interval.kind}:${interval.start}`,kind:isSkill?'skill':'status',label:isSkill?interval.label:statusLabel(interval.kind),
        iconKey:isSkill?skillIconKey(options.reference,interval.skillId!):'',color:statusColor(interval.kind),start:interval.start,end:interval.end,passive:isSkill&&passiveSkill(options,interval.skillId!),
        visualOnly:interval.end===null,detail:`${interval.evidence}. ${interval.detail??''}${interval.end===null?' 2.5s display dwell only.':''}`});
    }
    if(!options.intervals){
      if(sample.temptationMode!=null&&sample.temptationMode>0)add({id:'observed:rushed',kind:'status',label:'RUSH',iconKey:'',color:statusColor('rushed'),start:0,end:null,observedUntil:time+.001,visualOnly:false,detail:'Recorded current rushed state.'});
      if(sample.hp===0)add({id:'observed:hp-empty',kind:'status',label:'Exhausted',iconKey:'',color:statusColor('hp-empty'),start:0,end:null,observedUntil:time+.001,visualOnly:false,detail:'Recorded HP is zero.'});
      if(sample.blockFrontRunnerIndex!=null&&sample.blockFrontRunnerIndex>=0)add({id:'observed:block',kind:'status',label:'Blocked',iconKey:'',color:statusColor('front-block'),start:0,end:null,observedUntil:time+.001,visualOnly:false,detail:'Recorded current front block.'});
      for(const event of options.race.events)if(event.runnerId===runnerId&&(event.type===3||event.type==='3')&&(event.skillId===null||!selfVisionOnly(options,event.skillId)))add({id:`event:${event.skillId}:${event.time}`,kind:'skill',label:event.skillId===null?event.label:skillName(options.reference,event.skillId),iconKey:event.skillId===null?'':skillIconKey(options.reference,event.skillId),color:'#79ca0b',start:event.time,end:null,visualOnly:true,detail:'Recorded activation; 2.5s display dwell only.'});
    }
  }
  if(options.overlays?.debuffs)for(const activation of options.debuffActivations??options.analysis?.debuffs??[]){
    if(!activation.recipientsKnown||!activation.targetRunnerIds.includes(runnerId)||activation.sourceRunnerId===runnerId)continue;
    const window=receivedEffectWindow(activation,runnerId);if(!window)continue;
    const {start,end,confirmed,passive}=window;
    const source=options.race.runners.find(r=>r.id===activation.sourceRunnerId),target=options.race.runners.find(r=>r.id===runnerId);
    const immune=!confirmed&&source?.teamGroup!=null&&target?.teamGroup!=null&&source.teamGroup===target.teamGroup;
    const impact=runner?.receivedDebuffImpacts.find(i=>i.sourceRunnerId===activation.sourceRunnerId&&i.skillId===activation.skillId&&i.start===activation.start);
    add({id:`received:${activation.sourceRunnerId}:${activation.skillId}:${activation.start}`,sourceRunnerId:activation.sourceRunnerId,kind:'received',label:skillName(options.reference,activation.skillId),iconKey:skillIconKey(options.reference,activation.skillId),color:immune?'#97a1ba':'#e47474',start,end,confirmed,passive,
      visualOnly:end===null||end<=start,detail:confirmed?'Confirmed applied effect.':`${immune?'Same-team selected recipient; immune, not an applied hit. ':''}${impact?.detail??''} Recorded target mask from ${activation.sourceRunnerId}; recipient selection is not proof of final effect (teammates may be immune). ${activation.timingReason??activation.detail}`});
  }
  return result;
}
export function replayCardHelp(options:ReplayOptions,value:ReplayCard):string {
  if(value.passive&&value.kind!=='received')return 'Passive bonus applied.';
  if(value.kind==='status'&&value.id.split(':')[1].replace(/-model$/,'')==='last-spurt')return 'Started the final spurt.';
  if(value.kind==='received'){
    const source=options.race.runners.find(r=>r.id===value.sourceRunnerId);
    if(value.confirmed)return `From ${source?runnerName(options.reference,source):'another runner'}. ${value.passive?'Passive effect applied.':value.end===value.start?'Instant effect applied.':'Effect applied.'}`;
    return `From ${source?runnerName(options.reference,source):'another runner'}. Targeted by this skill. ${value.detail.startsWith('Same-team')?'Same team; immune to this debuff.':'Effect depends on immunity.'}`;
  }
  if(value.kind==='status')return `${value.visualOnly?'Recently active. ':''}${statusDescription(value.id.split(':')[1])}`;
  return value.end===value.start?'Instant effect.':value.end===null?'Duration unavailable.':value.visualOnly?'Effect ended.':'Remaining effect duration.';
}
export const layoutReplayCards=placeReplayCards;

interface IconEntry {image:HTMLImageElement;ready:Promise<void>;loaded:boolean}
const icons=new Map<string,IconEntry>();
function icon(key:string):IconEntry|null {
  if(!key||typeof Image==='undefined')return null;
  const existing=icons.get(key);if(existing)return existing;
  const source=iconSource(key);if(!source)return null;
  const image=new Image();let done=()=>{};const entry={image,loaded:false,ready:new Promise<void>(resolve=>done=resolve)};
  icons.set(key,entry);image.onload=()=>{entry.loaded=image.naturalWidth>0;done();};image.onerror=()=>done();image.src=source;return entry;
}
export function replayIcon(key:string):HTMLImageElement|null {const value=icon(key);return value?.loaded?value.image:null;}
export async function preloadReplayIcons(options:ReplayOptions):Promise<void> {
  const ids=new Set(options.race.events.flatMap(e=>e.skillId===null?[]:[e.skillId]));
  for(const activation of options.debuffActivations??options.analysis?.debuffs??[])ids.add(activation.skillId);
  for(const runner of Object.values(options.analysis?.runners??{}))for(const skill of runner.skillActivations)ids.add(skill.referenceSkillId??skill.skillId);
  await Promise.all([...ids].map(id=>icon(skillIconKey(options.reference,id))?.ready));
}
