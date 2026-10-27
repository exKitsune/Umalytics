import type {aggregate} from './results';
import type {WinImpact} from './insights';

type Skill=ReturnType<typeof aggregate>[number]['skills'][number];
export const skillColumns=[
  {key:'name',label:'Skill'}, {key:'gain',label:'Avg. distance gain'},
  {key:'impact',label:'Win impact'}, {key:'win',label:'WR when activated',title:'Difference from this runner’s overall win rate. Association, not the skill’s causal contribution.'},
  {key:'carryover',label:'Avg. carryover'}, {key:'time',label:'Time saved'},
  {key:'effectiveness',label:'Effectiveness'}, {key:'activation',label:'Activated'},
  {key:'per100Sp',label:'Gain / 100 SP'},
] as const;
export type SkillSort=typeof skillColumns[number]['key'];
export type SortDirection='asc'|'desc';
export const activatedWinDelta=(skill:Skill,win:number)=>skill.winRateWhenActivated===null?null:skill.winRateWhenActivated-win;

export function sortSkills(skills:Skill[],key:SkillSort,direction:SortDirection,win:number,name:(id:number)=>string,impacts:Map<string,WinImpact>){
  const value=(s:Skill):string|number|null=>{
    switch(key){
      case 'name':return name(s.id);
      case 'gain':return s.gain.mean;
      case 'impact':return impacts.get(`skill:${s.id}`)?.delta??null;
      case 'win':return activatedWinDelta(s,win);
      case 'carryover':return s.carryover.mean;
      case 'time':return s.time.mean===null?null:-s.time.mean;
      case 'effectiveness':return s.effectiveness.mean;
      case 'activation':return s.activation;
      case 'per100Sp':return s.per100Sp;
    }
  };
  return [...skills].sort((a,b)=>{
    const av=value(a),bv=value(b);
    // Unknown measurements stay last in either direction.
    if(av===null||bv===null)return av===bv?a.id-b.id:av===null?1:-1;
    const order=typeof av==='string'&&typeof bv==='string'?av.localeCompare(bv):Number(av)-Number(bv);
    return (direction==='asc'?order:-order)||a.id-b.id;
  });
}

/** Engine's initial Wit threshold, before green skills and strategy aptitude. */
export function skillCheckChance(rawWit:number,mood:number){
  const overcap=rawWit<=1200?rawWit:1200+(rawWit-1200)/2;
  const coefficient=Math.fround((10000+200*Math.max(-2,Math.min(2,mood-3)))*Math.fround(.0001));
  const wit=Math.max(1,Math.min(2000,Math.fround(Math.fround(overcap)*coefficient)));
  return Math.max(.2,1-90/wit);
}
