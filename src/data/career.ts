import type {RunnerStats,RunnerAptitudes,RunnerSkill} from './types';
export interface CareerFactor {id:number;stars:number|null}
export interface CareerSupport {id:number;position:number|null;exp:number|null;level:number|null;limitBreak:number|null;borrowed:boolean|null}
export interface CareerRace {programId:number;turn:number|null;place:number|null;time:number|null;weather:number|null;ground:number|null;style:number|null;popularity:number|null;prize:number|null}
export interface CareerRecord {
  cardId:number|null;rank:number|null;score:number|null;stars:number|null;potential:number|null;grade:number|null;
  trainerId:string|null;trainerName:string|null;createdAt:string|null;epithetId:number|null;epithetIds:number[];
  scenarioId:number|null;wins:number|null;fans:number|null;successionCount:number|null;
  stats:RunnerStats;aptitudes:RunnerAptitudes;skills:RunnerSkill[]|null;
  supports:CareerSupport[]|null;races:CareerRace[]|null;factors:CareerFactor[]|null;extendedFactors:CareerFactor[]|null;saddles:number[]|null;
  legacies:LegacyRecord[];
}
export interface LegacyRecord extends CareerRecord {position:number}
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const n=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
const s=(v:unknown):string|null=>typeof v==='string'&&v.trim()?v.trim().slice(0,300):null;
const pick=(v:Record<string,unknown>,...keys:string[])=>keys.map(k=>v[k]).find(x=>x!==undefined&&x!==null);
const id=(v:unknown)=>typeof v==='string'&&/^\d{1,20}$/.test(v)?v:typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):null;
const list=(v:unknown):unknown[]|null=>Array.isArray(v)?v.slice(0,500):null;
const numbers=(v:unknown)=>(list(v)??[]).map(n).filter((x):x is number=>x!==null);
const stars=(v:unknown)=>{const value=n(v);return value!==null&&Number.isInteger(value)&&value>=1&&value<=3?value:null;};
const factors=(v:unknown)=>list(v)?.map(x=>{const r=obj(x);return {id:n(pick(r,'id','factor_id'))??0,stars:stars(pick(r,'stars','level'))};}).filter(x=>x.id>0)??null;
const aptitudeAliases={turf:'ground_turf',dirt:'ground_dirt',short:'distance_short',mile:'distance_mile',middle:'distance_middle',long:'distance_long',front:'running_style_nige',pace:'running_style_senko',late:'running_style_sashi',end:'running_style_oikomi'};
/** A bounded, allowlisted career projection. Credentials and response envelopes never enter it. */
export function parseCareer(value:unknown,depth=0):CareerRecord|undefined {
  const r=obj(value);if(!Object.keys(r).length)return undefined;
  const stats=obj(r.stats),apt=obj(r.aptitudes);
  const skills=list(pick(r,'skills','skill_array'));
  const supports=list(pick(r,'supports','support_card_list'));
  const races=list(pick(r,'races','race_result_list','race_result_array'));
  return {cardId:n(pick(r,'cardId','card_id')),rank:n(r.rank),score:n(pick(r,'score','rank_score')),stars:n(pick(r,'stars','rarity')),potential:n(pick(r,'potential','talent_level')),grade:n(pick(r,'grade','chara_grade')),
    trainerId:id(r.trainerId)??id(r.owner_viewer_id)??id(r.viewer_id),trainerName:s(pick(r,'trainerName','owner_trainer_name','trainer_name','user_name')),createdAt:s(pick(r,'createdAt','create_time')),epithetId:n(pick(r,'epithetId','nickname_id')),epithetIds:numbers(pick(r,'epithetIds','nickname_id_array')),
    scenarioId:n(pick(r,'scenarioId','scenario_id')),wins:n(pick(r,'wins','single_mode_win_count')),fans:n(pick(r,'fans','fan_count')),successionCount:n(pick(r,'successionCount','succession_num')),
    stats:{speed:n(stats.speed??r.speed),stamina:n(stats.stamina??r.stamina),power:n(stats.power??pick(r,'power','pow')),guts:n(stats.guts??r.guts),wisdom:n(stats.wisdom??pick(r,'wiz','wisdom'))},
    aptitudes:Object.fromEntries(Object.entries(aptitudeAliases).map(([key,alias])=>[key,n(apt[key]??r[`proper_${alias}`])??s(apt[key])])),
    skills:skills?.map(x=>{const v=obj(x);return {id:n(pick(v,'id','skill_id'))??0,level:n(v.level)};}).filter(v=>v.id>0)??null,
    supports:supports?.map(x=>{const v=obj(x);return {id:n(pick(v,'id','support_card_id'))??0,position:n(v.position),exp:n(v.exp),level:n(v.level),limitBreak:n(pick(v,'limitBreak','limit_break_count')),borrowed:typeof v.borrowed==='boolean'?v.borrowed:typeof v.is_friend==='boolean'?v.is_friend:n(v.position)===6?true:null};}).filter(v=>v.id>0)??null,
    races:races?.map(x=>{const v=obj(x);return {programId:n(pick(v,'programId','program_id'))??0,turn:n(v.turn),place:n(pick(v,'place','result_rank')),time:n(pick(v,'time','result_time')),weather:n(v.weather),ground:n(pick(v,'ground','ground_condition')),style:n(pick(v,'style','running_style')),popularity:n(v.popularity),prize:n(pick(v,'prize','prize_money'))};}).filter(v=>v.programId>0)??null,
    factors:factors(pick(r,'factors','factor_info_array')),extendedFactors:factors(pick(r,'extendedFactors','factor_extend_array')),saddles:list(pick(r,'saddles','win_saddle_id_array'))===null?null:numbers(pick(r,'saddles','win_saddle_id_array')),
    legacies:depth?[]:(list(pick(r,'legacies','succession_chara_array'))??[]).flatMap(x=>{const v=obj(x),position=n(pick(v,'position','position_id')),career=parseCareer(v,depth+1);return career&&position!==null&&[10,11,12,20,21,22].includes(position)?[{...career,position}]:[];})};
}
/** Match saved careers by trained ID and owner, never by array order or character alone. */
export function careerForHorse(horse:Record<string,unknown>,source:Record<string,unknown>,outer:Record<string,unknown>={}):CareerRecord|undefined {
  const nested=pick(horse,'trained_chara_data','trainedCharaData')??pick(outer,'trained_chara_data','trainedCharaData');
  if(nested){const career=parseCareer(nested);if(career){career.trainerName??=s(pick(horse,'owner_trainer_name','trainer_name'));career.trainerId??=id(horse.owner_viewer_id)??id(horse.viewer_id);}return career;}
  const trainedId=id(pick(horse,'trained_chara_id','trainedCharaId'));
  if(!trainedId)return undefined;
  const owner=id(horse.owner_viewer_id)??id(horse.viewer_id);
  const candidates=(list(pick(source,'trained_chara_array','trainedCharaArray','trained_chara_data_array'))??[]).filter(v=>{
    const r=obj(v),other=id(r.owner_viewer_id)??id(r.viewer_id);
    return id(pick(r,'trained_chara_id','trainedCharaId'))===trainedId&&(!owner||!other||owner===other);
  });
  return candidates.length===1?parseCareer(candidates[0]):undefined;
}
