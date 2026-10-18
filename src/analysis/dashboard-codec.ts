import type {PreparedRace} from './prepared';

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
  const tables:Record<string,{motion:Table;inferred:Table|null;samples:Table}>={};
  for(const [id,runner] of Object.entries(value.runners)){
    tables[id]={motion:pack(runner.motion.samples),inferred:runner.inferredMotion===runner.motion?null:pack(runner.inferredMotion.samples),samples:pack(value.analysis.runners[id].samples)};
    runner.motion={...runner.motion,samples:[]};
    runner.inferredMotion=tables[id].inferred?{...runner.inferredMotion,samples:[]}:runner.motion;
    value.analysis.runners[id].samples=[];
  }
  return {value,tables};
}
export function restoreDashboard(saved:{value:PreparedRace;tables:Record<string,{motion:Table;inferred:Table|null;samples:Table}>}):PreparedRace{
  for(const [id,table] of Object.entries(saved.tables)){
    const runner=saved.value.runners[id];
    runner.motion.samples=unpack(table.motion) as typeof runner.motion.samples;
    if(table.inferred)runner.inferredMotion.samples=unpack(table.inferred) as typeof runner.inferredMotion.samples;
    else runner.inferredMotion=runner.motion;
    saved.value.analysis.runners[id].samples=unpack(table.samples) as typeof saved.value.analysis.runners[string]['samples'];
  }
  return saved.value;
}
