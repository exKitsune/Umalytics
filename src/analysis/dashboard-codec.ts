import type {PreparedRace} from './prepared';
import type {SpeedChange} from '../data/speed-changes';

type Text = [number, ...string[]];
interface Changes {patterns:string[];rows:[number,number,number,number,{label:Text;evidence:SpeedChange['reasons'][number]['evidence'];bounds?:[number,number];detail?:Text}[]][]}
function packChanges(changes:SpeedChange[]):Changes{
  const patterns:string[]=[],indices=new Map<string,number>();
  const text=(value:string):Text=>{
    const numbers:string[]=[],pattern=value.replace(/\u0001/g,'\u0001e').replace(/[-+]?\d+(?:\.\d+)?/g,n=>{numbers.push(n);return '\u0001n';});
    let index=indices.get(pattern);if(index===undefined){index=patterns.length;patterns.push(pattern);indices.set(pattern,index);}
    return [index,...numbers];
  };
  return {patterns,rows:changes.map(c=>[c.start,c.end,c.from,c.to,c.reasons.map(r=>({label:text(r.label),evidence:r.evidence,
    ...(r.start!==c.start||r.end!==c.end?{bounds:[r.start,r.end] as [number,number]}:{}),...(r.detail===undefined?{}:{detail:text(r.detail)})}))])};
}
function unpackChanges(value:Changes):SpeedChange[]{
  const text=([index,...numbers]:Text)=>{let n=0;return value.patterns[index].replace(/\u0001([en])/g,(_,kind)=>kind==='e'?'\u0001':numbers[n++]);};
  return value.rows.map(([start,end,from,to,reasons])=>({start,end,from,to,reasons:reasons.map(r=>{
    const reason={label:text(r.label),evidence:r.evidence,start:r.bounds?.[0]??start,end:r.bounds?.[1]??end};
    if(r.detail!==undefined)lazyProperty(reason,'detail',()=>text(r.detail!));
    return reason;
  })}));
}
function lazyProperty(object:object,key:string,read:()=>unknown){
  Object.defineProperty(object,key,{configurable:true,enumerable:true,get(){const value=read();Object.defineProperty(object,key,{configurable:true,enumerable:true,writable:true,value});return value;}});
}

interface Table {columns:{key:string;constant:boolean;band:boolean;values:unknown[]}[];length:number}
function pack(rows:Record<string,any>[]):Table{
  const keys=[...new Set(rows.flatMap(Object.keys))];
  return {length:rows.length,columns:keys.map(key=>{
    let values=rows.map(row=>row[key]);
    const band=values.some(Boolean)&&values.every(v=>v==null||typeof v==='object'&&Object.keys(v).length===3&&v.min===v.mid&&v.mid===v.max);
    if(band)values=values.map(v=>v?.mid??null);
    const first=JSON.stringify(values[0]),constant=values.every(value=>JSON.stringify(value)===first);
    return {key,band,constant,values:constant?[values[0]]:values};
  })};
}
function unpack(table:Table):Record<string,any>[] {
  const rows=Array.from({length:table.length},()=>({}) as Record<string,any>);
  for(const column of table.columns)for(let i=0;i<table.length;i++){
    const value=column.values[column.constant?0:i];
    rows[i][column.key]=column.band&&value!==null?{min:value,mid:value,max:value}:value;
  }
  return rows;
}
/** Compact repeated display rows, preserving exact doubles and null values. */
export function packDashboard(value:PreparedRace){
  const tables:Record<string,{motion:Table;inferred:Table|null;samples:Table;changes?:Changes}>={};
  for(const [id,runner] of Object.entries(value.runners)){
    tables[id]={motion:pack(runner.motion.samples),inferred:runner.inferredMotion===runner.motion?null:pack(runner.inferredMotion.samples),samples:pack(value.analysis.runners[id].samples)};
    tables[id].changes=packChanges(runner.speedChanges);runner.speedChanges=[];
    runner.motion={...runner.motion,samples:[]};
    runner.inferredMotion=tables[id].inferred?{...runner.inferredMotion,samples:[]}:runner.motion;
    value.analysis.runners[id].samples=[];
  }
  return {value,tables};
}
export function restoreDashboard(saved:{value:PreparedRace;tables:Record<string,{motion:Table;inferred:Table|null;samples:Table;changes?:Changes}>},lazy=false):PreparedRace{
  const set=(object:object,key:string,read:()=>unknown)=>lazy?lazyProperty(object,key,read):Object.assign(object,{[key]:read()});
  for(const [id,table] of Object.entries(saved.tables)){
    const runner=saved.value.runners[id];
    set(runner.motion,'samples',()=>unpack(table.motion));
    if(table.inferred)set(runner.inferredMotion,'samples',()=>unpack(table.inferred!));
    else runner.inferredMotion=runner.motion;
    set(saved.value.analysis.runners[id],'samples',()=>unpack(table.samples));
    if(table.changes)set(runner,'speedChanges',()=>unpackChanges(table.changes!));
  }
  return saved.value;
}
