<script lang="ts">
  import type { VelocityKind } from '../data/skill-details';
  export let kind: VelocityKind;
  export let up = true;
  export let text: string;
  let open = false, left = 0, top = 0;
  const copy = {
    target: ['Target speed', 'The speed she is aiming for moves. Her actual speed eases onto it, then eases back.'],
    current: ['Current speed', 'Her speed changes immediately. The change ends with the skill.'],
    coast: ['Current speed · coast', 'Her speed changes immediately. After the skill, that change eases away.'],
  } as const;
  function place(event: PointerEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const width = 228, height = 176;
    left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    top = rect.bottom + height + 8 > window.innerHeight ? Math.max(8, rect.top - height - 8) : rect.bottom + 8;
    open = true;
  }
  $: high = up ? 16 : 46;
  $: low = up ? 46 : 16;
</script>
<!-- The term is the category. The graph is the behavior, including a cut versus a boost. -->
<span class="speed-term" role="note" onpointerenter={place} onpointerleave={()=>open=false}>{text}
  {#if open}
    <span class="speed-tip" style:left="{left}px" style:top="{top}px">
      <strong>{copy[kind][0]}</strong>
      <svg viewBox="0 0 164 78" aria-hidden="true">
        <rect x="40" y="8" width="64" height="48" class="window"/>
        {#if kind==='target'}
          <path class="target" d="M6,{low} H40 V{high} H104 V{low} H158"/>
          <path class="speed" d="M6,{low} C28,{low} 52,{low} 72,{(low+high)/2} C90,{high} 100,{high} 104,{high} C122,{high} 138,{low} 158,{low}"/>
        {:else if kind==='current'}
          <path class="target" d="M6,{low} H158"/>
          <path class="speed" d="M6,{low} H40 V{high} H104 V{low} H158"/>
        {:else}
          <path class="target" d="M6,{low} H158"/>
          <path class="speed" d="M6,{low} H40 V{high} H104 C124,{high} 140,{low} 158,{low}"/>
        {/if}
        <path class="bracket" d="M40,60 V65 H104 V60"/>
        <text class="when" x="72" y="74" text-anchor="middle">skill</text>
      </svg>
      <span class="key"><i class="speed"></i>Speed <i class="target"></i>Target</span>
      <small>{copy[kind][1]}</small>
    </span>
  {/if}
</span>
<style>
.speed-term{position:relative;border-bottom:1px dotted var(--muted);cursor:help}
.speed-tip{position:fixed;z-index:80;width:212px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--panel);box-shadow:var(--shadow);color:var(--text);pointer-events:none}
.speed-tip strong{display:block;font-size:var(--font-12);font-weight:650;margin-bottom:6px}
.speed-tip svg{display:block;width:100%;height:auto}
.speed-tip small{display:block;margin-top:6px;color:var(--muted);font-size:var(--font-11);line-height:1.45}
.window{fill:var(--accent);opacity:.2}
.speed{fill:none;stroke:var(--accent-text,var(--accent));stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.target{fill:none;stroke:var(--muted);stroke-width:1.4;stroke-dasharray:3 3;stroke-linejoin:round}
.bracket{fill:none;stroke:var(--muted);stroke-width:1}
.when{fill:var(--muted);font-size:var(--font-8);font-family:inherit}
.key{display:flex;gap:8px;align-items:center;margin-top:4px;color:var(--muted);font-size:var(--font-10)}
.key i{width:14px;height:0;border-top:2px solid var(--accent-text,var(--accent))}
.key i.target{border-top:1.4px dashed var(--muted)}
</style>
