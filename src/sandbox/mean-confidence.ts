/** Student-t interval for the mean of independent paired differences.
 * It describes sampling uncertainty, not uncertainty in the engine itself. */
export function meanConfidence(sample:{n:number;mean:number|null;standardError:number|null}){
  if(sample.n<2||sample.mean===null||sample.standardError===null||!Number.isFinite(sample.mean)||!Number.isFinite(sample.standardError)||sample.standardError<0)return null;
  const df=sample.n-1;
  const critical=[0,12.706204736,4.30265273,3.182446305,2.776445105,2.570581836,2.446911851,2.364624252,2.306004135,2.262157163,2.228138852,2.20098516,2.17881283,2.160368656,2.144786688,2.131449546,2.119905299,2.109815578,2.10092204,2.093024054,2.085963447,2.079613845,2.073873068,2.06865761,2.063898562,2.059538553,2.055529439,2.051830516,2.048407142,2.045229642,2.042272456];
  const z=1.95996398454,t=df<=30?critical[df]:z+(z**3+z)/(4*df)+(5*z**5+16*z**3+3*z)/(96*df**2)+(3*z**7+19*z**5+17*z**3-15*z)/(384*df**3);
  const half=t*sample.standardError;return {low:sample.mean-half,high:sample.mean+half};
}
