export function localDate(date=new Date()){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

/** Each series keeps its latest started event plus the next two dates. */
export function upcomingEvents<T extends {kind:string;date:string}>(events:T[],kind:string,today:string){
  const ordered=events.filter(event=>event.kind===kind).sort((a,b)=>a.date.localeCompare(b.date));
  const current=ordered.filter(event=>event.date<=today).at(-1);
  return [...(current?[current]:[]),...ordered.filter(event=>event.date>today).slice(0,2)];
}
