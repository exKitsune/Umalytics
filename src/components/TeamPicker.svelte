<script lang="ts">
 import {teamColors} from '../sandbox/editor';
 export let value:number|null;
 export let onChange:(value:number|null)=>void;
 let open=false;
 $: color=value===null?null:teamColors[value%teamColors.length];
</script>
<div class="team-picker" onfocusout={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))open=false;}} role="group" aria-label="Team">
 <span>Team</span><button type="button" class="trigger" aria-label={`Team: ${color?.[0]??'No team'}`} aria-expanded={open} onkeydown={e=>{if(e.key==='Escape'){e.stopPropagation();open=false;}}} onclick={()=>open=!open}><i style:background={color?.[1]??'var(--muted)'}></i>{color?.[0]??'No team'}<small>▾</small></button>
 {#if open}<div class="choices">{#each [null,...teamColors.map((_,i)=>i)] as option}<button type="button" aria-pressed={value===option} onkeydown={e=>{if(e.key==='Escape'){e.stopPropagation();open=false;}}} onclick={()=>{onChange(option);open=false;}}><i style:background={option===null?'var(--muted)':teamColors[option][1]}></i>{option===null?'No team':teamColors[option][0]}</button>{/each}</div>{/if}
</div>
<style>
.team-picker{position:relative;min-width:0;font-size:12px;color:var(--muted)}.team-picker>span{display:block;margin-bottom:6px}button{display:flex;align-items:center;justify-content:flex-start;gap:8px;width:100%;text-align:left;padding:8px;background:var(--bg);font-size:12px}.trigger small{margin-left:auto}i{width:10px;height:10px;border-radius:50%;flex:none}.choices{position:absolute;z-index:35;top:100%;left:0;width:100%;box-sizing:border-box;border:1px solid var(--border);background:var(--panel);padding:4px;border-radius:6px;box-shadow:0 6px 20px #0005}.choices button{border:0;background:transparent}.choices button:hover{background:var(--accent-soft)}
</style>
