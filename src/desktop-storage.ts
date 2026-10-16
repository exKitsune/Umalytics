import { api, type ImportReceipt, type Preferences } from './api';
import { deleteSavedRace, raceLibraryEntry, savedRaces, type LibraryEntry } from './library';
import { toPortableRace } from './data/share';
import type { Race } from './data/types';
import { FONT_SCALE_KEY, normalizeFontScale } from './typography';

export const THEME_KEY='umatrace-theme';
export const COURSE_KEY='umalytics-course-assignments';
export function browserPreferences():Pick<Preferences,'theme'|'fontScale'|'courseAssignments'> {
  let theme:'dark'|'light'='dark';
  let fontScale=100;
  let courseAssignments:Record<string,number>={};
  try {theme=localStorage.getItem(THEME_KEY)==='light'?'light':'dark';const value=JSON.parse(localStorage.getItem(COURSE_KEY)??'{}');if(value&&typeof value==='object'&&!Array.isArray(value))courseAssignments=Object.fromEntries(Object.entries(value).filter(([,id])=>typeof id==='number'&&Number.isSafeInteger(id)&&id>0)) as Record<string,number>;}catch {/* Native preferences remain available when browser storage is disabled. */}
  try {const raw=localStorage.getItem(FONT_SCALE_KEY);fontScale=normalizeFontScale(raw===null?100:Number(raw));}catch {}
  return {theme,fontScale,courseAssignments};
}

async function importEntry(entry:LibraryEntry,csrfToken:string):Promise<LibraryEntry> {
  if(!entry.race)throw new Error('A browser race could not be read. Its original copy is still saved.');
  const receipt=await api<ImportReceipt>('races/import',{id:entry.id,race:toPortableRace(entry.race)},csrfToken);
  if(receipt.id!==entry.id||!/^[a-f0-9]{64}$/.test(receipt.sha256))throw new Error('Race save was not acknowledged. Its original copy is still saved.');
  return {...entry,remoteId:receipt.id,sha256:receipt.sha256,receivedAt:receipt.receivedAt};
}
export async function saveDesktopRace(race:Race,csrfToken:string):Promise<LibraryEntry> {
  return importEntry(await raceLibraryEntry(race),csrfToken);
}

/** Each acknowledged race is removed separately; interrupted migrations can safely resume. */
export async function migrateBrowserStorage(csrfToken:string):Promise<Preferences> {
  const native=await api<Preferences>('preferences');
  let entries:LibraryEntry[];
  try {entries=await savedRaces();}catch(e){if(native.browserMigrationComplete)return native;throw e;}
  for(const entry of entries) {
    await importEntry(entry,csrfToken);
    await deleteSavedRace(entry.id);
  }
  const legacy=browserPreferences();
  let themeRaw:string|null,courseRaw:string|null,fontRaw:string|null;
  try {themeRaw=localStorage.getItem(THEME_KEY);courseRaw=localStorage.getItem(COURSE_KEY);fontRaw=localStorage.getItem(FONT_SCALE_KEY);}catch(e){if(native.browserMigrationComplete)return native;throw e;}
  if(courseRaw!==null){const parsed=JSON.parse(courseRaw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.values(parsed).some(id=>typeof id!=='number'||!Number.isSafeInteger(id)||id<=0))throw new Error('Browser course choices could not be read. The original preference is still saved.');}
  const patch={
    theme:native.browserMigrationComplete||themeRaw===null?native.theme:legacy.theme,
    fontScale:native.browserMigrationComplete||fontRaw===null?normalizeFontScale(native.fontScale):legacy.fontScale,
    courseAssignments:native.browserMigrationComplete?{...legacy.courseAssignments,...native.courseAssignments}:{...native.courseAssignments,...legacy.courseAssignments},
  };
  const preferences=await api<Preferences>('preferences',patch,csrfToken);
  if('theme' in patch&&preferences.theme!==patch.theme)throw new Error('Appearance save was not acknowledged.');
  if(preferences.fontScale!==patch.fontScale)throw new Error('Text size save was not acknowledged.');
  if('courseAssignments' in patch&&Object.entries(patch.courseAssignments!).some(([id,course])=>preferences.courseAssignments[id]!==course))throw new Error('Course choices were not acknowledged.');
  const complete=await api<Preferences>('preferences',{browserMigrationComplete:true},csrfToken);
  if(!complete.browserMigrationComplete)throw new Error('Library migration was not acknowledged.');
  // Remove only preference keys owned by this app.
  try {localStorage.removeItem(THEME_KEY);localStorage.removeItem(COURSE_KEY);localStorage.removeItem(FONT_SCALE_KEY);}catch {/* The acknowledged native copy remains usable if browser cleanup is disabled. */}
  return complete;
}
