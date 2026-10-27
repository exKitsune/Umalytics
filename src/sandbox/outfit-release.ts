import {catalog as fallback} from '../data/catalog';

const releases:Readonly<Record<string,string|null>>=fallback.outfitGlobalReleases;

/** Catalog Global dates, not translated names or JP availability. Unknown stays hidden. */
export function isOutfitReleased(cardId:number,asOf:Date|string=new Date()):boolean {
  const release=releases[String(cardId)],date=typeof asOf==='string'?new Date(asOf):asOf;
  return !!release&&Number.isFinite(date.getTime())&&release<=date.toISOString().slice(0,10);
}
