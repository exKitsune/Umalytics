export type WorkspaceRoute={kind:'races';id?:string}|{kind:'umas'}|{kind:'simulator';view:'setup'|'results';jobId?:string}|{kind:'simulation';jobId:string;index:number};
export function routeHash(route:WorkspaceRoute):string {
  const params=new URLSearchParams();
  if(route.kind==='races'&&route.id)params.set('id',route.id);
  if(route.kind==='simulator'){params.set('view',route.view);if(route.jobId)params.set('job',route.jobId);}
  if(route.kind==='simulation'){params.set('job',route.jobId);params.set('run',String(route.index));}
  return `#${route.kind}${params.size?'?'+params:''}`;
}
export function parseRoute(hash:string):WorkspaceRoute {
  const [kind,query]=hash.replace(/^#/,'').split('?'),p=new URLSearchParams(query),jobId=p.get('job')??'';
  if(kind==='umas')return {kind};
  if(kind==='simulator')return {kind,view:p.get('view')==='results'?'results':'setup',...(jobId?{jobId}:{})};
  const index=Number(p.get('run'));
  if(kind==='simulation'&&jobId&&p.has('run')&&Number.isInteger(index)&&index>=0&&index<1000)return {kind,jobId,index};
  return {kind:'races',...(p.get('id')?{id:p.get('id')!}:{})};
}
