/** Normalize saved summaries as well as new ones, without rerunning races. */
export function normalizeRaceMetrics(source:Record<string,number|null>){
  const result={...source};
  for(const [oldKey,newKey] of [['Uphill gain · m','Uphill loss · m'],['pace-down gain · m','pace-down loss · m']]){
    if(Object.hasOwn(result,oldKey)){
      if(!Object.hasOwn(result,newKey))result[newKey]=result[oldKey]==null?null:-result[oldKey]!;
      delete result[oldKey];
    }
  }
  // Hill ceiling-area estimates and their realized mode comparison are not
  // independent gains. Rushed already includes its boost portion, too.
  delete result['Downhill gain · m'];
  delete result['rushed-boost gain · m'];
  for(const key of Object.keys(result))if(/ loss · m$/.test(key)&&result[key]!==null)result[key]=-Math.abs(result[key]!);
  return result;
}

export function metricMode(key:string):string|null{
  if(key==='Rushed · s')return 'rushed';
  return /^([a-z][a-z-]*) (?:gain|loss) · m$/.exec(key)?.[1]??null;
}

/** Mode gain keys are emitted only for observed, positive-duration windows.
 * A null or zero contribution still proves the mode occurred. */
export function modeOccurred(metrics:Record<string,number|null>,mode:string){
  if(mode==='rushed'&&metrics['Rushed · s']!=null)return metrics['Rushed · s']!>0;
  return Object.keys(metrics).some(key=>metricMode(key)===mode&&key!=='Rushed · s');
}
