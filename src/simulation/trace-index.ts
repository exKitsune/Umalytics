import {motionIndex as m,type DecisionTrace,type DecisionEvent} from './trace';

const grouped=new WeakMap<DecisionTrace,{events:Map<number|null,DecisionEvent[]>;motion:Map<number,number[][]>}>();
/** Preserve wire order while sharing runner partitions across analysis passes. */
export function traceIndex(trace:DecisionTrace){
  let value=grouped.get(trace);
  if(!value){
    value={events:new Map(),motion:new Map()};
    for(const event of trace.events){let rows=value.events.get(event.horseIndex);if(!rows)value.events.set(event.horseIndex,rows=[]);rows.push(event);}
    for(const row of trace.motion){let rows=value.motion.get(row[m.horse]);if(!rows)value.motion.set(row[m.horse],rows=[]);rows.push(row);}
    grouped.set(trace,value);
  }
  return value;
}

const eventTables=new WeakMap<DecisionEvent[],Map<string,Map<string,{all:DecisionEvent[];horses:Map<number|null,DecisionEvent[]>}>>>();
export function eventsOf(events:DecisionEvent[],kind:string,skillId:string,horse?:number|null):DecisionEvent[]{
  let table=eventTables.get(events);
  if(!table){
    table=new Map();
    for(const event of events){
      let skills=table.get(event.kind);if(!skills)table.set(event.kind,skills=new Map());
      let entry=skills.get(event.skillId);if(!entry)skills.set(event.skillId,entry={all:[],horses:new Map()});
      entry.all.push(event);let rows=entry.horses.get(event.horseIndex);if(!rows)entry.horses.set(event.horseIndex,rows=[]);rows.push(event);
    }
    eventTables.set(events,table);
  }
  const entry=table.get(kind)?.get(skillId);
  return (horse===undefined?entry?.all:entry?.horses.get(horse))??[];
}
