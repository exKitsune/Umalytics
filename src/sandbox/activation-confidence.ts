/** Conditional WR and overall WR overlap. Compare disjoint activated/inactive
 * groups, then scale by the inactive share: p(A) - p(all) = q * (p(A)-p(B)).
 * Newcombe's unpooled Wilson-score difference, conditional on group sizes. */
function wilson(wins:number,n:number,z:number){
  const p=wins/n,z2=z*z,d=1+z2/n,mid=(p+z2/(2*n))/d,half=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/d;
  return [Math.max(0,mid-half),Math.min(1,mid+half)];
}
export function activationConfidence(activatedWins:number,activated:number,wins:number,n:number,known=n){
  if(![activatedWins,activated,wins,n,known].every(Number.isInteger)||n<1||activated<1||activated>n||known!==n||wins<activatedWins||wins>n||activatedWins<0||activatedWins>activated||wins-activatedWins>n-activated)return null;
  const delta=activatedWins/activated-wins/n,q=(n-activated)/n;
  if(!q)return {delta,low:0,high:0,low99:0,high99:0,strength:0};
  const a=activatedWins/activated,b=(wins-activatedWins)/(n-activated);
  const interval=(z:number)=>{const [al,ah]=wilson(activatedWins,activated,z),[bl,bh]=wilson(wins-activatedWins,n-activated,z);return [q*(a-b-Math.hypot(a-al,bh-b)),q*(a-b+Math.hypot(ah-a,b-bl))];};
  const [low,high]=interval(1.95996398454),[low99,high99]=interval(2.57582930355);
  const edge=delta>0?low:-high,outer=delta>0?low99:-high99;
  const strength=edge<=0?0:Math.min(1,edge/Math.max(1e-12,edge-outer));
  return {delta,low,high,low99,high99,strength};
}
