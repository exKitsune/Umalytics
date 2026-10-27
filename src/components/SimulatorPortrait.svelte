<script lang="ts">
  import {portraitUrl} from '../data/portraits';
  export let uma:{cardId:number|null;charaId:number|null};
  export let size=62;
  $: url=portraitUrl(uma);
</script>
<span class="uma-portrait" style={`width:${size}px;height:${size}px`}>
  {#if url}<img src={url} alt="" draggable="false"/>{/if}
</span>
<style>
.uma-portrait{display:inline-flex;align-items:center;justify-content:center;flex:none}img{display:block;width:100%;height:100%;object-fit:contain}
</style>
