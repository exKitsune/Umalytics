<script lang="ts">
  import type { Runner } from '../data/types';
  import { strategyLabel } from '../data/game-icons';
  export let runner:Pick<Runner,'strategy'|'strategyCode'>;
  $: label=strategyLabel(runner);
  $: color=({Front:'#159bd1',Runaway:'#e35a72',Pace:'#7eae36',Late:'#d0a51e',End:'#ef8b35'} as Record<string,string>)[label]??'#8b949e';
</script>
<span class="strategy-badge" title={runner.strategy??label} style={`--style-color:${color}`}><svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="8"/><path d="m4 5 3 4-3 4V5Zm5 0 3 4-3 4V5Z"/>{#if label==='Runaway'}<path d="m13 5 3 4-3 4V5Z"/>{/if}</svg>{label}</span>
<style>.strategy-badge{display:inline-flex;align-items:center;gap:4px;min-width:92px;padding:3px 6px;border:1px solid color-mix(in srgb,var(--style-color) 55%,transparent);border-radius:5px;background:color-mix(in srgb,var(--style-color) 14%,var(--panel));color:var(--text);font-size:var(--font-10);font-weight:600;white-space:nowrap}.strategy-badge svg{width:15px;height:15px}.strategy-badge circle{fill:var(--style-color)}.strategy-badge path{fill:#fff}</style>
