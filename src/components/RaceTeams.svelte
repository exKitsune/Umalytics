<script lang="ts">
  import { onMount } from 'svelte';
  import type { Race } from '../data/types';
  import { runnerName, type ReferenceData } from '../data/reference';
  import { finishPlace, raceTeams } from '../data/race-teams';
  import UmaPortrait from './UmaPortrait.svelte';
  export let race: Race;
  export let reference: ReferenceData | null;
  export let selected: string;
  export let onSelect: (id: string) => void;
  let revealed: string | null = null;
  let copied: string | null = null;
  $: teams = raceTeams(race);
  function toggleId(teamId: string, event: MouseEvent) {
    event.stopPropagation();
    revealed = revealed === teamId ? null : teamId;
    if (revealed !== teamId) copied = null;
  }
  async function copyId(teamId: string, id: string, event: MouseEvent) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      const area = document.createElement('textarea');
      area.value = id;
      area.setAttribute('readonly', '');
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    copied = teamId;
  }
  function medal(order: number | null | undefined) {
    return order === 1 ? 'gold' : order === 2 ? 'silver' : order === 3 ? 'bronze' : null;
  }
  onMount(() => {
    const hide = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('.trainer-id')) return;
      revealed = null;
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') revealed = null; };
    window.addEventListener('pointerdown', hide);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', hide);
      window.removeEventListener('keydown', escape);
    };
  });
</script>
<div class="race-teams" aria-label="Trainers and teams">
  {#each teams as team}
    <section class="team-box" style={`--team:${team.color}`} aria-label={team.trainer ?? (team.runners.every(runner => runner.isNpc) ? 'NPC team' : 'Team')}>
      <header>
        <strong>{team.trainer ?? (team.runners.every(runner => runner.isNpc) ? 'NPC team' : 'Trainer')}</strong>
        {#if team.trainerId}
          <span class="trainer-id">
            <button type="button" class="trainer-id-value" aria-expanded={revealed === team.id} aria-label={revealed === team.id ? 'Hide trainer ID' : 'Show trainer ID'} title={revealed === team.id ? undefined : 'Show trainer ID'} onclick={event => toggleId(team.id, event)}>{revealed === team.id ? team.trainerId : '••••••••'}</button>
            {#if revealed === team.id}
              <button type="button" class="trainer-id-copy" aria-label="Copy trainer ID" onclick={event => copyId(team.id, team.trainerId!, event)}>{copied === team.id ? 'Copied' : 'Copy'}</button>
            {/if}
          </span>
        {/if}
      </header>
      <div class="team-umas">
        {#each team.runners as runner}
          <button type="button" class="uma-card" class:chosen={runner.id === selected} onclick={() => onSelect(runner.id)} title={runnerName(reference, runner)}>
            <UmaPortrait {runner} size={40} alt={runnerName(reference, runner)}/>
            <span class="uma-name">{runnerName(reference, runner)}</span>
            <span class="uma-meta"><span>Gate {runner.gate ?? runner.index + 1}</span><span class="place">{#if medal(runner.finishOrder)}<i class="medal {medal(runner.finishOrder)}" aria-hidden="true"></i>{/if}{finishPlace(runner.finishOrder) ?? '—'}</span></span>
          </button>
        {/each}
      </div>
    </section>
  {/each}
</div>
<style>
  .race-teams{display:flex;flex-wrap:nowrap;gap:8px;min-width:0;overflow-x:auto;overflow-y:hidden;padding-bottom:2px;scrollbar-width:thin}
  .team-box{flex:0 0 auto;width:max-content;max-width:none;padding:7px 8px;border:1px solid color-mix(in srgb,var(--team) 55%,var(--border));border-radius:8px;background:color-mix(in srgb,var(--team) 18%,var(--panel))}
  header{display:flex;align-items:baseline;gap:8px;margin-bottom:5px}header strong{min-width:0;font-size:var(--font-12);font-weight:650;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .trainer-id{display:inline-flex;align-items:center;gap:6px;min-width:0}
  .trainer-id-value,.trainer-id-copy{padding:0;border:0;background:transparent;color:var(--muted);font-size:var(--font-10);font-weight:550}
  .trainer-id-value{font-variant-numeric:tabular-nums;letter-spacing:.04em}.trainer-id-value:hover,.trainer-id-copy:hover{background:transparent;color:var(--text);border:0}.trainer-id-value[aria-expanded=true]{letter-spacing:0;color:var(--text)}
  .trainer-id-copy{letter-spacing:.02em;text-decoration:underline;text-underline-offset:2px}
  .team-umas{display:flex;flex-wrap:nowrap;gap:4px}
  .uma-card{display:flex;flex-direction:column;align-items:center;gap:2px;width:62px;padding:4px 3px;border:1px solid transparent;border-radius:7px;background:color-mix(in srgb,var(--panel) 72%,transparent);color:var(--text);white-space:normal;text-align:center}
  .uma-card:hover,.uma-card.chosen{border-color:color-mix(in srgb,var(--team) 70%,var(--border));background:color-mix(in srgb,var(--team) 22%,var(--panel))}
  .uma-name{max-width:100%;font-size:var(--font-10);font-weight:550;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .uma-meta{display:flex;flex-direction:column;align-items:center;font-size:var(--font-9);color:var(--muted);font-variant-numeric:tabular-nums;line-height:1.2}
  .place{position:relative;display:inline-block}.medal{position:absolute;left:-9px;top:50%;width:6px;height:6px;margin-top:-3px;border-radius:50%}.medal.gold{background:#e6c15a}.medal.silver{background:#c5ced6}.medal.bronze{background:#d08a56}
</style>
