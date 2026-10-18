import {projectSimulation} from './project';
import {decisionTrace} from './trace';
import {enrichSimulation} from './enrich';
import {packDerived,restoreDerived} from './derived-cache';
self.onmessage=async event=>{
  try{
    const {race,report,reference,cached,cacheKey}=event.data;
    const value=projectSimulation(race,report,reference),trace=decisionTrace(report);
    if(!value||!trace)throw new Error('Matched simulation trace unavailable.');
    const cacheHit=cached&&restoreDerived(value,cacheKey,cached);
    if(!cacheHit){
      try{await enrichSimulation(value,trace,reference);}
      catch(error){
        // A disposable metric failure must not discard an authorized dashboard.
        const baseline=projectSimulation(race,report,reference)!;
        baseline.analysis.warnings.push(`Some local comparisons are unavailable: ${String(error)}`);
        self.postMessage({type:'complete',value:baseline,cacheHit:false});return;
      }
    }
    const packed=cacheHit?cached:packDerived(value,cacheKey);
    self.postMessage({type:'complete',value,packed,cacheHit:!!cacheHit},{transfer:[packed.buffer]});
  }catch(error){self.postMessage({type:'error',error:String(error)});}
};
