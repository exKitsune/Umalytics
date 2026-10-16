export const FONT_SCALE_KEY='umalytics-font-scale';
export const DEFAULT_FONT_SCALE=100;
export const MIN_FONT_SCALE=75;
export const MAX_FONT_SCALE=200;

export function normalizeFontScale(value:unknown):number {
  return typeof value==='number'&&Number.isFinite(value)
    ? Math.max(MIN_FONT_SCALE,Math.min(MAX_FONT_SCALE,Math.round(value/5)*5)) : DEFAULT_FONT_SCALE;
}

/** CSS points use 96 px/inch: the default increase is 2 pt, or 8/3 px. */
export const fontPixels=(original:number,scale=DEFAULT_FONT_SCALE)=>(original+8/3)*normalizeFontScale(scale)/100;
export function replayTextMetrics(scale=DEFAULT_FONT_SCALE) {
  const font=fontPixels(11,scale),ratio=font/11;
  const headerHeight=Math.ceil(font+7),rowHeight=Math.ceil(font+12);
  const rowWidth=Math.round(160*ratio);
  return {font,headerHeight,headerInset:headerHeight+2,rowHeight,rowStride:rowHeight+2,
    rowWidth,groupWidth:rowWidth+8,columnStride:rowWidth+14};
}
