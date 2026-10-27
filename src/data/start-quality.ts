export function startQuality(delay:number|null|undefined){
  if(delay==null||!Number.isFinite(delay))return null;
  if(delay<.02)return {label:'Great start',tone:'great',color:'#6dce86'};
  if(delay<=.04)return {label:'Good start',tone:'good',color:'#b3e4a2'};
  if(delay>.08)return {label:'Late start',tone:'late',color:'#ef7474'};
  return {label:'Poor start',tone:'poor',color:'#e2c04a'};
}
