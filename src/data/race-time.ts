/** Global race clocks without an offset are UTC for display. Keep stored
 * evidence unchanged; this is not game-version eligibility evidence. */
export function raceTimestamp(value:string):Date {
  const clock=value.trim().replace(' ','T');
  return new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(clock)?clock+'Z':clock);
}
export function formatRaceTime(value:string,locales?:Intl.LocalesArgument,timeZone?:string):string {
  const date=raceTimestamp(value);
  return Number.isFinite(date.getTime())?date.toLocaleString(locales,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short',...(timeZone?{timeZone}:{})}):'Unknown date';
}
