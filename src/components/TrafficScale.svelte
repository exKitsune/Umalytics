<script lang="ts">
  import {trafficLegend} from '../simulation/traffic';
</script>
<span class="traffic-scale" title={trafficLegend} aria-label={trafficLegend}>
  <span class="ramp"></span><span class="ticks"><span>0</span><span>0.5</span><span>≥1 m/s</span></span>
</span>
<style>
  .traffic-scale{display:inline-flex;flex-direction:column;gap:3px;width:150px;vertical-align:middle;flex:none;cursor:help}.ramp{height:7px;border-radius:3px;background:linear-gradient(90deg,#fff34f,#ffb02e,#f04444)}.ticks{display:flex;justify-content:space-between;font-size:var(--font-9);font-variant-numeric:tabular-nums;color:var(--muted);line-height:1}
</style>
