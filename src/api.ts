import type { RaceCategory } from './data/types';
export interface CollectionSettings { schemaVersion: number; collectionEnabled: boolean; categories: Record<RaceCategory, boolean>; startAtLogin?: boolean; exportDirectory?: string | null; downloadsDirectory?: string }
export interface CertificateStatus { exists: boolean; trusted: boolean; sha256?: string; sha1?: string; subject?: string; expiresAt?: string }
export interface UpdateStatus { phase:string; availableVersion:string|null; canInstall?:boolean }
export interface StorageOptimizationStatus {phase:'pending'|'waiting'|'running'|'complete'|'failed'|'stopped';stage:string;done:number;total:number;reclaimedBytes:number;skipped:number}
export interface Health { storageOptimization?:StorageOptimizationStatus; analysisService?:boolean; analysisBackground?:{running:boolean;checked:number;total:number;failed:number}; ok: boolean; app?: string; mode: string; csrfToken?: string; proxy?: {state:string;port:number;error?:string;running?:boolean;listening?:boolean;gameConnected?:boolean;activeGameConnections?:number;lastGameTrafficAt?:string|null}; certificate?: CertificateStatus; launchOption?:string; dataDirectory?:string; update?:UpdateStatus }
export const defaultSettings = (): CollectionSettings => ({schemaVersion:1,collectionEnabled:true,categories:{career:false,'team-trials':false,practice:true,'champions-meeting':true,'league-of-heroes':true,other:true}});
export class ApiError extends Error {constructor(message:string,readonly status:number){super(message);}}
export async function api<T>(path: string, body?: unknown, csrfToken?: string): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : {'Content-Type':'application/json','X-UmaTrace-CSRF':csrfToken ?? ''}, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(body === undefined ? 15000 : 120000) });
  if (!response.ok) { const detail=await response.json().catch(()=>null); throw new ApiError(detail?.error??`Collector request failed (${response.status}).`,response.status); }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Desktop collector is unavailable in this viewer.');
  return response.json();
}

export interface SavedExport { filename: string; path: string; revealed: boolean }
export interface Preferences { theme:'dark'|'light'; fontScale:number; courseAssignments:Record<string,number>; browserMigrationComplete:boolean; raceTags?:Record<string,string[]> }
export interface ImportReceipt { id:string; sha256:string; filename:string; receivedAt:string }
export async function saveDesktopExport(filename: string, content: string, csrfToken: string): Promise<SavedExport> {
  return api<SavedExport>('exports', {filename, content}, csrfToken);
}
export async function revealDesktop(target: 'data' | 'exports' | 'diagnostics', csrfToken: string): Promise<SavedExport> {
  return api<SavedExport>('reveal', {target}, csrfToken);
}

