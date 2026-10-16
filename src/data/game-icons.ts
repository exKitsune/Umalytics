import images from './ui-icons.json';
import type { Runner } from './types';
import { getSkillReference, type ReferenceData } from './reference';

export function iconSource(key:string):string|null{return (images as Record<string,string>)[key]??null;}
export function skillIconKey(reference:ReferenceData|null,id:number):string{
  const iconId=getSkillReference(reference,id)?.iconId;
  return iconId==null?'':`skill-${iconId}`;
}
export function aptitudeLetter(value:number|string|null|undefined):string|null{
  if(typeof value==='number')return ['G','F','E','D','C','B','A','S'][value-1]??null;
  return value&&/^[A-GS]$/i.test(value)?value.toUpperCase():null;
}
export function strategyLabel(runner:Pick<Runner,'strategy'|'strategyCode'>):string{
  if(runner.strategyCode===5||/runaway|oonige|great escape/i.test(runner.strategy??''))return 'Runaway';
  if(runner.strategyCode!=null&&runner.strategyCode>=1&&runner.strategyCode<=4)return ['Front','Pace','Late','End'][runner.strategyCode-1];
  const style=runner.strategy??'';
  return /front/i.test(style)?'Front':/pace/i.test(style)?'Pace':/late/i.test(style)?'Late':/end/i.test(style)?'End':style||'Unknown';
}
