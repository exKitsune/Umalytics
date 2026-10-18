/** Compact hover descriptions; mechanics belong in the legend and FAQ. */
export function statusDescription(kind:string):string {
  return ({'pace-up':'Closing the gap ahead.','pace-down':'Easing back to the preferred position.',
    'speed-up':'Accelerating to hold the lead.',overtake:'Accelerating to pass the leader.',
    'extra-pace-up':'An additional pace-up boost.','spot-struggle':'Competing for the early lead.',
    'downhill-mode':'Faster downhill running with lower HP drain.',dueling:'A finishing duel.',
    rushed:'Faster running with increased HP drain.','front-block':'The runner ahead is obstructing the path.',
    traffic:'Speed lost to nearby runners.','near-slowdown':'Slowed by a nearby runner.',
    'conserve-power':'Building the power reserve.','release-conserve-power':'Releasing stored power as acceleration.',
    'force-in':'Moving toward the inside early in the race.','stamina-limit-break':'Extra late-race speed from stamina.',
    'compete-before-spurt':'Competing for position before the spurt.','stamina-keep':'Preserving stamina before the spurt.',
    'secure-lead':'Extending the lead.','lane-bonus':'Extra forward speed while changing lanes.',
    'last-spurt':'The final sustained sprint.','hp-empty':'Slowing after HP runs out.',
    uphill:'Reduced speed and acceleration uphill.','downhill-section':'A descending part of the course.'
  } as Record<string,string>)[kind.replace(/-model$/,'')]??'Race status.';
}
/** Longer descriptions are shown directly in the status legend. */
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
    rushed:'Up to +4% of base target speed; HP drain ×1.6 (+60% HP/s at the same speed). With Spot Struggle: ×3.6 normal drain, or ×7.7 for Runaway, instead of multiplying separate rates. Absolute HP/s also depends on speed, ground and race phase.',
    'rushed-boost':'Extra speed while rushed.',
    'front-block':'Another runner is blocking the path ahead.',
    traffic:'Speed cuts of at least 0.15 m/s. White → yellow → amber → red shows increasing slowdown; transparent sections are below the threshold.',
    'conserve-power':'Power above 1200 can build a reserve before the cutoff. The duration counts active accumulation, excluding interruptions and the 1.5 s restart cooldown. Blocking pace modes, rushing and spot struggle interrupt it; rushing and spot struggle can also reduce the gauge.',
    'release-conserve-power':'Stored power is released as an acceleration bonus during the last spurt. The band ends when the actual effect expires.',
    'force-in':'Early-race inward lane positioning with a nearby runner on the inside. The simulator adds its force-in target-speed adjustment (normally +0.05 m/s); this is not itself a block.',
    'extra-pace-up':'The simulator’s extra pace-up controller state, distinct from ordinary pace up. Its actual multiplier is included in the target speed.',
    'stamina-limit-break':'A late-race speed bonus from excess stamina when its engine conditions are met. Actual activation and expiry determine the window.',
    'compete-before-spurt':'A recorded pre-spurt competition event. A start marker alone does not establish its duration.',
    'stamina-keep':'A recorded stamina-preservation event before the last spurt. A start marker alone does not establish its duration.',
    'secure-lead':'A recorded lead-securing event. A start marker alone does not establish its duration.',
    'near-slowdown':'Traffic ahead slows her by more than 0.15 m/s. Pace and downhill modes can remain active.',
    'lane-bonus':'A lane-speed skill is active while her lane is changing. Forward target speed gains sqrt(0.0002×power) for that movement.',
    'last-spurt':'The runner has started its final spurt.',
    'hp-empty':'HP is empty. The tag starts when the 1.2 m/s² deceleration begins, which can be before the first zero sample.',
    'downhill-section':'A downhill section of the course.',
    uphill:'Target speed drops by grade × 200 / effective power. Higher power reduces the loss; uphill acceleration also uses its lower baseline.',
  } as Record<string,string>)[name]??'Time spent in this status.';
}
export const uphillHelp='Speed lost on uphill sections.';
export const downhillHelp='Speed and HP benefit from downhill mode.';
export function slopeEffectHelp(grade:number,power:number|null|undefined,name:string):string {
  if(grade>0)return `${name} · Uphill ${grade}% · ${power!=null&&power>0?`Target speed −${(grade*200/power).toFixed(2)} m/s · Effective power ${Math.round(power)}`:'Target speed loss unavailable: power is unresolved.'}`;
  return `${name} · Downhill ${Math.abs(grade)}% · Target speed +${(.3+Math.abs(grade)/10).toFixed(2)} m/s while DH is active.`;
}
export const debuffHelp='HP and distance lost to skills from other runners.';
export const modelHelp='Estimated benefit.';
export const statHelp='Stats after mood, course, strategy, ground and skill bonuses.';
export const statusLegend:{kind:string;short:string;name:string;source:string;formula?:string}[]=[
  {kind:'force-in',short:'Inward',name:'Force in',source:statusHelp('force-in')},
  {kind:'extra-pace-up',short:'Extra PU',name:'Extra pace up',source:statusHelp('extra-pace-up')},
  {kind:'stamina-limit-break',short:'Limit',name:'Stamina limit break',source:statusHelp('stamina-limit-break')},
  {kind:'compete-before-spurt',short:'Compete',name:'Pre-spurt competition',source:statusHelp('compete-before-spurt')},
  {kind:'stamina-keep',short:'Keep',name:'Stamina keep',source:statusHelp('stamina-keep')},
  {kind:'secure-lead',short:'Lead',name:'Secure lead',source:statusHelp('secure-lead')},
  {kind:'conserve-power',short:'Conserve',name:'Conserve power',source:'Accumulation clock and cooldown events from the matched simulator.'},
  {kind:'release-conserve-power',short:'Release',name:'Release power',source:'Actual activation, applied acceleration and expiry of conserved power.'},
  {kind:'pace-up',short:'PU',name:'Pace up',source:'Calculated from replay speed holding the raised pace-up target.',formula:'×1.04 section target'},
  {kind:'pace-down',short:'PD',name:'Pace down',source:'Calculated from replay speed holding the lowered pace-down target.',formula:'×0.915 or ×0.945 section target'},
  {kind:'speed-up',short:'SU',name:'Speed up',source:'Calculated for a Front Runner holding the speed-up target.',formula:'×1.04 section target'},
  {kind:'overtake',short:'OT',name:'Overtake',source:'Calculated for a Front Runner on the overtake target.',formula:'×1.05 section target'},
  {kind:'spot-struggle',short:'SS',name:'Spot struggle',source:'Recorded spot-struggle event. Duration uses guts and ends by 9/24 of the race.',formula:'(500×guts)^0.6×0.0001'},
  {kind:'downhill-mode',short:'DH',name:'Downhill',source:'Calculated from speed and HP on a downhill grade.',formula:'0.3+|grade|/10'},
  {kind:'dueling',short:'DUEL',name:'Dueling',source:'Recorded duel. It ends below 5% HP or more than 5 m from every other dueler.',formula:'(200×guts)^0.708×0.0001'},
  {kind:'rushed',short:'RUSH',name:'Rushed',source:statusHelp('rushed')},
  {kind:'front-block',short:'Blocked',name:'Blocked',source:'Recorded front-block slot.'},
  {kind:'near-slowdown',short:'Near',name:'Near',source:'Traffic ahead slows her by more than 0.15 m/s below her target, including active modes and skills.'},
  {kind:'lane-bonus',short:'Lane',name:'Lane bonus',source:'A lane-speed skill is active and her recorded lane is changing.',formula:'√(0.0002×power)'},
  {kind:'hp-empty',short:'Exhausted',name:'Exhausted',source:'Recorded HP reaches zero. The tag starts at the 1.2 m/s² deceleration, which can precede the first zero sample.'},
  {kind:'last-spurt',short:'SPURT',name:'Last spurt',source:'Start is the recorded last-spurt distance. End is the finish.'},
  {kind:'uphill',short:'Up',name:'Uphill',source:'Applied on every uphill grade. Higher power reduces the loss.',formula:'−grade×200/power'},
];
export function statusFormula(kind:string){return statusLegend.find(item=>item.kind===kind)?.formula??null;}
export function statusColor(kind:string):string {
  return ({'conserve-power':'#a0b6ca','release-conserve-power':'#ed75d4','pace-up':'#5dcc83',
    'pace-down':'#559deb','speed-up':'#c0d849',overtake:'#e9c44e','extra-pace-up':'#8f87ff',
    'spot-struggle':'#f39b43','downhill-mode':'#48d0e5',rushed:'#ee7597',dueling:'#b085df',
    traffic:'#ffffff','front-block':'#ef6a52','near-slowdown':'#f0cb82','lane-bonus':'#49b6a0',
    'last-spurt':'#dbe3ef','force-in':'#b6dcc5','stamina-limit-break':'#e8b493',
    'compete-before-spurt':'#c69a6b','stamina-keep':'#a4b987','secure-lead':'#c4abda',
    'hp-empty':'#e65050',uphill:'#69b779'} as Record<string,string>)[kind.replace(/-model$/,'')]??'#97a1ba';
}
