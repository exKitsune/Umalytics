<script lang="ts">
  const label='Slowdown: white 0.15, yellow 0.35, amber 0.65, red 1 m/s or more.';
</script>
<span class="traffic-scale" aria-label={label}>
  <span class="ramp"></span><span class="ticks"><span>0.15</span><span>0.35</span><span>0.65</span><span>≥1 m/s</span></span>
</span>
<style>
  .traffic-scale{display:inline-flex;flex-direction:column;gap:5px;width:190px;max-width:100%;vertical-align:middle;flex:none}.ramp{height:6px;border-radius:9px;background:linear-gradient(90deg,#fff,#ffec4a 23.53%,#ffa825 58.82%,#f04444);box-shadow:0 0 0 1px color-mix(in srgb,var(--border) 50%,transparent)}.ticks{position:relative;height:9px;font-size:var(--font-9);font-variant-numeric:tabular-nums;color:var(--muted);line-height:1}.ticks span{position:absolute;transform:translateX(-50%)}.ticks span:first-child{left:0;transform:none}.ticks span:nth-child(2){left:23.53%}.ticks span:nth-child(3){left:58.82%}.ticks span:last-child{right:0;transform:none}
</style>
