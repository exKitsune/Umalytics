<script lang="ts">
  export let title:string;export let onClose:()=>void;
  function focus(node:HTMLElement){
    const previous=document.activeElement as HTMLElement;node.focus();
    function trap(e:KeyboardEvent){
      if(e.key==='Escape'){e.stopPropagation();onClose();}
      if(e.key!=='Tab')return;
      const items=[...node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length);
      const first=items[0],last=items.at(-1);if(!first||!last)return;
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===node)){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
    node.addEventListener('keydown',trap);return {destroy(){node.removeEventListener('keydown',trap);previous?.focus();}};
  }
</script>
<div class="library-backdrop" role="presentation" onclick={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div class="library-dialog" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" use:focus>
    <header><h2>{title}</h2><button aria-label={`Close ${title}`} onclick={onClose}>×</button></header>
    <slot/>
  </div>
</div>
<style>
  .library-backdrop{position:fixed;inset:0;z-index:300;background:#0009;display:grid;place-items:center;padding:18px}.library-dialog{width:min(460px,96vw);max-height:90vh;overflow:auto;padding:22px;border:1px solid var(--border);border-radius:12px;background:var(--panel);box-shadow:0 20px 80px #0008}.library-dialog:focus{outline:none}header{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:18px;height:auto}h2{font-size:19px;margin:0}header button{border:0;background:transparent;padding:4px 9px}
</style>
