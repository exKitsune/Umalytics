<script lang="ts">
  const label='Slowdown: white 0.001, yellow 0.25, amber 0.4, red 0.6 m/s or more.';
</script>
<span class="traffic-scale" aria-label={label}>
  <span class="ramp"></span><span class="ticks"><span>0.001</span><span>0.25</span><span>0.4</span><span>≥0.6 m/s</span></span>
</span>
<style>
  .traffic-scale{display:inline-flex;flex-direction:column;gap:5px;width:190px;max-width:100%;vertical-align:middle;flex:none}.ramp{height:6px;border-radius:9px;background:linear-gradient(90deg,#fff,#ffec4a 41.57%,#ffa825 66.61%,#f04444);box-shadow:0 0 0 1px color-mix(in srgb,var(--border) 50%,transparent)}.ticks{position:relative;height:9px;font-size:var(--font-9);font-variant-numeric:tabular-nums;color:var(--muted);line-height:1}.ticks span{position:absolute;transform:translateX(-50%)}.ticks span:first-child{left:0;transform:none}.ticks span:nth-child(2){left:41.57%}.ticks span:nth-child(3){left:66.61%}.ticks span:last-child{right:0;transform:none}
</style>
