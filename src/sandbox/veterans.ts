import {parseCareer} from '../data/career';
import {runnerName,skillName,type ReferenceData} from '../data/reference';
import type {Runner} from '../data/types';
import {uid,type UmaBuild} from './model';
import {careerReference,factorGroups,rating} from '../data/career-display';
import {aptitudeLetter} from '../data/game-icons';
import {raceTimestamp} from '../data/race-time';
import {fuzzyScore} from './search';

export interface VeteranSnapshot {schemaVersion:1|2;capturedAt:string|null;count:number;veterans:Record<string,unknown>[];favorites?:Record<string,unknown>[]|null;unchanged?:boolean}
export const veteranMarkers=['No marker','Carrot','Rice','Drink','Chocolate','Cake','Diamond','Spade','Heart','Club','Pink shoe','Green shoe','Orange shoe','Blue shoe','Red shoe','Handshake'];
export const sparkTypes=[['Stats',1],['Aptitudes',2],['Unique skills',3],['White sparks',4],['Race sparks',5],['Scenario sparks',6],['Other',0]] as const;
export const aptitudeTypes=[['Track',[['turf','Turf'],['dirt','Dirt']]],['Distance',[['short','Sprint'],['mile','Mile'],['middle','Medium'],['long','Long']]],['Strategy',[['front','Front'],['pace','Pace'],['late','Late'],['end','End']]]] as const;
export const sparkColor=(type:number)=>(({1:'#58baff',2:'#f27fb2',3:'#81d286',6:'#b89bef'} as Record<number,string>)[type]??'#c6ced0');
export interface VeteranFilters {
  query:string;character:string;sort:string;direction:'asc'|'desc';sortDetail:string;sortParents:boolean;memo:'any'|'yes'|'no';markers:number[];
  sparks:{group:string;minStars:number;includeParents?:boolean}[];
  sparkCategories:{type:number;groups:string[];minStars:number;includeParents:boolean}[];
  aptitudes:{key:string;minGrade:string}[];
  aptitudeCategories:{keys:string[];minGrade:string}[];
}
export const emptyVeteranFilters=():VeteranFilters=>({query:'',character:'',sort:'recent',direction:'desc',sortDetail:'',sortParents:false,memo:'any',markers:[],sparks:[],aptitudes:[],
  sparkCategories:[1,2,3].map(type=>({type,groups:[],minStars:1,includeParents:false})),aptitudeCategories:aptitudeTypes.map(()=>({keys:[],minGrade:'A'}))});
