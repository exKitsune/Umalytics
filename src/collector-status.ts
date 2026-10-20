import type {Health,CollectionSettings,CertificateStatus} from './api';
export function collectorStatus(health:Health|null,desktop:boolean,reconnecting:boolean,settings:CollectionSettings,certificate:CertificateStatus|null):string{
  if(reconnecting&&(desktop||health?.mode==='desktop'))return 'Reconnecting to collector';
  if(!health)return desktop?'Connecting to collector':'Local viewer';
  if(health.mode!=='desktop')return 'Local viewer';
  if(!settings.collectionEnabled)return 'Collection paused';
  if(!certificate?.trusted)return 'Certificate needed';
  if(health.proxy?.gameConnected)return 'Game connected';
  if(health.proxy?.state==='running')return 'Ready · waiting for game';
  return health.proxy?.state==='starting'?'Starting collector':'Collector offline';
}
