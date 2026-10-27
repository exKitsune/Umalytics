/** Native dialog backdrops target the dialog itself. Padding is still inside
 * the dialog; a drag beginning inside must not be mistaken for dismissal. */
export function dismissDialog(node:HTMLDialogElement){
  let beganOutside=false;
  const outside=(event:MouseEvent)=>{const b=node.getBoundingClientRect();return event.target===node&&(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom);};
  const down=(event:PointerEvent)=>{beganOutside=event.button===0&&outside(event);};
  const click=(event:MouseEvent)=>{if(beganOutside&&outside(event))node.close();beganOutside=false;};
  node.addEventListener('pointerdown',down);node.addEventListener('click',click);
  return {destroy(){node.removeEventListener('pointerdown',down);node.removeEventListener('click',click);}};
}
