import { trafficActive, trafficAt, trafficColor } from '../simulation/traffic';
import type { ReplayCard, ReplayOptions, ReplayScene } from './model';
import type { RunnerSample } from '../data/types';
import { combinedStatusIntervals, statusLabel } from '../data/status-presentation';
import { skillName, runnerName, getSkillReference, type SkillReference } from '../data/reference';
import { statusColor, statusDescription } from '../data/analysis-copy';
import { iconSource, skillIconKey } from '../data/game-icons';
import { placeReplayCards } from './layout';

export const CARD_DWELL=2.5;
const hiddenReplayStatuses=new Set(['downhill-section','rushed-boost','force-in','conserve-power']);
type Effects=SkillReference['branches'][number]['effects'];
/** Keep mixed effects and unresolved skills; hide only known self-only vision. */
function selfVisionOnly(options:ReplayOptions,id:number,effects?:Effects):boolean{
  const onlyVision=(values:Effects)=>values.length>0&&values.every(e=>e.type===8&&(e.targetType??1)===1);
  if(effects?.length)return onlyVision(effects);
  const branches=getSkillReference(options.reference,id)?.branches;
  return !!branches?.length&&branches.every(branch=>onlyVision(branch.effects));
}
type CardInput=Omit<ReplayCard,'displayEnd'|'progress'|'alpha'>&{observedUntil?:number};
function card(value:CardInput,time:number):ReplayCard|null {
  // Dwell is presentation only: the countdown is always the resolved effect end.
  const displayEnd=value.kind==='status'&&value.end!==null?value.end:Math.max(value.start+CARD_DWELL,value.end??value.observedUntil??value.start);
  if(time<value.start||time>=displayEnd)return null;
  const progress=value.end!==null&&value.end>value.start?Math.max(0,Math.min(1,(value.end-time)/(value.end-value.start))):null;
  return {...value,displayEnd,progress,visualOnly:value.visualOnly||value.end!==null&&time>=value.end,
    alpha:Math.min(1,(time-value.start)/.15,(displayEnd-time)/.15)};
}
export function replayCards(options:ReplayOptions,runnerId:string,time:number,sample:RunnerSample):ReplayCard[] {
  const result:ReplayCard[]=[];
  const add=(value:CardInput)=>{const visible=card(value,time);if(visible)result.push(visible);};
  const runner=options.analysis?.runners[runnerId];
  if(runner){
    for(const status of combinedStatusIntervals(runner.intervals,{includeModels:true})){
      if(hiddenReplayStatuses.has(status.kind)||status.traffic&&!trafficActive(status,time))continue;
      const end=status.end;
      add({id:`status:${status.kind}:${status.start}`,kind:'status',label:statusLabel(status.kind),iconKey:'',color:status.traffic?trafficColor(trafficAt(status,time)):statusColor(status.kind),start:status.start,end,observedUntil:status.observedUntil,
        visualOnly:end===null&&time>=(status.observedUntil??status.start),detail:`${status.evidence==='estimated'?'Modeled status. ':''}${status.detail}${end===null?' End unknown; 2.5s display dwell only.':''}`});
    }
    for(const skill of runner.skillActivations){
      if(selfVisionOnly(options,skill.referenceSkillId??skill.skillId,skill.effects))continue;
      const end=skill.effectiveEnd??skill.end;
      add({id:`skill:${skill.skillId}:${skill.start}`,kind:'skill',label:skillName(options.reference,skill.referenceSkillId??skill.skillId),
        iconKey:skillIconKey(options.reference,skill.referenceSkillId??skill.skillId),color:'#79ca0b',start:skill.start,end,
        visualOnly:end===null||end<=skill.start,detail:`${skill.timingReason??skill.detail}${end===null||end<=skill.start?' 2.5s display dwell only; not an effect duration.':''}`});
    }
  }else{
    for(const interval of options.intervals?.(runnerId)??[]){
      const isSkill=interval.skillId!=null;
      if(isSkill?selfVisionOnly(options,interval.skillId!):hiddenReplayStatuses.has(interval.kind.replace(/-model$/,'')))continue;
      add({id:`interval:${interval.kind}:${interval.start}`,kind:isSkill?'skill':'status',label:isSkill?interval.label:statusLabel(interval.kind),
        iconKey:isSkill?skillIconKey(options.reference,interval.skillId!):'',color:statusColor(interval.kind),start:interval.start,end:interval.end,
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
    const end=activation.effectiveEnd??activation.end;
    const source=options.race.runners.find(r=>r.id===activation.sourceRunnerId),target=options.race.runners.find(r=>r.id===runnerId);
    const immune=source?.teamGroup!=null&&target?.teamGroup!=null&&source.teamGroup===target.teamGroup;
    const impact=runner?.receivedDebuffImpacts.find(i=>i.sourceRunnerId===activation.sourceRunnerId&&i.skillId===activation.skillId&&i.start===activation.start);
    add({id:`received:${activation.sourceRunnerId}:${activation.skillId}:${activation.start}`,sourceRunnerId:activation.sourceRunnerId,kind:'received',label:skillName(options.reference,activation.skillId),iconKey:skillIconKey(options.reference,activation.skillId),color:immune?'#97a1ba':'#e47474',start:activation.start,end,
      visualOnly:end===null||end<=activation.start,detail:`${immune?'Same-team selected recipient; immune, not an applied hit. ':''}${impact?.detail??''} Recorded target mask from ${activation.sourceRunnerId}; recipient selection is not proof of final effect (teammates may be immune). ${activation.timingReason??activation.detail}`});
  }
  return result;
}
export function replayCardHelp(options:ReplayOptions,value:ReplayCard):string {
  if(value.kind==='received'){
    const source=options.race.runners.find(r=>r.id===value.sourceRunnerId);
    return `From ${source?runnerName(options.reference,source):'another runner'}. Targeted by this skill. ${value.detail.startsWith('Same-team')?'Same team; immune to this debuff.':'Effect depends on immunity.'}`;
  }
  if(value.kind==='status')return `${statusDescription(value.id.split(':')[1])}${value.end!==null?` ${(value.end-value.start).toFixed(2)} s.`:''}`;
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
