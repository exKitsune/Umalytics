import {positionCheckpoints} from './position-checkpoints';

/** Compare the displayed median with the pooled lobby mean, not its median. */
export function metricComparison(key:string,median:number|null,average:number|null|undefined){
  const neutral={color:'#ead68a',description:'Median matches the lobby average at the displayed precision.'};
  if(median==null||average==null||!Number.isFinite(median)||!Number.isFinite(average))
    return {...neutral,description:'Lobby comparison unavailable.'};
  const decimals=metricDisplay(key).decimals;
  const difference=Number(median.toFixed(decimals))-Number(average.toFixed(decimals));
  if(!difference)return neutral;
  const lower=positionCheckpoints.some(p=>p.key===key)||['Start delay · s','Last-spurt start · m','HP spent','Rushed · s'].includes(key);
  // Losses are signed negatives: closer to zero is better.
  const better=lower?difference<0:difference>0;
  return {color:better?'#a6dbad':'#efb0b3',description:`Median ${difference<0?'below':'above'} the lobby average; ${lower?'lower':'higher'} is better.`};
}

/** Presentation of the existing per-race measurements; units stay explicit. */
export function metricDisplay(key:string){
  const checkpoint=positionCheckpoints.find(p=>p.key===key);
  if(checkpoint)return {label:checkpoint.label,group:'Race position',icon:'race',color:'#a6bff2',decimals:2,unit:'',
    description:'Standing when this Uma reaches the checkpoint; first place is 1.',order:positionCheckpoints.indexOf(checkpoint)};
  const known:Record<string,[string,string,string,string,number]>={
    'Start delay · s':['Start delay','Start & stamina','clock','#93bfe8',3],
    'Starting HP':['Starting HP','Start & stamina','heart','#83d0a4',0],
    'HP spent':['HP spent','Start & stamina','heart','#edaa87',0],
    'HP recovered':['HP recovered','Start & stamina','heart','#83d0a4',0],
    'Last-spurt start · m':['Last spurt begins','Start & stamina','race','#adb9eb',1],
    'speed-up gain · m':['Pacemaker speed up','Race modes','race','#95b6e2',2],
    'Rushed · s':['Rushed duration','Race modes','race','#ef8794',2],
    'Uphill loss · m':['Uphill loss','Course & traffic','track','#d8af80',2],
    'pace-down loss · m':['Pace down loss','Race modes','race','#eab16d',2],
    'downhill-mode gain · m':['Downhill mode gain','Course & traffic','track','#8dcbd0',2],
    'rushed gain · m':['Rushed gain','Race modes','race','#ef8794',2],
    'Corner loss · m':['Corner distance loss','Course & traffic','track','#c5a1db',2],
    'Traffic loss · m':['Traffic loss','Course & traffic','race','#eab16d',2],
    'Exhaustion loss · m':['Exhaustion loss','Start & stamina','heart','#ef8794',2],
  };
  const aliases:Record<string,string>={'pace-up':'Pace up','pace-down':'Pace down','speed-up':'Pacemaker speed up','overtake':'Overtake','extra-pace-up':'Extra pace up','position-keep':'Position keep','lane-bonus':'Lane movement bonus','spot-struggle':'Spot struggle','conserve-power':'Conserve power','release-power':'Release power'};
  const raw=key.replace(/ gain · m$/,'').replace(/-model$/,'');
  const [label,group,icon,color,decimals]=known[key]??[`${aliases[raw]??raw.replaceAll('-',' ').replace(/^./,s=>s.toUpperCase())} gain`,'Race modes','race','#95b6e2',2];
  const unit=key.endsWith(' · s')?'s':key.endsWith(' · m')?'m':key.includes('HP')?'HP':'';
  const descriptions:Record<string,string>={
    'speed-up gain · m':'Distance gained from position-keeping speed up: opening a lead, normally as a front runner or while rushed.',
    'Uphill loss · m':'Estimated distance lost to the uphill target-speed penalty.',
    'downhill-mode gain · m':'Distance gained while downhill mode was active, including its speed carryover.',
    'pace-down loss · m':'Distance lost while slowing to maintain the strategy’s position behind the pace setter.',
    'Rushed · s':'Average time spent rushed per race.',
    'rushed gain · m':'Distance gained from rushed speed effects per race; excludes its HP cost.',
  };
  const order=['Start delay · s','Last-spurt start · m','Starting HP','HP spent','HP recovered','Exhaustion loss · m','Uphill loss · m','downhill-mode gain · m','Corner loss · m','Traffic loss · m','Rushed · s','rushed gain · m','speed-up gain · m','pace-up gain · m','pace-down loss · m','overtake gain · m','extra-pace-up gain · m','position-keep gain · m','conserve-power gain · m','release-power gain · m','dueling gain · m','spot-struggle gain · m','lane-bonus gain · m'].indexOf(key);
  return {label,group,icon,color,decimals,unit,description:descriptions[key],order:order<0?100:order};
}