const sparksOf=(career:NonNullable<Runner['career']>)=>factorGroups(career.factors,null).map(f=>({...f,group:String(careerReference.factors[f.id]?.group??`id:${f.id}`)}));
export function veteranFilterCount(filter:VeteranFilters){return Number(!!filter.query)+Number(!!filter.character)+Number(filter.memo!=='any')+Number(!!filter.markers.length)+filter.sparks.filter(f=>f.group).length+filter.aptitudes.filter(f=>f.key).length+filter.sparkCategories.filter(f=>f.groups.length||f.minStars>1).length+filter.aptitudeCategories.filter(f=>f.keys.length).length;}
export function veteranRows(snapshot:VeteranSnapshot,reference:ReferenceData){
  const favorites=new Map((snapshot.favorites??[]).map(item=>[String(item.trained_chara_id),item]));
  return snapshot.veterans.flatMap((raw,index)=>{
    const career=parseCareer(raw);if(!career?.cardId)return [];
    const charaId=Math.floor(career.cardId/100),id=`veteran-${raw.trained_chara_id}`;
    const runner:Runner={id,index,gate:null,name:reference.metadata.characters[charaId]??`Uma ${charaId}`,
      charaId,cardId:career.cardId,trainer:career.trainerName,trainerId:career.trainerId,
      strategy:null,finishOrder:null,finishTime:null,career,stats:career.stats,skills:career.skills??[],
      aptitudes:career.aptitudes,starCount:career.stars,rankScore:career.score,fanCount:career.fans,raceWinCount:career.wins};
    const name=runnerName(reference,runner),outfit=reference.metadata.outfits[career.cardId]??'';
    const favorite=favorites.get(String(raw.trained_chara_id));
    // API icon_type is zero-based (0 = carrot); artwork 0 is the unset placeholder.
    // An absent favorite entry, not icon_type 0, means no marker.
    const marker=favorite?(typeof favorite.icon_type==='number'&&Number.isInteger(favorite.icon_type)&&favorite.icon_type>=0?favorite.icon_type+1:null):snapshot.favorites?0:null;
    const memo=typeof favorite?.memo==='string'?favorite.memo.trim().slice(0,2000):'';
    const epithet=career.epithetId?careerReference.epithets[career.epithetId]??`Epithet ${career.epithetId}`:'';
    const sparks=sparksOf(career);
    // When this Veteran is selected as a parent, its own parents become the
    // offspring's grandparents. Deeper recorded ancestry is not inherited.
    const originSparks=career.legacies.filter(c=>c.position===10||c.position===20).flatMap(sparksOf);
    const created=career.createdAt?raceTimestamp(career.createdAt).getTime():NaN;
    return [{id,runner,career,name,outfit,marker,memo,epithet,sparks,originSparks,created:Number.isFinite(created)?created:0,
      search:[name,outfit,memo,epithet,...(career.skills??[]).map(s=>skillName(reference,s.id)),...sparks.map(s=>s.name)].join(' ')}];
  });
}
export function filterVeterans(rows:ReturnType<typeof veteranRows>,filter:VeteranFilters){
  return rows.filter(row=>{
    if(filter.character&&String(row.runner.charaId)!==filter.character)return false;
    if(filter.markers.length&&(row.marker===null||!filter.markers.includes(row.marker)))return false;
    if(filter.memo==='yes'&&!row.memo||filter.memo==='no'&&row.memo)return false;
    const pool=(parents:boolean)=>parents?[...row.sparks,...row.originSparks]:row.sparks;
    if(!filter.sparks.every(s=>!s.group||pool(!!s.includeParents).some(f=>f.group===s.group&&(f.stars??0)>=s.minStars)))return false;
    if(!filter.sparkCategories.every(s=>!s.groups.length&&s.minStars===1||pool(s.includeParents).some(f=>f.type===s.type&&(!s.groups.length||s.groups.includes(f.group))&&(f.stars??0)>=s.minStars)))return false;
    const gradeFor=(key:string)=>aptitudeLetter(row.career.aptitudes[key as keyof typeof row.career.aptitudes]);
    if(!filter.aptitudeCategories.every(a=>!a.keys.length||a.keys.some(key=>{const grade=gradeFor(key);return grade!==null&&'GFEDCBAS'.indexOf(grade)>='GFEDCBAS'.indexOf(a.minGrade);})))return false;
    return filter.aptitudes.every(a=>{if(!a.key)return true;const grade=aptitudeLetter(row.career.aptitudes[a.key as keyof typeof row.career.aptitudes]);return grade!==null&&'GFEDCBAS'.indexOf(grade)>='GFEDCBAS'.indexOf(a.minGrade);});
  }).map(row=>({...row,searchScore:fuzzyScore(filter.query,row.search)})).filter(r=>r.searchScore>0).sort((a,b)=>{
    if(filter.query.trim()){
      // Exact name matches should not be demoted for owning more skills.
      const relevance=(r:typeof a)=>Math.max(fuzzyScore(filter.query,r.name+' '+r.outfit),r.searchScore*.5);
      const delta=relevance(b)-relevance(a);if(delta)return delta;
    }
    const direction=filter.direction==='asc'?1:-1;
    let delta=0;
    if(filter.sort==='name')delta=a.name.localeCompare(b.name)||a.outfit.localeCompare(b.outfit);
    else if(filter.sort==='memo')delta=a.memo.localeCompare(b.memo);
    else {
      const value=(row:typeof a):number|null=>{
        if(filter.sort==='rating')return row.career.score;
        if(filter.sort==='recent')return row.created||null;
        if(filter.sort==='favorites')return row.marker;
        if(filter.sort==='skills')return row.career.skills?.length??null;
        if(filter.sort==='sparks')return (filter.sortParents?[...row.sparks,...row.originSparks]:row.sparks).filter(f=>!filter.sortDetail||f.group===filter.sortDetail).reduce((sum,f)=>sum+(f.stars??0),0);
        const category=aptitudeTypes.find(([label])=>label.toLowerCase()===filter.sort);
        if(category){const key=filter.sortDetail||category[1][0][0],grade=aptitudeLetter(row.career.aptitudes[key as keyof typeof row.career.aptitudes]);return grade===null?null:'GFEDCBAS'.indexOf(grade);}
        return row.career.stats[filter.sort as keyof typeof row.career.stats]??null;
      };
      const av=value(a),bv=value(b);
      if(av===null||bv===null)return av===bv?b.created-a.created:av===null?1:-1;
      delta=av-bv;
    }
    return delta*direction||b.created-a.created||a.id.localeCompare(b.id);
  });
}
export function veteranCopyMemo(row:ReturnType<typeof veteranRows>[number]):string {
  const career=row.career,rank=rating(career.score,career.rank);
  const details=[
    [rank?.label,career.score?.toLocaleString()].filter(Boolean).join(' '),
    career.stars!=null?`${career.stars}★`:'',row.epithet,
    row.created?new Date(row.created).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'',
  ].filter(Boolean);
  const source=`Veteran: ${details.join(' ')}`.trim();
  return [source,row.memo].filter(Boolean).join(' · ');
}
export function veteranBuild(row:ReturnType<typeof veteranRows>[number]):UmaBuild {
  return {id:uid(),name:row.name,memo:veteranCopyMemo(row),charaId:row.runner.charaId!,cardId:row.runner.cardId!,
    stats:{...row.career.stats},skills:structuredClone(row.career.skills??[]),fans:row.career.fans??0,
    careerWins:row.career.wins??0,folderId:'',favorite:false};
}
