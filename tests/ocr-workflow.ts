import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {findSkillCards,findStatCells,findDetailRegions,textPixels,gradeColor,iconSignature,matchIcon} from '../src/ocr/layout';
import {mergeScreenshots,identifyOutfits,skillCandidates,reviewSkillCandidates,type ScreenshotReading,type OcrLine} from '../src/ocr/recognition';
const reference={metadata:JSON.parse(readFileSync('public/data/metadata.json','utf8'))} as any;
const line=(text:string):OcrLine=>({text,confidence:95,bbox:{x0:0,y0:0,x1:100,y1:30},words:[]});
const reading=(image:number,texts:string[],full=false):ScreenshotReading=>({image,lines:full?[line('[Shooting Star Revue]'),line('Fuji Kiseki')]:[],stats:full?{speed:1119,stamina:452,power:755,guts:582,wisdom:1007}:{},aptitudes:full?{Turf:'A',Dirt:'F'}:{},skills:texts.map(text=>({text,confidence:95,image}))});
const result=mergeScreenshots([
  reading(0,['Lights of Vaudeville Lvl 4','Right-Handed ©','Quter Post Proficiency O','Medium Straightaways O'],true),
  reading(1,['Lights of Vaudeville Lvl 4','Right-Handed ◎','Outer Post Proficiency ○','Racing Spirit: Stamina']),
  reading(2,['Straighta ways O','Racing Spirit: Stamina']),
],reference);
const uniqueOnly=reading(0,['Lights of Vaudeville Lvl 4']);uniqueOnly.skills[0].nativeUnique=true;
const fromUnique=mergeScreenshots([uniqueOnly],reference);
assert.equal(fromUnique.cardId,100501,'A leveled rainbow native unique identifies its outfit without a readable header');
assert.equal(fromUnique.skills[0].id,100051);assert.equal(fromUnique.skills[0].level,4);
const inheritedOnly=structuredClone(uniqueOnly);inheritedOnly.skills[0].nativeUnique=false;
assert.equal(mergeScreenshots([inheritedOnly],reference).cardId,null,'Text or a level without rainbow evidence cannot establish the owner');
const noLevel=structuredClone(uniqueOnly);noLevel.skills[0].text='Lights of Vaudeville';
assert.equal(mergeScreenshots([noLevel],reference).cardId,null,'Rainbow evidence also requires a visible native level');
const wrongHeader=structuredClone(uniqueOnly);wrongHeader.lines=['[Special Dreamer]','Special Week'].map(line);
assert.equal(mergeScreenshots([wrongHeader],reference).cardId,null,'Conflicting header and unique identities require review');
assert.equal(result.cardId,100501);assert.deepEqual(result.stats,{speed:1119,stamina:452,power:755,guts:582,wisdom:1007});
assert.equal(result.skills.length,5);assert.equal(result.unresolved.length,0);
assert.equal(result.skills.find(s=>s.id===100051)?.level,4);assert.deepEqual(result.skills.find(s=>s.id===200011)?.sources,[0,1]);
assert.equal(result.skills.find(s=>s.id===200262)?.sources.length,2);assert.equal(result.skills.find(s=>s.id===210101)?.sources.length,2);
assert.equal(skillCandidates('Right-Handed ©',reference,100501)[0].id,200011);
assert.equal(skillCandidates('Right-Handed O',reference,100501)[0].id,200012);
assert.equal(reviewSkillCandidates('Racing Sprit Stamina',reference,null)[0].id,210101,'Manual fuzzy corrections tolerate OCR substitutions');
assert.ok(reviewSkillCandidates('Right-Hand',reference,null).some(s=>s.id===200011),'Partial searches can select a missing skill tier');
assert.equal(reviewSkillCandidates('Lights of Vaudeville',reference,100501)[0].id,100051,'Manual correction supports the selected Uma’s own unique');
assert.equal(reviewSkillCandidates('Lights Vaudeville',reference,null,true)[0].id,100051,'Rainbow evidence allows a manual native-unique lookup before its owner is known');
assert.deepEqual(identifyOutfits(['[Shooting','Star Revue]','Fuji','Kiseki'].map(line),reference),[100501],'Identity survives OCR line fragmentation');
const regional=structuredClone(reference);regional.metadata.skills[204372]={...regional.metadata.skills[200502],name:'Go With the Flow',dataRegion:'JP',unreleasedGlobal:true,iconId:20011};
assert.equal(mergeScreenshots([reading(0,['Go with the Flow'],true)],regional).skills.length,0,'A duplicate JP name needs evidence to disambiguate');
const iconEvidence=reading(0,['Go with the Flow'],true);iconEvidence.skills[0].iconId=20051;
assert.equal(mergeScreenshots([iconEvidence],regional).skills[0]?.id,200502,'The arrow icon distinguishes the Global lane skill from a JP speed skill');
assert.equal(mergeScreenshots([reading(0,['Right-Handed'])],reference).skills.length,0,'A missing ○/◎ must not silently pick a tier');
assert.equal(mergeScreenshots([reading(0,['Skills','Close','Career Info','Change','Inspiration'])],reference).skills.length,0,'UI labels never become skills');
const conflict=reading(1,[],true);conflict.stats.speed=1200;const conflicted=mergeScreenshots([reading(0,[],true),conflict],reference);
assert.equal(conflicted.stats.speed,null);assert.deepEqual(conflicted.statChoices.speed,[1119,1200]);assert.ok(conflicted.warnings.some(w=>w.includes('Conflicting speed')));
assert.ok(Object.values(mergeScreenshots([reading(0,['Racing Spirit: Stamina'])],reference).stats).every(v=>v===null),'Skill-only imports do not invent base stats or an identity');
assert.equal(mergeScreenshots([reading(0,['Racing Spirit: Stamina'])],reference).cardId,null);
const pixels={width:520,height:125,data:new Uint8ClampedArray(520*125*4).fill(255)};
function paint(x:number,y:number,w:number,h:number,color:number[]){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const i=(yy*pixels.width+xx)*4;pixels.data.set([...color,255],i);}}
paint(14,20,489,88,[200,198,225]);paint(26,35,51,51,[245,160,30]);
const cards=findSkillCards(pixels);assert.equal(cards.length,1);assert.ok(cards[0].text.x>77,'The colored icon must be excluded from OCR text');assert.equal(findStatCells(pixels).length,0);
const signature=iconSignature(pixels);assert.equal(matchIcon(signature,[{id:20051,signature}]),20051);assert.equal(matchIcon([],[]),undefined);
const ui={width:520,height:125,data:new Uint8ClampedArray(520*125*4).fill(255)};assert.equal(findSkillCards(ui).length,0);
const details={width:1000,height:500,data:new Uint8ClampedArray(1000*500*4).fill(255)};
function fillDetails(x:number,y:number,w:number,h:number,color:number[]){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)details.data.set([...color,255],(yy*details.width+xx)*4);}
fillDetails(0,200,1000,40,[120,220,20]);
for(let i=0;i<5;i++)fillDetails(i*200+100,255,35,30,[140,80,30]);
assert.equal(findStatCells(details).length,5,'A cropped title must not prevent reading the stat row');
const regions=findDetailRegions(details);assert.ok(regions.identity&&regions.aptitudes);assert.equal(regions.identity.y+regions.identity.height,200);assert.ok(regions.aptitudes.y>240);
fillDetails(0,0,1000,70,[120,220,20]);
assert.equal(findStatCells(details)[0].y,244,'Adding a title leaves the same stat row selected');
fillDetails(10,15,200,50,[200,198,225]);fillDetails(20,20,35,35,[245,160,30]);
assert.equal(findSkillCards(details).length,0,'Portrait decorations above a title-free stat row must not become skill crops');
const converted=textPixels({width:2,height:1,data:[140,80,30,255,180,240,60,255]});assert.deepEqual([...converted],[0,0,0,255,255,255,255,255]);
assert.equal(gradeColor({width:4,height:4,data:Array.from({length:16},()=>[255,185,50,255]).flat()}),'S');
assert.equal(gradeColor({width:4,height:4,data:Array.from({length:16},()=>[220,140,255,255]).flat()}),'E','Purple E must not be classified as pink B');
assert.equal(gradeColor({width:4,height:4,data:Array.from({length:16},()=>[255,170,220,255]).flat()}),'B');
console.log('Screenshot OCR: card landmarks, cropped skills, tier matching, outfit identity, unique level, deduplication, conflicts and UI rejection passed.');
