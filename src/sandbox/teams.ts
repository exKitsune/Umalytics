import type {Setup} from './model';
export function setupTeams(setup:Setup){
  const teams=(setup.teams??[]).map(t=>({...t}));
  for(const p of setup.participants)if(p.team!==null&&!teams.some(t=>t.id===p.team))teams.push({id:p.team,name:`Team ${p.team+1}`});
  return teams;
}
export function addTeam(setup:Setup):Setup {
  const teams=setupTeams(setup);if(teams.length>=18)return setup;
  let id=0;while(teams.some(t=>t.id===id))id++;
  return {...setup,teams:[...teams,{id,name:`Team ${id+1}`}]};
}
export function deleteTeam(setup:Setup,id:number):Setup {
  return {...setup,teams:setupTeams(setup).filter(t=>t.id!==id),participants:setup.participants.map(p=>p.team===id?{...p,team:null}:p)};
}
