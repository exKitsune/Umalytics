<script lang="ts">
import type {CareerRecord} from '../data/career';
import {g1WinGroups,g1Wins} from '../data/career-display';
export let career:CareerRecord;
$: groups=g1WinGroups(career);
$: count=g1Wins(career).size;
let missingArt=new Set<number>();
</script>
<details class="g1-wins">
  <summary><span class="disclosure-arrow" aria-hidden="true">▶</span><span>G1 wins</span><small>{career.saddles===null?'Not recorded':count}</small></summary>
  {#if groups.length}
    <div class="race-groups">
      {#each groups as group}
        <section class="race-group" aria-label={group.label}>
          <h4>{group.label}<small>{group.races.length}</small></h4>
          <ul class="race-banners">
            {#each group.races as win (win.id)}
              <li title={win.name}>
                {#if win.art&&!missingArt.has(win.art)}
                  <img src={`/career/race-${win.art}.png`} alt={win.name} width="128" height="64" loading="lazy" onerror={()=>missingArt=new Set([...missingArt,win.art])}/>
                {:else}<span>{win.name}</span>{/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {:else if career.saddles!==null}<p>No G1 wins recorded.</p>{/if}
</details>
<style>
.g1-wins{margin-top:18px}
summary{display:flex;align-items:center;gap:9px;padding:11px 12px;background:var(--panel-raised);border:1px solid var(--border);border-radius:7px;font-size:var(--font-12);font-weight:600;cursor:pointer;list-style:none}
summary::-webkit-details-marker{display:none}summary:hover{border-color:var(--accent)}summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
summary>small{margin-left:auto;color:var(--accent-text);background:var(--accent-soft);padding:2px 7px;border-radius:5px;font-weight:600}
.disclosure-arrow{font-size:var(--font-9);color:var(--muted);transition:transform .15s}details[open]>summary .disclosure-arrow{transform:rotate(90deg)}
.race-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}
.race-group{min-width:0;padding:10px;border:1px solid var(--border);border-radius:7px}
h4{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 9px;font-size:var(--font-11);font-weight:550;color:var(--muted)}h4 small{font-size:var(--font-10);font-weight:400}
.race-banners{display:grid;grid-template-columns:repeat(auto-fill,minmax(94px,1fr));gap:6px;list-style:none;margin:0;padding:0}
li{display:grid;place-items:center;aspect-ratio:2;min-width:0;border-radius:5px;overflow:hidden;background:var(--panel-raised)}
img{display:block;width:100%;height:auto;object-fit:contain}
li span{font-size:var(--font-11);font-weight:550;line-height:1.4;text-align:center;padding:8px;overflow-wrap:anywhere}
p{font-size:var(--font-11);color:var(--muted);margin:12px 0 0}
@media(max-width:850px){.race-groups{grid-template-columns:1fr}.race-banners{grid-template-columns:repeat(auto-fill,minmax(100px,1fr))}}
</style>
