/** Short UI explanations. Full calculation evidence stays in analysis exports. */
export function statusHelp(kind:string):string {
  const name=kind.replace(/-model$/,'');
  return ({
    'pace-up':'Speeds up to close the gap ahead.',
    'pace-down':'Slows down to keep the strategy’s preferred position.',
    'speed-up':'A Front Runner speeds up to hold the lead.',
    overtake:'A Front Runner speeds up to pass another leader.',
    'spot-struggle':'Front Runners compete for the lead, gaining speed and spending more HP.',
    'downhill-mode':'Gains speed and saves HP while downhill mode is active.',
    dueling:'Gains speed while dueling near the finish.',
    rushed:'Spends extra HP while rushed.',
    'rushed-boost':'Extra speed while rushed.',
    'front-block':'Another runner is blocking the path ahead.',
    traffic:'Nearby runners and blocking in one band. Amber to red shows increasing speed cuts; faded sections are clear gaps.',
    'near-slowdown':'Traffic ahead slows her by more than 0.15 m/s. Pace and downhill modes can remain active.',
    'lane-bonus':'A lane-speed skill is active while her lane is changing. Forward target speed gains sqrt(0.0002×power) for that movement.',
    'last-spurt':'The runner has started its final spurt.',
    'hp-empty':'HP is empty. The tag starts when the 1.2 m/s² deceleration begins, which can be before the first zero sample.',
    'downhill-section':'A downhill section of the course.',
  } as Record<string,string>)[name]??'Time spent in this status.';
}
export const uphillHelp='Target speed loss −grade×200/power while on an uphill. Higher power reduces the loss.';
export const downhillHelp='Downhill mode target gain 0.3+|grade|/10. Slope time without that mode is not included.';
export function slopeEffectHelp(grade:number,power:number|null|undefined,name:string):string {
  if(grade>0)return `${name} · Uphill ${grade}% · ${power!=null&&power>0?`Target speed −${(grade*200/power).toFixed(2)} m/s · Effective power ${Math.round(power)}`:'Target speed loss unavailable: power is unresolved.'}`;
  return `${name} · Downhill ${Math.abs(grade)}% · Target speed +${(.3+Math.abs(grade)/10).toFixed(2)} m/s while DH is active.`;
}
export const debuffHelp='HP and distance lost to skills from other runners.';
export const modelHelp='Calculated from replay speed, stats and known effects. See FAQ for details.';
export const statHelp='Stats after mood, course, strategy, ground and skill bonuses.';
export const statusLegend:{kind:string;short:string;name:string;source:string;formula?:string}[]=[
  {kind:'pace-up',short:'PU',name:'Pace up',source:'Calculated from replay speed holding the raised pace-up target.',formula:'×1.04 section target'},
  {kind:'pace-down',short:'PD',name:'Pace down',source:'Calculated from replay speed holding the lowered pace-down target.',formula:'×0.915 or ×0.945 section target'},
  {kind:'speed-up',short:'SU',name:'Speed up',source:'Calculated for a Front Runner holding the speed-up target.',formula:'×1.04 section target'},
  {kind:'overtake',short:'OT',name:'Overtake',source:'Calculated for a Front Runner on the overtake target.',formula:'×1.05 section target'},
  {kind:'spot-struggle',short:'SS',name:'Spot struggle',source:'Recorded spot-struggle event. Duration uses guts and ends by 9/24 of the race.',formula:'(500×guts)^0.6×0.0001'},
  {kind:'downhill-mode',short:'DH',name:'Downhill',source:'Calculated from speed and HP on a downhill grade.',formula:'0.3+|grade|/10'},
  {kind:'dueling',short:'DUEL',name:'Dueling',source:'Recorded duel. It ends below 5% HP or more than 5 m from every other dueler.',formula:'(200×guts)^0.708×0.0001'},
  {kind:'rushed',short:'RUSH',name:'Rushed',source:'Recorded temptation mode. The extra speed counts only while she is actually running it.',formula:'Realized, up to +4% of base target'},
  {kind:'front-block',short:'Blocked',name:'Blocked',source:'Recorded front-block slot.'},
  {kind:'near-slowdown',short:'Near',name:'Near',source:'Traffic ahead slows her by more than 0.15 m/s below her target, including active modes and skills.'},
  {kind:'lane-bonus',short:'Lane',name:'Lane bonus',source:'A lane-speed skill is active and her recorded lane is changing.',formula:'√(0.0002×power)'},
  {kind:'hp-empty',short:'Exhausted',name:'Exhausted',source:'Recorded HP reaches zero. The tag starts at the 1.2 m/s² deceleration, which can precede the first zero sample.'},
  {kind:'last-spurt',short:'SPURT',name:'Last spurt',source:'Start is the recorded last-spurt distance. End is the finish.'},
  {kind:'uphill',short:'Up',name:'Uphill',source:'Applied on every uphill grade. Higher power reduces the loss.',formula:'−grade×200/power'},
];
export function statusFormula(kind:string){return statusLegend.find(item=>item.kind===kind)?.formula??null;}
export function statusColor(kind:string):string {
  return ({'pace-up':'#78b341','pace-down':'#6ca3d6','speed-up':'#9abe54',overtake:'#e7c85a','spot-struggle':'#e8a351','downhill-mode':'#44b9b6',rushed:'#e48087',dueling:'#bf83df','front-block':'#e28f7f','near-slowdown':'#d2a15a','lane-bonus':'#3cba9a','last-spurt':'#91bf64','hp-empty':'#ed676b'} as Record<string,string>)[kind.replace(/-model$/,'')]??'#97a1ba';
}
