import type {ReferenceData,SkillReference} from '../data/reference';
import {skillName} from '../data/reference';
import {catalog as fallback,catalogRevision} from '../data/catalog';
import type {UmaBuild,Participant} from './model';
import type {RunnerSkill} from '../data/types';

const owners:Record<string,number[]> = fallback.skillOwners;
const byCard=new Map<number,number[]>();
let indexedRevision='';
function indexOwners(){if(indexedRevision===catalogRevision)return;byCard.clear();for(const [id,cards] of Object.entries(owners))for(const card of cards)byCard.set(card,[...(byCard.get(card)??[]),Number(id)]);indexedRevision=catalogRevision;}
export const nativeUnique=(skill:SkillReference|undefined)=>!!skill&&[3,4,5].includes(skill.rarity);
export const editorSkillName=(ref:ReferenceData,id:number)=>skillName(ref,id).replace(/ \(inherited\)$/i,'');
export const ownInherited=(cardId:number)=>{indexOwners();return (byCard.get(cardId)??[]).filter(id=>String(id).startsWith('9'));};
export function outfitUniques(ref:ReferenceData,cardId:number):number[]{indexOwners();
  return (byCard.get(cardId)??[]).filter(id=>nativeUnique(ref.metadata.skills[id]))
    .sort((a,b)=>ref.metadata.skills[b].rarity-ref.metadata.skills[a].rarity||a-b);
}
/** Only editor inventories are normalized. Counterfactual measurements may remove a unique. */
export function withOwnUnique(uma:UmaBuild,ref:ReferenceData):UmaBuild {
  const candidates=outfitUniques(ref,uma.cardId),old=uma.skills.find(s=>candidates.includes(s.id)),id=old?.id??candidates[0];
  const skills=uma.skills.filter(s=>!nativeUnique(ref.metadata.skills[s.id])&&!(String(s.id).startsWith('9')&&owners[s.id]?.includes(uma.cardId)));
  const equipped:RunnerSkill[]=[];
  for(const skill of skills){const group=ref.metadata.skills[skill.id]?.groupId;for(let i=equipped.length-1;i>=0;i--)if(equipped[i].id===skill.id||(group&&ref.metadata.skills[equipped[i].id]?.groupId===group))equipped.splice(i,1);equipped.push({...skill,level:1});}
  equipped.sort((a,b)=>editorSkillName(ref,a.id).localeCompare(editorSkillName(ref,b.id))||a.id-b.id);
  return {...uma,skills:[...(id?[{id,level:old?.level??1}]:[]),...equipped]};
}
/** A newly chosen tier replaces the equipped tier from the same catalog group. */
export function equipSkill(uma:UmaBuild,id:number,ref:ReferenceData):UmaBuild {
  if(nativeUnique(ref.metadata.skills[id])||ownInherited(uma.cardId).includes(id))return withOwnUnique(uma,ref);
  return withOwnUnique({...uma,skills:[...uma.skills.filter(s=>s.id!==id),{id,level:1}]},ref);
}
export function swapPopularity(participants:Participant[],index:number,popularity:number):Participant[]{
  if(!Number.isInteger(popularity)||popularity<1||popularity>participants.length)return participants;
  const previous=participants[index].popularity;
  return participants.map((p,i)=>i===index?{...p,popularity}:p.popularity===popularity?{...p,popularity:previous}:p);
}
/** Preserve relative order when removing a slot or importing incomplete rankings. */
export function normalizePopularity(participants:Participant[]):Participant[]{
  const order=[...participants].sort((a,b)=>a.popularity-b.popularity);
  return participants.map(p=>({...p,popularity:order.indexOf(p)+1}));
}
export const teamColors=[['Red','#ef777c'],['Blue','#78b6ed'],['Green','#7aca9b'],['Gold','#e5bf65'],['Purple','#bca0ee'],['Pink','#e498c8'],['Teal','#65d0ce'],['Orange','#ed9b65'],['Silver','#b2becb']] as const;
// null means solo in the editor; each gets a distinct engine team ID at execution.
export function normalizeTeams(participants:Participant[]):Participant[]{
  const counts=new Map<number,number>();for(const p of participants)if(p.team!==null)counts.set(p.team,(counts.get(p.team)??0)+1);
  const shared=[...counts].filter(([,n])=>n>1).map(([team])=>team);
  return participants.map(p=>({...p,team:p.team!==null&&(counts.get(p.team)??0)>1?shared.indexOf(p.team):null}));
}
export function engineTeams(participants:Participant[]):number[]{
  const used=new Set(participants.flatMap(p=>p.team===null?[]:[p.team]));let next=0;
  return participants.map(p=>{if(p.team!==null)return p.team;while(used.has(next))next++;used.add(next);return next++;});
}
export function saveTarget<T extends {id:string;name:string}>(records:T[],name:string,currentId:string):T|undefined {
  const same=records.filter(r=>r.name.trim().toLocaleLowerCase()===name.trim().toLocaleLowerCase());
  return same.find(r=>r.id===currentId)??same[0];
}
